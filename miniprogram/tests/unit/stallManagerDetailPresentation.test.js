const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const finance = require('../../utils/managerFinance');

function harness({ get, post } = {}) {
  let config;
  const calls = [], routes = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.js'), 'utf8'), {
    Page: value => { config = value; }, console,
    require: name => name.endsWith('/api') ? {
      async get(url, params) { calls.push({ method: 'get', url, params }); return get ? get(url, params) : { content: [], totalElements: 0, totalPages: 0 }; },
      async post(url, body) { calls.push({ method: 'post', url, body }); return post && post(url, body); }
    } : name.endsWith('/managerFinance') ? { ...finance, confirmAction: async () => true } : {},
    wx: { navigateTo: options => routes.push(options.url), showToast() {} }
  });
  const page = { ...config, data: structuredClone(config.data), _authorized: true };
  page.setData = patch => Object.entries(patch).forEach(([key, value]) => {
    const parts = key.split('.');
    const last = parts.pop();
    const target = parts.reduce((result, part) => result[part], page.data);
    target[last] = value;
  });
  page.setData({ userId: '9007199254740993' });
  page.refresh = async () => {};
  return { page, calls, routes };
}
const event = dataset => ({ currentTarget: { dataset } });
const row = {
  orderId: '9007199254740999', orderItemId: '9007199254740997', productId: '9007199254740995',
  creatorUserId: '9007199254740993', productName: '历史衬衫', skuSpec: '白色', skuSize: 'L',
  salePrice: '39.9', lineAmount: '79.8', qty: 2, orderPayAmount: '79.8',
  buyerName: '张同学', creatorName: '李店长', status: 'UNCONFIRMED',
  createdAt: Date.parse('2026-09-01T09:00:00+08:00')
};

test('历史卡片保留长编号，商品快照、价格、人物、毫秒时间及售后转换为可读内容', () => {
  const item = finance.managerDetailRow({ ...row, afterSaleStatus: 'refunded', refundedAmount: '39.9', bundleProductName: null, bundleGroupName: 'null' }, 'history');
  assert.equal(item.orderId, row.orderId);
  assert.equal(item.specLabel, '白色 / L');
  assert.equal(item.salePriceLabel, '39.90');
  assert.equal(item.lineAmountLabel, '79.80');
  assert.equal(item.buyerName, '张同学');
  assert.equal(item.creatorName, '李店长');
  assert.equal(item.orderedTime, '2026-09-01 09:00');
  assert.equal(item.afterSaleLabel, '已退款');
  assert.equal(item.refundedLabel, '39.90');
  assert.equal(item.bundleLabel, '');
  assert.equal(finance.displayTime('2026-09-01T01:00:00Z'), item.orderedTime);
  assert.equal(finance.displayTime(String(row.createdAt)), item.orderedTime);
});

test('缺失的名称、规格、价格、时间不会渲染null或把未知价格当作零', () => {
  const item = finance.managerDetailRow({ productName: 'null', skuSpec: null, skuSize: 'undefined' }, 'history');
  assert.equal(item.productName, '商品名称未记录');
  assert.equal(item.specLabel, '规格未记录');
  assert.equal(item.salePriceLabel, '未记录');
  assert.equal(item.createdTime, '时间未记录');
  assert.equal(item.afterSaleLabel, '无售后');
});

test('财务操作、关系及系统操作人使用中文，未认识的操作代码不直接展示英文', () => {
  const actions = ['COMMISSION_SET', 'HISTORY_CONFIRMED', 'HISTORY_EXCLUDED', 'OFFLINE_SETTLED', 'OFFLINE_REVERSED', 'DEBT_OFFSET', 'DEBT_OFFSET_RELEASED',
    'WITHDRAWAL_SUCCESS', 'WITHDRAWAL_FAIL', 'WITHDRAWAL_CANCELLED', 'WITHDRAWAL_MANUAL_SUCCESS', 'WITHDRAWAL_MANUAL_CANCELLED',
    'PROFIT_SHARING_RECEIVER_REGISTERED', 'PROFIT_SHARING_WITHDRAWAL_REQUESTED', 'PROFIT_SHARING_CREATED', 'PROFIT_SHARING_WITHDRAWAL_ITEM_BLOCKED',
    'PROFIT_SHARING_SUCCESS', 'PROFIT_SHARING_CLOSED', 'PROFIT_SHARING_MANUAL_SUCCESS', 'PROFIT_SHARING_MANUAL_CLOSED', 'MANAGEMENT_FREEZE_RETIRED', 'WITHDRAWAL_BLOCK_RETIRED'];
  actions.forEach(action => assert.match(finance.managerDetailRow({ action }, 'audit').actionLabel, /[\u4e00-\u9fa5]/));
  const item = finance.managerDetailRow({ action: 'OFFLINE_REVERSED', amount: '-2', operatorName: '管理员小王', reason: '核实关系；关系=PARTNER' }, 'audit');
  assert.equal(item.actionLabel, '冲正线下付款登记');
  assert.equal(item.amountLabel, '-2.00');
  assert.equal(item.operatorName, '管理员小王');
  assert.equal(item.reasonLabel, '核实关系；关系=合作伙伴');
  assert.equal(finance.managerDetailRow({ action: 'FUTURE_ACTION' }, 'audit').actionLabel, '其他财务操作');
  assert.equal(finance.managerDetailRow({}, 'audit').operatorName, '系统自动处理');
});

test('历史筛选在服务端分页之前应用，切换只请求首屏且保留历史查询范围', async () => {
  const { page, calls } = harness({ get: async () => ({ content: [row], totalElements: 1, totalPages: 1 }) });
  page.setData({ tab: 'history', page: 3 });
  await page.historyStatusChange({ detail: { value: '1' } });
  assert.equal(calls[0].params.historical, true);
  assert.equal(calls[0].params.status, 'UNCONFIRMED');
  assert.equal(calls[0].params.page, 1);
  assert.equal(page.data.rows[0].orderedTime, '2026-09-01 09:00');
  await page.historyStatusChange({ detail: { value: '2' } });
  assert.equal(calls[1].params.status, 'CONFIRMED');
});

test('商品与订单详情入口保留长编号，返回后会刷新', () => {
  const { page, routes } = harness();
  page.openOrder(event({ id: row.orderId }));
  page.openProduct(event({ id: row.productId }));
  assert.deepEqual(routes, ['/pages/adminOrderDetail/adminOrderDetail?id=' + row.orderId, '/pages/detail/detail?id=' + row.productId]);
  assert.equal(page._refreshOnShow, true);
});

test('无创建归属及其他负责人的明细不能打开核对，也不能通过直接调用确认来计佣或排除', async () => {
  const { page, calls } = harness();
  for (const creatorUserId of [null, '42']) {
    page.setData({ rows: [{ ...row, creatorUserId }], historyForm: null });
    page.openHistory(event({ index: 0 }));
    assert.equal(page.data.historyForm, null);
    for (const eligible of [true, false]) {
      page.setData({ historyForm: { ...row, creatorUserId, eligible, reason: '管理员声称属于本负责人', creatorConfirmed: true } });
      await page.confirmHistory();
      assert.match(page.data.error, /创建人/);
    }
  }
  assert.equal(calls.length, 0);
});

test('已有任职证据时不必重复手填区间，普通商品核对仅提交必要佣金与依据', async () => {
  const { page, calls } = harness();
  page.setData({ rows: [finance.managerDetailRow({ ...row, hasAppointmentEvidence: true }, 'history')] });
  page.openHistory(event({ index: 0 }));
  page.setData({ 'historyForm.unitCommission': '2', 'historyForm.reason': '核实历史约定' });
  await page.confirmHistory();
  const item = calls[0].body.items[0];
  assert.equal(item.creatorUserId, row.creatorUserId);
  assert.equal(item.unitCommission, '2.00');
  assert.equal(item.assignmentStartedAt, undefined);
  assert.equal(page.data.historyForm, null);
});

test('补任职时间使用日期加时间，毫秒下单时间参与包含校验，结束时间不包含', async () => {
  const { page, calls } = harness();
  page.setData({ rows: [finance.managerDetailRow(row, 'history')] });
  page.openHistory(event({ index: 0 }));
  page.setData({ 'historyForm.unitCommission': '2', 'historyForm.reason': '纸质任职证明' });
  function pick(index, part, value) { page.historyPeriodChange({ ...event({ index, part }), detail: { value } }); }
  pick(0, 'date', '2026-08-01'); pick(0, 'time', '00:00');
  pick(2, 'date', '2026-08-01'); pick(2, 'time', '00:00');
  pick(1, 'date', '2026-09-01');
  await page.confirmHistory();
  assert.match(page.data.error, /同时选择/);
  pick(1, 'time', '09:00');
  await page.confirmHistory();
  assert.match(page.data.error, /包含下单/);
  page.clearHistoryPeriod(event({ index: 1 }));
  await page.confirmHistory();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.items[0].assignmentStartedAt, '2026-08-01T00:00:00+08:00');
  assert.equal(calls[0].body.items[0].assignmentEndedAt, null);
});

test('套装核对默认关联后端返回的全部明细，套数仍必须明确核实', async () => {
  const { page, calls } = harness();
  page.setData({ rows: [{ ...row, isBundle: true, hasAppointmentEvidence: true, bundleMemberIds: row.orderItemId + ',9007199254740998' }] });
  page.openHistory(event({ index: 0 }));
  page.setData({ 'historyForm.unitCommission': '2', 'historyForm.reason': '整套约定' });
  await page.confirmHistory();
  assert.match(page.data.error, /售出套数/);
  page.setData({ 'historyForm.saleUnits': '1' });
  await page.confirmHistory();
  assert.deepEqual(Array.from(calls[0].body.items[0].memberOrderItemIds), [row.orderItemId, '9007199254740998']);
  assert.equal(calls[0].body.items[0].saleUnits, 1);
});

test('线下付款明细按需加载，可收起再次展开，点击订单详情保留订单号', async () => {
  const { page, calls } = harness({ get: async () => ({ allocations: [{ ...row, id: '1', amount: '5', active: true }] }) });
  page.setData({ tab: 'settlements', rows: [{ id: '10' }] });
  await page.toggleSettlementDetails(event({ id: '10' }));
  assert.equal(calls[0].url, '/stall-managers/' + row.creatorUserId + '/offline-settlements/10');
  assert.equal(page.data.rows[0].allocationRows[0].amountLabel, '5.00');
  assert.equal(page.data.rows[0].allocationRows[0].orderId, row.orderId);
  await page.toggleSettlementDetails(event({ id: '10' }));
  assert.equal(page.data.rows[0].detailsVisible, false);
  await page.toggleSettlementDetails(event({ id: '10' }));
  assert.equal(calls.length, 1);
});

test('付款明细请求迟到不会覆盖另一个tab或刷新后的行', async () => {
  let finish;
  const { page } = harness({ get: () => new Promise(resolve => { finish = resolve; }) });
  page.setData({ tab: 'settlements', rows: [{ id: '10' }] });
  const request = page.toggleSettlementDetails(event({ id: '10' }));
  page.setData({ tab: 'history', rows: [row] });
  finish({ allocations: [] });
  await request;
  assert.equal(page.data.rows[0].orderItemId, row.orderItemId);
});

test('冲正弹窗不会拿付款备注充当原因，必须填本次原因才能提交', async () => {
  const { page, calls } = harness();
  page.setData({ rows: [{ id: '10', reversed: false }], settlementReason: '上次付款备注' });
  page.openReverseSettlement(event({ id: '10' }));
  assert.equal(page.data.reverseForm.reason, '');
  await page.reverseSettlement();
  assert.equal(calls.length, 0);
  assert.match(page.data.error, /冲正原因/);
  page.reverseReasonInput({ detail: { value: '重复登记' } });
  await page.reverseSettlement();
  assert.equal(calls[0].body.reason, '重复登记');
  assert.equal(page.data.reverseForm, null);
});
