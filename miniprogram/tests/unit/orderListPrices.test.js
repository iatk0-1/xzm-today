const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const orderId = '374956650504654848';
function discountedOrder() {
  return { id: orderId, status: 'pending', payAmount: '2.70', promotionDiscount: '0.30',
    items: [{ id: '11', salePrice: '1.00', qty: 1, settlementAmount: '0.90' },
      { id: '12', salePrice: '2.00', qty: 1, settlementAmount: '1.80' }] };
}
function setup(order) {
  let config;const reads = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/orderList/orderList.js'), 'utf8'), {
    Page(value) { config = value; }, console,
    wx: { showLoading() {}, hideLoading() {}, showToast() {} },
    require(name) {
      if (name.endsWith('/api')) return { get: async url => { reads.push(url);return { content: [order] }; } };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/skuPromotionDisplay')) return require('../../utils/skuPromotionDisplay');
      if (name.endsWith('/customerServiceOrder')) return require('../../utils/customerServiceOrder');
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/pageSync')) return { wrap: value => value,
        updateList: async (page, changes, options) => {
          assert.equal(changes[0].id, orderId);assert.equal(options.url(orderId), '/orders/' + orderId);
          page.setData({ orders: [options.normalize.call(page, order)] });
        } };
      return {};
    }
  });
  const page = { ...config, data: structuredClone(config.data), setData(patch) { Object.assign(this.data, patch); } };
  return { page, reads };
}

test('优惠订单列表一次请求直接展示成交单价和原价，不为每张订单另取价格明细', async () => {
  const { page, reads } = setup(discountedOrder());await page.loadOrders();
  const order = page.data.orders[0];assert.equal(order.id, orderId);
  assert.equal(order.items[0].displayUnitPrice, '0.90');assert.equal(order.items[0].originalUnitPrice, '1.00');
  assert.equal(order.items[1].displayUnitPrice, '1.80');assert.equal(order.items[1].showOriginalPrice, true);
  assert.equal(order.items[0].salePrice, '1.00');assert.equal(order.payAmount, '2.70');
  assert.deepEqual(reads, ['/orders/query']);
});

test('普通订单没有重复原价，零元成交不回退，套装使用整行成交金额', async () => {
  const order = discountedOrder();order.items = [
    { id: '1', salePrice: 100, qty: 2, settlementAmount: 200 },
    { id: '2', salePrice: 100, qty: 1, settlementAmount: 0 },
    { id: '3', salePrice: 200, qty: 1, settlementAmount: 170, bundleProductName: '套装', bundleConfig: [{ skuId: 'a' }, { skuId: 'b' }] }
  ];
  const { page } = setup(order);await page.loadOrders();const items = page.data.orders[0].items;
  assert.equal(items[0].displayUnitPrice, '100.00');assert.equal(items[0].showOriginalPrice, false);
  assert.equal(items[1].displayUnitPrice, '0.00');assert.equal(items[1].showOriginalPrice, true);
  assert.equal(items[2].displayUnitPrice, '170.00');assert.equal(items[2].originalUnitPrice, '200.00');
});

test('订单单项刷新同样保留优惠单价与原价展示，不能重新显示原价为成交价', async () => {
  const { page } = setup(discountedOrder());await page.refreshOrder(orderId);
  assert.equal(page.data.orders[0].items[0].displayUnitPrice, '0.90');
  assert.equal(page.data.orders[0].items[1].displayUnitPrice, '1.80');
  assert.equal(page.data.orders[0].items[1].showOriginalPrice, true);
});
