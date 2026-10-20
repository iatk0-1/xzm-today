const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
const storage = {};
const calls = [];
const pages = [];
let postHandler = async () => ({});
let getHandler = async () => ({});
global.Page = config => { pageConfig = config; };
global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync: (key, value) => { storage[key] = value; },
  removeStorageSync: key => { delete storage[key]; },
  showToast() {}
};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {
    post: async (url, body) => { calls.push(['POST', url, body]); return postHandler(url, body); },
    get: async (url, params) => { calls.push(['GET', url, params]); return getHandler(url, params); }
  };
  if (request.endsWith('utils/auth')) return {};
  if (request.endsWith('utils/clipboard')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminOrder/adminOrder.js');
Module._load = originalLoad;

function page() {
  const p = Object.assign({}, pageConfig);
  p.data = JSON.parse(JSON.stringify(pageConfig.data));
  p.setData = patch => Object.assign(p.data, patch);
  p.refreshActiveBatchTask = async () => {};
  pages.push(p);
  return p;
}

test.afterEach(() => {
  for (const p of pages.splice(0)) p.stopBatchPolling();
});

test('创建响应丢失后按请求号找回原任务', { concurrency: false }, async () => {
  calls.length = 0;
  const p = page();
  p.data.pendingShipItems = [{ orderId: '1', orderItemId: '11', skuId: '111', shipQty: 1 }];
  postHandler = async () => { throw new Error('连接中断'); };
  getHandler = async url => ({ id: '99', groups: [{ id: '9', orderIds: ['1'] }] });

  const task = await p.createBatchTask({ bizId: 'biz', deliveryId: 'ZTO' });

  assert.equal(task.id, '99');
  assert.match(calls[1][1], /^\/shipments\/batch-tasks\/by-request\//);
  assert.equal(storage.admin_order_active_batch_task.taskId, '99');
  delete storage.admin_order_active_batch_task;
});

test('成功组移出待发货列表，失败和待核查组保留', { concurrency: false }, () => {
  const p = page();
  storage.admin_order_active_batch_task = { taskId: '99', confirmed: true, items: [
    { orderId: '1', orderItemId: '11', shipQty: 1 },
    { orderId: '2', orderItemId: '22', shipQty: 1 },
    { orderId: '3', orderItemId: '33', shipQty: 1 }
  ] };
  p.updateBatchProgress({ id: '99', groups: [
    { id: 'a', orderIds: ['1'], status: 'SUCCESS' },
    { id: 'b', orderIds: ['2'], status: 'FAILED', reason: '库存不足' },
    { id: 'c', orderIds: ['3'], status: 'NEEDS_REVIEW', reason: '面单结果未知' }
  ] });

  assert.deepEqual(p.data.pendingShipItems.map(item => item.orderId), ['2', '3']);
  assert.equal(p.data.batchProgress.success, 1);
  assert.equal(p.data.batchProgress.failed, 2);
  assert.equal(p.data.batchProgress.groups[1].reason, '库存不足');
  delete storage.admin_order_active_batch_task;
});

test('占用冲突计入失败，不误判整批成功', { concurrency: false }, () => {
  const p = page();
  p.updateBatchProgress({ id: '99', groups: [
    { id: 'a', orderIds: ['1'], status: 'BLOCKED', reason: '商品已被占用' }
  ] });
  assert.equal(p.data.batchProgress.completed, 1);
  assert.equal(p.data.batchProgress.failed, 1);
  assert.equal(p.data.batchProgress.canRetry, true);
});

test('微信补报处理中不会算完成，也不会清除任务', { concurrency: false }, () => {
  const p = page();
  storage.admin_order_active_batch_task = { taskId: '99', confirmed: true, items: [] };
  p.updateBatchProgress({ id: '99', groups: [
    { id: 'a', orderIds: ['1'], status: 'PROCESSING_WECHAT', stage: 'WECHAT_REPORT' }
  ] });
  assert.equal(p.data.batchProgress.completed, 0);
  assert.equal(p.data.batchProgress.failed, 0);
  assert.equal(storage.admin_order_active_batch_task.taskId, '99');
  delete storage.admin_order_active_batch_task;
});

test('待核查任务可以结束并保留异常记录，不再阻塞新任务', { concurrency: false }, () => {
  const p = page();
  storage.admin_order_active_batch_task = { taskId: '99', confirmed: true, items: [] };
  p.updateBatchProgress({ id: '99', groups: [
    { id: 'a', orderIds: ['1'], status: 'NEEDS_REVIEW', stage: 'WAYBILL_API_CALL' }
  ] });
  const progress = p.data.batchProgress;
  p.finishBatchTask();
  assert.equal(storage.admin_order_active_batch_task, undefined);
  assert.equal(progress.hasPendingReview, true);
});

test('面单已创建但微信同步失败时按发货完成处理', { concurrency: false }, () => {
  const p = page();
  storage.admin_order_active_batch_task = { taskId: '99', confirmed: true, items: [] };
  p.updateBatchProgress({ id: '99', groups: [
    { id: 'a', orderIds: ['1'], status: 'SHIPMENT_CREATED_WECHAT_FAILED', shipmentId: '500' }
  ] });
  const progress = p.data.batchProgress;
  p.finishBatchTask();
  assert.equal(storage.admin_order_active_batch_task, undefined);
  assert.equal(progress.success, 1);
  assert.equal(progress.failed, 0);
  assert.equal(progress.hasPendingReview, false);
  assert.equal(progress.groups[0].statusText, '发货完成，微信同步失败');
  assert.equal(progress.groups[0].canRetryWechat, false);
});

test('结束任务时只保留明确未创建面单的失败订单用于重发', { concurrency: false }, () => {
  const p = page();
  const failedItem = { orderId: '1', orderItemId: '11', skuId: '111', shipQty: 1 };
  const reviewItem = { orderId: '2', orderItemId: '22', skuId: '222', shipQty: 1 };
  p.data.pendingShipItems = [failedItem, reviewItem];
  storage.admin_order_active_batch_task = {
    taskId: '99', confirmed: true, items: [failedItem, reviewItem]
  };
  p.updatePendingShipSummary(p.data.pendingShipItems);
  p.updateBatchProgress({ id: '99', groups: [
    { id: 'a', orderIds: ['1'], status: 'FAILED' },
    { id: 'b', orderIds: ['2'], status: 'NEEDS_REVIEW' }
  ] });

  p.finishBatchTask();

  assert.deepEqual(p.data.pendingShipItems.map(item => item.orderId), ['1']);
  assert.equal(storage.admin_order_active_batch_task, undefined);
});

test('上一批只有终态异常时，创建新任务可以重新带上失败订单', { concurrency: false }, async () => {
  calls.length = 0;
  const p = page();
  const failedItem = { orderId: '1', orderItemId: '11', skuId: '111', shipQty: 1 };
  const newItem = { orderId: '2', orderItemId: '22', skuId: '222', shipQty: 1 };
  p.data.pendingShipItems = [failedItem, newItem];
  storage.admin_order_active_batch_task = {
    taskId: '99', confirmed: true, items: [failedItem]
  };
  getHandler = async () => ({ id: '99', groups: [
    { id: 'g1', orderIds: ['1'], status: 'FAILED' }
  ] });
  postHandler = async () => ({ id: '100', groups: [
    { id: 'g2', orderIds: ['1', '2'], status: 'WAITING' }
  ] });

  const task = await p.createBatchTask({ bizId: 'biz', deliveryId: 'ZTO' });

  assert.equal(task.id, '100');
  assert.deepEqual(storage.admin_order_active_batch_task.items.map(item => item.orderId), ['1', '2']);
  assert.deepEqual(calls.map(call => call[0]), ['GET', 'POST']);
  delete storage.admin_order_active_batch_task;
});

test('历史 WAITING 任务只查看不自动发货，关闭后可建新任务', { concurrency: false }, async () => {
  calls.length = 0;
  const p = page();
  const task = { id: '88', status: 'DRAFT', clientRequestId: 'old', groups: [
    { id: 'g1', orderIds: ['1'], status: 'WAITING', stage: 'WAITING' }
  ] };
  p.data.recentBatchTasks = [task];
  getHandler = async () => task;
  await p.selectRecentBatchTask({ currentTarget: { dataset: { index: 0 } } });
  await p.runBatchTask(false);
  assert.equal(calls.filter(call => call[0] === 'POST').length, 0);
  p.closeBatchProgress();
  assert.equal(storage.admin_order_active_batch_task, undefined);
  assert.equal(p.data.showBatchProgress, false);
});

test('关闭历史轮询后不会删除随后建立的新任务', { concurrency: false }, async () => {
  const p = page();
  const oldTask = { id: '88', groups: [
    { id: 'g1', orderIds: ['1'], status: 'PROCESSING', stage: 'WAYBILL_API_CALL' }
  ] };
  storage.admin_order_active_batch_task = {
    taskId: '88', requestId: 'old', confirmed: true, historyOnly: true, items: []
  };
  getHandler = async () => oldTask;
  const running = p.runBatchTask(false);
  await new Promise(resolve => setTimeout(resolve, 20));
  p.closeBatchProgress();
  storage.admin_order_active_batch_task = { taskId: '99', requestId: 'new', confirmed: true, items: [] };
  await running;
  assert.equal(storage.admin_order_active_batch_task.taskId, '99');
  assert.equal(p.batchTaskRunning, false);
  delete storage.admin_order_active_batch_task;
});

test('失败列表分页展示原因，加入时保留现有待发货项并过滤已发商品', { concurrency: false }, async () => {
  const p = page();
  p.data.pendingShipItems = [{ orderId: '9', orderItemId: '99', skuId: '999', shipQty: 1 }];
  getHandler = async (url) => {
    assert.equal(url, '/shipments/batch-tasks/failed-waybills');
    return { hasNext: false, content: [{ groupId: 'g1', reason: '面单接口拒绝',
      shippableItemIds: ['11'],
      failedAt: '2026-09-29T12:00:00+08:00', items: [
        { orderId: '1', orderItemId: '11', skuId: '111', orderNo: 'A1', unshippedQty: 2 },
        { orderId: '2', orderItemId: '22', skuId: '222', orderNo: 'A2', unshippedQty: 0 }
      ] }] };
  };
  p.openFailedWaybills();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.data.failedWaybillGroups[0].reason, '面单接口拒绝');
  assert.equal(p.data.failedWaybillGroups[0].orders.length, 2);
  p.addFailedWaybillsToPending();
  assert.deepEqual(p.data.pendingShipItems.map(item => String(item.orderId)), ['9', '1']);
  assert.equal(p.data.pendingShipItems[1].shipQty, 2);
  assert.equal(p.data.showPendingShipList, true);
  assert.equal(p.data.showFailedWaybills, false);
});


test('确认整批只提交一次，后端确认前不设置本地已提交', { concurrency: false }, async () => {
  calls.length = 0;
  const p = page();
  p.data.batchTask = { id: '100' };
  storage.admin_order_active_batch_task = { taskId: '100', requestId: 'request', confirmed: false, items: [] };
  let accept;
  postHandler = async (url) => {
    assert.equal(url, '/shipments/batch-tasks/100/submit');
    return new Promise(resolve => { accept = resolve; });
  };
  getHandler = async () => ({ id: '100', status: 'COMPLETED', groups: [] });
  const submitting = p.confirmBatchShip();
  assert.equal(storage.admin_order_active_batch_task.confirmed, false);
  await p.confirmBatchShip();
  assert.equal(calls.filter(c => c[0] === 'POST').length, 1);
  accept({ id: '100', confirmedAt: '2026-10-20T10:00:00+08:00', executionMode: 'BACKGROUND', status: 'QUEUED',
    groups: [{ id: 'a', status: 'WAITING', orderIds: ['1'] }] });
  await submitting;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(storage.admin_order_active_batch_task.confirmed, true);
  assert.equal(calls.some(c => /groups\/.+\/start/.test(c[1])), false);
  delete storage.admin_order_active_batch_task;
});

test('提交响应丢失通过查询原任务恢复，不新建不重复提交', { concurrency: false }, async () => {
  calls.length = 0;
  const p = page();
  p.data.batchTask = { id: '100' };
  storage.admin_order_active_batch_task = { taskId: '100', requestId: 'request', confirmed: false, items: [] };
  postHandler = async () => { throw new Error('连接断开'); };
  getHandler = async () => ({ id: '100', confirmedAt: '2026-10-20T10:00:00+08:00', executionMode: 'BACKGROUND', status: 'COMPLETED', groups: [] });
  await p.confirmBatchShip();
  assert.equal(storage.admin_order_active_batch_task.confirmed, true);
  assert.equal(calls.filter(c => c[0] === 'POST').length, 1);
  delete storage.admin_order_active_batch_task;
});

test('提交未确认时保留预览和原请求，避免误显示提交成功', { concurrency: false }, async () => {
  const p = page();
  p.data.batchTask = { id: '100' };
  p.data.showPreviewModal = true;
  storage.admin_order_active_batch_task = { taskId: '100', confirmed: false, items: [] };
  postHandler = async () => { throw new Error('连接断开'); };
  getHandler = async () => ({ id: '100', status: 'DRAFT', groups: [] });
  await p.confirmBatchShip();
  assert.equal(storage.admin_order_active_batch_task.confirmed, false);
  assert.equal(p.data.showPreviewModal, true);
  assert.equal(p.data.batchSubmitting, false);
  delete storage.admin_order_active_batch_task;
});

test('查看历史详情不覆盖正在发货的本地任务，并按包裹组织订单商品', { concurrency: false }, async () => {
  const p = page();
  const saved = { taskId: 'active', requestId: 'active-request', confirmed: true, items: [] };
  storage.admin_order_active_batch_task = saved;
  p.data.recentBatchTasks = [{ id: 'old' }];
  getHandler = async () => ({ id: 'old', status: 'COMPLETED', createdAt: '2026-10-20T11:12:13+08:00',
    groups: [{ id: 'g', sequenceNo: 0, status: 'SUCCESS', orderIds: ['1', '2'], expressNo: 'ZTO123', items: [
      { orderId: '1', orderItemId: '11', orderNo: 'ORDER1', productName: '棉袄', skuSpec: '红色', shipQty: 2 },
      { orderId: '2', orderItemId: '22', orderNo: 'ORDER2', productName: '裤子', shipQty: 3 }
    ] }] });
  await p.selectRecentBatchTask({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(storage.admin_order_active_batch_task, saved);
  assert.equal(p.data.batchTask.createdAtText, '2026-10-20 11:12:13');
  const group = p.data.batchProgress.groups[0];
  assert.equal(group.totalQty, 5);
  assert.equal(group.orders[0].items[0].productName, '棉袄');
  assert.equal(group.orders[1].orderNo, 'ORDER2');
  p.toggleBatchPackage({ currentTarget: { dataset: { groupId: 'g' } } });
  assert.equal(p.data.batchProgress.groups[0].expanded, true);
  p.closeBatchProgress();
  assert.equal(storage.admin_order_active_batch_task, saved);
  assert.equal(p.data.showRecentBatchTasks, true);
  delete storage.admin_order_active_batch_task;
});

test('历史入口始终打开列表，支持筛选分页且不被当前任务劫持', { concurrency: false }, async () => {
  const p = page();
  storage.admin_order_active_batch_task = { taskId: 'active', confirmed: true, items: [] };
  getHandler = async (url, params) => {
    assert.equal(url, '/shipments/batch-tasks/query');
    return { content: [{ id: String(params.page), createdAt: '2026-10-20T12:00:00+08:00', status: 'COMPLETED',
      summary: { total: 2, completed: 2, success: 2, failed: 0, review: 0, orders: 3, quantity: 4 } }], hasNext: params.page === 1 };
  };
  await p.openRecentBatchTasks();
  assert.equal(p.data.showRecentBatchTasks, true);
  assert.equal(p.data.showBatchProgress, false);
  assert.equal(p.data.recentBatchTasks[0].summary.quantity, 4);
  await p.loadMoreBatchTaskHistory();
  assert.deepEqual(p.data.recentBatchTasks.map(t => t.id), ['1', '2']);
  assert.equal(p.data.historyHasMore, false);
  p.changeBatchHistoryFilter({ currentTarget: { dataset: { filter: 'issues' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.data.historyPage, 1);
  assert.equal(p.data.recentBatchTasks.length, 1);
  delete storage.admin_order_active_batch_task;
});

test('详情分页使用整批统计，当前页完成不误判整批完成', { concurrency: false }, () => {
  const p = page();
  p.updateBatchProgress({ id: '100', status: 'RUNNING',
    summary: { total: 31, completed: 30, success: 30, failed: 0, review: 0, orders: 40, quantity: 90 },
    groups: [{ id: 'one', status: 'SUCCESS', orderIds: ['1'], items: [] }] });
  assert.equal(p.data.batchGroupPages, 2);
  assert.equal(p.data.batchProgress.total, 31);
  assert.equal(p.data.batchProgress.completed, 30);
  assert.equal(p.data.batchProgress.canRetry, false);
});

test('离开页面停止查询，回来只查结果不会发起逐包发货', { concurrency: false }, async () => {
  const p = page();
  calls.length = 0;
  p.data.showBatchProgress = true;
  p.data.batchTask = { id: '100' };
  getHandler = async () => ({ id: '100', status: 'RUNNING', groups: [{ id: 'g', status: 'PROCESSING', orderIds: ['1'] }] });
  const running = p.runBatchTask();
  await new Promise(resolve => setImmediate(resolve));
  p.onHide();
  await running;
  assert.equal(p.batchTaskRunning, false);
  assert.equal(calls.filter(c => c[0] === 'POST').length, 0);
  const before = calls.length;
  await p.runBatchTask();
  assert.equal(calls.length, before);
  p.batchReady = true;
  getHandler = async () => ({ id: '100', status: 'COMPLETED', groups: [] });
  p.onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.length > before);
});


test('关闭历史列表后迟到的详情响应不会重新弹出详情', { concurrency: false }, async () => {
  const p = page();
  p.data.showRecentBatchTasks = true;
  let finish;
  getHandler = async () => new Promise(resolve => { finish = resolve; });
  const opening = p.openBatchTaskDetail('late', true);
  p.closeRecentBatchTasks();
  finish({ id: 'late', status: 'DRAFT', groups: [] });
  await opening;
  assert.equal(p.data.showRecentBatchTasks, false);
  assert.equal(p.data.showBatchProgress, false);
});

test('提交结果未知时保留原任务，禁止另建一批绕过待确认请求', { concurrency: false }, async () => {
  const p = page();
  calls.length = 0;
  storage.admin_order_active_batch_task = { taskId: '100', requestId: 'old-request', confirmed: false, submissionPending: true, items: [] };
  getHandler = async () => ({ id: '100', status: 'DRAFT', groups: [] });
  await assert.rejects(p.createBatchTask({ bizId: 'biz', deliveryId: 'ZTO' }), /原任务重新确认/);
  assert.equal(calls.filter(c => c[0] === 'POST').length, 0);
  p.closePreviewModal();
  assert.equal(storage.admin_order_active_batch_task.taskId, '100');
  delete storage.admin_order_active_batch_task;
});

test('结束分页任务时按完整批次保留失败商品，不能只按当前页清理', { concurrency: false }, async () => {
  const p = page();
  const items = [{ orderId: '1', orderItemId: '11', shipQty: 1 }, { orderId: '2', orderItemId: '22', shipQty: 2 }];
  p.updatePendingShipSummary(items);
  storage.admin_order_active_batch_task = { taskId: '100', requestId: 'whole', confirmed: true, items };
  p.updateBatchProgress({ id: '100', status: 'COMPLETED_WITH_ISSUES',
    summary: { total: 31, completed: 31, success: 30, failed: 1, review: 0, orders: 31, quantity: 32 },
    groups: [{ id: 'a', orderIds: ['1'], status: 'SUCCESS' }] });
  getHandler = async url => {
    assert.equal(url, '/shipments/batch-tasks/by-request/whole');
    return { id: '100', groups: [{ id: 'a', orderIds: ['1'], status: 'SUCCESS' }, { id: 'b', orderIds: ['2'], status: 'FAILED' }] };
  };
  await p.finishBatchTask();
  assert.deepEqual(p.data.pendingShipItems.map(i => i.orderId), ['2']);
  assert.equal(storage.admin_order_active_batch_task, undefined);
});
