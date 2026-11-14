const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const config = require('../../utils/config');

function role(code, name = code, properties = {}) {
  return { code, name, kind: code === 'user' ? 'USER' : 'CUSTOM', permissions: [], ...properties };
}

function snapshot(current, menuCodes, roles = [role('user'), current]) {
  return { roles, currentRole: current,
    menus: menuCodes.map(code => ({ code, name: code, enabled: true })), stallIds: [] };
}

function loadAuth(info, api) {
  const store = {
    [config.USER_INFO_KEY]: { userId: 7, openid: 'test', ...info },
    [config.TOKEN_KEY]: 'token'
  };
  global.wx = {
    getStorageSync: key => store[key], setStorageSync: (key, value) => { store[key] = value; },
    removeStorageSync: key => { delete store[key]; }
  };
  const apiPath = require.resolve('../../utils/api');
  const authPath = require.resolve('../../utils/auth');
  const oldApi = require.cache[apiPath];
  require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: api };
  delete require.cache[authPath];
  const auth = require('../../utils/auth');
  return { auth, store, restore() {
    delete require.cache[authPath];
    if (oldApi) require.cache[apiPath] = oldApi;
    else delete require.cache[apiPath];
  } };
}

test('自定义角色显示服务端名称，只使用当前角色菜单', async () => {
  const warehouse = role('role_warehouse', '仓库发货员');
  const support = role('role_support', '售后专员');
  const env = loadAuth({ role: warehouse.code, selectedRole: warehouse.code }, {
    get: async () => ['user', warehouse.code, support.code],
    request: async options => {
      assert.equal(options.activeRole, warehouse.code);
      return snapshot(warehouse, ['shipping'], [role('user'), warehouse, support]);
    }
  });
  try {
    assert.deepEqual(await env.auth.loadAvailableRoles(), ['user', warehouse.code, support.code]);
    assert.equal(env.auth.getRoleLabel(warehouse.code), '仓库发货员');
    assert.equal(env.auth.canAccessMenu('shipping'), true);
    assert.equal(env.auth.canAccessMenu('afterSale'), false);
    env.auth.selectRole(support.code);
    assert.equal(env.auth.canAccessMenu('shipping'), false);
    assert.equal(env.auth.getPermissionSnapshot(), null);
  } finally { env.restore(); }
});

test('当前身份被撤销后回到普通用户，清除旧角色菜单', async () => {
  const calls = [];
  const env = loadAuth({ role: 'role_old', selectedRole: 'role_old' }, {
    request: async options => {
      calls.push(options.activeRole);
      if (options.activeRole === 'role_old') throw { statusCode: 403 };
      return snapshot(role('user', '普通用户'), ['browse'], [role('user')]);
    }
  });
  try {
    await env.auth.loadPermissionSnapshot();
    assert.deepEqual(calls, ['role_old', 'user']);
    assert.equal(env.auth.getUserInfo().selectedRole, 'user');
    assert.equal(env.auth.canAccessMenu('shipping'), false);
    assert.equal(env.auth.canAccessMenu('browse'), true);
  } finally { env.restore(); }
});

test('旧角色权限响应不能覆盖已切换的角色或账号', async () => {
  let complete;
  const env = loadAuth({ role: 'role_old', selectedRole: 'role_old', availableRoles: ['user', 'role_new'] }, {
    request: () => new Promise(resolve => { complete = resolve; })
  });
  try {
    const pending = env.auth.loadPermissionSnapshot();
    env.auth.selectRole('role_new');
    complete(snapshot(role('role_old'), ['shipping']));
    await pending;
    assert.equal(env.auth.getUserInfo().role, 'role_new');
    assert.equal(env.auth.getPermissionSnapshot(), null);
  } finally { env.restore(); }
});

test('同角色并发刷新共享请求，特殊负责人以业务标识识别', async () => {
  let calls = 0;
  const manager = role('custom_manager', '改名后的负责人', { kind: 'SPECIAL', businessKey: 'STALL_MANAGER' });
  const env = loadAuth({ role: manager.code, selectedRole: manager.code }, {
    request: async () => { calls++; return snapshot(manager, ['income']); }
  });
  try {
    await Promise.all([env.auth.loadPermissionSnapshot(), env.auth.loadPermissionSnapshot()]);
    assert.equal(calls, 1);
    assert.equal(env.auth.isStallManager(), true);
    assert.equal(env.auth.isAdmin(), false);
  } finally { env.restore(); }
});

test('工作台按服务端菜单过滤，排序缓存不能恢复旧权限', () => {
  const workbench = require('../../utils/workbench');
  assert.deepEqual(workbench.getOrderedEntries('role_warehouse', ['afterSale', 'shipping'], [
    { code: 'shipping', name: '发货岗位', enabled: true }, { code: 'roleManage', name: '角色管理', enabled: true }
  ]).map(entry => entry.id), ['shipping', 'roleManage']);
  assert.deepEqual(workbench.getOrderedEntries('role_warehouse', ['shipping'], []), []);
  assert.notEqual(workbench.getStorageKey({ userId: 7, role: 'role_warehouse' }),
    workbench.getStorageKey({ userId: 7, role: 'role_support' }));
});

function loadPermissions(auth, wx = {}, consent = { ensure: async () => true, isConfirmed: () => true }) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/permissions.js'), 'utf8'), {
    module, wx, require: name => name === './auth' ? auth : name === './purchaseConsent' ? consent : { getErrorMessage: (error, fallback) => error.message || fallback }
  });
  return module.exports;
}

test('购买须知停用后不阻止业务页面加载，保留正常身份权限检查', async () => {
  const calls = [];
  const permissions = loadPermissions({ ensureAuthenticated: async () => {}, loadPermissionSnapshot: async () => {},
    canAccessMenu: () => true, getPermissionSnapshot: () => null }, {
    showLoading: () => calls.push('mask'), hideLoading: () => calls.push('unmask')
  }, { isConfirmed() { throw new Error('不应再检查须知'); }, ensure() { throw new Error('不应再拦截页面'); } });
  const page = { ...permissions.wrap({ onLoad() { calls.push('load'); }, onShow() { calls.push('show'); } }),
    route: 'pages/detail/detail', setData() {} };
  await Promise.all([page.onLoad({ id: '123' }), page.onShow()]);
  assert.deepEqual(calls, ['load', 'show']);
});

test('直接访问、共享订单详情及未知页面均按菜单检查', () => {
  const permissions = loadPermissions({ canAccessMenu: code => code === 'shipping' });
  assert.equal(permissions.canVisit('pages/adminOrder/adminOrder'), true);
  assert.equal(permissions.canVisit('pages/adminOrderDetail/adminOrderDetail'), true);
  assert.equal(permissions.canVisit('pages/adminAfterSaleList/adminAfterSaleList'), false);
  assert.equal(permissions.canVisit('pages/unknown/index'), false);
  assert.equal(permissions.canVisit('pages/user/user'), true);
});

test('仅有心愿管理权限也能进入市集，工作台旧入口和旧路由已撤下', () => {
  const permissions = loadPermissions({ canAccessMenu: code => code === 'wishManage' });
  assert.equal(permissions.canVisit('pages/market/market'), true);
  assert.equal(permissions.canVisit('pages/adminWish/adminWish'), false);
  const workbench = require('../../utils/workbench');
  assert.deepEqual(workbench.getOrderedEntries('role_wishes', ['wishManage'], [{ code: 'wishManage' }]), []);
  const app = require('../../app.json');
  assert.equal(app.subPackages.some(pkg => pkg.root === 'pages/adminWish'), false);
});

test('页面先刷新权限再加载业务，撤权后不运行旧页面业务回调', async () => {
  let allow = true;
  let loaded = 0;
  let shown = 0;
  let reads = 0;
  const redirects = [];
  const auth = {
    canAccessMenu: code => allow && code === 'shipping',
    ensureAuthenticated: async () => {}, loadPermissionSnapshot: async () => { reads++; },
    getPermissionSnapshot: () => snapshot(role('warehouse'), ['shipping'])
  };
  const permissions = loadPermissions(auth, { showToast() {}, reLaunch: options => redirects.push(options.url) });
  const page = { ...permissions.wrap({ onLoad() { loaded++; }, onShow() { shown++; } }),
    route: 'pages/adminOrder/adminOrder', setData() {} };
  await Promise.all([page.onLoad({}), page.onShow()]);
  assert.equal(loaded, 1);
  assert.equal(shown, 1);
  assert.equal(reads, 1);
  allow = false;
  await page.onShow();
  assert.equal(shown, 1);
  assert.deepEqual(redirects, ['/pages/user/user']);
});

test('共享订单详情的发货权限可以改收件信息，不能退款或改价', () => {
  const calls = [];
  const permissions = loadPermissions({ canAccessMenu: code => code === 'shipping' }, { showToast() {} });
  const page = { ...permissions.wrap({
    openRefundPanel() { calls.push('refund'); }, savePrice() { calls.push('price'); },
    openRecipientEditor() { calls.push('recipient'); }, confirmFullUnbind() { calls.push('unbind'); }
  }), route: 'pages/adminOrderDetail/adminOrderDetail' };
  page.openRefundPanel(); page.savePrice(); page.openRecipientEditor(); page.confirmFullUnbind();
  assert.deepEqual(calls, ['recipient', 'unbind']);
});

test('所有已注册页面都有菜单访问规则，身份切换页始终可进入', () => {
  const permissions = loadPermissions({ canAccessMenu: () => false });
  const manifest = require('../../app.json');
  const pages = manifest.pages.concat(manifest.subPackages.flatMap(pkg => pkg.pages.map(name => pkg.root + '/' + name)));
  for (const route of pages) {
    assert.ok(route === 'pages/user/user' || Object.hasOwn(permissions.requirements, route), route);
  }
});

test('角色选择支持多于六个岗位，权限读取失败恢复原身份', async () => {
  const codes = ['user', ...Array.from({ length: 10 }, (_, index) => 'role_' + index)];
  let info = { userId: 7, role: 'user', selectedRole: 'user' };
  let fail = false;
  let definition;
  const redirects = [];
  const auth = {
    getUserInfo: () => info,
    loadAvailableRoles: async () => codes,
    getRoleLabel: code => code === 'user' ? '普通用户' : '岗位 ' + code,
    selectRole: code => { info = { ...info, role: code, selectedRole: code }; },
    loadPermissionSnapshot: async () => { if (fail) throw new Error('网络中断'); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/user/user.js'), 'utf8'), {
    Page: value => { definition = value; }, console,
    require: name => name.endsWith('/auth') ? auth : name.endsWith('/config') ? config
      : name.endsWith('/error') ? { getErrorMessage: error => error.message } : {},
    wx: { reLaunch: options => redirects.push(options.url), showToast() {},
      setStorageSync: (key, value) => { if (key === config.USER_INFO_KEY) info = value; } }
  });
  const page = { ...definition, data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); }, checkAdmin() {}, loadUserInfo() {} };
  await page.switchRole();
  assert.equal(page.data.roleOptions.length, 11);
  await page.chooseRole({ currentTarget: { dataset: { code: 'role_9' } } });
  assert.equal(info.role, 'role_9');
  assert.deepEqual(redirects, ['/pages/user/user']);
  fail = true;
  await page.chooseRole({ currentTarget: { dataset: { code: 'user' } } });
  assert.equal(info.role, 'role_9');
  assert.equal(page.data.rolePicking, false);
});
