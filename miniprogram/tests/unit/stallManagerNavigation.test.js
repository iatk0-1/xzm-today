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
    isAdmin: () => role === 'admin',
    isStallManager: () => role === 'stall_manager'
  };
  const wx = {
    showActionSheet: options => { sheet = options; },
    navigateTo: options => navigations.push(options.url),
    reLaunch: options => navigations.push(options.url),
    showToast: options => toasts.push(options.title)
  };
  const menuModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/managementNavigation.js'), 'utf8'), {
    require: () => auth, wx, module: menuModule
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../../pages/${name}/${name}.js`), 'utf8'), {
    require(request) {
      if (request.endsWith('/auth')) return auth;
      if (request.endsWith('/managementNavigation')) return menuModule.exports;
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

for (const name of ['index', 'market', 'messages', 'user']) {
  test(`负责人在 ${name} 页面有加号，菜单只含三个管理入口`, () => {
    const fixture = loadPage(name, 'stall_manager');
    assert.equal(fixture.page.data.isStallManager, true);
    const wxml = fs.readFileSync(path.join(__dirname, `../../pages/${name}/${name}.wxml`), 'utf8');
    assert.match(wxml, /class="tab-item admin-portal" wx:if="\{\{isAdmin \|\| isStallManager\}\}"/);
    fixture.page.goToAdmin();
    assert.deepEqual(Array.from(fixture.sheet.itemList), ['发布新商品', '商品上下架管理', '拣货推荐']);
    ['admin/admin', 'adminProduct/adminProduct', 'pickingList/pickingList'].forEach((target, tapIndex) => {
      fixture.sheet.success({ tapIndex });
      assert.equal(fixture.navigations[tapIndex], '/pages/' + target);
    });
    if (name === 'user') assert.match(wxml, /bindtap="goToSales"/);
  });

  test(`普通用户在 ${name} 页面无管理权限`, () => {
    const fixture = loadPage(name, 'user');
    assert.equal(fixture.page.data.isAdmin, false);
    assert.equal(fixture.page.data.isStallManager, false);
    fixture.page.goToAdmin();
    assert.equal(fixture.sheet, undefined);
    assert.deepEqual(fixture.toasts, ['无权限']);
    assert.deepEqual(fixture.navigations, []);
  });

  test(`管理员在 ${name} 页面保留原来的管理入口`, () => {
    const fixture = loadPage(name, 'admin');
    fixture.page.goToAdmin();
    if (name === 'messages') {
      assert.deepEqual(fixture.navigations, ['/pages/admin/admin']);
    } else {
      assert.deepEqual(Array.from(fixture.sheet.itemList), [
        '发布新商品', '商品上下架管理', '库存管理', '拣货推荐', '订单管理',
        name === 'market' ? '售后管理' : '订单发货管理'
      ]);
    }
  });
}
