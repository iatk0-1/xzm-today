const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const display = require('../../utils/skuPromotionDisplay');

function quote(readyStockQty) {
  return { originalGoodsAmount: 30, discountAmount: 0, goodsAmount: 30, applied: [],
    items: [{ requestIndex: 0, skuId: 's1', quantity: 3, settlementAmount: 30, readyStockQty }] };
}
const normal = () => [{ skuId: 's1', count: 3, price: 10, freeStockQty: 90, readyStockQty: 90 }];

test('结算现货只读取本次报价，不使用本地缓存；报价清除、未知、零件或超出购买量时不误显示', () => {
  assert.equal(display.checkoutItemPrices(normal(), quote(2))[0].readyStockQty, 2);
  for (const value of [null, undefined, -1, 4, 1.5, '2']) {
    assert.equal(display.checkoutItemPrices(normal(), quote(value))[0].readyStockQty, null);
  }
  assert.equal(display.checkoutItemPrices(normal(), quote(0))[0].readyStockQty, 0);
  assert.equal(display.checkoutItemPrices(normal(), null)[0].readyStockQty, null);
  assert.equal(normal()[0].readyStockQty, 90, '展示转换不修改原始缓存');
});

test('同SKU多行结算按请求行匹配现货，不重复使用另一行的库存', () => {
  const items = [{ skuId: 's1', count: 3, price: 10 }, { skuId: 's1', count: 2, price: 10 }];
  const result = display.checkoutItemPrices(items, { goodsAmount: 50, discountAmount: 0, items: [
    { requestIndex: 0, skuId: 's1', quantity: 3, settlementAmount: 30, readyStockQty: 2 },
    { requestIndex: 1, skuId: 's1', quantity: 2, settlementAmount: 20, readyStockQty: 0 }
  ] });
  assert.deepEqual(result.map(item => item.readyStockQty), [2, 0]);
});

test('多套套装展示实际子项件数及现货件数，整套现货件数可大于套数', () => {
  const items = [{ skuId: 'a', count: 2, price: 30, bundleConfig: [
    { skuId: 'a', count: 2, price: 10 }, { skuId: 'b', count: 1, price: 10 }
  ] }];
  const result = display.checkoutItemPrices(items, { goodsAmount: 60, discountAmount: 0, items: [
    { requestIndex: 0, skuId: 'a', quantity: 4, settlementAmount: 40, readyStockQty: 3 },
    { requestIndex: 0, skuId: 'b', quantity: 2, settlementAmount: 20, readyStockQty: 1 }
  ] })[0];
  assert.equal(result.readyStockQty, 4);
  assert.equal(result.count, 2);
  assert.deepEqual(result.bundleConfig.map(sub => sub.displayQuantity), [4, 2]);
  assert.deepEqual(result.bundleConfig.map(sub => sub.readyStockQty), [3, 1]);
});

test('订单价格展示保留服务端快照，历史未知不从当前库存回填，套装子项也保留快照', () => {
  const result = display.orderItemPrices({ items: [
    { qty: 3, salePrice: 10, readyStockQty: 2, freeStockQty: 99 },
    { qty: 3, salePrice: 10, freeStockQty: 99 },
    { qty: 1, salePrice: 30, readyStockQty: 4, bundleConfig: [{ skuId: 'a', count: 4, readyStockQty: 3 }] }
  ] }, null);
  assert.equal(result[0].readyStockQty, 2);
  assert.equal(result[1].readyStockQty, undefined);
  assert.equal(result[2].readyStockQty, 4);
  assert.equal(result[2].bundleConfig[0].readyStockQty, 3);
});

function checkout(post) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/checkout/checkout.js'), 'utf8'), {
    Page(value) { definition = value; }, console,
    require(name) {
      if (name.endsWith('/api')) return { post };
      if (name.endsWith('/skuPromotionDisplay')) return display;
      if (name.endsWith('/error')) return require('../../utils/error');
      return {};
    }
  });
  return { ...definition, data: { ...structuredClone(definition.data), checkoutItems: normal() },
    setData(patch) { Object.assign(this.data, patch); } };
}

test('结算刷新报价期间清除旧现货文案，迟到报价不能覆盖最新现货件数', async () => {
  const pending = [];
  const page = checkout(() => new Promise(resolve => pending.push(resolve)));
  const first = page.refreshShippingQuote();
  assert.equal(page.data.checkoutDisplayItems[0].readyStockQty, null);
  pending.shift()(quote(2));await first;
  assert.equal(page.data.checkoutDisplayItems[0].readyStockQty, 2);
  const stale = page.refreshShippingQuote();
  assert.equal(page.data.checkoutDisplayItems[0].readyStockQty, null);
  const latest = page.refreshShippingQuote();
  pending[1](quote(1));await latest;
  pending[0](quote(3));await stale;
  assert.equal(page.data.checkoutDisplayItems[0].readyStockQty, 1);
});
