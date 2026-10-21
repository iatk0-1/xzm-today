const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const finance = require('../../utils/managerFinance');
const { getErrorMessage } = require('../../utils/error');

const requestPath = '/stall-managers/profit-sharing/withdrawals/mine';
const requestKey = 'manager-test-request-0001';
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(options = {}) {
  let config;
  const user = { userId: '9007199254740993', role: 'stall_manager', ...options.user };
  const calls = [], writes = [], routes = [], storage = new Map();
  const auth = {
    getUserInfo: () => user,
    isStallManager: () => user.role === 'stall_manager',
    ensureAuthenticated: options.authenticate || (async () => {})
  };
  const income = { manualWithdrawalAvailable: '12.34', selfWithdrawalEnabled: false, profitSharingEnabled: true };
  const defaultGet = async url => {
    if (url === '/stall-managers/mine') return { userId: user.userId, active: true };
    if (url === '/stall-managers/income/mine') return income;
    if (url.startsWith(requestPath + '/')) return { id: '7', requestKey: url.includes('/by-key/') ? decodeURIComponent(url.split('/').at(-1)) : requestKey, status: 'PROCESSING', items: [] };
    return { content: [], totalPages: 1 };
  };
  const api = {
    get: async (url, params) => {
      calls.push({ url, params });
      return options.get ? options.get(url, params, defaultGet) : defaultGet(url);
    },
    request: async data => {
      writes.push(data);
      return options.request ? options.request(data) : { id: '7', requestKey: data.data.requestKey, status: 'PROCESSING', items: [] };
    }
  };
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    switchTab: ({ url }) => routes.push(url),
    stopPullDownRefresh() {},
    requestMerchantTransfer: data => { writes.push(data); data.success(); }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/managerIncome/managerIncome.js'), 'utf8'), {
    Page: value => { config = value; }, wx,
    require: name => {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return auth;
      if (name.endsWith('/managerFinance')) return { ...finance, confirmAction: options.confirm || (async () => true) };
      if (name.endsWith('/error')) return { getErrorMessage };
      if (name.endsWith('/customerServiceNavigation')) return { openFromContact() {} };
      throw new Error('测试缺少依赖：' + name);
    }
  });
  const page = { ...config, data: structuredClone(config.data) };
  page.setData = patch => Object.assign(page.data, patch);
  return { page, user, income, calls, writes, routes, storage };
}

test('普通用户携带伪造角色、账号及提现开关参数也不能进入账户或请求接口', async () => {
  const env = harness({ user: { role: 'user' } });
  await env.page.onLoad({ role: 'stall_manager', userId: '2', selfWithdrawalEnabled: 'true' });
  assert.equal(env.page.data.accessState, 'denied');
  assert.equal(env.page.data.profile, null);
  assert.equal(env.calls.length, 0);
  await env.page.withdrawAll();
  assert.equal(env.writes.length, 0);
});

test('本地角色伪造为负责人时，服务端403仍清空整页并拒绝操作', async () => {
  const env = harness({ get: async () => { throw { statusCode: 403, message: '当前账户不具备所选角色' }; } });
  await env.page.onLoad();
  assert.equal(env.page.data.accessState, 'denied');
  assert.equal(env.page.data.error, '当前账户不具备所选角色');
  assert.equal(env.page.data.profile, null);
  assert.deepEqual(Object.keys(env.page.data.income), []);
  await env.page.withdrawAll();
  assert.equal(env.writes.length, 0);
});

test('资料和收入均经服务端验证前不展示账户，onLoad和onShow并发只加载一轮', async () => {
  const gate = deferred();
  const env = harness({ get: (url, params, next) => url.endsWith('/income/mine') ? gate.promise : next(url) });
  const load = env.page.onLoad();
  const show = env.page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.page.data.accessState, 'checking');
  assert.equal(env.page.data.profile, null);
  assert.equal(env.calls.filter(row => row.url.endsWith('/income/mine')).length, 1);
  gate.resolve(env.income);
  await Promise.all([load, show]);
  assert.equal(env.page.data.accessState, 'ready');
  assert.equal(env.page.data.profile.userId, env.user.userId);
});

test('服务端返回其他负责人资料时拒绝展示，也不加载佣金明细', async () => {
  const env = harness({ get: (url, params, next) => url === '/stall-managers/mine' ? { userId: '2' } : next(url) });
  await env.page.onLoad();
  assert.equal(env.page.data.accessState, 'error');
  assert.equal(env.page.data.profile, null);
  assert.equal(env.calls.some(row => row.url.includes('commission-records')), false);
});

test('自助开关关闭时仍可读取本人结算记录，但不能创建新申请', async () => {
  const env = harness();
  await env.page.onLoad();
  assert.equal(env.page.data.accessState, 'ready');
  assert.equal(env.page.data.income.selfWithdrawalEnabled, false);
  assert.ok(env.calls.some(row => row.url.includes('commission-records/mine')));
  await env.page.withdrawAll();
  assert.equal(env.writes.length, 0);
  assert.match(env.page.data.error, /未开启自助提现/);
});

test('自助关闭不删除原申请编号，返回后自动查询原申请且不发起付款', async () => {
  const env = harness();
  const storageKey = 'managerWithdrawalRequest:' + env.user.userId;
  env.storage.set(storageKey, { requestKey });
  await env.page.onLoad();
  assert.equal(env.page.data.pendingRequestKey, requestKey);
  assert.equal(env.page.data.currentRequest.id, '7');
  env.page.onHide();
  assert.equal(env.page.data.currentRequest, null);
  assert.equal(env.page.data.pendingRequestKey, '');
  assert.equal(env.storage.get(storageKey).requestKey, requestKey);
  await env.page.onShow();
  assert.equal(env.page.data.pendingRequestKey, requestKey);
  assert.equal(env.page.data.currentRequest.id, '7');
  assert.equal(env.writes.length, 0);
});

test('收入请求途中切换账号或角色，旧收入不能回填', async () => {
  for (const change of [user => { user.userId = '2'; }, user => { user.role = 'user'; }]) {
    const gate = deferred();
    const env = harness({ get: (url, params, next) => url.endsWith('/income/mine') ? gate.promise : next(url) });
    const task = env.page.onLoad();
    await new Promise(resolve => setImmediate(resolve));
    change(env.user);
    gate.resolve(env.income);
    await task;
    assert.equal(env.page.data.accessState, 'denied');
    assert.equal(env.page.data.profile, null);
    assert.equal(env.page.data.rows.length, 0);
  }
});

test('隐藏时清空账户，旧明细慢响应不能回填；重进后重新验证身份', async () => {
  const gate = deferred();
  let delay = true;
  const env = harness({ get: (url, params, next) => delay && url.includes('commission-records') ? gate.promise : next(url) });
  const task = env.page.onLoad();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.page.data.accessState, 'ready');
  env.page.onHide();
  gate.resolve({ content: [{ id: 'old-secret-row' }], totalPages: 1 });
  await task;
  assert.equal(env.page.data.accessState, 'checking');
  assert.equal(env.page.data.profile, null);
  assert.equal(env.page.data.rows.length, 0);
  delay = false;
  env.user.role = 'user';
  await env.page.onShow();
  assert.equal(env.page.data.accessState, 'denied');
});

test('异步明细请求返回时账号已变，旧明细与旧错误均不能显示', async () => {
  for (const reject of [false, true]) {
    const gate = deferred();
    let delay = false;
    const env = harness({ get: (url, params, next) => delay && url.includes('commission-records') ? gate.promise : next(url) });
    await env.page.onLoad();
    delay = true;
    const task = env.page.loadList(true);
    env.user.userId = '2';
    if (reject) gate.reject({ message: '旧账号的错误' });
    else gate.resolve({ content: [{ id: 'secret-row' }], totalPages: 1 });
    await task;
    assert.equal(env.page.data.accessState, 'denied');
    assert.equal(env.page.data.rows.length, 0);
    assert.doesNotMatch(env.page.data.error, /旧账号/);
  }
});

test('旧申请查询途中切换角色，404和成功响应均不能恢复旧申请状态', async () => {
  for (const missing of [false, true]) {
    const gate = deferred();
    const env = harness({ get: (url, params, next) => url.includes('/by-key/') ? gate.promise : next(url) });
    await env.page.onLoad();
    env.page.setData({ pendingRequestKey: requestKey });
    const task = env.page.recoverRequest();
    env.user.role = 'user';
    if (missing) gate.reject({ statusCode: 404 });
    else gate.resolve({ id: '7', requestKey, status: 'PROCESSING' });
    await task;
    assert.equal(env.page.data.accessState, 'denied');
    assert.equal(env.page.data.requestMissing, false);
    assert.equal(env.page.data.currentRequest, null);
  }
});

test('提现确认弹窗期间切换身份，确认后也不能提交付款', async () => {
  const confirm = deferred();
  const env = harness({ confirm: () => confirm.promise });
  env.income.selfWithdrawalEnabled = true;
  await env.page.onLoad();
  const task = env.page.withdrawAll();
  env.user.role = 'user';
  confirm.resolve(true);
  await task;
  assert.equal(env.writes.length, 0);
  assert.equal(env.page.data.accessState, 'denied');
});

test('正常自助申请沿用服务端开关和账号专属幂等编号，刷新不自动付款', async () => {
  const env = harness();
  env.income.selfWithdrawalEnabled = true;
  await env.page.onLoad();
  await env.page.withdrawAll();
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].url, requestPath);
  assert.equal(env.writes[0].data.requestKey, env.writes[0].idempotencyKey);
  assert.equal(env.storage.get('managerWithdrawalRequest:' + env.user.userId).requestKey, env.writes[0].idempotencyKey);
  assert.equal(env.page.data.busy, false);
  assert.equal(env.page.data.requestUncertain, false);
  assert.equal(env.page.data.error, '');
});

test('提交后离开页面，慢响应不回填且原申请编号保留用于查询', async () => {
  const gate = deferred();
  const env = harness({ request: () => gate.promise });
  env.income.selfWithdrawalEnabled = true;
  await env.page.onLoad();
  const task = env.page.withdrawAll();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.writes.length, 1);
  env.page.onHide();
  gate.resolve({ id: '7', requestKey: env.writes[0].idempotencyKey, status: 'PROCESSING' });
  await task;
  assert.equal(env.page.data.currentRequest, null);
  assert.equal(env.page.data.profile, null);
  assert.equal(env.storage.get('managerWithdrawalRequest:' + env.user.userId).requestKey, env.writes[0].idempotencyKey);
});

test('读取账户失败可重试，刷新遇到403后旧账户和列表立即清空', async () => {
  let failure = { statusCode: 500, message: '服务暂不可用' };
  const env = harness({ get: (url, params, next) => {
    if (failure) throw failure;
    return next(url);
  } });
  await env.page.onLoad();
  assert.equal(env.page.data.accessState, 'error');
  failure = null;
  await env.page.refresh();
  assert.equal(env.page.data.accessState, 'ready');
  failure = { statusCode: 403, message: '当前角色无权访问' };
  await env.page.refresh();
  assert.equal(env.page.data.accessState, 'denied');
  assert.equal(env.page.data.profile, null);
  assert.equal(env.page.data.rows.length, 0);
});

function adminHarness({ role = 'admin', get } = {}) {
  let config;
  const user = { userId: '42', role };
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.js'), 'utf8'), {
    Page: value => { config = value; },
    require: name => {
      if (name.endsWith('/api')) return { get: async url => { calls.push(url); return get(url); } };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => user.role === 'admin', getUserInfo: () => user };
      if (name.endsWith('/managerFinance')) return finance;
      if (name.endsWith('/error')) return { getErrorMessage };
      return {};
    }, wx: {}
  });
  const page = { ...config, data: structuredClone(config.data) };
  page.setData = patch => Object.assign(page.data, patch);
  return { page, user, calls };
}

test('管理员详情页拒绝普通用户传入负责人编号，也不加载账户', async () => {
  const env = adminHarness({ role: 'user' });
  await env.page.onLoad({ id: '99', role: 'admin', tab: 'records' });
  assert.equal(env.page.data.profile, null);
  assert.equal(env.calls.length, 0);
  assert.match(env.page.data.error, /仅管理员/);
});

test('管理员详情页的服务端403清空资料、金额、结算弹窗和结果', async () => {
  const env = adminHarness({ get: async () => { throw { statusCode: 403, message: '当前账户无权管理负责人' }; } });
  env.page.setData({ profile: { userId: '99' }, income: { manualWithdrawalAvailable: '99' }, paymentVisible: true, currentWithdrawal: { id: '7' } });
  await env.page.onLoad({ id: '99' });
  assert.equal(env.page.data.profile, null);
  assert.deepEqual(Object.keys(env.page.data.income), []);
  assert.equal(env.page.data.paymentVisible, false);
  assert.equal(env.page.data.currentWithdrawal, null);
  assert.equal(env.page._authorized, false);
});

test('管理员资料加载途中切账号，返回结果不能展示旧负责人资料', async () => {
  const gate = deferred();
  const env = adminHarness({ get: () => gate.promise });
  const task = env.page.onLoad({ id: '99' });
  await new Promise(resolve => setImmediate(resolve));
  env.user.userId = '43';
  gate.resolve({ userId: '99' });
  await task;
  assert.equal(env.page.data.profile, null);
  assert.equal(env.page._authorized, false);
  assert.match(env.page.data.error, /管理员账号或操作身份已变化/);
});

test('管理员详情页返回时角色已切换，立即隐藏历史账户及付款内容', () => {
  const env = adminHarness();
  env.page._authorized = true;
  env.page._adminOwner = '42';
  env.page.setData({ profile: { userId: '99' }, paymentVisible: true });
  env.user.role = 'user';
  env.page.onShow();
  assert.equal(env.page.data.profile, null);
  assert.equal(env.page.data.paymentVisible, false);
  assert.equal(env.page._authorized, false);
});
