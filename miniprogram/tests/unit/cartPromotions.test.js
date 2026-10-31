const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve;const promise = new Promise(r => { resolve = r; });return { promise, resolve }; };
const event = (index, type) => ({ currentTarget: { dataset: { index, type } } });
const fixture = () => [
  { id: '1', productId: 'p1', skuId: 's1', price: 1, count: 1, selected: true, stockMain: 100, validityStatus: 'valid', stockStatus: 'in_stock', productStatus: 'on' },
  { id: '2', productId: 'p2', skuId: 's2', price: 2, count: 1, selected: true, stockMain: 100, validityStatus: 'valid', stockStatus: 'in_stock', productStatus: 'on' }
];
function quote(original, goods, applied) {
  return { originalGoodsAmount: original, goodsAmount: goods,
    discountAmount: (Math.round(original * 100) - Math.round(goods * 100)) / 100, applied };
}
const applied = (type, amount) => ({ scheme: { type }, discountAmount: amount });

function setup(options = {}) {
  let definition;const calls = [], toasts = [], navigation = [], storage = new Map();
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/cart/cart.js'), 'utf8'), {
    Page(value) { definition = value; }, console: { error() {} },
    wx: { showLoading() {}, hideLoading() {}, showToast: data => toasts.push(data.title),
      setStorageSync: (key, value) => storage.set(key, plain(value)), navigateTo: data => navigation.push(data.url) },
    require(name) {
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/skuPromotionDisplay')) return require('../../utils/skuPromotionDisplay');
      if (name.endsWith('/pageSync')) return { wrap: config => config };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/api')) return {
        get: async url => { calls.push({ method: 'GET', url });return { items: options.items ? options.items() : fixture() }; },
        post: async (url, data) => {
          calls.push({ method: 'POST', url, data: plain(data) });
          if (options.post) return options.post(url, data);
          const original = data.items.reduce((sum, item) => sum + Math.round(item.salePrice * 100) * item.qty, 0) / 100;
          return quote(original, original, []);
        },
        patch: async url => calls.push({ method: 'PATCH', url }),
        put: async (url, data) => calls.push({ method: 'PUT', url, data: plain(data) }),
        delete: async url => calls.push({ method: 'DELETE', url })
      };
      throw new Error('未配置测试模块：' + name);
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  return { page, calls, toasts, navigation, storage };
}

test('勾选的跨商品一起报价，底部使用服务端优惠后货款且不包含运费', async () => {
  const { page, calls } = setup({ post: async () => ({ ...quote(3, 2.7, [applied('FIRST', 0.1), applied('QUANTITY', 0.2)]), shippingFee: 99 }) });
  await page.onLoad();assert.equal(page.data.originalTotalPrice, '3.00');assert.equal(page.data.totalPrice, '2.70');
  assert.equal(page.data.discountAmount, '0.30');assert.equal(page.data.totalCount, 2);assert.equal(page.data.cartQuoteReady, true);
  const request = calls.find(call => call.method === 'POST');assert.equal(request.url, '/orders/goods-quote');
  assert.deepEqual(request.data, { items: [{ skuId: 's1', qty: 1, salePrice: 1, pool: 'main' }, { skuId: 's2', qty: 1, salePrice: 2, pool: 'main' }] });
  assert.equal(page.data.cartList[0].finalPrice, 1);assert.equal(page.data.cartList[1].finalPrice, 2);
});

test('取消勾选、全选和失效商品过滤都会重新计算，不把未选或失效商品拿去凑单', async () => {
  const rows = fixture();rows.push({ ...rows[0], id: '3', skuId: 'invalid', productStatus: 'off' });
  const { page, calls } = setup({ items: () => rows });await page.onLoad();
  await page.toggleSelect(event(1));assert.equal(page.data.totalPrice, '1.00');assert.equal(page.data.totalCount, 1);
  assert.deepEqual(calls.filter(call => call.method === 'POST').at(-1).data.items.map(item => item.skuId), ['s1']);
  await page.toggleAll();assert.equal(page.data.totalPrice, '3.00');assert.equal(page.data.cartList[2].selected, false);
  const count = calls.filter(call => call.method === 'POST').length;
  await page.toggleAll();assert.equal(page.data.totalPrice, '0.00');assert.equal(page.data.totalCount, 0);
  assert.equal(calls.filter(call => call.method === 'POST').length, count);
});

test('数量加减和删除后重新报价，套装购买数量按套数提交', async () => {
  const { page, calls } = setup();await page.onLoad();
  await page.changeCount(event(0, 'add'));assert.equal(page.data.totalPrice, '4.00');
  assert.equal(calls.filter(call => call.method === 'POST').at(-1).data.items[0].qty, 2);
  await page.changeCount(event(0, 'minus'));assert.equal(page.data.totalPrice, '3.00');
  await page.changeCount(event(0, 'minus'));assert.equal(page.data.cartList.length, 1);assert.equal(page.data.totalPrice, '2.00');
  await page.deleteItem(event(0));assert.equal(page.data.totalPrice, '0.00');assert.equal(page.data.cartQuoteReady, true);
});

test('快速改变勾选，较早返回的旧报价不能覆盖最新清单金额', async () => {
  const first = deferred(), second = deferred();let requests = 0;
  const { page } = setup({ post: () => ++requests === 1 ? first.promise : second.promise });
  const load = page.onLoad();await new Promise(resolve => setImmediate(resolve));
  page.data.cartList[1].selected = false;const latest = page.calculateTotal();
  second.resolve(quote(1, 0.9, [applied('FIRST', 0.1)]));await latest;assert.equal(page.data.totalPrice, '0.90');
  first.resolve(quote(3, 2.7, [applied('FIRST', 0.3)]));await load;
  assert.equal(page.data.totalPrice, '0.90');assert.equal(page.data.totalCount, 1);assert.equal(page.data.cartQuoteLoading, false);
});

test('清空选择会使在途报价失效，购物车合计保持零元', async () => {
  const pending = deferred();const { page, calls } = setup({ post: () => pending.promise });
  const loading = page.onLoad();await new Promise(resolve => setImmediate(resolve));
  page.data.cartList.forEach(item => { item.selected = false; });await page.calculateTotal();
  assert.equal(page.data.totalPrice, '0.00');assert.equal(page.data.cartQuoteReady, true);
  pending.resolve(quote(3, 2.7, [applied('RATE', 0.3)]));await loading;
  assert.equal(page.data.totalPrice, '0.00');assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('报价失败时不能把原价当成交价结算，重新加载后恢复；立即结算仍保留原价', async () => {
  let fail = true;const { page, navigation, storage } = setup({ post: async () => {
    if (fail) throw new Error('优惠计算失败');return quote(3, 2.8, [applied('AMOUNT', 0.2)]);
  } });
  await page.onLoad();assert.equal(page.data.cartQuoteReady, false);assert.match(page.data.cartQuoteError, /优惠计算失败/);
  page.goToCheckout();assert.equal(navigation.length, 0);
  fail = false;await page.loadCartData();assert.equal(page.data.totalPrice, '2.80');
  page.goToCheckout();assert.equal(navigation[0], '/pages/checkout/checkout');
  assert.deepEqual(storage.get('checkoutItems').map(item => item.finalPrice), [1, 2]);
});

test('从其他页面返回会刷新首单资格，已占用首单时采用后端不含首单的报价', async () => {
  let used = false;const { page, calls } = setup({ post: async () => used ? quote(3, 2.8, [applied('QUANTITY', 0.2)]) :
    quote(3, 2.7, [applied('FIRST', 0.1), applied('QUANTITY', 0.2)]) });
  await page.onLoad();assert.equal(page.data.totalPrice, '2.70');used = true;await page.onShow();
  assert.equal(page.data.totalPrice, '2.80');assert.equal(calls.filter(call => call.method === 'GET').length, 2);
});

test('套装以整数分汇总子项原价，避免小数误差引起权威价格校验失败', async () => {
  const row = { ...fixture()[0], count: 2, bundleConfig: [{ skuId: 'a', price: 0.1, count: 3 }, { skuId: 'b', price: 0.2, count: 2 }] };
  const { page, calls } = setup({ items: () => [row], post: async () => quote(1.4, 1.35, [applied('FIRST', 0.05)]) });
  await page.onLoad();assert.equal(page.data.cartList[0].price, 0.7);assert.equal(page.data.totalPrice, '1.35');
  const request = calls.find(call => call.method === 'POST').data.items[0];assert.equal(request.salePrice, 0.7);assert.equal(request.qty, 2);
  assert.deepEqual(request.bundleConfig.map(child => child.count), [3, 2]);
});

test('卸载后在途报价不能回写页面，非法金额响应也不能进入可结算状态', async () => {
  const pending = deferred();const { page } = setup({ post: () => pending.promise });
  const load = page.onLoad();await new Promise(resolve => setImmediate(resolve));page.onUnload();
  const writes = [];page.setData = value => writes.push(value);pending.resolve(quote(3, 2.7, [applied('FIRST', 0.3)]));await load;
  assert.equal(writes.length, 0);
  const bad = setup({ post: async () => quote(99, 1, [applied('FIRST', 98)]) });await bad.page.onLoad();assert.equal(bad.page.data.cartQuoteReady, false);
});
