const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(options = {}) {
  let definition;
  const calls = [], modals = [], toasts = [], storage = new Map();
  const wx = { showLoading() {}, hideLoading() {}, showToast: v => toasts.push(v.title),
    showModal: v => modals.push(v), getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key),
    requestPayment: v => { calls.push(['payment']); v.success({}); v.complete(); },
    reLaunch() {}, redirectTo: v => calls.push(['redirect', v.url]) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/checkout/checkout.js'), 'utf8'), {
    Page: v => { definition = v; }, wx, console: { error() {} }, setTimeout() {},
    require(name) {
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/purchaseNotice')) return require('../../utils/purchaseNotice');
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/api')) return {
        get: async (url, data) => {
          calls.push(['get', url, data]);
          if (url === '/orders/shipping-quote') return options.quote ? options.quote(data) : {
            shippingFee: data.province === '西藏' ? '15.00' : '12.00', maxQuantity: data.province === '西藏' ? 3 : 5,
            allowed: data.quantity <= (data.province === '西藏' ? 3 : 5), message: data.quantity > 3 ? '收货地址每单最多3件，请修改地址或商品' : '' };
          return { product: { name: '测试商品' } };
        },
        post: async (url, body) => { calls.push(['post', url, body]); return options.post ? options.post(url, body) : url === '/orders' ? { id: '123' } : { package: 'test', timeStamp: '1' }; },
        delete: async url => calls.push(['delete', url])
      };
      throw new Error('未配置模块：' + name);
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(v) { Object.assign(this.data, v); } };
  page.data.checkoutItems = [{ id: '1', productId: '10', skuId: '11', name: '普通商品', price: '10.01', count: 1 },
    { id: '2', productId: '20', skuId: '21', name: '套装', price: '20.00', count: 2, bundleConfig: [{ count: 3, skuId: '22' }] }];
  page.data.address = { recipient: '买家', phone: '13800000000', province: '西藏', city: '拉萨', district: '城关', detail: '测试地址' };
  page.data.purchaseNoticeAgreed = true;
  page.data.purchaseNoticeReady = true;
  return { page, calls, modals, toasts, storage };
}
const event = (index, delta) => ({ currentTarget: { dataset: { index, delta } } });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('套装按购买套数计件，西藏整单只加15元，金额按分计算', async () => {
  const { page, calls } = harness();
  await page.refreshShippingQuote();
  assert.equal(page.data.itemQuantity, 3);
  assert.equal(page.data.goodsAmount, '50.01');
  assert.equal(page.data.totalPrice, '65.01');
  assert.equal(calls[0][2].quantity, 3);
  await page.submitOrder();
  const payload = calls.find(c => c[1] === '/orders')[2];
  assert.equal(payload.expectedShippingFee, '15.00');
  assert.equal(payload.items[1].qty, 2);
  assert.ok(calls.some(c => c[0] === 'payment'));
  assert.ok(!calls.some(c => c[0] === 'delete'));
});

test('超限不创建订单，减少数量或换地址后可再次提交', async () => {
  const { page, calls, modals } = harness();
  await page.changeQuantity(event(0, 1));
  await page.submitOrder();
  assert.equal(page.data.itemQuantity, 4);
  assert.equal(modals[0].title, '收货地址件数限制');
  assert.ok(!calls.some(c => c[1] === '/orders'));
  page.setData({ address: { ...page.data.address, province: '新疆' } });
  await page.refreshShippingQuote();
  assert.equal(page.data.shippingAllowed, true);
  assert.equal(page.data.shippingFee, '12.00');
  await page.changeQuantity(event(0, -1));
  assert.equal(page.data.itemQuantity, 3);
});

test('移除商品仅改本次结算，立即购买同步本地数据，移除全部不能支付', async () => {
  const { page, calls, storage } = harness();
  page._localCheckout = true;
  await page.removeItem(event(0));
  assert.equal(page.data.checkoutItems.length, 1);
  assert.equal(storage.get('checkoutItems').length, 1);
  assert.equal(page.data.itemQuantity, 2);
  await page.removeItem(event(0));
  await page.submitOrder();
  assert.equal(page.data.shippingReady, false);
  assert.equal(page.data.totalPrice, '0.00');
  assert.ok(!calls.some(c => c[1] === '/orders' || c[0] === 'delete'));
});

test('无地址、报价失败和正在加载都阻止提交，重试可恢复', async () => {
  let fail = true;
  const { page, calls } = harness({ quote: async () => { if (fail) throw new Error('运费加载失败'); return { shippingFee: '15.00', allowed: true }; } });
  await page.refreshShippingQuote();
  await page.submitOrder();
  assert.match(page.data.shippingError, /加载失败/);
  assert.ok(!calls.some(c => c[1] === '/orders'));
  fail = false;
  await page.refreshShippingQuote();
  assert.equal(page.data.shippingReady, true);
  page.setData({ address: null });
  await page.refreshShippingQuote();
  assert.equal(page.data.shippingReady, false);
});

test('快速换省份的旧报价不能覆盖最新省份的运费', async () => {
  const first = deferred(), second = deferred();
  const { page } = harness({ quote: data => data.province === '西藏' ? first.promise : second.promise });
  const a = page.refreshShippingQuote();
  page.setData({ address: { ...page.data.address, province: '新疆' } });
  const b = page.refreshShippingQuote();
  second.resolve({ shippingFee: '12.00', allowed: true, maxQuantity: 5 }); await b;
  first.resolve({ shippingFee: '15.00', allowed: false, maxQuantity: 3 }); await a;
  assert.equal(page.data.shippingFee, '12.00');
  assert.equal(page.data.maxQuantity, 5);
  assert.equal(page.data.shippingAllowed, true);
});

test('提交时运费变化，刷新报价并留在结算页，不创建订单或自动支付', async () => {
  let fee = '15.00';
  const { page, calls, modals } = harness({ quote: async () => ({ shippingFee: fee, allowed: true }),
    post: async () => { fee = '18.00'; throw { code: 'SHIPPING_FEE_CHANGED', message: '运费已变化，请再次提交', statusCode: 409 }; } });
  await page.refreshShippingQuote();
  await page.submitOrder();
  assert.equal(page.data.shippingFee, '18.00');
  assert.equal(page.data.submitting, false);
  assert.equal(modals[0].title, '运费已更新');
  assert.ok(!calls.some(c => c[0] === 'payment' || c[0] === 'redirect'));
});

test('订单创建后再次点击跳转原订单，避免支付取消后重复下单', async () => {
  const { page, calls } = harness();
  await page.refreshShippingQuote(); await page.submitOrder(); await page.submitOrder();
  assert.equal(calls.filter(c => c[1] === '/orders').length, 1);
  assert.ok(calls.some(c => c[0] === 'redirect' && c[1].endsWith('id=123')));
});
