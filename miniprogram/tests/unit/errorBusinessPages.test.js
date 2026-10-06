const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(file, api = {}) {
  let definition;
  const modals = [], toasts = [], callbacks = [];
  const pageFile = path.resolve(__dirname, '../../pages', file);
  vm.runInNewContext(fs.readFileSync(pageFile, 'utf8'), {
    Page: value => { definition = value; }, console: { log() {}, warn() {}, error() {} }, setTimeout() {}, clearTimeout() {},
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { isAdmin: () => true, isStallManager: () => false, getUserInfo: () => ({ userId: 1 }), ensureAuthenticated: async () => {} };
      if (name.endsWith('/customerServiceUnread')) return { label: n => String(n), update() {}, start() {} };
      if (name.endsWith('/pageSync')) return { wrap: config => config };
      if (name.endsWith('/shareImage') || name.endsWith('/clipboard') || name.endsWith('/cos-upload') || name.endsWith('/customerServiceNavigation')) return {};
      return require(path.resolve(path.dirname(pageFile), name));
    },
    wx: {
      showModal: value => { modals.push(value); if (value.success && value.title === '确认批量取消') callbacks.push(value.success({ confirm: true })); },
      showToast: value => toasts.push(value), showLoading() {}, hideLoading() {}, getStorageSync() {}, setStorageSync() {},
      navigateBack() {}, stopPullDownRefresh() {}
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
  return { page, modals, toasts, callbacks };
}

test('商品和心愿详情只有明确404提示不存在，网络及500展示实际原因', async () => {
  for (const [statusCode, message] of [[404, '数据不存在'], [500, '服务暂时不可用，请稍后重试'], [undefined, '网络连接异常，请检查网络后重试']]) {
    for (const file of ['detail/detail.js', 'wishDetail/wishDetail.js']) {
      const env = harness(file, { get: async () => { throw { statusCode, message }; } });
      if (file.startsWith('detail/')) await env.page.getProductDetailWithRetry('1', 2);
      else { env.page.data.wishId = '1'; await env.page.loadWishDetail(); }
      assert.equal(env.modals.length, 1);
      assert.equal(env.modals[0].content, message);
    }
  }
});

test('明确404没有message时才使用找不到的场景兜底', async () => {
  for (const file of ['detail/detail.js', 'wishDetail/wishDetail.js']) {
    const env = harness(file, { get: async () => { throw { statusCode: 404 }; } });
    if (file.startsWith('detail/')) await env.page.getProductDetailWithRetry('1', 2);
    else { env.page.data.wishId = '1'; await env.page.loadWishDetail(); }
    assert.equal(env.modals[0].content, file.startsWith('detail/') ? '找不到该商品' : '找不到该心愿');
  }
});

test('商品详情最终401只展示一次失败提示，兼容code/status恢复判断', async () => {
  let calls = 0, waits = 0;
  const env = harness('detail/detail.js', { get: async () => { calls++; throw { code: 'UNAUTHORIZED', statusCode: 401, message: '登录已过期，请重新登录' }; } });
  env.page.waitForAuth = async () => { waits++; };
  await env.page.getProductDetailWithRetry('1', 2);
  assert.equal(calls, 3);
  assert.equal(waits, 2);
  assert.equal(env.modals.length, 1);
  assert.equal(env.modals[0].content, '登录已过期，请重新登录');
});

test('搜索全部商品加载失败呈现错误态，重试保持all查询且成功清除旧错误', async () => {
  let fails = true;
  const calls = [];
  const env = harness('search/search.js', { get: async (url, data) => {
    calls.push({ url, data }); if (fails) throw { message: '商品查询服务暂时不可用' };
    return { content: [], hasNext: false };
  } });
  await env.page.fetchAllProducts();
  assert.equal(env.page.data.loadError, '商品查询服务暂时不可用');
  assert.equal(env.page.data.loading, false);
  env.page.data.keyword = '尚未提交的搜索词';
  fails = false;
  env.page.retrySearch();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.page.data.loadError, '');
  assert.equal(env.page.data.searchType, 'all');
  assert.equal(calls.at(-1).data.keyword, undefined);
});

test('客服历史、发送即时失败和重试失败均安全展示，静默刷新失败不弹窗', async () => {
  const message = { id: 9, direction: 'staff', messageType: 'text', content: '客服回复', status: 'failed', errorMessage: '{"code":"FAILED","message":"微信暂时无法接收消息"}' };
  const env = harness('customerServiceChat/customerServiceChat.js', {
    get: async () => { throw { message: '后台刷新失败' }; }, post: async () => message
  });
  env.page.data.id = '1'; env.page.data.canReply = true; env.page.data.inputText = '客服回复';
  await env.page.send();
  assert.equal(env.page.data.messages[0].errorMessage, '微信暂时无法接收消息');
  assert.equal(env.toasts.length, 0);
  assert.equal(env.page.data.messages[0].status, 'failed');
  await env.page.retry({ currentTarget: { dataset: { id: 9 } } });
  assert.equal(env.page.data.messages[0].errorMessage, '微信暂时无法接收消息');
  assert.equal(env.toasts.length, 0);
});

test('发货进度和失败面单历史均提取reason文字，保留人工核查和禁止微信重复补报', async () => {
  const raw = '{"code":"FAILED","message":"发货结果待核查"}';
  const env = harness('adminOrder/adminOrder.js', { get: async () => ({ content: [{ reason: raw, items: [] }], hasNext: false }) });
  env.page.updateBatchProgress({ id: '1', groups: [{ id: '2', reason: raw, status: 'NEEDS_REVIEW', orderIds: ['1'] }] });
  assert.equal(env.page.data.batchProgress.groups[0].reason, '发货结果待核查');
  assert.equal(env.page.data.batchProgress.groups[0].canReview, true);
  assert.equal(env.page.data.batchProgress.groups[0].canRetryWechat, false);
  env.page.data.failedWaybillHasMore = true; env.page.data.showFailedWaybills = true;
  env.page.failedWaybillRequestVersion = 1;
  await env.page.loadFailedWaybills();
  assert.equal(env.page.data.failedWaybillGroups[0].reason, '发货结果待核查');
});

test('批量取消部分失败保留失败运单并显示安全原因，成功数不混淆', async () => {
  const env = harness('logistics/expressBatchManage/expressBatchManage.js', { post: async () => ({ results: [
    { waybillId: 'ok', success: true }, { waybillId: 'fail', success: false, error: '{"message":"运单当前不可取消","code":"FAILED"}' }
  ] }) });
  env.page.data.allItems = [{ waybillId: 'ok', orderId: '1', expressCode: 'TEST', checked: true }, { waybillId: 'fail', orderId: '2', expressCode: 'TEST', checked: true }];
  env.page.data.filteredItems = env.page.data.allItems;
  env.page.batchCancel();
  await Promise.all(env.callbacks);
  const result = env.modals.find(m => m.title === '操作完成');
  assert.ok(result);
  assert.equal(result.content, '成功：1 条\n失败：1 条\n原因：运单当前不可取消');
  assert.equal(env.page.data.allItems.length, 1);
  assert.equal(env.page.data.allItems[0].waybillId, 'fail');
});

test('销售/出货统计实际接口失败给每个分区写可读文案，重试成功清旧错误', async () => {
  for (const file of ['adminSalesDetail/adminSalesDetail.js', 'adminShippingSalesDetail/adminShippingSalesDetail.js']) {
    let fails = true;
    const env = harness(file, { get: async () => { if (fails) throw { message: '统计服务暂时不可用' }; return { content: [], totalElements: 0 }; } });
    env.page.data.productId = '1';
    env.page.loadAll();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.page.data.overviewError, '统计服务暂时不可用', file);
    assert.equal(env.page.data.skuError, '统计服务暂时不可用', file);
    assert.equal(env.page.data.orderError, '统计服务暂时不可用', file);
    assert.equal(env.toasts.length, 0);
    fails = false;
    env.page.loadAll();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(!env.page.data.overviewError);
    assert.ok(!env.page.data.skuError);
    assert.ok(!env.page.data.orderError);
  }
});

test('协商退款processing和unknown不误报成功，明确失败只展示errorMessage', async () => {
  for (const status of ['processing', 'unknown', 'failed']) {
    const env = harness('adminAfterSaleDetail/adminAfterSaleDetail.js', { post: async () => ({ status, errorMessage: '{"code":"FAILED","message":"退款结果待核对"}' }) });
    env.page.data.afterSaleId = '1'; env.page.data.negotiatedReason = '用户协商退款';
    env.page.data.negotiatedItems = [{ id: '2', selected: true, inputAmount: '10', refundAmount: '20' }];
    let reloads = 0;
    env.page.loadAfterSaleDetail = () => { reloads++; };
    await env.page.submitNegotiatedRefund();
    assert.ok(env.toasts.every(t => t.icon !== 'success'), status);
    assert.ok(env.modals.length || env.toasts.length);
    if (status === 'failed') assert.ok(env.modals.some(m => m.content === '退款结果待核对') || env.toasts.some(t => t.title === '退款结果待核对'));
    else assert.ok(env.modals.some(m => /处理中|待核对|待确认/.test(m.title + m.content)), status);
  }
});

test('财务失败原因转换为中文且不改变UNKNOWN/PROCESSING终态，人工审计备注保留', () => {
  const finance = require('../../utils/managerFinance');
  const sharing = finance.profitSharingRow({ status: 'UNKNOWN', reason: 'SYSTEM_ERROR' });
  assert.equal(sharing.terminal, false);
  assert.equal(sharing.reason, '微信服务暂时不可用，请稍后查询');
  const withdrawal = finance.withdrawalRequestRow({ status: 'PROCESSING', heldAmount: '20', items: [{ status: 'PROCESSING', reason: '{"message":"微信暂未确认结果"}' }] });
  assert.equal(withdrawal.terminal, false);
  assert.equal(withdrawal.items[0].reason, '微信暂未确认结果');
  const note = '人工核对备注：保留原有申请理由';
  const audit = finance.managerDetailRow({ action: 'EXCLUDE', reason: note }, 'audit');
  assert.equal(audit.reasonLabel, note);
  assert.equal(finance.failureReason('UNKNOWN_CODE'), '处理未完成，请查询原记录核对结果');
});

test('直播列表加载失败显示文案，分页失败保留已有场次且重试同一页', async () => {
  let fails = true;
  const calls = [];
  const env = harness('liveRoomList/index.js', { get: async url => {
    calls.push(url); if (fails) throw { message: '直播列表暂时不可用' };
    return url.endsWith('/active') ? null : { content: [], hasNext: false };
  } });
  await env.page.loadLiveSessions();
  assert.equal(env.page.data.loadError, '直播列表暂时不可用');
  assert.equal(env.page.data.isLoading, false);
  env.page.data.allSessions = [{ id: '1', title: '已有场次', createdAt: '2026-10-06T12:00:00Z' }];
  env.page.data.page = 2;
  await env.page.loadLiveSessions(false);
  assert.equal(env.page.data.allSessions.length, 1);
  assert.equal(env.page.data.page, 2);
  fails = false;
  await env.page.retryLiveSessions();
  assert.equal(env.page.data.loadError, '');
  assert.equal(env.page.data.allSessions.length, 1);
  assert.match(calls.at(-1), /page=2/);
});

test('消息首次加载失败显示文案，静默轮询失败不新增UI，主动重试成功清错误', async () => {
  let fails = true;
  const env = harness('messages/messages.js', { get: async url => {
    if (fails) throw { message: '消息服务暂时不可用' };
    return url.endsWith('/me') ? { canServe: false } : { hasContacted: false, unreadCount: 0 };
  } });
  await env.page.loadContact(false);
  assert.equal(env.page.data.loadError, '消息服务暂时不可用');
  assert.equal(env.page.data.loading, false);
  env.page.data.loadError = false;
  await env.page.loadContact(true);
  assert.equal(env.page.data.loadError, false);
  assert.equal(env.toasts.length, 0);
  fails = false;
  await env.page.retryContact();
  assert.equal(env.page.data.loadError, false);
});
