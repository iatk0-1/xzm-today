const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(cached, profile, canProfile = true) {
  let page;
  let stored = cached;
  const auth = {
    canAccessMenu: () => canProfile,
    getRoleLabel: code => ({ admin: '管理员', user: '普通用户' }[code]),
    getPermissionSnapshot: () => ({ menus: [] }),
    ROLE_LABELS: { user: '普通用户', stall_manager: '档口负责人', admin: '管理员' },
    getUserInfo: () => stored,
    loadAvailableRoles: async () => [(stored && stored.role) || 'user'],
    ensureAuthenticated: async () => {},
    isAdmin: () => stored && stored.role === 'admin',
    isStallManager: () => false
  };
  const toasts = [], navigations = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/user/user.js'), 'utf8'), {
    require(name) {
        if (name.endsWith('/error')) return require('../../utils/error');
      if (name === '../../utils/auth') return auth;
      if (name.endsWith('/permissions')) return { applyPagePermissions() {} };
      if (name === '../../utils/api') return { get: async () => profile };
      if (name === '../../utils/workbench') return require('../../utils/workbench');
      return {};
    },
    wx: { setStorageSync: (key, value) => { stored = value; }, showToast: value => toasts.push(value.title),
      navigateTo: value => navigations.push(value.url) },
    console,
    Page(value) { page = value; }
  });
  page.setData = function(value) { Object.assign(this.data, value); };
  return { page, getStored: () => stored, toasts, navigations };
}

test('本地缓存有手机号时，即使旧绑定标记为 false 也显示已绑定', () => {
  const { page } = loadPage({ phone: '13800000000', isPhoneBound: false });
  page.loadUserInfo();
  assert.equal(page.data.isPhoneBound, true);
  assert.equal(page.data.phone, '13800000000');
});

test('用户资料只返回 phone 时，刷新页面并修复缓存中的绑定状态', async () => {
  const env = loadPage({ isPhoneBound: false }, { phone: '13800000000', role: 'admin' });
  await env.page.refreshUserInfoFromServer();
  assert.equal(env.page.data.isPhoneBound, true);
  assert.equal(env.page.data.phone, '13800000000');
  assert.equal(env.getStored().isPhoneBound, true);
  assert.equal(env.page.data.isAdmin, true);
});

test('接口手机号为空时，清除旧手机号和已绑定状态', async () => {
  for (const phone of [null, '', undefined]) {
    const env = loadPage({ phone: '13800000000', isPhoneBound: true }, { phone });
    await env.page.refreshUserInfoFromServer();
    assert.equal(env.page.data.isPhoneBound, false);
    assert.equal(env.page.data.phone, null);
    assert.equal(env.getStored().isPhoneBound, false);
  }
});

test('本地缓存为空时，接口返回的手机号仍能显示', async () => {
  const env = loadPage(null, { phone: '13800000000' });
  await env.page.refreshUserInfoFromServer();
  assert.equal(env.page.data.isPhoneBound, true);
  assert.equal(env.getStored().phone, '13800000000');
});

test('没有个人资料菜单时不打开编辑页也不提交手机号绑定', async () => {
  const env = loadPage({ role: 'warehouse' }, null, false);
  env.page.goToEditProfile();
  await env.page.onGetPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'fixture' } });
  assert.equal(env.navigations.length, 0);
  assert.equal(env.toasts.length, 2);
  assert.ok(env.toasts.every(message => message.includes('权限')));
});
