const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadConfig(file, api, wx = {}) {
  let config;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    Page(value) { config = value; }, Component(value) { config = value; },
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => true };
      if (name.endsWith('/pageSync')) return { wrap: value => value };
      throw new Error('未模拟依赖：' + name);
    },
    wx: { showToast() {}, ...wx }, console, setInterval, clearInterval
  });
  return config;
}

function createInstance(config) {
  return {
    ...config, ...config.methods,
    data: structuredClone(config.data), properties: { visible: false, stallId: '', stallName: '' },
    events: [], setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { this.events.push({ name, detail }); }
  };
}

function open(config, picker, stallId) {
  picker.properties = { visible: true, stallId, stallName: '测试档口' };
  config.observers['visible, stallId'].call(picker, true, stallId);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const event = id => ({ currentTarget: { dataset: { id } } });

test('列表分配直接打开本页弹窗，保存后原位更新负责人完整资料', async () => {
  let navigations = 0;
  const user = { userId: 8, stallId: 1, nickname: '负责人', phone: '13800000000', avatarUrl: 'https://example.com/avatar.jpg' };
  const config = loadConfig('pages/adminCatalogManage/adminCatalogManage.js', {
    get: async url => url === '/stall-managers/assignments' ? [user] : [{ id: 1, name: '一档口' }]
  }, { navigateTo() { navigations += 1; } });
  const page = createInstance(config);
  await page.loadGroups();
  assert.equal(page.data.groups[0].managers[0].avatarUrl, user.avatarUrl);
  assert.equal(page.data.groups[0].managers[0].id, 8);
  page.openManagerAssignment({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(navigations, 0);
  assert.equal(page._openedProducts, undefined);
  assert.equal(page.data.managerVisible, true);
  assert.equal(page.data.managerStallId, '1');
  const managers = [{ id: 9, nickname: '新负责人', phone: '13900000000', avatarUrl: 'new.jpg' }];
  page.onManagersChanged({ detail: { stallId: '1', managers } });
  assert.equal(page.data.groups[0].managers, managers);
  assert.equal(page.data.groups[0].y, 0);
  page.closeManagerPicker();
  page.openProducts({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(navigations, 1);
});

test('添加和移除保留其他负责人，已分配用户不能重复添加', async () => {
  const original = { id: 1, nickname: '原负责人', phone: '13800000001', avatarUrl: 'one.jpg' };
  const candidate = { id: 2, nickname: '新负责人', phone: '13800000002', avatarUrl: 'two.jpg' };
  const writes = [];
  const config = loadConfig('components/stallManagerPicker/index.js', {
    get: async url => url.includes('/users') ? [original, candidate] : [original],
    put: async (url, ids) => { writes.push(Array.from(ids)); return [original, candidate].filter(user => ids.includes(user.id)); }
  });
  const picker = createInstance(config);
  open(config, picker, '11');
  await flush();
  picker.onKeywordInput({ detail: { value: '负责人' } });
  await picker.searchUsers();
  assert.equal(picker.data.candidates[0].assigned, true);
  assert.equal(picker.data.candidates[1].phone, candidate.phone);
  await picker.addManager(event(1));
  assert.equal(writes.length, 0);
  await picker.addManager(event(2));
  assert.deepEqual(writes, [[1, 2]]);
  assert.equal(picker.data.candidates[1].assigned, true);
  assert.equal(picker.events[0].detail.managers[1].avatarUrl, candidate.avatarUrl);
  await picker.removeManager(event(1));
  assert.deepEqual(writes, [[1, 2], [2]]);
  assert.equal(picker.data.candidates[0].assigned, false);
});

test('负责人加载失败时禁止覆盖分配，重试成功后才能保存', async () => {
  let failed = true;
  let writes = 0;
  const config = loadConfig('components/stallManagerPicker/index.js', {
    get: async () => { if (failed) throw new Error('加载失败'); return [{ id: 1 }]; },
    put: async () => { writes += 1; return []; }
  });
  const picker = createInstance(config);
  open(config, picker, '11');
  await flush();
  picker.data.candidates = [{ id: 2 }];
  await picker.addManager(event(2));
  await picker.removeManager(event(1));
  assert.equal(writes, 0);
  failed = false;
  await picker.loadManagers();
  await picker.removeManager(event(1));
  assert.equal(writes, 1);
});

test('保存失败保留原负责人，保存期间不允许重复提交或关闭弹窗', async () => {
  let rejectSave;
  let writes = 0;
  const config = loadConfig('components/stallManagerPicker/index.js', {
    get: async () => [{ id: 1 }],
    put: () => { writes += 1; return new Promise((resolve, reject) => { rejectSave = reject; }); }
  });
  const picker = createInstance(config);
  open(config, picker, '11');
  await flush();
  picker.data.candidates = [{ id: 2 }];
  const saving = picker.addManager(event(2));
  await picker.addManager(event(2));
  picker.close();
  assert.equal(writes, 1);
  assert.equal(picker.events.length, 0);
  rejectSave(new Error('保存失败'));
  await saving;
  assert.equal(picker.data.managers.length, 1);
  assert.equal(picker.data.managers[0].id, 1);
  assert.equal(picker.data.saving, false);
});

test('修改搜索词和重新打开其他档口后，旧请求不能覆盖当前弹窗', async () => {
  let resolveSearch;
  let resolveFirst;
  const config = loadConfig('components/stallManagerPicker/index.js', {
    get: url => {
      if (url.includes('/users')) return new Promise(resolve => { resolveSearch = resolve; });
      if (url.endsWith('/11')) return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve([{ id: 2, avatarUrl: 'two.jpg' }]);
    }
  });
  const picker = createInstance(config);
  open(config, picker, '11');
  picker.onKeywordInput({ detail: { value: '用户' } });
  const searching = picker.searchUsers();
  picker.onKeywordInput({ detail: { value: '新用户' } });
  resolveSearch([{ id: 1 }]);
  await searching;
  assert.equal(picker.data.candidates.length, 0);
  open(config, picker, '22');
  await flush();
  resolveFirst([{ id: 1, avatarUrl: 'one.jpg' }]);
  await flush();
  assert.equal(picker.data.managers[0].id, 2);
  assert.equal(picker.data.loading, false);
});

test('详情页商品保留负责人头像、昵称、手机号', async () => {
  const owner = { productId: 5, userId: 8, nickname: '负责人', phone: '13800000000', avatarUrl: 'avatar.jpg' };
  const config = loadConfig('pages/adminCatalogProducts/adminCatalogProducts.js', {
    get: async url => url.includes('/owners') ? [owner] : { content: [{ id: 5, name: '商品' }], hasNext: false }
  });
  const page = createInstance(config);
  page.data.groupId = '11';
  await page.loadProducts(true);
  assert.equal(page.data.products[0].managerOwner, owner);
});

test('详情页旧的负责人加载请求不会盖掉刚保存的分配', async () => {
  let resolveLoad;
  const config = loadConfig('pages/adminCatalogProducts/adminCatalogProducts.js', {
    get: () => new Promise(resolve => { resolveLoad = resolve; })
  });
  const page = createInstance(config);
  page.data.groupId = '11';
  const loading = page.loadManagers();
  const managers = [{ id: 2, nickname: '新负责人', phone: '13900000000', avatarUrl: 'new.jpg' }];
  page.onManagersChanged({ detail: { stallId: '11', managers } });
  resolveLoad([{ id: 1, nickname: '原负责人' }]);
  await loading;
  assert.equal(page.data.managers, managers);
});
