const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const channels = require('../../utils/refundChannels');

function harness(name) {
  const filename = path.resolve(__dirname, `../../pages/${name}/${name}.js`);
  let definition, modal;
  const requests = [], toasts = [];
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; }, console,
    require(module) {
      if (module.endsWith('/api')) return { post: async url => { requests.push(url); } };
      if (module.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (module.endsWith('/pageSync')) return { wrap: value => value };
      return require(path.resolve(path.dirname(filename), module));
    },
    wx: { showModal: value => { modal = value; }, showLoading() {}, hideLoading() {},
      showToast: value => toasts.push(value.title) }
  });
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); } };
  return { page, requests, toasts, modal: () => modal };
}

function sale(status = 'refunded') {
  return { id: '371292052173885440', status, type: 'refund', totalRefundAmount: '20.00', totalQty: 1,
    items: [{ id: '1', qty: 1, requestedQty: 2, refundAmount: '20.00', requestedRefundAmount: '50.00',
      afterSaleType: 'refund', requestedAfterSaleType: 'refund', status }],
    refundPayment: { onlineAmount: 0, offlineAmount: 20, requestedOnlineAmount: 0, requestedOfflineAmount: 50 } };
}

test('管理员改金额和数量后，用户清单及申请进度保留50元两件，商家审核展示20元', () => {
  const { page } = harness('afterSaleDetail');
  const formatted = page.formatAfterSaleDetail(sale());
  assert.equal(formatted.items[0].applicationRefundAmount, '50.00');
  assert.equal(formatted.items[0].applicationQty, 2);
  const timeline = page.buildTimeline(formatted);
  assert.match(timeline[0].description, /退款 ¥50.00/);
  assert.match(timeline[1].description, /退款 ¥20.00/);
});

test('管理员商品清单显示原申请，不覆盖审核和退款使用的实际金额', () => {
  const { page } = harness('adminAfterSaleDetail');
  const formatted = page.formatAfterSaleDetail(sale());
  assert.equal(formatted.items[0].applicationRefundAmount, '50.00');
  assert.equal(formatted.items[0].refundAmount, '20.00');
});

test('部分明细被拒绝时，申请记录包含全部申请，审核通过金额不包含拒绝项', () => {
  const { page } = harness('afterSaleDetail');
  const input = sale();
  input.items.push({ qty: 1, requestedQty: 1, refundAmount: '30.00', requestedRefundAmount: '30.00',
    afterSaleType: 'refund', status: 'rejected' });
  const timeline = page.buildTimeline(page.formatAfterSaleDetail(input));
  assert.match(timeline[0].description, /退款 ¥80.00/);
  assert.match(timeline[1].description, /退款 ¥20.00/);
});

test('新申请拆分一致时无金额调整标识，线上0元也能正确比较', () => {
  assert.equal(channels.format({ onlineAmount: '0.00', offlineAmount: '50.00',
    requestedOnlineAmount: 0, requestedOfflineAmount: 50 }).hasAdjustedAmounts, false);
  assert.equal(channels.format(sale().refundPayment).hasAdjustedAmounts, true);
});

test('旧售后缺少申请快照时回退现有金额，已有0元申请快照不被替换', () => {
  const { page } = harness('afterSaleDetail');
  const input = sale();
  delete input.items[0].requestedRefundAmount;
  assert.equal(page.formatAfterSaleDetail(input).applicationRefundAmount, '20.00');
  input.items[0].requestedRefundAmount = 0;
  assert.equal(page.formatAfterSaleDetail(input).applicationRefundAmount, '0.00');
});

test('订单售后取消状态映射为中文，确认撤销使用原字符串ID并刷新订单', async () => {
  const env = harness('orderDetail');
  const id = '371292052173885440';
  env.page.orderId = '371292052173885441';
  env.page.data.afterSaleRecords = [{ id, status: 'pending' }];
  let refreshed;
  env.page.loadOrderDetail = async value => { refreshed = value; };
  assert.equal(env.page.getAfterSaleStatusDisplay('cancelled'), '已撤销');
  env.page.cancelAfterSale({ currentTarget: { dataset: { id } } });
  await env.modal().success({ confirm: false });
  assert.equal(env.requests.length, 0);
  await env.modal().success({ confirm: true });
  assert.equal(env.requests[0], `/after-sales/${id}/cancel`);
  assert.equal(refreshed, env.page.orderId);
  assert.equal(env.page._cancellingAfterSale, false);
});

test('已审核售后不能从订单卡片发起撤销', () => {
  const env = harness('orderDetail');
  env.page.data.afterSaleRecords = [{ id: '123', status: 'approved' }];
  env.page.cancelAfterSale({ currentTarget: { dataset: { id: '123' } } });
  assert.equal(env.modal(), undefined);
  assert.equal(env.requests.length, 0);
});

test('同商品多个SKU的售后清单按订单明细匹配图片，用户和管理员都优先SKU图', () => {
  for (const name of ['afterSaleDetail', 'adminAfterSaleDetail']) {
    const { page } = harness(name);
    const input = sale();
    input.items = [
      { ...input.items[0], orderItemId: '9007199254740993', productImage: '/cover.jpg' },
      { ...input.items[0], id: '2', orderItemId: '9007199254740994', productImage: '/cover.jpg' }
    ];
    input.orderDetail = { items: [
      { id: '9007199254740993', skuImageUrl: '/red-sku.jpg', productImage: '/cover.jpg' },
      { id: '9007199254740994', skuImageUrl: '/blue-sku.jpg', productImage: '/cover.jpg' }
    ] };
    const result = page.formatAfterSaleDetail(input);
    assert.equal(result.items[0].displayImage, '/red-sku.jpg');
    assert.equal(result.items[1].displayImage, '/blue-sku.jpg');
    input.orderDetail.items[0].skuImageUrl = null;
    assert.equal(page.formatAfterSaleDetail(input).items[0].displayImage, '/cover.jpg');
  }
});
