const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
let admin = false;
const navigations = [];
global.Page = config => { pageConfig = config; };
global.wx = {
  getMenuButtonBoundingClientRect: () => ({ bottom: 80 }),
  navigateTo: options => navigations.push(options.url)
};

const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/auth')) return { isAdmin: () => admin };
  if (request.endsWith('utils/api')) return {};
  if (request.endsWith('utils/stock')) return {};
  if (request.endsWith('utils/shareImage')) return {};
  if (request.endsWith('utils/customerServiceNavigation')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/detail/detail.js');
Module._load = originalLoad;

function page() {
  const instance = Object.assign({}, pageConfig);
  instance.data = JSON.parse(JSON.stringify(pageConfig.data));
  instance.setData = patch => Object.assign(instance.data, patch);
  instance.data.product = { id: '123' };
  return instance;
}

test('编辑按钮初始在分享下方，拖动后只改变编辑位置', () => {
  admin = true;
  navigations.length = 0;
  const instance = page();
  instance.initShareFloatPosition({ windowWidth: 375, windowHeight: 667 });
  assert.equal(instance.data.editFloatLeft, instance.data.shareFloatLeft);
  assert.equal(instance.data.editFloatTop, instance.data.shareFloatTop + 66);

  instance.startEditFloatDrag({ touches: [{ clientX: 300, clientY: 200 }] });
  instance.moveEditFloat({ touches: [{ clientX: 1000, clientY: 1000 }] });
  instance.endEditFloatDrag();
  assert.equal(instance.data.editFloatLeft, 317);
  assert.equal(instance.data.editFloatTop, 609);
  assert.equal(instance.data.shareFloatLeft, 299);
  assert.equal(navigations.length, 0);
});

test('管理员轻点编辑跳转商品编辑页，非管理员不能跳转', () => {
  const instance = page();
  instance.initShareFloatPosition({ windowWidth: 375, windowHeight: 667 });
  navigations.length = 0;
  admin = true;
  instance.startEditFloatDrag({ touches: [{ clientX: 300, clientY: 200 }] });
  instance.endEditFloatDrag();
  assert.deepEqual(navigations, ['/pages/admin/admin?editId=123']);

  admin = false;
  instance.startEditFloatDrag({ touches: [{ clientX: 300, clientY: 200 }] });
  instance.endEditFloatDrag();
  assert.equal(navigations.length, 1);
});
