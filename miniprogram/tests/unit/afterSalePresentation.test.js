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

for (const name of ['afterSaleDetail', 'adminAfterSaleDetail']) {
  test(`${name}：关联订单按成交行金额分摊单价，保留原价和售后退款金额`, () => {
    const { page } = harness(name), input = sale();
    input.items[0].refundAmount = '0.90';input.items[0].requestedRefundAmount = '0.90';
    input.orderDetail = { promotionDiscount: '0.28', items: [
      { id: '9007199254740993', qty: 3, salePrice: '1.00', settlementAmount: '2.72' }
    ] };
    const result = page.formatAfterSaleDetail(input), item = result.orderDetail.items[0];
    assert.equal(item.displayUnitPrice, '0.91');assert.equal(item.originalUnitPrice, '1.00');
    assert.equal(item.showOriginalPrice, true);assert.equal(item.salePrice, '1.00');
    assert.equal(item.settlementAmount, '2.72');assert.equal(result.items[0].refundAmount, '0.90');
    assert.equal(input.orderDetail.items[0].displayUnitPrice, undefined);
  });

  test(`${name}：零元成交不回退原价，普通旧订单和改价订单沿用订单单价口径`, () => {
    const { page } = harness(name);
    const discounted = page.formatOrderDetail({ promotionDiscount: 1, items: [
      { id: '1', qty: 1, salePrice: 1, settlementAmount: 0 }
    ] }).items[0];
    assert.equal(discounted.displayUnitPrice, '0.00');assert.equal(discounted.showOriginalPrice, true);
    const ordinary = page.formatOrderDetail({ items: [{ id: '2', qty: 2, salePrice: 5 }] }).items[0];
    assert.equal(ordinary.displayUnitPrice, '5.00');assert.equal(ordinary.showOriginalPrice, false);
    const adjusted = page.formatOrderDetail({ priceRevision: 1, items: [
      { id: '3', qty: 2, salePrice: 10, settlementAmount: 16 }
    ] }).items[0];
    assert.equal(adjusted.displayUnitPrice, '8.00');assert.equal(adjusted.originalUnitPrice, '10.00');
    const missing = page.formatOrderDetail({ promotionDiscount: 1, items: [{ id: '4', qty: 1, salePrice: 5 }] }).items[0];
    assert.equal(missing.displayUnitPrice, null);
  });
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

test('两端摘要区分原申请与审核金额，保留零元结果且不改原始退款字段', () => {
  for (const name of ['afterSaleDetail', 'adminAfterSaleDetail']) {
    const { page } = harness(name), input = sale();
    input.totalRefundAmount = '0.00';
    input.items[0].refundAmount = '0.00';
    const result = page.formatAfterSaleDetail(input);
    assert.equal(result.displayRefundAmount, '0.00');
    assert.equal(result.refundAmountLabel, '退款金额');
    assert.equal(result.applicationRefundAmount, '50.00');
    assert.equal(result.applicationTotalQty, 2);
    assert.equal(result.hasAdjustedTotal, true);
    assert.equal(result.items[0].applicationRefundAmount, '50.00');
    assert.equal(input.items[0].requestedRefundAmount, '50.00');
    const pending = page.formatAfterSaleDetail(sale('pending'));
    assert.equal(pending.displayRefundAmount, '50.00');
    assert.equal(pending.refundAmountLabel, '申请退款金额');
    assert.equal(pending.hasAdjustedTotal, false);
    const legacy = sale('approved');
    delete legacy.totalRefundAmount;
    assert.equal(page.formatAfterSaleDetail(legacy).displayRefundAmount, '20.00');
  }
});

test('买家详情按申请原因和补充说明展示，时间轴视图不改写业务进度', () => {
  const display = require('../../utils/afterSaleDisplay');
  const input = sale('pending');
  input.reason = '尺码不符\n上身偏大，申请退货';
  input.evidenceUrls = '["/a.jpg","/b.jpg"]';
  const result = harness('afterSaleDetail').page.formatAfterSaleDetail(input);
  assert.equal(result.reasonTitle, '尺码不符');
  assert.equal(result.reasonDescription, '上身偏大，申请退货');
  assert.deepEqual(Array.from(result.evidenceImages), ['/a.jpg', '/b.jpg']);
  const entries = [{ status: '用户申请', time: '11/4 10:26' }, { status: '商家审核', description: '审核通过' }];
  const view = display.timelineView(entries, 'approved');
  assert.equal(view[0].status, '商家审核通过');
  assert.equal(view[1].time, '11-04 10:26');
  assert.equal(entries[0].status, '用户申请');
  assert.equal(display.timelineView(entries.slice(0, 1), 'pending')[1].waiting, true);
});

test('买家和管理端统一按实际付款构成展示线下退款，零元分摊和历史标记不误判', () => {
  for (const name of ['afterSaleDetail', 'adminAfterSaleDetail']) {
    const { page } = harness(name);
    const pureOnline = sale();
    pureOnline.peerOrder = true;
    pureOnline.orderDetail = { priceRevision: 2, offlinePaidAmount: '0.00', items: [] };
    pureOnline.refundPayment.hasOfflinePayment = true;
    const originalPayment = structuredClone(pureOnline.refundPayment);
    const result = page.formatAfterSaleDetail(pureOnline);
    assert.equal(result.showOfflineRefund, false);
    assert.equal(result.showRefundBreakdown, false);
    assert.doesNotMatch(result.statusHint, /线下/);
    assert.deepEqual(pureOnline.refundPayment, originalPayment);
    const mixed = sale();
    mixed.orderDetail = { offlinePaidAmount: '30.00', items: [] };
    mixed.refundPayment.offlineAmount = 0;
    assert.equal(page.formatAfterSaleDetail(mixed).showOfflineRefund, true);
    mixed.refundPayment.requestedOfflineAmount = 0;
    assert.equal(page.formatAfterSaleDetail(mixed).showRefundBreakdown, false);
    delete mixed.orderDetail;
    mixed.refundPayment.hasOfflinePayment = true;
    assert.equal(page.formatAfterSaleDetail(mixed).showOfflineRefund, true);
  }
});

test('买家售后进度接入真实审核和退款时间，退款后审核时间不会被覆盖', () => {
  const { page } = harness('afterSaleDetail');
  const input = sale();
  input.createdAt = '2026-11-04 23:46:00';
  input.updatedAt = '2026-11-05 01:00:00';
  input.progress = [
    { action: 'apply', createdAt: input.createdAt },
    { action: 'review_items', createdAt: '2026-11-04 23:48:00' },
    { action: 'refund', createdAt: '2026-11-04 23:49:00' }
  ];
  const formatted = page.formatAfterSaleDetail(input);
  const view = require('../../utils/afterSaleDisplay').timelineView(page.buildTimeline(formatted), input.status);
  assert.equal(view[0].status, '退款完成');
  assert.equal(view[0].time, '11-04 23:49');
  assert.equal(view[1].status, '商家审核通过');
  assert.equal(view[1].time, '11-04 23:48');
  assert.equal(view[2].time, '11-04 23:46');
  assert.equal(formatted.updatedAt, input.updatedAt);
});

test('逐项退款和重复验收取最终操作时间，首次审核时间单独保留', () => {
  const { page } = harness('afterSaleDetail'), input = sale();
  input.type = 'return_refund';
  input.warehouseCheck = 'pass';
  input.progress = [
    { action: 'negotiated_refund', createdAt: '2026-11-05 12:30:00' },
    { action: 'review_items', createdAt: '2026-11-05 10:00:00' },
    { action: 'receive_fail', createdAt: '2026-11-05 11:00:00' },
    { action: 'refund', createdAt: '2026-11-05 12:00:00' },
    { action: 'reinspect_pass', createdAt: '2026-11-05 11:30:00' },
    { action: 'review_approve', createdAt: '2026-11-05 10:01:00' }
  ];
  const timeline = page.buildTimeline(page.formatAfterSaleDetail(input));
  assert.equal(timeline.find(item => item.status === '商家审核').time, '11/5 10:00');
  assert.equal(timeline.find(item => item.status === '仓库已收货').time, '11/5 11:30');
  assert.equal(timeline.find(item => item.status === '退款完成').time, '11/5 12:30');
});

test('旧接口、无日志和无效时间不冒用最后更新时间，已完成节点明确提示未记录', () => {
  const { page } = harness('afterSaleDetail'), input = sale();
  input.updatedAt = '2026-11-05 01:00:00';
  for (const progress of [undefined, [], null, 'invalid', [
    { action: 'refund', createdAt: 'invalid' }, null,
    { action: 'review_items', createdAt: null }
  ]]) {
    input.progress = progress;
    const timeline = page.buildTimeline(page.formatAfterSaleDetail(input));
    assert.equal(timeline.find(item => item.status === '商家审核').time, '时间未记录');
    assert.equal(timeline.find(item => item.status === '退款完成').time, '时间未记录');
  }
  assert.equal(page.formatTime('invalid'), '-');
});

test('审核拒绝、撤销和逐项验收节点使用各自的日志时间', () => {
  const { page } = harness('afterSaleDetail');
  for (const [status, action, warehouseCheck] of [
    ['rejected', 'review_reject'], ['rejected', 'review_items'], ['cancelled', 'cancel'],
    ['received', 'receive', 'pass'], ['received', 'reinspect', 'fail']
  ]) {
    const input = { ...sale(status), warehouseCheck,
      progress: [{ action, createdAt: '2026-11-05 09:15:00' }] };
    const timeline = page.buildTimeline(page.formatAfterSaleDetail(input));
    assert.equal(timeline.at(-1).time, '11/5 09:15');
  }
});

test('退货物流优先采用物流字段时间，缺失时读取日志，待审核提示不伪造时间', () => {
  const { page } = harness('afterSaleDetail');
  const input = { ...sale('approved'), type: 'return_refund', returnExpressNo: 'ZTO123',
    returnShippedAt: '2026-11-05 10:10:00',
    progress: [{ action: 'ship_return', createdAt: '2026-11-05 10:11:00' }] };
  let timeline = page.buildTimeline(page.formatAfterSaleDetail(input));
  assert.equal(timeline.at(-1).time, '11/5 10:10');
  delete input.returnShippedAt;
  timeline = page.buildTimeline(page.formatAfterSaleDetail(input));
  assert.equal(timeline.at(-1).time, '11/5 10:11');
  const display = require('../../utils/afterSaleDisplay');
  const pending = display.timelineView(page.buildTimeline(page.formatAfterSaleDetail(sale('pending'))), 'pending');
  assert.equal(pending.at(-1).waiting, true);
  assert.equal(pending.at(-1).time, undefined);
});

test('日志时间比较保留时区，按真实时刻选择最终退款', () => {
  const display = require('../../utils/afterSaleDisplay');
  const input = { progress: [
    { action: 'refund', createdAt: '2026-11-05T10:00:00+08:00' },
    { action: 'refund', createdAt: '2026-11-05T03:00:00Z' }
  ] };
  assert.equal(display.progressTime(input, ['refund']), '2026-11-05T03:00:00Z');
});
