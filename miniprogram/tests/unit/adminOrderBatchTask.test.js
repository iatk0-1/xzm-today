const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
const storage = {};
const calls = [];
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
    post: async (url, body) => { calls.push(['POST', url]); return postHandler(url, body); },
    get: async url => { calls.push(['GET', url]); return getHandler(url); }
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
  return p;
}

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

test('待核查任务不能结束，任务 ID 留给恢复', { concurrency: false }, () => {
  const p = page();
  storage.admin_order_active_batch_task = { taskId: '99', confirmed: true, items: [] };
  p.updateBatchProgress({ id: '99', groups: [
    { id: 'a', orderIds: ['1'], status: 'NEEDS_REVIEW', stage: 'WAYBILL_API_CALL' }
  ] });
  p.finishBatchTask();
  assert.equal(storage.admin_order_active_batch_task.taskId, '99');
  assert.equal(p.data.batchProgress.hasPendingReview, true);
  delete storage.admin_order_active_batch_task;
});

test('微信上报失败时不能结束，保留补报入口', { concurrency: false }, () => {
  const p = page();
  storage.admin_order_active_batch_task = { taskId: '99', confirmed: true, items: [] };
  p.updateBatchProgress({ id: '99', groups: [
    { id: 'a', orderIds: ['1'], status: 'SHIPMENT_CREATED_WECHAT_FAILED', shipmentId: '500' }
  ] });
  p.finishBatchTask();
  assert.equal(storage.admin_order_active_batch_task.taskId, '99');
  assert.equal(p.data.batchProgress.groups[0].canRetryWechat, true);
  delete storage.admin_order_active_batch_task;
});

test('历史 WAITING 任务只查看不自动发货，关闭后可建新任务', { concurrency: false }, async () => {
  calls.length = 0;
  const p = page();
  const task = { id: '88', clientRequestId: 'old', groups: [
    { id: 'g1', orderIds: ['1'], status: 'WAITING', stage: 'WAITING' }
  ] };
  p.data.recentBatchTasks = [task];
  p.selectRecentBatchTask({ currentTarget: { dataset: { index: 0 } } });
  getHandler = async () => task;
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
