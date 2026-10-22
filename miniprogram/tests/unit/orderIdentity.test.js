const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { orderCard } = require('../../utils/customerServiceOrder');

const orderId = '371292052173885440';
const paymentNo = 'P371292052173885440c1d5d3d9b4';

function loadPage(name, api = {}) {
  let definition;
  const copies = [];
  const businessViews = [];
  const app = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages', name, name + '.js'), 'utf8'), {
    console,
    Page(value) { definition = value; },
    getApp: () => app,
    wx: {
      showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
      openBusinessView(value) { businessViews.push(value); }
    },
    require(request) {
      if (request.endsWith('/api')) return api;
      if (request.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (request.endsWith('/clipboard')) return { copyText: (value, label) => copies.push({ value, label }) };
      if (request.endsWith('/pageSync') || request.endsWith('/autoSearch')) return { wrap: value => value };
      return {};
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  return { page, copies, businessViews, app };
}

for (const [name, field, handler] of [
  ['orderDetail', 'order', 'copyOrderSn'],
  ['adminOrderDetail', 'order', 'copyOrderSn'],
  ['afterSaleApply', 'order', 'copyOrderNo'],
  ['afterSaleDetail', 'afterSale', 'copyOrderNo'],
  ['adminAfterSaleDetail', 'afterSale', 'copyOrderNo']
]) {
  test(`${name} 订单经过多次改价换支付号后仍复制原业务订单ID`, () => {
    const { page, copies } = loadPage(name);
    // 售后ID也不同，防止把售后单自己的ID当成订单ID。
    page.data[field] = { id: field === 'order' ? orderId : 'other-after-sale-id', orderId, outTradeNo: orderId };
    page[handler]();
    page.data[field].outTradeNo = paymentNo;
    page[handler]();
    page.data[field].outTradeNo = 'P' + orderId + 'another123';
    page[handler]();
    assert.deepEqual(copies.map(x => x.value), [orderId, orderId, orderId]);
    assert.equal(page.data[field].outTradeNo, 'P' + orderId + 'another123');
  });
}

test('客服订单卡片改价前后标题中的订单编号保持一致', () => {
  const order = { id: orderId, outTradeNo: orderId, items: [{ productName: '测试商品', productImage: '/test.jpg' }] };
  const before = orderCard(order);
  order.outTradeNo = paymentNo;
  const after = orderCard(order);
  assert.deepEqual(after, before);
  assert.ok(after.title.endsWith('订单' + orderId));
  assert.ok(!after.title.includes(paymentNo));
});

for (const name of ['orderDetail', 'orderList']) {
  test(`${name} 展示订单号的修正不影响微信确认收货使用新支付单号`, async () => {
    const { page, businessViews, app } = loadPage(name);
    const order = { id: orderId, outTradeNo: paymentNo, payTxnId: 'wx-test-txn', merchantId: 'test-merchant' };
    if (name === 'orderDetail') page.data.order = order;
    else page.data.orders = [order];
    await page.confirmReceipt({ currentTarget: { dataset: { id: orderId } } });
    assert.equal(businessViews.length, 1);
    assert.equal(businessViews[0].extraData.merchant_trade_no, paymentNo);
    assert.equal(businessViews[0].extraData.transaction_id, 'wx-test-txn');
    assert.equal(app.pendingConfirmOrderId, orderId);
    assert.equal(order.id, orderId);
  });
}

test('微信按新支付号跳回小程序时仍解析并加载原业务订单', async () => {
  const reads = [];
  const { page } = loadPage('orderDetail', { get: async (url, params) => {
    reads.push({ url, params });
    return { orderId };
  } });
  let loaded;
  page.loadOrderDetail = async id => { loaded = id; };
  await page.loadPaymentOrder(paymentNo);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].url, '/orders/payment-order');
  assert.equal(reads[0].params.outTradeNo, paymentNo);
  assert.equal(loaded, orderId);
});

test('合并订单发货展示固定业务ID且18位ID不会经数字转换丢失精度', async () => {
  const ids = [orderId, '371292052173885441'];
  const reads = [];
  const { page } = loadPage('shipPartial', { get: async url => {
    reads.push(url);
    const id = url.match(/orders\/(\d+)/)[1];
    return { id, outTradeNo: 'P' + id + 'abcdef1234', items: [{ id: 'item-' + id, qty: 1, shippedQty: 0 }] };
  } });
  page.data.orderIds = ids;
  page.data.shipmentId = 'test-shipment';
  await page.loadOrderItems();
  assert.deepEqual(reads, ids.map(id => `/orders/${id}?flat=true`));
  assert.deepEqual(Array.from(page.data.items, item => item.orderNo), ids);
});
