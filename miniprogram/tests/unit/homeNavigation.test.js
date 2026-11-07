const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const navigation = require('../../utils/homeNavigation');

const config = { tabs: [
  { key: 'sales', visible: true }, { key: 'stock', visible: false }, { key: 'newest', visible: true }
] };
function page() {
  return { data: { currentMainTab: '上新' }, setData(patch) { Object.assign(this.data, patch); } };
}

test('配置顺序决定默认选项，显式分享保留可见选项，隐藏选项自动回退', () => {
  const p = page();
  const tabs = navigation.normalize(config);
  assert.equal(navigation.apply(p, tabs), true);
  assert.equal(p.data.currentMainTab, '销量');
  assert.deepEqual(p.data.mainTabs.map(tab => tab.label), ['销量', '上新']);
  assert.equal(p.data.showReadyStockTag, undefined);
  p.data.currentMainTab = '上新';
  navigation.apply(p, tabs);
  assert.equal(p.data.currentMainTab, '上新');
  const shared = page();
  shared._navigationExplicitTab = true;
  navigation.apply(shared, tabs);
  assert.equal(shared.data.currentMainTab, '上新');
  shared.data.currentMainTab = '现货';
  navigation.apply(shared, tabs);
  assert.equal(shared.data.currentMainTab, '销量');
});

test('全部隐藏仍以默认上新查询，导航配置不写入商品现货展示状态', () => {
  const p = page();
  navigation.apply(p, navigation.normalize({ tabs: config.tabs.map(tab => ({ ...tab, visible: false })) }));
  assert.deepEqual(p.data.mainTabs, []);
  assert.equal(p.data.currentMainTab, '上新');
  assert.equal(p.data.showReadyStockTag, undefined);
  navigation.apply(p, navigation.defaults);
  assert.equal(p.data.showReadyStockTag, undefined);
});

test('并发读取共用请求，失败保留已有配置，卸载后忽略迟到响应', async () => {
  const p = page();
  let resolve, calls = 0;
  const api = { get() { calls++; return new Promise(done => { resolve = done; }); } };
  const first = navigation.load(p, api);
  const second = navigation.load(p, api);
  resolve(config);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  const saved = JSON.stringify(p.data);
  await navigation.load(p, { get: async () => { throw new Error('模拟断网'); } });
  assert.equal(JSON.stringify(p.data), saved);
  const late = navigation.load(p, api);
  p._pageClosed = true;
  resolve({ tabs: navigation.defaults });
  await late;
  assert.equal(JSON.stringify(p.data), saved);
});

async function editor(options = {}) {
  let definition;
  const writes = [], toasts = [];
  const api = {
    get: async () => options.config || { tabs: [...config.tabs, { key: 'home', visible: false }] },
    put: async (url, value) => {
      writes.push(value);
      return options.put ? options.put(value) : value;
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/homeNavigation/homeNavigation.js'), 'utf8'), {
    Page: value => { definition = value; },
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => true };
      if (name.endsWith('/homeNavigation')) return navigation;
      if (name.endsWith('/error')) return require('../../utils/error');
      throw new Error(name);
    }, wx: { showToast(value) { toasts.push(value); }, vibrateShort() {} }
  });
  const p = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  await p.onLoad();
  return { p, writes, toasts };
}
const gesture = (key, clientY, identifier = 1, ended = false) => ({
  currentTarget: { dataset: { key } },
  [ended ? 'changedTouches' : 'touches']: [{ identifier, clientY }]
});
const tabKeys = p => Array.from(p.data.tabs, tab => tab.key);

test('左侧长按拖动松手自动保存，开关变更自动提交，不含布局字段', async () => {
  const { p, writes } = await editor();
  p.onDragStart(gesture('stock', 200));
  p.onDragTouchMove(gesture('stock', 104));
  assert.equal(writes.length, 0);
  await p.onDragEnd(gesture('stock', 104, 1, true));
  assert.deepEqual(tabKeys(p), ['stock', 'sales', 'newest', 'home']);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0].tabs[0]), ['key', 'visible', 'adminVisible']);
  assert.equal(p.data.dragKey, '');
  assert.equal(p.data.saved, true);
  await p.toggle({ currentTarget: { dataset: { key: 'stock' } }, detail: { value: true } });
  assert.equal(writes.length, 2);
  assert.equal(writes[1].tabs[0].visible, true);
});

test('边界拖动后能立刻回拖，使用松手坐标落位，只处理原手指', async () => {
  const { p, writes } = await editor();
  p.onDragStart(gesture('sales', 100));
  p.onDragTouchMove(gesture('sales', 10000));
  assert.equal(p.data.tabs[0].y, 288);
  p.onDragTouchMove(gesture('sales', 148));
  assert.equal(p.data.tabs[0].y, 48);
  p.onDragTouchMove(gesture('sales', 300, 2));
  assert.equal(p.data.tabs[0].y, 48);
  await p.onDragEnd(gesture('sales', 300, 2, true));
  assert.equal(p.data.dragKey, 'sales');
  await p.onDragEnd(gesture('sales', 292, 1, true));
  assert.deepEqual(tabKeys(p), ['stock', 'newest', 'sales', 'home']);
  assert.equal(writes.length, 1);
});

test('没长按不能拖动，同一位置松手和取消拖动都复位且不保存', async () => {
  const { p, writes } = await editor();
  p.onDragTouchMove(gesture('sales', 250));
  assert.equal(p.data.dragKey, '');
  p.onDragStart(gesture('sales', 100));
  await p.onDragEnd(gesture('sales', 110, 1, true));
  assert.equal(p.data.tabs[0].y, 0);
  p.onDragStart(gesture('stock', 100));
  p.onDragTouchMove(gesture('stock', 220));
  p.cancelDrag();
  assert.equal(p.data.tabs[1].y, 96);
  assert.equal(writes.length, 0);
  assert.deepEqual(tabKeys(p), ['sales', 'stock', 'newest', 'home']);
});

test('保存期间阻止重复操作，失败后恢复最后成功保存的排序和开关', async () => {
  let reject;
  const { p, writes, toasts } = await editor({ put: () => new Promise((resolve, fail) => { reject = fail; }) });
  const saving = p.toggle({ currentTarget: { dataset: { key: 'stock' } }, detail: { value: true } });
  assert.equal(p.data.saving, true);
  p.onDragStart(gesture('sales', 100));
  assert.equal(p.data.dragKey, '');
  await p.toggle({ currentTarget: { dataset: { key: 'sales' } }, detail: { value: false } });
  assert.equal(writes.length, 1);
  reject(new Error('模拟保存失败'));
  await saving;
  assert.equal(p.data.tabs[1].visible, false);
  assert.equal(p.data.tabs[0].visible, true);
  assert.equal(p.data.saving, false);
  assert.equal(toasts[0].title, '保存失败，已恢复');
});

test('拖动保存失败恢复顺序，切换后台取消拖动，卸载后不写页面状态', async () => {
  const { p } = await editor({ put: async () => { throw new Error('断网'); } });
  p.onDragStart(gesture('newest', 300));
  await p.onDragEnd(gesture('newest', 100, 1, true));
  assert.deepEqual(tabKeys(p), ['sales', 'stock', 'newest', 'home']);
  p.onDragStart(gesture('newest', 300));
  p.onDragTouchMove(gesture('newest', 100));
  p.onHide();
  assert.equal(p.data.dragKey, '');
  assert.equal(p.data.tabs[2].y, 192);
  let resolve;
  const next = await editor({ put: value => new Promise(done => { resolve = () => done(value); }) });
  const pending = next.p.toggle({ currentTarget: { dataset: { key: 'stock' } }, detail: { value: true } });
  next.p.onUnload();
  const before = JSON.stringify(next.p.data);
  resolve();
  await pending;
  assert.equal(JSON.stringify(next.p.data), before);
});

test('拖动入口仅在左侧手柄，页面显示自动保存状态且没有手动保存或移动按钮', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../pages/homeNavigation/homeNavigation.wxml'), 'utf8');
  assert.match(source, /class="drag-handle"[^>]*catchlongpress="onDragStart"/);
  assert.match(source, /catchtouchcancel="cancelDrag"/);
  assert.match(source, /正在保存/);
  assert.doesNotMatch(source, /上移|下移|保存设置|bindtap="save"/);
});

test('旧三项配置升级为四行管理项，首页开关和拖动排序都自动保存', async () => {
  const { p, writes } = await editor({ config });
  assert.deepEqual(tabKeys(p), ['home', 'sales', 'stock', 'newest']);
  assert.equal(p.data.listHeight, 384);
  assert.equal(p.data.tabs[0].visible, true);
  await p.toggle({ currentTarget: { dataset: { key: 'home' } }, detail: { value: false } });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].tabs.length, 4);
  assert.equal(writes[0].tabs[0].visible, false);
  p.onDragStart(gesture('home', 100));
  await p.onDragEnd(gesture('home', 292, 1, true));
  assert.deepEqual(tabKeys(p), ['sales', 'stock', 'home', 'newest']);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].tabs[2].key, 'home');
  assert.equal(writes[1].tabs[2].visible, false);
});

test('首页按保存顺序展示和选择默认项，首页隐藏后自动切换，搜索排除独立首页项', () => {
  const tabs = navigation.normalize({ tabs: [
    { key: 'stock', visible: false }, { key: 'sales', visible: true },
    { key: 'home', visible: true }, { key: 'newest', visible: true }
  ] });
  const p = page(); p._includeHomeTab = true;
  navigation.apply(p, tabs);
  assert.deepEqual(p.data.mainTabs.map(tab => tab.label), ['销量', '首页', '上新']);
  assert.equal(p.data.currentMainTab, '销量');
  p.data.currentMainTab = '首页';
  navigation.apply(p, tabs.map(tab => tab.key === 'home' ? { ...tab, visible: false } : tab));
  assert.deepEqual(p.data.mainTabs.map(tab => tab.label), ['销量', '上新']);
  assert.equal(p.data.currentMainTab, '销量');
  const search = page(); navigation.apply(search, tabs);
  assert.deepEqual(search.data.mainTabs.map(tab => tab.label), ['销量', '上新']);
  navigation.apply(p, tabs.map(tab => ({ ...tab, visible: false })));
  assert.deepEqual(p.data.mainTabs, []);
  assert.equal(p.data.currentMainTab, '上新');
});

test('导航配置拒绝缺项、重复项和未知项，旧三项配置保留原有开关和顺序', () => {
  const tabs = navigation.normalize(config);
  assert.equal(tabs[0].key, 'home');
  assert.deepEqual(tabs.slice(1).map(({ key, visible }) => ({ key, visible })), config.tabs);
  for (const invalid of [
    { tabs: [] }, { tabs: tabs.slice(0, 3) },
    { tabs: tabs.map(tab => tab.key === 'stock' ? { ...tab, key: 'home' } : tab) },
    { tabs: tabs.map(tab => tab.key === 'home' ? { ...tab, visible: null } : tab) },
    { tabs: tabs.map(tab => tab.key === 'home' ? { ...tab, key: 'unknown' } : tab) }
  ]) assert.throws(() => navigation.normalize(invalid));
});

test('两类身份独立使用可见开关，隐藏当前项自动回退，搜索不展示首页项', () => {
  const tabs = [
    { key: 'home', visible: false, adminVisible: true },
    { key: 'stock', visible: false, adminVisible: true },
    { key: 'sales', visible: true, adminVisible: false },
    { key: 'newest', visible: true, adminVisible: false }
  ];
  const p = page(); p._includeHomeTab = true;
  navigation.apply(p, tabs, false);
  assert.deepEqual(p.data.mainTabs.map(tab => tab.key), ['sales', 'newest']);
  assert.equal(p.data.currentMainTab, '销量');
  navigation.apply(p, tabs, true);
  assert.deepEqual(p.data.mainTabs.map(tab => tab.key), ['home', 'stock']);
  assert.equal(p.data.currentMainTab, '首页');
  navigation.apply(p, tabs, false);
  assert.equal(p.data.currentMainTab, '销量');
  const search = page();
  navigation.apply(search, tabs, true);
  assert.deepEqual(search.data.mainTabs.map(tab => tab.key), ['stock']);
  navigation.apply(search, tabs.map(tab => ({ ...tab, adminVisible: false })), true);
  assert.deepEqual(search.data.mainTabs, []);
  assert.equal(search.data.currentMainTab, '上新');
});

test('读取时使用响应落地时的当前身份，旧配置沿用原状态，非法管理员开关被拒绝', async () => {
  for (const tab of navigation.normalize(config)) assert.equal(tab.adminVisible, tab.visible);
  for (const value of [null, 'true', 1]) {
    assert.throws(() => navigation.normalize({ tabs: config.tabs.map(tab => ({ ...tab, adminVisible: value })) }));
  }
  const p = page();
  let resolve, admin = false;
  const task = navigation.load(p, { get: () => new Promise(done => { resolve = done; }) }, () => admin);
  admin = true;
  resolve({ tabs: config.tabs.map(tab => ({ ...tab, visible: false, adminVisible: true })) });
  await task;
  assert.deepEqual(p.data.mainTabs.map(tab => tab.key), ['sales', 'stock', 'newest']);
});

test('管理员开关独立自动保存，拖动携带两列状态，失败恢复两列开关', async () => {
  const { p, writes } = await editor();
  await p.toggle({ currentTarget: { dataset: { key: 'stock', field: 'adminVisible' } }, detail: { value: true } });
  assert.equal(writes[0].tabs[1].adminVisible, true);
  assert.equal(writes[0].tabs[1].visible, false);
  await p.toggle({ currentTarget: { dataset: { key: 'stock', field: 'visible' } }, detail: { value: true } });
  assert.equal(writes[1].tabs[1].adminVisible, true);
  p.onDragStart(gesture('stock', 200));
  await p.onDragEnd(gesture('stock', 104, 1, true));
  assert.equal(writes[2].tabs[0].key, 'stock');
  assert.equal(writes[2].tabs[0].adminVisible, true);
  const failed = await editor({ put: async () => { throw new Error('模拟断网'); } });
  await failed.p.toggle({ currentTarget: { dataset: { key: 'stock', field: 'adminVisible' } }, detail: { value: true } });
  assert.equal(failed.p.data.tabs[1].adminVisible, false);
  assert.equal(failed.p.data.tabs[1].visible, false);
});

test('导航显示配置只作用于导航，商品标签和其他现货展示保持独立', () => {
  for (const name of ['index', 'search']) {
    const source = fs.readFileSync(path.join(__dirname, '../../pages', name, name + '.wxml'), 'utf8');
    assert.doesNotMatch(source, /showReadyStockTag/);
    assert.equal((source.match(/wx:for="\{\{item.cardTags\}\}"/g) || []).length, 2);
    assert.match(source, /wx:for="\{\{mainTabs\}\}"/);
  }
});

test('隐藏现货导航仍生成现货商品标签，SKU、订单和支付校验不依赖导航配置', () => {
  const p = page();
  navigation.apply(p, navigation.normalize(config));
  const { cardTags } = require('../../utils/productCardTags');
  assert.ok(cardTags({ skuMatrix: [{ stock: 5, freeStockQty: 2 }] }).some(tag => tag.type === 'READY_STOCK'));
  for (const file of ['templates/productSkuPanel.wxml', 'pages/checkout/checkout.wxml',
    'pages/orderList/orderList.wxml', 'pages/orderDetail/orderDetail.wxml']) {
    const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    assert.doesNotMatch(source, /showReadyStockTag|homeNavigation/);
    assert.match(source, /现货/);
  }
  const checkout = fs.readFileSync(path.join(__dirname, '../../pages/checkout/checkout.js'), 'utf8');
  assert.doesNotMatch(checkout, /homeNavigation|loadStock/);
  assert.match(checkout, /if \(expected\) orderData.expectedReadyStock = expected/);
});
