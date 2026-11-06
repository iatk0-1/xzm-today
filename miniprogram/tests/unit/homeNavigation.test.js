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
  assert.equal(p.data.showReadyStockTag, false);
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

test('全部隐藏仍以默认上新查询，恢复现货时标签同步恢复', () => {
  const p = page();
  navigation.apply(p, navigation.normalize({ tabs: config.tabs.map(tab => ({ ...tab, visible: false })) }));
  assert.deepEqual(p.data.mainTabs, []);
  assert.equal(p.data.currentMainTab, '上新');
  assert.equal(p.data.showReadyStockTag, false);
  navigation.apply(p, navigation.defaults);
  assert.equal(p.data.showReadyStockTag, true);
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

test('管理员调整页面上移下移、开关和保存实际提交同一份配置', async () => {
  let definition, body;
  const api = { get: async () => config, put: async (url, value) => { body = value; return value; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/homeNavigation/homeNavigation.js'), 'utf8'), {
    Page: value => { definition = value; },
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => true };
      if (name.endsWith('/homeNavigation')) return navigation;
      if (name.endsWith('/error')) return require('../../utils/error');
      throw new Error(name);
    }, wx: { showToast() {} }
  });
  const p = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  await p.onLoad();
  p.move({ currentTarget: { dataset: { key: 'stock', direction: -1 } } });
  p.toggle({ currentTarget: { dataset: { key: 'stock' } }, detail: { value: true } });
  await p.save();
  assert.equal(body.tabs[0].key, 'stock');
  assert.equal(body.tabs[0].visible, true);
  assert.equal(p.data.saving, false);
});

test('首页和搜索页的现货标签始终使用页面开关过滤，优惠异步返回也不能绕过', () => {
  for (const name of ['index', 'search']) {
    const source = fs.readFileSync(path.join(__dirname, '../../pages', name, name + '.wxml'), 'utf8');
    assert.equal((source.match(/showReadyStockTag \|\| tag.type !== 'READY_STOCK'/g) || []).length, 2);
    assert.match(source, /wx:for="\{\{mainTabs\}\}"/);
  }
});
