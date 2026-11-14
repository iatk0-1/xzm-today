const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, deps, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../', file), 'utf8'), {
    module, console, require: name => {
      if (Object.prototype.hasOwnProperty.call(deps, name)) return deps[name];
      throw new Error('测试缺少依赖：' + name);
    }, ...globals
  });
  return module.exports;
}

function guardedPage(route, initiallyBlocked) {
  let blocked = initiallyBlocked;
  const redirects = [], calls = [];
  const wx = { showToast() {}, reLaunch: options => redirects.push(options.url) };
  const access = load('utils/blacklistAccess.js', {}, { wx });
  const auth = {
    isBlacklisted: () => blocked,
    canAccessMenu: code => !blocked || ['messages', 'profile'].includes(code),
    ensureAuthenticated: async () => {}, loadPermissionSnapshot: async () => {},
    getPermissionSnapshot: () => ({ currentRole: {}, menus: [] })
  };
  const permissions = load('utils/permissions.js', {
    './auth': auth, './blacklistAccess': { ...access, watch() {}, stopWatching() {} },
    './error': require('../../utils/error')
  }, { wx });
  const page = { ...permissions.wrap({
    data: {}, onLoad() { calls.push('load'); }, onShow() { calls.push('show'); }
  }), route, setData(patch) { Object.assign(this.data, patch); } };
  return { page, permissions, redirects, calls, setBlocked(value) { blocked = value; } };
}

test('黑名单冷启动分享商品、心愿链接及首页市集均在业务加载前返回我页面', async () => {
  for (const route of ['pages/detail/detail', 'pages/wishDetail/wishDetail', 'pages/index/index', 'pages/market/market']) {
    const env = guardedPage(route, true);
    await Promise.all([env.page.onLoad({ id: '9007199254740993', from: 'share' }), env.page.onShow()]);
    assert.equal(env.calls.length, 0);
    assert.equal(env.page.data.pageAccessReady, false);
    assert.equal(env.redirects[0], '/pages/user/user');
    assert.equal(env.page.data.canBrowse, false);
    assert.equal(env.page.data.canMarket, false);
    assert.equal(env.page.data.canMessages, true);
  }
});

test('黑名单只保留信息、我和资料编辑，禁止购物、订单、后台及旧分享路径', () => {
  const env = guardedPage('pages/user/user', true);
  for (const route of ['pages/messages/messages', 'pages/user/user', 'pages/editProfile/editProfile']) {
    assert.equal(env.permissions.canVisit(route), true);
  }
  for (const route of ['pages/cart/cart', 'pages/checkout/checkout', 'pages/orderDetail/orderDetail', 'pages/adminOrderManage/adminOrderManage', 'pages/blacklist/blacklist', '/pages/detail/detail?id=11']) {
    assert.equal(env.permissions.canVisit(route), false);
  }
});

test('已缓存详情再次显示时先隐藏再检查，新增黑名单拦截、移出后恢复', async () => {
  const env = guardedPage('pages/detail/detail', false);
  await env.page.onLoad({ id: '1' });
  await env.page.onShow();
  assert.equal(env.page.data.pageAccessReady, true);
  env.page.onHide();
  assert.equal(env.page.data.pageAccessReady, false);
  env.setBlocked(true);
  await env.page.onShow();
  assert.deepEqual(env.calls, ['load', 'show']);
  assert.equal(env.page.data.pageAccessReady, false);
  env.setBlocked(false);
  await env.page.onShow();
  assert.deepEqual(env.calls, ['load', 'show', 'show']);
  assert.equal(env.page.data.pageAccessReady, true);
});

test('详情停留时10秒检查账号状态，命中后隐藏内容并清空页面栈跳回我', async () => {
  let tick, marked = false;
  const redirects = [], intervals = [];
  const page = { route: 'pages/wishDetail/wishDetail', data: { pageAccessReady: true },
    setData(patch) { Object.assign(this.data, patch); } };
  const access = load('utils/blacklistAccess.js', {
    './api': { get: async url => { assert.equal(url, '/users/me/blacklist-status'); return { blacklisted: true }; } },
    './auth': { markBlacklisted() { marked = true; } }, './permissions': { applyPagePermissions() {} }
  }, {
    wx: { showToast() {}, reLaunch: options => redirects.push(options.url) },
    getCurrentPages: () => [page], setInterval: (fn, ms) => { tick = fn; intervals.push(ms); return 10; }, clearInterval() {}
  });
  access.watch(page);
  assert.deepEqual(intervals, [10000]);
  await tick();
  assert.equal(marked, true);
  assert.equal(page.data.pageAccessReady, false);
  assert.deepEqual(redirects, ['/pages/user/user']);
  access.stopWatching(page);
  assert.equal(page._blacklistWatchActive, false);
  page.route = 'pages/orderDetail/orderDetail';
  access.watch(page);
  assert.equal(page._blacklistWatchActive, true);
  assert.deepEqual(intervals, [10000, 10000]);
  page.route = 'pages/user/user';
  access.watch(page);
  assert.equal(page._blacklistWatchActive, false);
  assert.equal(intervals.length, 2);
});

test('后端黑名单错误直接触发踢回处理，保留专用错误码并不重试受限请求', async () => {
  let denied = 0, calls = 0;
  const api = load('utils/api.js', {
    './date': { dateTimestamp: () => 0 }, './config': { API_BASE_URL: 'https://example.test', USER_INFO_KEY: 'user' },
    './media': {}, './error': require('../../utils/error'),
    './blacklistAccess': { handleDenied() { denied++; } }
  }, {
    wx: { getStorageSync: () => ({}), request(options) {
      calls++;
      options.success({ statusCode: 403, data: { code: 'USER_BLACKLISTED', message: '当前账号已被移入黑名单' } });
    } }
  });
  await assert.rejects(api.request({ url: '/products/1', skipAuthRefresh: true }), error => error.code === 'USER_BLACKLISTED');
  assert.equal(denied, 1);
  assert.equal(calls, 1);
});

test('订单黑名单按钮使用下单账号并同步同账号其他订单，大编号不转数字', async () => {
  const changed = { id: '9007199254740993', nickname: '下单用户', phone: '13800000000', blacklisted: true };
  const user = { ...changed, blacklisted: false };
  const updates = [];
  const page = { data: { orders: [{ id: '101' }, { id: '102' }, { id: '103' }] },
    setData(patch) { Object.assign(this.data, patch); } };
  const utility = load('utils/orderBlacklist.js', {
    './auth': { canAccessMenu: code => code === 'orderManage' },
    './api': { get: async (url, data) => {
      assert.equal(data.orderIds, '101,102,103');
      return [{ orderId: '101', user }, { orderId: '102', user }, { orderId: '103', user: { id: '3', blacklisted: false } }];
    } }, './error': require('../../utils/error'),
    './userBlacklist': { confirmChange: async (account, url) => {
      assert.equal(account.id, '9007199254740993');
      assert.equal(account.phone, '13800000000');
      assert.equal(url, '/admin/blacklist/order-users/101');
      return changed;
    } }, './pageSync': { publish: (...args) => updates.push(args) }
  }, { wx: { showToast() {} } });
  await utility.refresh(page);
  await utility.toggle(page, '101');
  assert.equal(page.data.blacklistUsers['101'].blacklisted, true);
  assert.equal(page.data.blacklistUsers['102'].blacklisted, true);
  assert.equal(page.data.blacklistUsers['103'].blacklisted, false);
  assert.equal(page.data.blacklistSaving, false);
  assert.deepEqual(updates, [['blacklist-users', '9007199254740993']]);
});

test('四个受限页面均在授权完成前隐藏整页，包含商品详情浮层', () => {
  for (const route of ['index', 'market', 'detail', 'wishDetail']) {
    const source = fs.readFileSync(path.join(__dirname, '../../pages', route, route + '.wxml'), 'utf8').trim();
    assert.ok(source.startsWith('<block wx:if="{{pageAccessReady}}">'));
    assert.ok(source.endsWith('</block>'));
  }
});

test('移出黑名单明确提交false，取消确认不产生请求', async () => {
  const writes = [];
  let confirm = false;
  const utility = load('utils/userBlacklist.js', {
    './api': { put: async (url, data) => { writes.push({ url, ...data }); return { id: '9', blacklisted: data.blacklisted }; } }
  }, { wx: { showToast() {}, showModal: options => options.success({ confirm }) } });
  const user = { id: '9', nickname: '测试用户', phone: '13800000000', blacklisted: true };
  assert.equal(await utility.confirmChange(user), null);
  assert.equal(writes.length, 0);
  confirm = true;
  const changed = await utility.confirmChange(user);
  assert.equal(changed.blacklisted, false);
  assert.deepEqual(writes, [{ url: '/admin/blacklist/users/9', blacklisted: false }]);
});
