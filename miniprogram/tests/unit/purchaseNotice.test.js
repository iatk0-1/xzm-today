const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const notices = require('../../utils/purchaseNotice');

function harness({ get, post, authenticate, payment } = {}) {
  let definition;
  const calls = [];
  const toasts = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/checkout/checkout.js'), 'utf8'), {
    Page: value => { definition = value; },
    console: { error() {} }, setTimeout() {},
    require(name) {
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/purchaseNotice')) return notices;
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => { if (authenticate) await authenticate(); } };
      if (name.endsWith('/api')) return {
        get: async url => { calls.push(['get', url]); return get ? get(url) : { product: { name: '衣服' } }; },
        post: async (url, body) => {
          calls.push(['post', url, body]);
          return post ? post(url, body) : url === '/orders' ? { id: '123' } : { package: 'prepay_id=test', timeStamp: '1' };
        },
        delete: async () => {}
      };
      throw new Error('未配置模块：' + name);
    },
    wx: {
      showToast: value => toasts.push(value.title), showLoading() {}, hideLoading() {}, showModal() {},
      requestPayment: options => { calls.push(['payment']); if (payment) payment(options); else options.complete(); },
      getStorageSync: () => [], removeStorageSync() {}, reLaunch() {}
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  page.data.address = { recipient: '测试买家', phone: '13800000000', province: '测试省', city: '测试市', district: '测试区', detail: '测试地址' };
  page.data.checkoutItems = [{ productId: '90071992547409931', skuId: '90071992547409932', name: '衣服', count: 1, price: 20 }];
  return { page, calls, toasts };
}

test('旧商品和空文案使用完整默认须知，自定义文案保留原有换行', () => {
  assert.equal(notices.getPurchaseNotice(null), notices.DEFAULT_PURCHASE_NOTICE);
  assert.equal(notices.getPurchaseNotice('  '), notices.DEFAULT_PURCHASE_NOTICE);
  assert.equal(notices.getPurchaseNotice('第一行\n第二行'), '第一行\n第二行');
  assert.ok(notices.DEFAULT_PURCHASE_NOTICE.startsWith('【下单即默认同意以下全部规则哦，介意勿拍！】\n'));
  assert.ok(notices.DEFAULT_PURCHASE_NOTICE.endsWith('感谢理解🙏'));
});

test('多商品相同须知去重，不同须知按商品完整展示', () => {
  const sections = notices.buildPurchaseNoticeSections([
    { name: '上衣', purchaseNotice: '规则一' }, { name: '裤子', purchaseNotice: '规则一' },
    { name: '外套', purchaseNotice: '规则二' }
  ]);
  assert.deepEqual(sections.map(section => [section.title, section.content]), [['上衣、裤子', '规则一'], ['外套', '规则二']]);
});

test('立即购买结算默认勾选，从详情读取最新须知且保留大整数商品编号', async () => {
  const { page, calls } = harness({ get: async () => ({ product: { name: '衣服', purchaseNotice: '最新规则' } }) });
  await page.loadLocalCheckoutItems(page.data.checkoutItems);
  assert.equal(page.data.purchaseNoticeAgreed, true);
  assert.equal(page.data.purchaseNoticeReady, true);
  assert.equal(page.data.purchaseNoticeSections[0].content, '最新规则');
  assert.deepEqual(calls[0], ['get', '/products/90071992547409931']);
  await page.openPurchaseNotice();
  assert.equal(page.data.showPurchaseNotice, true);
  assert.equal(page.data.purchaseNoticeAgreed, true);
  page.closePurchaseNotice();
  assert.equal(page.data.showPurchaseNotice, false);
});

test('购物车结算相同商品多款式只查询一次，旧商品展示默认须知', async () => {
  const { page, calls } = harness({ get: async url => url === '/cart/selected' ? {
    items: [{ productId: '10', skuId: '11', price: 20, count: 1 }, { productId: '10', skuId: '12', price: 20, count: 1 }]
  } : { product: { name: '旧衣服' } } });
  await page.loadCartSelectedItems();
  assert.equal(page.data.totalPrice, '40.00');
  assert.equal(calls.filter(call => call[1] === '/products/10').length, 1);
  assert.equal(page.data.purchaseNoticeSections[0].content, notices.DEFAULT_PURCHASE_NOTICE);
});

test('取消勾选后外部和内部提交入口都不创建订单、不调用支付', async () => {
  const { page, calls, toasts } = harness();
  page.data.purchaseNoticeReady = true;
  page.togglePurchaseNoticeAgreement();
  await page.submitOrder();
  await page.submitOrderInternal();
  assert.equal(calls.length, 0);
  assert.equal(toasts[0], '请先阅读并同意购买须知');
});

test('须知加载失败拦住下单，点击须知重试成功后可阅读', async () => {
  let failed = true;
  const { page, calls } = harness({ get: async () => {
    if (failed) throw new Error('网络失败');
    return { product: { name: '衣服', purchaseNotice: '商品规则' } };
  } });
  await page.loadPurchaseNotices();
  await page.submitOrder();
  assert.equal(page.data.purchaseNoticeReady, false);
  assert.equal(calls.some(call => call[0] === 'post'), false);
  failed = false;
  await page.openPurchaseNotice();
  assert.equal(page.data.showPurchaseNotice, true);
  assert.equal(page.data.purchaseNoticeSections[0].content, '商品规则');
});

test('勾选后允许创建订单和支付，处理期间重复点击不重复下单', async () => {
  let finishPayment;
  const { page, calls } = harness({ payment: options => { finishPayment = options.complete; } });
  await page.loadPurchaseNotices();
  const submitting = page.submitOrder();
  await new Promise(resolve => setImmediate(resolve));
  page.togglePurchaseNoticeAgreement();
  await page.submitOrder();
  assert.equal(page.data.purchaseNoticeAgreed, true);
  assert.equal(page.data.submitting, true);
  assert.equal(calls.filter(call => call[1] === '/orders').length, 1);
  assert.equal(calls.filter(call => call[1] === '/orders/123/pay/wechat').length, 1);
  assert.equal(calls.filter(call => call[0] === 'payment').length, 1);
  finishPayment();
  await submitting;
  assert.equal(page.data.submitting, false);
});

test('认证等待期间失去同意状态，不发送订单请求', async () => {
  const { page, calls } = harness({ authenticate: async () => { page.data.purchaseNoticeAgreed = false; } });
  page.data.purchaseNoticeReady = true;
  await page.submitOrder();
  assert.equal(calls.length, 0);
  assert.equal(page.data.submitting, false);
});

test('订单响应期间失去同意状态，不发送预支付请求', async () => {
  const { page, calls } = harness({ post: async () => { page.data.purchaseNoticeAgreed = false; return { id: '123' }; } });
  page.data.purchaseNoticeReady = true;
  await page.submitOrder();
  assert.equal(calls.filter(call => call[0] === 'post').length, 1);
  assert.equal(calls.some(call => call[0] === 'payment'), false);
});

test('预支付响应期间失去同意状态，不拉起微信支付', async () => {
  const { page, calls } = harness({ post: async url => {
    if (url === '/orders') return { id: '123' };
    page.data.purchaseNoticeAgreed = false;
    return { package: 'prepay_id=test' };
  } });
  page.data.purchaseNoticeReady = true;
  await page.submitOrder();
  assert.equal(calls.some(call => call[0] === 'payment'), false);
});
