const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(name, role) {
  let pageConfig;
  let sheet;
  const navigations = [];
  const toasts = [];
  const auth = {
    ROLE_LABELS: { user: '普通用户', stall_manager: '档口负责人', admin: '管理员' },
    getUserInfo: () => ({ role }),
    isAdmin: () => role === 'admin',
    isStallManager: () => role === 'stall_manager',
    loadAvailableRoles: async () => ['user', 'stall_manager', 'admin'],
    selectRole: selectedRole => { role = selectedRole; }
  };
  const wx = {
    showActionSheet: options => { sheet = options; },
    navigateTo: options => navigations.push(options.url),
    reLaunch: options => navigations.push(options.url),
    showToast: options => toasts.push(options.title)
  };
  const menuModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/managementNavigation.js'), 'utf8'), {
    require: request => request === './workbench' ? require('../../utils/workbench') : auth, wx, module: menuModule
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../../pages/${name}/${name}.js`), 'utf8'), {
    require(request) {
        if (request.endsWith('/error')) return require('../../utils/error');
      if (request.endsWith('/auth')) return auth;
      if (request.endsWith('/managementNavigation')) return menuModule.exports;
      if (request.endsWith('/workbench')) return require('../../utils/workbench');
      if (request.endsWith('/pageSync')) return { wrap: config => config };
      if (request.endsWith('/customerServiceUnread')) return { start() {} };
      return {};
    },
    Page: config => { pageConfig = config; },
    getApp: () => ({}), wx, console, clearInterval() {}, setInterval() {}
  });
  const page = { ...pageConfig, data: { ...pageConfig.data } };
  page.setData = patch => Object.assign(page.data, patch);
  if (page.checkAdmin) page.checkAdmin();
  else {
    page.loadContact = () => {};
    page.onShow();
  }
  return { page, navigations, toasts, get sheet() { return sheet; } };
}

function evaluateCondition(expression, data) {
  return vm.runInNewContext(expression, { isAdmin: data.isAdmin, isStallManager: data.isStallManager });
}

for (const name of ['index', 'market', 'messages', 'user']) {
  for (const role of ['stall_manager', 'admin', 'user']) {
    test(`${role} 在 ${name} 自定义底栏中，加号仅用于商品新增并按角色显示`, () => {
      const fixture = loadPage(name, role);
      const wxml = fs.readFileSync(path.join(__dirname, `../../pages/${name}/${name}.wxml`), 'utf8');
      const portals = Array.from(wxml.matchAll(/<view class="tab-item admin-portal" wx:if="\{\{([^}]+)\}\}" bindtap="([^"]+)"/g));
      assert.equal(portals.length, 1, '每个主页面必须有一个自定义加号入口');
      const [, condition, handler] = portals[0];
      assert.equal(evaluateCondition(condition, fixture.page.data), role !== 'user');
      fixture.page[handler]();
      assert.equal(fixture.sheet, undefined, '点击加号不能弹出管理菜单');
      assert.deepEqual(fixture.navigations, role === 'user' ? [] : ['/pages/admin/admin']);
      assert.deepEqual(fixture.toasts, role === 'user' ? ['无权限'] : []);
    });
  }
}

const workbenchTemplate = fs.readFileSync(path.join(__dirname, '../../pages/user/user.wxml'), 'utf8');
const workbenchCondition = workbenchTemplate.match(/class="workbench-section" wx:if="\{\{([^}]+)\}\}"/)[1];
const migratedTargets = {
  productManage: '/pages/adminProduct/adminProduct',
  inventory: '/pages/skuInventory/skuInventory',
  picking: '/pages/pickingList/pickingList',
  orderManage: '/pages/adminOrderManage/adminOrderManage',
  shipping: '/pages/adminOrder/adminOrder'
};

for (const role of ['admin', 'stall_manager', 'user']) {
  test(`${role} 工作台显示正确的入口，迁入按钮可打开原来的管理页面`, () => {
    const fixture = loadPage('user', role);
    const visible = evaluateCondition(workbenchCondition, fixture.page.data);
    assert.equal(visible, role !== 'user');
    assert.match(workbenchTemplate, /wx:for="\{\{workbenchItems\}\}"/);
    assert.match(workbenchTemplate, /class="workbench-button" bindtap="goToWorkbench" data-entry="\{\{item.id\}\}"/);
    const buttons = visible ? Array.from(fixture.page.data.workbenchItems) : [];
    assert.equal(buttons.length, role === 'admin' ? 14 : role === 'stall_manager' ? 4 : 0);
    if (role === 'stall_manager') {
      assert.deepEqual(buttons.map(button => button.label), ['商品上下架管理', '拣货推荐', '销售数据', '我的收入与提现']);
    }
    const migrated = buttons.filter(button => Object.hasOwn(migratedTargets, button.id));
    assert.deepEqual(migrated.map(button => button.id), role === 'admin' ? Object.keys(migratedTargets) : role === 'stall_manager' ? ['productManage', 'picking'] : []);
    for (const button of migrated) {
      fixture.page.goToWorkbench({ currentTarget: { dataset: { entry: button.id } } });
    }
    assert.deepEqual(fixture.navigations, migrated.map(button => migratedTargets[button.id]));
    assert.equal(fixture.sheet, undefined);
    assert.deepEqual(fixture.toasts, []);
    if (role === 'admin') assert.equal(buttons.filter(button => button.label === '售后管理').length, 1);
    assert.equal(buttons.some(button => button.label === '发布新商品'), false);
    const registeredPages = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8')).pages;
    for (const target of fixture.navigations) assert.ok(registeredPages.includes(target.slice(1)));
  });
}

test('负责人直接触发管理员工作台入口也不能跳转', () => {
  const fixture = loadPage('user', 'stall_manager');
  for (const entry of ['inventory', 'orderManage', 'shipping']) {
    fixture.page.goToWorkbench({ currentTarget: { dataset: { entry } } });
  }
  assert.deepEqual(fixture.navigations, []);
  assert.deepEqual(fixture.toasts, ['无权限', '无权限', '无权限']);
});

for (const role of ['admin', 'stall_manager']) {
  test(`${role} 切换成普通用户后隐藏整个工作台，旧入口和加号均不能继续跳转`, async () => {
    const fixture = loadPage('user', role);
    await fixture.page.switchRole();
    fixture.sheet.success({ tapIndex: 0 });
    assert.equal(fixture.page.data.currentRoleLabel, '普通用户');
    assert.equal(evaluateCondition(workbenchCondition, fixture.page.data), false);
    assert.deepEqual(fixture.navigations, ['/pages/user/user']);
    fixture.navigations.length = 0;
    fixture.page.onWorkbenchTouchStart();
    for (const entry of Object.keys(migratedTargets)) {
      fixture.page.goToWorkbench({ currentTarget: { dataset: { entry } } });
    }
    fixture.page.goToCreateProduct();
    assert.deepEqual(fixture.navigations, []);
    assert.deepEqual(fixture.toasts, Array(6).fill('无权限'));
  });
}

test('工作台拒绝未知入口，不把任意字符串当成页面路径', () => {
  const fixture = loadPage('user', 'admin');
  for (const entry of ['unknown', '/pages/admin/admin', '__proto__', 'toString']) {
    fixture.page.goToWorkbench({ currentTarget: { dataset: { entry } } });
  }
  assert.deepEqual(fixture.navigations, []);
  assert.deepEqual(fixture.toasts, Array(4).fill('工作台入口不存在'));
});
