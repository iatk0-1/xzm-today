const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(options = {}) {
  let definition;
  let lastShippingFee = '0.00';
  const calls = [], modals = [], toasts = [], storage = new Map();
  const wx = { showLoading() {}, hideLoading() {}, showToast: v => toasts.push(v.title),
    showModal: v => modals.push(v), getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key),
    requestPayment: v => { calls.push(['payment']); v.success({}); v.complete(); },
    reLaunch() {}, redirectTo: v => calls.push(['redirect', v.url]) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/checkout/checkout.js'), 'utf8'), {
    Page: v => { definition = v; }, wx, console: { error() {} }, setTimeout() {},
    require(name) {
      if (name.endsWith('/skuSelectionDraft')) return require('../../utils/skuSelectionDraft');
      if (name.endsWith('/skuPromotionDisplay')) return require('../../utils/skuPromotionDisplay');
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/purchaseNotice')) return require('../../utils/purchaseNotice');
      if (name.endsWith('/customerServiceNavigation')) return require('../../utils/customerServiceNavigation');
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/api')) return {
        get: async (url, data) => {
          calls.push(['get', url, data]);
          if (url === '/orders/shipping-quote') { const result = await (options.quote ? options.quote(data) : {
            shippingFee: (Math.ceil(data.quantity / (data.province === '西藏' ? 1 : 5)) * (data.province === '西藏' ? 15 : 12)).toFixed(2),
            firstQuantity: data.province === '西藏' ? 1 : 5, allowed: true, message: '' });lastShippingFee = result.shippingFee;return result; }
          return { product: { name: '测试商品' } };
        },
        post: async (url, body) => {
          calls.push(['post', url, body]);
          if (url === '/orders/quote' || url === '/orders/goods-quote') {
            if (options.goodsQuote) return options.goodsQuote(body, url);
            const total = body.items.reduce((sum, item) => sum + Math.round(item.salePrice * 100) * item.qty, 0) / 100;
            return { originalGoodsAmount: total, goodsAmount: total, discountAmount: 0, applied: [], shippingFee: lastShippingFee };
          }
          return options.post ? options.post(url, body) : url === '/orders' ? { id: '123' } : { package: 'test', timeStamp: '1' };
        },
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
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('结算按后端首单和满减展示原商品合计及优惠，合计含运费，下单仍传原价并核对实付', async () => {
  const { page, calls } = harness({ goodsQuote: async () => ({ originalGoodsAmount: '50.01', goodsAmount: '35.01', discountAmount: '15.00', shippingFee: '45.00',
    applied: [{ scheme: { type: 'FIRST' }, discountAmount: '5.00' }, { scheme: { type: 'AMOUNT' }, discountAmount: '10.00' }] }) });
  await page.refreshShippingQuote();
  assert.equal(page.data.originalGoodsAmount, '50.01');assert.equal(page.data.goodsAmount, '35.01');
  assert.equal(page.data.discountAmount, '15.00');assert.equal(page.data.totalPrice, '80.01');
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.promotionRows.map(row => row.label))), ['首单优惠', '满减优惠']);
  await page.submitOrder();const request = calls.find(row => row[1] === '/orders')[2];
  assert.equal(request.expectedPayAmount, '80.01');assert.equal(request.expectedShippingFee, '45.00');
  assert.equal(request.items[0].salePrice, 10.01);assert.equal(request.items[1].salePrice, 20);
});

test('没有地址仍能计算优惠后货款，快递费保持待计算且不能提交订单', async () => {
  const { page, calls } = harness({ goodsQuote: async () => ({ originalGoodsAmount: 50.01, goodsAmount: 45.01, discountAmount: 5,
    applied: [{ scheme: { type: 'FIRST' }, discountAmount: 5 }] }) });
  page.data.address = null;await page.refreshShippingQuote();
  assert.equal(page.data.totalPrice, '45.01');assert.equal(page.data.goodsQuoteReady, true);assert.equal(page.data.shippingReady, false);
  assert.ok(calls.some(row => row[1] === '/orders/goods-quote'));await page.submitOrder();assert.ok(!calls.some(row => row[1] === '/orders'));
});

test('优惠报价失败不把原价当作最终支付金额，重试前拦截下单', async () => {
  const { page, calls } = harness({ goodsQuote: async () => { throw new Error('优惠报价失败'); } });
  await page.refreshShippingQuote();assert.equal(page.data.goodsQuoteReady, false);assert.match(page.data.shippingError, /优惠报价失败/);
  await page.submitOrder();assert.ok(!calls.some(row => row[1] === '/orders'));
});

test('提交时首单资格失效，重新报价并要求核对，不自动重下单或支付', async () => {
  let changed = false;
  const { page, calls, modals } = harness({ goodsQuote: async () => ({ originalGoodsAmount: 50.01, goodsAmount: changed ? 50.01 : 45.01,
    discountAmount: changed ? 0 : 5, shippingFee: 45, applied: changed ? [] : [{ scheme: { type: 'FIRST' }, discountAmount: 5 }] }),
    post: async () => { changed = true;throw { statusCode: 409, message: '首单优惠或商品金额已变化' }; } });
  await page.refreshShippingQuote();assert.equal(page.data.totalPrice, '90.01');await page.submitOrder();
  assert.equal(page.data.totalPrice, '95.01');assert.equal(page.data.discountAmount, '0.00');assert.equal(page.data.orderCreated, false);
  assert.equal(calls.filter(row => row[1] === '/orders').length, 1);assert.ok(!calls.some(row => row[0] === 'payment'));
  assert.equal(modals[0].title, '订单金额或状态已更新');
});

test('套装按购买套数计件，西藏首单1件时3件收45元，金额按分计算', async () => {
  const { page, calls } = harness();
  await page.refreshShippingQuote();
  assert.equal(page.data.itemQuantity, 3);
  assert.equal(page.data.goodsAmount, '50.01');
  assert.equal(page.data.shippingFee, '45.00');
  assert.equal(page.data.totalPrice, '95.01');
  assert.equal(calls[0][2].quantity, 3);
  await page.submitOrder();
  const payload = calls.find(c => c[1] === '/orders')[2];
  assert.equal(payload.expectedShippingFee, '45.00');
  assert.equal(payload.items[1].qty, 2);
  assert.ok(calls.some(c => c[0] === 'payment'));
  assert.ok(!calls.some(c => c[0] === 'delete'));
});

test('换地址后重新计算运费，商品数量保持不变', async () => {
  const { page } = harness();
  const items = JSON.stringify(page.data.checkoutItems);
  await page.refreshShippingQuote();
  assert.equal(page.data.shippingFee, '45.00');
  page.setData({ address: { ...page.data.address, province: '新疆' } });
  await page.refreshShippingQuote();
  assert.equal(page.data.shippingAllowed, true);
  assert.equal(page.data.shippingFee, '12.00');
  assert.equal(page.data.itemQuantity, 3);
  assert.equal(JSON.stringify(page.data.checkoutItems), items);
});

test('结算页没有修改数量和移除入口，空商品仍不能提交，运费浮层可开关', async () => {
  const { page, calls } = harness();
  assert.equal(page.changeQuantity, undefined);
  assert.equal(page.removeItem, undefined);
  page.toggleShippingTip(); assert.equal(page.data.showShippingTip, true);
  page.closeShippingTip(); assert.equal(page.data.showShippingTip, false);
  page.toggleShippingTip(); page.toggleShippingTip(); assert.equal(page.data.showShippingTip, false);
  const template = fs.readFileSync(path.join(__dirname, '../../pages/checkout/checkout.wxml'), 'utf8');
  assert.ok(!/changeQuantity|removeItem|移除商品/.test(template));
  assert.match(template, /catchtap="toggleShippingTip"/);
  assert.match(template, /西藏、新疆等特殊地区按照商品件数计算运费。/);
  page.setData({ checkoutItems: [] });
  await page.refreshShippingQuote();
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
  second.resolve({ shippingFee: '12.00', allowed: true, firstQuantity: 5 }); await b;
  first.resolve({ shippingFee: '45.00', allowed: true, firstQuantity: 1 }); await a;
  assert.equal(page.data.shippingFee, '12.00');
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
