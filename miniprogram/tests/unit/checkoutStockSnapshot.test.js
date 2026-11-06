const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const item = overrides => ({ productId: 'p1', skuId: 's1', name: '羽绒服', price: 10, count: 3, readyStockQty: 2, ...overrides });
function goodsQuote(items, stock = 0) {
  const remaining = new Map();
  const lines = items.flatMap((row, requestIndex) => (row.bundleConfig || [{ skuId: row.skuId, count: 1, price: row.salePrice }]).map(sub => {
    const quantity = row.qty * sub.count;
    const free = remaining.has(sub.skuId) ? remaining.get(sub.skuId) : stock;
    const readyStockQty = Math.min(quantity, free);remaining.set(sub.skuId, free - readyStockQty);
    return { requestIndex, skuId: sub.skuId, quantity, readyStockQty, settlementAmount: quantity * sub.price };
  }));
  const amount = lines.reduce((sum, row) => sum + row.settlementAmount, 0);
  return { originalGoodsAmount: amount, goodsAmount: amount, discountAmount: 0, applied: [], items: lines };
}
function setup({ source = 'sku', items = [item()], quote, create, shipping } = {}) {
  let definition;const calls = [], modals = [], storage = new Map([['checkoutSource', source], ['checkoutItems', items]]);
  const api = {
    get: async (url, data) => {
      calls.push({ url, data, method: 'GET' });
      if (url === '/orders/shipping-quote') return shipping ? shipping(data) : { shippingFee: data.province === '西藏' ? 40 : 8, allowed: true };
      if (url === '/cart/selected') return { items: items.map(row => ({ ...row, productName: row.name })) };
      return { product: { id: 'p1', name: '羽绒服' } };
    },
    post: async (url, data) => {
      calls.push({ url, data: copy(data), method: 'POST' });
      if (url === '/orders') return create ? create(data) : { id: 'order1', items: [{ readyStockQty: 0 }] };
      if (url.endsWith('/pay/wechat')) return {};
      return quote ? quote(data) : goodsQuote(data.items, 1);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/checkout/checkout.js'), 'utf8'), {
    Page(value) { definition = value; }, console: { error() {} }, setTimeout() {},
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/skuSelectionDraft')) return { clearCheckoutDrafts() {} };
      if (name.endsWith('/purchaseNotice')) return { buildPurchaseNoticeSections: () => [] };
      return require(path.resolve(__dirname, '../../utils', path.basename(name)));
    },
    wx: { getStorageSync: key => storage.get(key), removeStorageSync: key => storage.delete(key),
      showToast() {}, showLoading() {}, hideLoading() {}, redirectTo() {}, reLaunch() {},
      showModal(options) { modals.push(options);options.success({ confirm: false }); },
      requestPayment(options) { options.fail({ errMsg: 'requestPayment:fail cancel' });options.complete(); },
      chooseAddress(options) { options.success({ userName: '买家', telNumber: '13800000000', provinceName: '上海市', cityName: '上海市', countyName: '浦东新区', detailInfo: '测试地址' }); }
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  return { page, calls, modals, storage };
}
const quotes = env => env.calls.filter(call => call.url === '/orders/goods-quote');

test('直接购买保留SKU打开时的现货快照，选地址、切地址及重算运费不重查SKU或商品报价', async () => {
  const env = setup();await env.page.onLoad();
  assert.equal(quotes(env)[0].data.includeReadyStock, false);
  assert.equal(env.page.data.checkoutDisplayItems[0].readyStockQty, 2, '金额报价的新现货不覆盖已确认快照');
  env.page.chooseAddress();await tick();env.page.data.address.province = '西藏';await env.page.refreshShippingQuote();
  assert.equal(quotes(env).length, 1);assert.equal(env.page.data.shippingFee, '40.00');assert.equal(env.page.data.totalPrice, '70.00');
  assert.equal(env.calls.filter(call => call.url === '/products/p1').length, 1, '购买须知只加载一次');
  assert.deepEqual(copy(env.page.buildReadyStockExpectation()), [{ skuId: 's1', readyStockQty: 2 }]);
});

test('购物车首次按最新正常现货优先匹配，同SKU多行与套装共享预算；地址不再次匹配', async () => {
  const env = setup({ source: 'cart', items: [item({ id: 'c1', readyStockQty: 99 }), item({ id: 'c2', count: 2 }),
    item({ id: 'c3', count: 2, price: 20, bundleConfig: [{ skuId: 's1', count: 1, price: 10 }, { skuId: 's2', count: 1, price: 10 }] })],
    quote: data => goodsQuote(data.items, 4) });
  await env.page.onLoad();assert.equal(env.page._localCheckout, false);assert.equal(quotes(env)[0].data.includeReadyStock, true);
  assert.deepEqual(copy(env.page.data.checkoutDisplayItems.map(row => row.readyStockQty)), [3, 1, 2]);
  assert.deepEqual(copy(env.page.data.checkoutDisplayItems[2].bundleConfig.map(row => row.readyStockQty)), [0, 2]);
  env.page.chooseAddress();await tick();await env.page.refreshShippingQuote();assert.equal(quotes(env).length, 1);
  env.page.data.purchaseNoticeAgreed = true;await env.page.submitOrder();
  const request = env.calls.find(call => call.url === '/orders').data;
  assert.deepEqual(request.items.map(row => row.cartItemId), ['c1', 'c2', 'c3']);
  assert.deepEqual(request.expectedReadyStock, [{ skuId: 's1', readyStockQty: 4 }, { skuId: 's2', readyStockQty: 2 }]);
});

test('旧购物车本地入口和后端已选入口均能首次匹配现货', async () => {
  for (const local of [true, false]) {
    const env = setup({ source: undefined, items: [item({ id: 'c1' })] });env.storage.delete('checkoutSource');
    if (!local) env.storage.delete('checkoutItems');
    await env.page.onLoad();assert.equal(env.page._localCheckout, false);
    assert.equal(quotes(env)[0].data.includeReadyStock, true);assert.equal(env.page.data.checkoutDisplayItems[0].readyStockQty, 1);
  }
});

test('购物车首次报价未返回完整现货时阻止支付，重试仍匹配现货', async () => {
  let attempt = 0;
  const env = setup({ source: 'cart', quote: data => {
    const result = goodsQuote(data.items, 1);if (++attempt === 1) result.items = [];return result;
  } });
  await env.page.onLoad();assert.equal(env.page.data.goodsQuoteReady, false);assert.match(env.page.data.shippingError, /匹配失败/);
  assert.equal(env.page._matchReadyStockOnLoad, true);
  await env.page.refreshShippingQuote();assert.equal(quotes(env)[1].data.includeReadyStock, true);
  assert.equal(env.page.data.goodsQuoteReady, true);assert.equal(env.page.data.checkoutDisplayItems[0].readyStockQty, 1);
});

test('初次报价未完成时选择地址复用同一请求，现货只匹配一次', async () => {
  let finish;const env = setup({ source: 'cart', quote: data => new Promise(resolve => { finish = () => resolve(goodsQuote(data.items, 1)); }) });
  const loading = env.page.onLoad();await tick();env.page.chooseAddress();await tick();
  assert.equal(quotes(env).length, 1);finish();await loading;await tick();
  assert.equal(env.page.data.shippingReady, true);assert.equal(env.page.data.goodsQuoteReady, true);
  assert.equal(env.page.data.checkoutDisplayItems[0].readyStockQty, 1);
});

test('SKU套装快照按实际子件计算，重新计算价格不改变预期现货', async () => {
  const env = setup({ items: [item({ count: 2, price: 30, bundleConfig: [
    { skuId: 's1', count: 2, price: 10, readyStockQty: 3 }, { skuId: 's2', count: 1, price: 10, readyStockQty: 1 }
  ] })] });await env.page.onLoad();await env.page.refreshShippingQuote({ refreshGoods: true });
  assert.equal(quotes(env).length, 2);assert.ok(quotes(env).every(row => row.data.includeReadyStock === false));
  assert.equal(env.page.data.checkoutDisplayItems[0].readyStockQty, 4);
  assert.deepEqual(copy(env.page.buildReadyStockExpectation()), [{ skuId: 's1', readyStockQty: 3 }, { skuId: 's2', readyStockQty: 1 }]);
});

test('选地址的运费慢于首次现货匹配时，也保留已完成的报价并避免重新匹配', async () => {
  let finishQuote, finishShipping;
  const env = setup({ source: 'cart',
    quote: data => new Promise(resolve => { finishQuote = () => resolve(goodsQuote(data.items, 1)); }),
    shipping: () => new Promise(resolve => { finishShipping = () => resolve({ shippingFee: 8, allowed: true }); }) });
  const loading = env.page.onLoad();await tick();env.page.chooseAddress();await tick();
  finishQuote();await loading;assert.equal(quotes(env).length, 1);
  finishShipping();await tick();assert.equal(quotes(env).length, 1);
  assert.equal(env.page.data.shippingReady, true);assert.equal(env.page.data.checkoutDisplayItems[0].readyStockQty, 1);
});

test('地址变更不降低预期现货，立即支付仍检测被其他订单占用的库存并提示', async () => {
  const env = setup({ create: () => { throw { code: 'READY_STOCK_CHANGED', details: {
    shortages: [{ productName: '羽绒服', color: '黑色', size: 'M', readyStockQty: 0 }], currentReadyStock: [{ skuId: 's1', readyStockQty: 0 }]
  } }; } });await env.page.onLoad();env.page.chooseAddress();await tick();env.page.data.purchaseNoticeAgreed = true;
  await env.page.submitOrder();assert.equal(env.calls.find(row => row.url === '/orders').data.expectedReadyStock[0].readyStockQty, 2);
  assert.equal(env.modals[0].title, '');assert.equal(env.modals[0].content, '现货数量不足，请重新下单哦~');
  assert.equal(env.page.data.checkoutDisplayItems[0].readyStockQty, 0, '用户收到提示后才更新快照');
});
