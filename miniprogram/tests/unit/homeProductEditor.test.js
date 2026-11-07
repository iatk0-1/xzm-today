const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const navigation = require('../../utils/homeNavigation');

function setup(options = {}) {
  const writes = [], reads = [], modals = [], timers = new Map();
  let role = 'admin', definition;
  const auth = { isAdmin: () => role === 'admin' };
  const api = {
    async get(url, params) {
      reads.push({ url, params });
      return options.get ? options.get(url, params) : {
        revision: '7', products: Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1), name: '商品' + (i + 1), articleNo: 'NO' + i }))
      };
    },
    async put(url, data) { writes.push({ url, data }); if (options.put) return options.put(url, data); }
  };
  const module = { exports: {} };
  const context = {
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return auth;
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/productManagementQuery')) return require('../../utils/productManagementQuery');
      throw new Error(name);
    }, module, Component(value) { definition = value; },
    wx: { showToast() {}, vibrateShort() {}, showModal(value) { modals.push(value); } },
    setInterval(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); }, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/homeProductEditor.js'), 'utf8'), context);
  const page = { ...module.exports.methods, data: { ...structuredClone(module.exports.initialData),
    currentMainTab: '首页', totalNavHeight: 100, listTop: 0, listHeight: 650, productList: [{ id: 'public-first-page' }] },
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const match = key.match(/^homeProducts\[(\d+)\]\.y$/);
        if (match) this.data.homeProducts[Number(match[1])].y = value;
        else this.data[key] = value;
      }
    },
    getWindowSize: () => ({ width: 375, height: 800 }),
    updateListMetrics() { this.data.listTop = this.data.homeEditing ? 44 : 0; },
    async getProductsList() { this.refreshed = true; }
  };
  const picker = () => {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../components/homeProductPicker/index.js'), 'utf8'), { ...context });
    const events = [];
    return { ...definition.methods, data: { ...structuredClone(definition.data), visible: true, existingIds: [] },
      setData(patch) { Object.assign(this.data, patch); }, triggerEvent(name, value) { events.push({ name, value }); }, events };
  };
  return { page, reads, writes, modals, timers, picker, role(value) { role = value; } };
}
const event = dataset => ({ currentTarget: { dataset } });
const touch = (id, y, identifier = 1, ended = false) => ({ ...event({ id }),
  [ended ? 'changedTouches' : 'touches']: [{ identifier, clientY: y }] });
const ids = page => Array.from(page.data.homeProducts, item => String(item.id));
const flush = () => new Promise(resolve => setImmediate(resolve));

test('首页始终第一位且默认选中，旧导航配置和搜索页维持三个筛选项', () => {
  const tabs = navigation.normalize({ tabs: navigation.defaults.slice().reverse() });
  const p = { _includeHomeTab: true, data: { currentMainTab: '首页' }, setData(value) { Object.assign(this.data, value); } };
  navigation.apply(p, tabs);
  assert.deepEqual(p.data.mainTabs.map(item => item.label), ['首页', '现货', '销量', '上新']);
  assert.equal(p.data.currentMainTab, '首页');
  const search = { data: { currentMainTab: '上新' }, setData: p.setData };
  navigation.apply(search, tabs);
  assert.deepEqual(search.data.mainTabs.map(item => item.label), ['现货', '销量', '上新']);
});

test('全选覆盖浏览列表未加载的商品，增删排序只改草稿，保存才按完整顺序提交', async () => {
  const { page: p, reads, writes } = setup();
  await p.toggleHomeEditor();
  assert.equal(reads[0].url, '/home-products/manage');
  assert.equal(p.data.homeProducts.length, 25);
  assert.equal(p.data.listTop, 44);
  await p.selectAllHomeProducts();
  assert.equal(reads.filter(item => item.url === '/home-products/manage').length, 2);
  assert.equal(p.data.homeSelectedCount, 25);
  assert.equal(p.data.homeDirty, false);
  p.toggleHomeProduct(event({ id: '25' }));
  p.removeHomeProducts(event({}));
  assert.deepEqual(ids(p), ['25']);
  p.addHomeProducts({ detail: { products: [{ id: '25' }, { id: '26', name: '新增' }, { id: '26' }] } });
  p.moveHomeProduct(event({ id: '26', direction: -1 }));
  assert.deepEqual(ids(p), ['26', '25']);
  await p.selectAllHomeProducts();
  assert.deepEqual(ids(p), ['26', '25']);
  assert.equal(p.data.homeSelectedCount, 2);
  assert.equal(writes.length, 0);
  await p.saveHomeProducts();
  assert.equal(writes[0].url, '/home-products');
  assert.deepEqual(Array.from(writes[0].data.productIds), ['26', '25']);
  assert.equal(writes[0].data.revision, '7');
  assert.equal(p.data.homeEditing, false);
  assert.equal(p.data.listTop, 0);
  assert.equal(p.refreshed, true);
});

test('首尾箭头不越界，单行删除仅改首页草稿；取消修改需确认并丢弃草稿', async () => {
  const { page: p, writes, modals } = setup();
  await p.toggleHomeEditor();
  p.moveHomeProduct(event({ id: '1', direction: -1 }));
  p.moveHomeProduct(event({ id: '25', direction: 1 }));
  assert.equal(p.data.homeDirty, false);
  p.removeHomeProducts(event({ id: '10' }));
  assert.equal(ids(p).includes('10'), false);
  const first = p.toggleHomeEditor();
  modals[0].success({ confirm: false }); await first;
  assert.equal(p.data.homeEditing, true);
  const next = p.toggleHomeEditor();
  modals[1].success({ confirm: true }); await next;
  assert.equal(p.data.homeEditing, false);
  assert.equal(writes.length, 0);
});

test('保存失败保留编辑草稿，保存期间禁止重复提交和更改；角色切换后不能编辑', async () => {
  let reject;
  const env = setup({ put: () => new Promise((resolve, fail) => { reject = fail; }) });
  const p = env.page;
  await p.toggleHomeEditor();
  p.removeHomeProducts(event({ id: '1' }));
  const snapshot = ids(p);
  const pending = p.saveHomeProducts();
  p.moveHomeProduct(event({ id: '2', direction: 1 }));
  await p.saveHomeProducts();
  assert.equal(env.writes.length, 1);
  assert.deepEqual(ids(p), snapshot);
  reject(new Error('模拟断网')); await pending;
  assert.equal(p.data.homeSaving, false);
  assert.equal(p.data.homeEditing, true);
  assert.deepEqual(ids(p), snapshot);
  assert.match(env.modals[0].content, /模拟断网/);
  env.role('user');
  p.removeHomeProducts(event({ id: '2' }));
  await p.saveHomeProducts();
  assert.deepEqual(ids(p), snapshot);
  assert.equal(env.writes.length, 1);
});

test('长按后拖动、松手落位，其他手指和取消手势不改顺序，离开清理定时器', async () => {
  const { page: p, timers, writes } = setup();
  await p.toggleHomeEditor();
  p.moveHomeDrag(touch('1', 334));
  assert.equal(p.data.homeDragId, '');
  p.startHomeDrag(touch('1', 250));
  p.moveHomeDrag(touch('1', 334, 2));
  assert.equal(p.data.homeProducts[0].y, 0);
  p.endHomeDrag(touch('1', 334, 2, true));
  assert.equal(p.data.homeDragId, '1');
  p.endHomeDrag(touch('1', 418, 1, true));
  assert.deepEqual(ids(p).slice(0, 3), ['2', '3', '1']);
  assert.equal(timers.size, 0);
  assert.equal(writes.length, 0);
  p.startHomeDrag(touch('2', 250));
  p.moveHomeDrag(touch('2', 650));
  p.cancelHomeDrag();
  assert.deepEqual(ids(p).slice(0, 3), ['2', '3', '1']);
  assert.equal(p.data.homeProducts[0].y, 0);
  assert.equal(timers.size, 0);
});

test('非管理员没有读取入口，迟到的配置响应不会写入已卸载页面', async () => {
  let resolve;
  const env = setup({ get: () => new Promise(done => { resolve = done; }) });
  env.role('user'); await env.page.toggleHomeEditor();
  assert.equal(env.reads.length, 0);
  env.role('admin');
  const pending = env.page.toggleHomeEditor();
  env.page._pageClosed = true;
  const snapshot = JSON.stringify(env.page.data);
  resolve({ revision: 1, products: [{ id: 'late' }] }); await pending;
  assert.equal(JSON.stringify(env.page.data), snapshot);
});

test('选品复用管理查询，跨页和筛选保留多选，已有商品不能重复加入，确认只带简化卡片', async () => {
  const env = setup({ get: async (url, params) => {
    if (url !== '/products/query') return [];
    return { content: params.page === 1 ? [{ id: '1', name: '商品1', articleNo: 'A1', costPrice: 50 }, { id: '2', name: '已添加' }]
      : [{ id: '3', name: '商品3', articleNo: 'A3' }], hasNext: params.page === 1 };
  } });
  const picker = env.picker(); picker.data.existingIds = ['2'];
  await picker.open(); await flush();
  const firstQuery = env.reads.find(item => item.url === '/products/query');
  assert.equal(firstQuery.params.status, 'all'); assert.equal(firstQuery.params.manage, true);
  picker.toggleProduct(event({ id: '1' })); picker.toggleProduct(event({ id: '2' }));
  await picker.loadMore();
  picker.toggleProduct(event({ id: '3' }));
  await picker.selectFilter(event({ type: 'stall', id: 's1' }));
  assert.equal(picker.data.selectedCount, 2);
  assert.equal(env.reads.at(-1).params.stallId, 's1');
  assert.equal(picker.data.products[0].selected, true);
  await picker.selectStatus(event({ key: 'off' }));
  assert.equal(env.reads.at(-1).params.status, 'off');
  picker.confirm();
  const added = picker.events[0].value.products;
  assert.deepEqual(Array.from(added, item => item.id), ['1', '3']);
  assert.equal(added[0].costPrice, undefined);
});

test('快速切换选品筛选丢弃旧响应，名称和货号搜索去掉两端空格', async () => {
  let resolveFirst;
  const env = setup({ get: (url, params) => {
    if (params.keyword === '货号123') return Promise.resolve({ content: [{ id: 'new' }], hasNext: false });
    return new Promise(resolve => { resolveFirst = resolve; });
  } });
  const picker = env.picker(); picker._selected = new Map();
  const old = picker.loadProducts(true);
  picker.data.searchKeyword = ' 货号123 ';
  await picker.search();
  resolveFirst({ content: [{ id: 'old' }], hasNext: true }); await old;
  assert.deepEqual(Array.from(picker.data.products, item => item.id), ['new']);
  assert.equal(picker.data.hasMore, false);
});
