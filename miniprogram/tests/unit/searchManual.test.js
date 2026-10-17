const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function flush() { return new Promise(resolve => setImmediate(resolve)); }

function setup(t, handler) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  const calls = [];
  const navigations = [];
  const keyboardCalls = [];
  let config;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/search/search.js'), 'utf8'), {
    Page(value) { config = value; },
    require(name) {
        if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/api')) return {
        get: async (url, params) => {
          calls.push({ url, params });
          if (url === '/products/query') requests.push(params);
          if (handler) return handler(url, params);
          if (url === '/products/query') return { content: [], hasNext: true };
          return [];
        }, delete: async () => {}
      };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/stock')) return { isProductSoldOut: () => false };
      if (name.endsWith('/productFilters')) return require('../../utils/productFilters');
      throw new Error('未模拟依赖：' + name);
    },
    wx: { showLoading() {}, hideLoading() {}, showToast() {},
      navigateTo({ url }) { navigations.push(url); },
      hideKeyboard() { keyboardCalls.push('hide'); } },
    setTimeout, clearTimeout, console
  });
  const page = { ...config, data: structuredClone(config.data) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return { page, requests, calls, navigations, keyboardCalls };
}

test('输入和停顿不搜索，失焦后查询一次，重复失焦不重复记录历史', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '棉袄' } });
  t.mock.timers.tick(1000);
  assert.equal(requests.length, 0);
  page.onSearchBlur();
  t.mock.timers.tick(200);
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].keyword, '棉袄');
  page.onSearchBlur();
  t.mock.timers.tick(200);
  assert.equal(requests.length, 1);
});

test('失焦同时点击搜索或历史词只查询一次', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '未完成词' } });
  page.onSearchBlur();
  page.onSearchHistoryTap({ currentTarget: { dataset: { keyword: '历史词' } } });
  await flush();
  t.mock.timers.tick(200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].keyword, '历史词');
  page.onSearchBlur();
  await page.doSearch({ type: 'tap' });
  t.mock.timers.tick(200);
  assert.equal(requests.length, 2);
});

test('未提交的新输入不影响已有结果分页，清空后手动搜索恢复全部商品', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '棉袄' } });
  await page.doSearch();
  page.onInput({ detail: { value: '外套' } });
  await page.doSearch(false);
  assert.equal(requests[1].keyword, '棉袄');
  assert.equal(requests[1].page, 2);
  page.onInput({ detail: { value: '' } });
  assert.equal(requests.length, 2);
  await page.doSearch();
  assert.equal(requests[2].keyword, undefined);
  assert.equal(page.data.searchType, 'all');
});

test('正在加载时手动搜索会排队，页面卸载取消失焦搜索', async t => {
  const { page, requests } = setup(t);
  page.data.loading = true;
  page.onInput({ detail: { value: '新词' } });
  await page.doSearch();
  assert.equal(requests.length, 0);
  page.data.loading = false;
  page.finishPendingSearch();
  await flush();
  assert.equal(requests[0].keyword, '新词');
  page.onInput({ detail: { value: '另一个词' } });
  page.onSearchBlur();
  page.onUnload();
  t.mock.timers.tick(200);
  assert.equal(requests.length, 1);
});


test('搜索全部商品、关键词搜索和两种分页均保留上架时间排序', async t => {
  const { page, requests } = setup(t);
  await page.fetchAllProducts();
  await page.fetchAllProducts(false);
  page.onInput({ detail: { value: '棉袄' } });
  await page.doSearch();
  await page.doSearch(false);
  assert.deepEqual(requests.map(params => ({ ...params })), [
    { page: 1, size: 20, sort: 'newest' },
    { page: 2, size: 20, sort: 'newest' },
    { keyword: '棉袄', page: 1, size: 20, sort: 'newest' },
    { keyword: '棉袄', page: 2, size: 20, sort: 'newest' }
  ]);
});

test('搜索框聚焦时点商品仅收起输入并搜索，再次点击才进入详情', async t => {
  const { page, requests, navigations, keyboardCalls } = setup(t);
  page.onSearchFocus();
  page.onInput({ detail: { value: '棉袄' } });
  page.onProductTouchStart();
  await page.goToDetail({ currentTarget: { dataset: { id: 'p1' } } });
  assert.deepEqual(navigations, []);
  assert.equal(page.data.focus, false);
  assert.equal(page.data.searchEditing, false);
  assert.equal(page.data.showHistory, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].keyword, '棉袄');
  assert.equal(requests[0].sort, 'newest');
  assert.equal(keyboardCalls.length, 1);
  page.onProductTouchStart();
  page.goToDetail({ currentTarget: { dataset: { id: 'p1' } } });
  assert.deepEqual(navigations, ['/pages/detail/detail?id=p1']);
});

test('先失焦再点击商品也拦截详情，失焦与点击不会重复搜索', async t => {
  const { page, requests, navigations } = setup(t);
  page.onSearchFocus();
  page.onInput({ detail: { value: '外套' } });
  page.onSearchBlur();
  page.onProductTouchStart();
  await page.goToDetail({ currentTarget: { dataset: { id: 'p2' } } });
  t.mock.timers.tick(200);
  assert.deepEqual(navigations, []);
  assert.equal(requests.length, 1);
});

test('触摸始于输入状态，即便松手前失焦延时已结束，本次也不能跳详情', async t => {
  const { page, requests, navigations } = setup(t);
  page.onSearchFocus();
  page.onInput({ detail: { value: '衬衫' } });
  page.onProductTouchStart();
  page.onSearchBlur();
  t.mock.timers.tick(200);
  await flush();
  await page.goToDetail({ currentTarget: { dataset: { id: 'p3' } } });
  assert.deepEqual(navigations, []);
  assert.equal(requests.length, 1);
  page.onProductTouchStart();
  page.goToDetail({ currentTarget: { dataset: { id: 'p3' } } });
  assert.deepEqual(navigations, ['/pages/detail/detail?id=p3']);
});

test('输入词没变时点商品只收起输入，主动搜索或正常失焦后可以进入详情', async t => {
  const { page, requests, navigations } = setup(t);
  page.onSearchFocus();
  await page.goToDetail({ currentTarget: { dataset: { id: 'p4' } } });
  assert.equal(requests.length, 0);
  assert.deepEqual(navigations, []);
  page.onSearchFocus();
  page.onSearchBlur();
  t.mock.timers.tick(200);
  page.onProductTouchStart();
  page.goToDetail({ currentTarget: { dataset: { id: 'p4' } } });
  assert.deepEqual(navigations, ['/pages/detail/detail?id=p4']);
  page.onSearchFocus();
  page.onInput({ detail: { value: '裤子' } });
  await page.doSearch();
  page.onProductTouchStart();
  page.goToDetail({ currentTarget: { dataset: { id: 'p5' } } });
  assert.deepEqual(navigations, ['/pages/detail/detail?id=p4', '/pages/detail/detail?id=p5']);
});

test('左右商品列都绑定触摸保护，输入框焦点由页面状态控制', () => {
  const template = fs.readFileSync(path.join(__dirname, '../../pages/search/search.wxml'), 'utf8');
  assert.match(template, /focus="\{\{focus\}\}"/);
  assert.equal((template.match(/bindtouchstart="onProductTouchStart"/g) || []).length, 2);
});

test('搜索页首次加载同时查询商品、搜索历史和档口，档口按首页规则分组', async t => {
  const { page, calls } = setup(t, async url => {
    if (url === '/stalls') return [{ id: 'z', name: 'Z档口' }, { id: 'a', name: 'A档口' }, { id: 'n', name: '123' }];
    if (url === '/products/query') return { content: [], hasNext: false };
    return ['棉袄'];
  });
  await page.onLoad();
  assert.deepEqual(calls.map(call => call.url).sort(), ['/products/query', '/stalls', '/users/me/usage/searches?limit=10']);
  assert.deepEqual(Array.from(page.data.groupedStalls, group => group.letter), ['A', 'Z', '#']);
  assert.equal(page.data.currentMainTab, '上新');
  assert.equal(page.data.recentSearches[0], '棉袄');
});

test('进入搜索前恢复首页档口，首屏、关键词搜索和分页持续使用该档口', async t => {
  const { page, requests } = setup(t);
  const stallId = '9007199254740993123';
  await page.onLoad({ stallId });
  assert.equal(page.data.selectedStall, stallId);
  assert.equal(page.data.currentMainTab, '档口');
  assert.equal(page.data.showAllPanel, false);
  assert.deepEqual({ ...requests[0] }, { page: 1, size: 20, sort: 'newest', stallId });
  await page.fetchAllProducts(false);
  page.onInput({ detail: { value: '棉袄' } });
  await page.doSearch();
  await page.doSearch(false);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(params => params.stallId === stallId && params.sort === 'newest'));
  assert.equal(requests[1].page, 2);
  assert.equal(requests[2].keyword, '棉袄');
  assert.equal(requests[2].page, 1);
  assert.equal(requests[3].page, 2);
});

test('档口筛选保留关键词和上架时间排序，关键词分页与全部商品分页都带档口', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '棉袄' } });
  await page.selectStall({ currentTarget: { dataset: { stall: 's1' } } });
  await page.doSearch(false);
  assert.deepEqual(requests.slice(0, 2).map(params => ({ ...params })), [
    { page: 1, size: 20, sort: 'newest', keyword: '棉袄', stallId: 's1' },
    { page: 2, size: 20, sort: 'newest', keyword: '棉袄', stallId: 's1' }
  ]);
  page.onInput({ detail: { value: '' } });
  await page.doSearch();
  await page.fetchAllProducts(false);
  assert.deepEqual(requests.slice(2).map(params => ({ ...params })), [
    { page: 1, size: 20, sort: 'newest', stallId: 's1' },
    { page: 2, size: 20, sort: 'newest', stallId: 's1' }
  ]);
});

test('上新清除档口但保留关键词，全部档口清除筛选并收起面板', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '外套' } });
  await page.selectStall({ currentTarget: { dataset: { stall: 's1' } } });
  await page.handleMainTabChange({ currentTarget: { dataset: { tab: '上新' } } });
  assert.equal(page.data.currentMainTab, '上新');
  assert.equal(page.data.selectedStall, '');
  assert.equal(requests.at(-1).keyword, '外套');
  assert.equal(requests.at(-1).stallId, undefined);
  await page.selectStall({ currentTarget: { dataset: { stall: 's2' } } });
  await page.toggleAllPanel();
  assert.equal(page.data.showAllPanel, true);
  await page.selectStall({ currentTarget: { dataset: { stall: 'all' } } });
  assert.equal(page.data.currentMainTab, '档口');
  assert.equal(page.data.selectedStall, '');
  assert.equal(page.data.showAllPanel, false);
  assert.equal(requests.at(-1).stallId, undefined);
  assert.equal(requests.at(-1).keyword, '外套');
});

test('切档口和打开下拉面板会结束输入，搜索历史与面板互斥，购物车可正常打开', async t => {
  const { page, navigations, keyboardCalls } = setup(t);
  page.onSearchFocus();
  await page.handleMainTabChange({ currentTarget: { dataset: { tab: '档口' } } });
  assert.equal(page.data.currentMainTab, '档口');
  assert.equal(page.data.focus, false);
  assert.equal(page.data.showHistory, false);
  assert.equal(keyboardCalls.length, 1);
  await page.toggleAllPanel();
  assert.equal(page.data.showAllPanel, true);
  page.closeAllPanel();
  assert.equal(page.data.showAllPanel, false);
  await page.toggleAllPanel();
  page.onSearchFocus();
  assert.equal(page.data.showAllPanel, false);
  assert.equal(page.data.showHistory, true);
  page.goToCart();
  assert.deepEqual(navigations, ['/pages/cart/cart']);
  assert.equal(page.data.focus, false);
  assert.equal(page.data.showHistory, false);
});

test('快速切换档口时丢弃旧商品响应，最终查询使用最后的档口和关键词', async t => {
  let resolveOld;
  let round = 0;
  const { page, requests } = setup(t, async url => {
    if (url !== '/products/query') return [];
    if (++round === 1) return new Promise(resolve => { resolveOld = resolve; });
    return { content: [{ id: 'latest' }], hasNext: false };
  });
  const initial = page.fetchAllProducts();
  await flush();
  page.onInput({ detail: { value: '棉袄' } });
  await page.selectStall({ currentTarget: { dataset: { stall: 's1' } } });
  await page.selectStall({ currentTarget: { dataset: { stall: 's2' } } });
  resolveOld({ content: [{ id: 'old' }], hasNext: true });
  await initial;
  assert.equal(requests.length, 2);
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'newest', keyword: '棉袄', stallId: 's2' });
  assert.deepEqual(Array.from(page.data.results, product => product.id), ['latest']);
  assert.equal(page.data.loading, false);
});

test('页面卸载后不写入在途商品结果', async t => {
  let resolveOld;
  const { page } = setup(t, async url => url === '/products/query'
    ? new Promise(resolve => { resolveOld = resolve; }) : []);
  const initial = page.fetchAllProducts();
  await flush();
  page.onUnload();
  resolveOld({ content: [{ id: 'closed' }], hasNext: false });
  await initial;
  assert.equal(page.data.results.length, 0);
});

test('输入新关键词后展开档口面板，提交搜索不会把刚打开的面板关掉', async t => {
  const { page, requests } = setup(t);
  await page.handleMainTabChange({ currentTarget: { dataset: { tab: '档口' } } });
  page.onSearchFocus();
  page.onInput({ detail: { value: '棉袄' } });
  page.onSearchBlur();
  await page.toggleAllPanel();
  t.mock.timers.tick(200);
  await flush();
  assert.equal(page.data.showAllPanel, true);
  assert.equal(page.data.showHistory, false);
  assert.equal(page.data.focus, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].keyword, '棉袄');
});
