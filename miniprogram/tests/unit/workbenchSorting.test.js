const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const workbench = require('../../utils/workbench');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  let info = { userId: '9007199254740993', role: 'admin', ...options.info };
  const cache = new Map(options.cache || []);
  const requests = [], navigations = [], toasts = [];
  const auth = {
    ROLE_LABELS: { admin: '管理员', stall_manager: '档口负责人', user: '普通用户' },
    getUserInfo: () => info,
    isAdmin: () => info.role === 'admin', isStallManager: () => info.role === 'stall_manager'
  };
  const api = {
    get: (url, data) => {
      requests.push({ method: 'GET', url, data });
      return options.read ? options.read(url, data) : Promise.resolve({ userId: info.userId, role: info.role, entries: [] });
    },
    put: (url, data) => {
      requests.push({ method: 'PUT', url, data });
      return options.write ? options.write(url, data) : Promise.resolve(data);
    }
  };
  const wx = {
    getWindowInfo: () => ({ windowWidth: options.width || 375 }),
    getStorageSync: key => cache.get(key), setStorageSync: (key, value) => cache.set(key, value),
    navigateTo: ({ url }) => navigations.push(url), showToast: ({ title }) => toasts.push(title), vibrateShort() {}
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/managementNavigation.js'), 'utf8'), {
    require: name => name.endsWith('/error') ? require('../../utils/error') : name === './auth' ? auth : workbench, module, wx
  });
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/user/user.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, console: { error() {} },
    require(name) {
        if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/workbench')) return workbench;
      if (name.endsWith('/auth')) return auth;
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/managementNavigation')) return module.exports;
      if (name.endsWith('/customerServiceUnread')) return { stop() {} };
      return {};
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  page.checkAdmin();
  return { page, requests, navigations, toasts, cache, setInfo(value) { info = value; } };
}

const event = (entry, detail = {}) => ({ currentTarget: { dataset: { entry } }, detail });
const ids = page => Array.from(page.data.workbenchItems, item => item.id);
const settle = () => new Promise(resolve => setImmediate(resolve));

test('排序缓存去重、过滤无权限入口并追加新增入口，普通用户无按钮', () => {
  const entries = workbench.getOrderedEntries('stall_manager', ['income', 'income', 'inventory', 'unknown']);
  assert.deepEqual(entries.map(item => item.id), ['income', 'productManage', 'picking', 'sales']);
  assert.equal(workbench.getOrderedEntries('admin', {}).length, 15);
  assert.deepEqual(workbench.getOrderedEntries('user', ['inventory']), []);
});

test('三列布局适配不同屏宽，最后一行空位及越界位置落到有效按钮', () => {
  for (const width of [320, 375, 430]) {
    const layout = workbench.createLayout(workbench.getOrderedEntries('admin'), 648 * width / 750, width / 750);
    assert.ok(Math.abs(layout.items[2].x + layout.itemWidth - 648 * width / 750) < 0.0001);
    assert.equal(workbench.getDropIndex(1e5, 1e5, layout, 14), 13);
    assert.equal(workbench.getDropIndex(-100, -100, layout, 14), 0);
    assert.equal(layout.items[3].x, 0);
    assert.equal(layout.items[3].y, layout.stepY);
  }
});

test('读取服务端排序恢复位置，跨设备无本地缓存也能恢复', async () => {
  const env = fixture({ read: () => Promise.resolve({ userId: '9007199254740993', role: 'admin', entries: ['applications', 'sales'] }) });
  await settle();
  assert.deepEqual(ids(env.page).slice(0, 2), ['applications', 'sales']);
  assert.equal(ids(env.page).length, 15);
  assert.deepEqual(env.cache.get('workbenchOrder:v1:9007199254740993:admin').slice(0, 2), ['applications', 'sales']);
  assert.equal(env.requests[0].url, '/users/me/workbench-order');
});

test('长按跨行拖动让位，松手仅保存一次到后端且拖动不误触跳转', async () => {
  const env = fixture();
  await settle();
  const page = env.page;
  page.onWorkbenchDragStart(event('productManage'));
  page.goToWorkbench(event('productManage'));
  assert.deepEqual(env.navigations, []);
  page.onWorkbenchDragMove(event('inventory', { x: 1000, y: 1000, source: 'touch' }));
  assert.equal(ids(page)[0], 'productManage');
  page.onWorkbenchDragMove(event('productManage', { x: 1000, y: 1000, source: '' }));
  assert.equal(ids(page)[0], 'productManage');
  page.onWorkbenchDragMove(event('productManage', { x: page._workbenchLayout.stepX, y: page._workbenchLayout.stepY, source: 'touch' }));
  assert.equal(ids(page)[4], 'productManage');
  const saving = page.onWorkbenchDragEnd(event('productManage'));
  page.onWorkbenchDragEnd(event('productManage'));
  page.goToWorkbench(event('productManage'));
  assert.deepEqual(env.navigations, []);
  await saving;
  const writes = env.requests.filter(item => item.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.userId, '9007199254740993');
  assert.equal(writes[0].data.role, 'admin');
  assert.equal(writes[0].data.entries[4], 'productManage');
  assert.equal(page.data.workbenchDraggingId, '');
  assert.equal(page.data.workbenchSaving, false);
  assert.equal(page.data.workbenchItems[4].x, page._workbenchLayout.stepX);
  page.onWorkbenchTouchStart();
  page.goToWorkbench(event('productManage'));
  assert.deepEqual(env.navigations, ['/pages/adminProduct/adminProduct']);
});

test('保存过程中阻止再次拖动，接口失败恢复原顺序并提示', async () => {
  const write = deferred();
  const env = fixture({ write: () => write.promise });
  await settle();
  const original = ids(env.page);
  env.page.onWorkbenchDragStart(event('productManage'));
  env.page.onWorkbenchDragMove(event('productManage', { x: 200, y: 200, source: 'touch' }));
  const saving = env.page.onWorkbenchDragEnd(event('productManage'));
  assert.equal(env.page.data.workbenchSaving, true);
  env.page.onWorkbenchDragStart(event('picking'));
  assert.equal(env.page._workbenchDrag, null);
  write.reject({ errMsg: 'request:fail connection closed' });
  await saving;
  assert.deepEqual(ids(env.page), original);
  assert.deepEqual(env.toasts, ['网络连接异常，请检查网络后重试']);
});

test('未跨格和取消手势均复位，不向后端保存', async () => {
  const env = fixture();
  await settle();
  const original = ids(env.page);
  const oldKey = env.page.data.workbenchItems[2].renderKey;
  env.page.onWorkbenchDragStart(event('picking'));
  env.page.onWorkbenchDragMove(event('picking', { x: env.page._workbenchLayout.stepX * 2 - 2, y: 2, source: 'touch' }));
  env.page.onWorkbenchDragEnd(event('picking'));
  assert.notEqual(env.page.data.workbenchItems[2].renderKey, oldKey);
  assert.equal(env.page.data.workbenchItems[2].y, 0);
  env.page.onWorkbenchDragStart(event('picking'));
  env.page.onWorkbenchDragMove(event('picking', { x: 0, y: 200, source: 'touch' }));
  env.page.onWorkbenchDragCancel(event('picking'));
  assert.deepEqual(ids(env.page), original);
  assert.equal(env.page.data.workbenchDraggingId, '');
  assert.equal(env.requests.filter(item => item.method === 'PUT').length, 0);
});

test('拖动时切角色或离开页面取消排序，普通用户工作台为空', async () => {
  const env = fixture();
  await settle();
  env.page.onWorkbenchDragStart(event('productManage'));
  env.page.onWorkbenchDragMove(event('productManage', { x: 200, y: 200, source: 'touch' }));
  env.page.onHide();
  assert.equal(ids(env.page)[0], 'productManage');
  env.page.onWorkbenchTouchStart();
  env.page.onWorkbenchDragStart(event('picking'));
  env.setInfo({ userId: '9007199254740993', role: 'user' });
  env.page.onWorkbenchDragEnd(event('picking'));
  env.page.checkAdmin();
  assert.equal(env.page.data.isAdmin, false);
  assert.deepEqual(ids(env.page), []);
  assert.equal(env.requests.filter(item => item.method === 'PUT').length, 0);
});

test('延迟读取结果不覆盖正在拖动的新顺序，切账号后不承接旧响应', async () => {
  const read = deferred();
  const env = fixture({ read: () => read.promise });
  env.page.onWorkbenchDragStart(event('productManage'));
  env.page.onWorkbenchDragMove(event('productManage', { x: 200, y: 200, source: 'touch' }));
  const moved = ids(env.page);
  read.resolve({ userId: '9007199254740993', role: 'admin', entries: ['applications'] });
  await settle();
  assert.deepEqual(ids(env.page), moved);
  env.page.cancelWorkbenchDrag();
  const later = deferred();
  const second = fixture({ read: () => later.promise });
  second.setInfo({ userId: '9007199254740994', role: 'stall_manager' });
  second.page.checkAdmin();
  later.resolve({ userId: '9007199254740993', role: 'admin', entries: ['applications'] });
  await settle();
  assert.deepEqual(ids(second.page), ['productManage', 'picking', 'sales', 'income']);
});

test('账号和角色隔离，旧保存响应不能覆盖切换后的页面', async () => {
  const write = deferred();
  const env = fixture({ write: () => write.promise });
  await settle();
  env.page.onWorkbenchDragStart(event('productManage'));
  env.page.onWorkbenchDragMove(event('productManage', { x: 200, y: 200, source: 'touch' }));
  const saving = env.page.onWorkbenchDragEnd(event('productManage'));
  env.setInfo({ userId: '9007199254740994', role: 'stall_manager' });
  env.page.checkAdmin();
  await settle();
  write.resolve(env.requests.find(item => item.method === 'PUT').data);
  await saving;
  assert.deepEqual(ids(env.page), ['productManage', 'picking', 'sales', 'income']);
  assert.equal(env.cache.has('workbenchOrder:v1:9007199254740993:admin'), true);
  assert.equal(env.cache.get('workbenchOrder:v1:9007199254740993:admin')[0], 'productManage');
  assert.notEqual(workbench.getStorageKey({ userId: '1', role: 'admin' }), workbench.getStorageKey({ userId: '1', role: 'stall_manager' }));
});

test('所有动态按钮目标页面都已注册，模板绑定拖动、取消和滚动锁定', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
  const pages = appConfig.pages.concat(
    (appConfig.subPackages || appConfig.subpackages || []).flatMap(pkg => pkg.pages.map(page => `${pkg.root}/${page}`))
  );
  for (const role of ['admin', 'stall_manager']) {
    for (const entry of workbench.getOrderedEntries(role)) assert.ok(pages.includes(entry.url.slice(1)));
  }
  const template = fs.readFileSync(path.join(__dirname, '../../pages/user/user.wxml'), 'utf8');
  assert.match(template, /bindlongpress="onWorkbenchDragStart"/);
  assert.match(template, /bindtouchcancel="onWorkbenchDragCancel"/);
  assert.match(template, /<page-meta page-style=/);
});
