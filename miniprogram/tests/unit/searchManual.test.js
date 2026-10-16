const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(t, handler) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  const navigations = [];
  const keyboardCalls = [];
  let config;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/search/search.js'), 'utf8'), {
    Page(value) { config = value; },
    require(name) {
        if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/api')) return {
        get: async (url, params) => {
          if (url === '/products/query') {
            requests.push(params);
            return handler ? handler(url, params) : { content: [], hasNext: true };
          }
          if (handler) return handler(url, params);
          return [];
        }, delete: async () => {}
      };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/stock')) return { isProductSoldOut: () => false };
      if (name.endsWith('/productFilters')) return require('../../utils/productFilters');
      throw new Error('未模拟依赖：' + name);
    },
    wx: {
      showLoading() {}, hideLoading() {}, showToast() {},
      navigateTo(options) { navigations.push(options.url); },
      hideKeyboard() { keyboardCalls.push('hide'); },
      getMenuButtonBoundingClientRect: () => ({ top: 44, height: 32, bottom: 76 })
    },
    setTimeout, clearTimeout, console
  });
  const page = { ...config, data: structuredClone(config.data) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return { page, requests, navigations, keyboardCalls };
}

test('输入和停顿不搜索，失焦后查询一次，重复失焦不重复记录历史', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '棉袄' } });
  t.mock.timers.tick(1000);
  assert.equal(requests.length, 0);
  page.onSearchBlur();
  t.mock.timers.tick(200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].keyword, '棉袄');
  page.onSearchBlur();
  t.mock.timers.tick(200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
});

test('失焦同时点击搜索或历史词只查询一次', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '未完成词' } });
  page.onSearchBlur();
  page.onSearchHistoryTap({ currentTarget: { dataset: { keyword: '历史词' } } });
  await new Promise(resolve => setImmediate(resolve));
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
  await page.finishPendingSearch();
  assert.equal(requests[0].keyword, '新词');
  page.onInput({ detail: { value: '另一个词' } });
  page.onSearchBlur();
  page.onUnload();
  t.mock.timers.tick(200);
  assert.equal(requests.length, 1);
});

const event = dataset => ({ currentTarget: { dataset } });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('从首页进入：首轮查询恢复销量时间和档口，关键词及分页继续使用这些条件', async t => {
  const { page, requests } = setup(t);
  await page.onLoad({ tab: encodeURIComponent('销量'), salesMonths: '6', stallId: 's2', tagId: 't1' });
  assert.equal(page.data.currentMainTab, '销量');
  assert.equal(page.data.salesMonths, 6);
  assert.equal(page.data.selectedStall, 's2');
  assert.deepEqual({ ...requests[0] }, { page: 1, size: 20, sort: 'sales', salesMonths: 6, stallId: 's2', tagId: 't1' });

  page.onInput({ detail: { value: '棉袄' } });
  await page.doSearch();
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'sales', salesMonths: 6, stallId: 's2', tagId: 't1', keyword: '棉袄' });
  page.onReachBottom();
  await flush();
  assert.equal(requests.at(-1).page, 2);
  assert.equal(requests.at(-1).salesMonths, 6);
  assert.equal(requests.at(-1).keyword, '棉袄');
  page.onInput({ detail: { value: '' } });
  await page.doSearch();
  assert.equal(requests.at(-1).keyword, undefined);
  assert.equal(requests.at(-1).stallId, 's2');
  assert.equal(requests.at(-1).sort, 'sales');
});

test('搜索页排序与档口独立：切换销量、时间范围、上新和全部时保留已搜索词', async t => {
  const { page, requests } = setup(t);
  page.data.keyword = '外套';
  await page.doSearch();
  await page.selectStall(event({ stall: 's1' }));
  await page.handleMainTabChange(event({ tab: '销量' }));
  assert.equal(requests.at(-1).salesMonths, 1);
  const count = requests.length;
  page.handleMainTabChange(event({ tab: '销量' }));
  assert.equal(page.data.showSalesPanel, true);
  assert.equal(requests.length, count);
  for (const months of [3, 6, 12, 1]) {
    await page.selectSalesPeriod(event({ months }));
    assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'sales', salesMonths: months, stallId: 's1', keyword: '外套' });
    assert.equal(page.data.showSalesPanel, false);
  }
  await page.handleMainTabChange(event({ tab: '上新' }));
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'newest', stallId: 's1', keyword: '外套' });
  await page.selectStall(event({ stall: 'all' }));
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'newest', keyword: '外套' });
});

test('点击筛选同时应用输入词，搜索历史、销量下拉和档口面板互斥', async t => {
  const { page, requests } = setup(t);
  page.data.keyword = '棉袄';
  await page.doSearch();
  page.onInput({ detail: { value: '尚未提交' } });
  page.onSearchBlur();
  await page.handleMainTabChange(event({ tab: '销量' }));
  t.mock.timers.tick(200);
  await flush();
  assert.equal(requests.at(-1).keyword, '尚未提交');
  assert.equal(page.data.keyword, '尚未提交');
  page.handleMainTabChange(event({ tab: '销量' }));
  assert.equal(page.data.showSalesPanel, true);
  page.toggleAllPanel();
  assert.equal(page.data.showSalesPanel, false);
  assert.equal(page.data.showAllPanel, true);
  page.onSearchFocus();
  assert.equal(page.data.showAllPanel, false);
  assert.equal(page.data.showHistory, true);
  page.toggleAllPanel();
  assert.equal(page.data.showHistory, false);
  page.hideFilterPanels();
  assert.equal(page.data.showAllPanel, false);
});

test('自定义导航与首页使用同样胶囊尺寸，失焦搜索不关闭刚展开的筛选面板', async t => {
  const { page, requests } = setup(t);
  await page.onLoad();
  assert.equal(page.data.navTop, 44);
  assert.equal(page.data.navHeight, 32);
  assert.equal(page.data.totalNavHeight, 116);
  page.onInput({ detail: { value: '外套' } });
  page.onSearchBlur();
  await page.toggleAllPanel();
  t.mock.timers.tick(200);
  await flush();
  assert.equal(requests.at(-1).keyword, '外套');
  assert.equal(requests.length, 2);
  assert.equal(page.data.showAllPanel, true);
  page.onSearchBlur();
  t.mock.timers.tick(200);
  await flush();
  assert.equal(requests.length, 2);
});

test('点击非输入区域自动提交，失焦和冒泡同时发生不重复搜索', async t => {
  const { page, requests } = setup(t);
  page.onSearchInputTap();
  assert.equal(page.data.focus, true);
  page.onInput({ detail: { value: '棉袄' } });
  page.onSearchBlur();
  await page.onPageTap();
  assert.equal(page.data.focus, false);
  assert.equal(requests[0].keyword, '棉袄');
  t.mock.timers.tick(200);
  await flush();
  await page.onPageTap();
  assert.equal(requests.length, 1);
  page.onInput({ detail: { value: '' } });
  await page.onPageTap();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].keyword, undefined);
});

test('快速切换筛选丢弃旧响应，排队的关键词与最终档口/销量条件共同生效', async t => {
  let resolveOld;
  let round = 0;
  const { page, requests } = setup(t, async url => {
    if (url !== '/products/query') return [];
    round++;
    if (round === 1) return new Promise(resolve => { resolveOld = resolve; });
    return { content: [{ id: 'latest' }], hasNext: false };
  });
  const initial = page.fetchAllProducts();
  await flush();
  page.data.keyword = '棉袄';
  await page.doSearch();
  await page.handleMainTabChange(event({ tab: '销量' }));
  await page.selectSalesPeriod(event({ months: 12 }));
  await page.selectStall(event({ stall: 's2' }));
  resolveOld({ content: [{ id: 'outdated' }], hasNext: true });
  await initial;
  assert.equal(requests.length, 2);
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'sales', salesMonths: 12, stallId: 's2', keyword: '棉袄' });
  assert.equal(page.data.results[0].id, 'latest');
  assert.equal(page.data.results.length, 1);
  assert.equal(page.data.appliedKeyword, '棉袄');
  assert.equal(page.data.loading, false);
});

test('未指定条件默认上新；不合法的销量范围回到近一个月；旧档口入口仍保留筛选', async t => {
  const { page, requests } = setup(t);
  await page.onLoad();
  assert.deepEqual({ ...requests[0] }, { page: 1, size: 20, sort: 'newest' });
  await page.onLoad({ tab: '档口', stallId: 's1', salesMonths: '99' });
  assert.equal(page.data.currentMainTab, '上新');
  assert.equal(page.data.salesMonths, 1);
  assert.equal(requests.at(-1).stallId, 's1');
  await page.onLoad({ tab: '%E9%ZZ', salesMonths: '3' });
  assert.equal(page.data.currentMainTab, '上新');
  assert.equal(page.data.salesMonths, 3);
});

test('档口列表加载后按同一分组规则展示', async t => {
  const { page } = setup(t, async url => url === '/stalls'
    ? [{ id: 'z', name: 'Z档口' }, { id: 'a', name: 'A档口' }, { id: 'n', name: '123' }]
    : []);
  await page.loadStallList();
  assert.deepEqual(Array.from(page.data.groupedStalls, group => group.letter), ['A', 'Z', '#']);
});

test('页面卸载后不应用在途结果', async t => {
  let resolveOld;
  const pending = setup(t, async url => url === '/products/query'
    ? new Promise(resolve => { resolveOld = resolve; }) : []);
  const task = pending.page.fetchAllProducts();
  await flush();
  pending.page.onUnload();
  resolveOld({ content: [{ id: 'closed' }], hasNext: false });
  await task;
  assert.equal(pending.page.data.results.length, 0);
});

test('输入框聚焦时点商品只收起输入并搜索，下一次点击才打开详情', async t => {
  const { page, requests, navigations } = setup(t);
  page.onSearchFocus();
  page.onInput({ detail: { value: '棉袄' } });
  page.onProductTouchStart();
  await page.goToDetail(event({ id: 'p1' }));
  assert.equal(navigations.length, 0);
  assert.equal(page.data.focus, false);
  assert.equal(page.data.showHistory, false);
  assert.equal(requests[0].keyword, '棉袄');
  page.onProductTouchStart();
  page.goToDetail(event({ id: 'p1' }));
  assert.deepEqual(navigations, ['/pages/detail/detail?id=p1']);
});

test('失焦先于商品 tap 到达也不会误跳详情，长按跨过失焦延时仍拦截本次点击', async t => {
  const { page, requests, navigations } = setup(t);
  page.onSearchFocus();
  page.onInput({ detail: { value: '外套' } });
  page.onSearchBlur();
  page.onProductTouchStart();
  t.mock.timers.tick(200);
  await flush();
  await page.goToDetail(event({ id: 'p2' }));
  assert.equal(navigations.length, 0);
  assert.equal(requests.length, 1);
  page.onProductTouchStart();
  page.goToDetail(event({ id: 'p2' }));
  assert.deepEqual(navigations, ['/pages/detail/detail?id=p2']);
});

test('关键词没有变化时点商品也只取消输入，正常失焦结束后商品可直接打开', async t => {
  const { page, requests, navigations } = setup(t);
  page.onSearchFocus();
  page.onSearchBlur();
  await page.goToDetail(event({ id: 'p3' }));
  assert.equal(navigations.length, 0);
  assert.equal(requests.length, 0);
  page.onSearchFocus();
  page.onSearchBlur();
  t.mock.timers.tick(200);
  await flush();
  page.onProductTouchStart();
  page.goToDetail(event({ id: 'p3' }));
  assert.deepEqual(navigations, ['/pages/detail/detail?id=p3']);
});

test('重复点销量只切换面板，不重复收键盘或写入输入焦点', async t => {
  const { page, keyboardCalls, requests } = setup(t);
  page.onSearchFocus();
  page.onInput({ detail: { value: '棉袄' } });
  await page.handleMainTabChange(event({ tab: '销量' }));
  assert.equal(page.data.focus, false);
  assert.equal(page.data.searchEditing, false);
  assert.equal(keyboardCalls.length, 1);
  assert.equal(requests.length, 1);
  await page.handleMainTabChange(event({ tab: '销量' }));
  await page.handleMainTabChange(event({ tab: '销量' }));
  assert.equal(keyboardCalls.length, 1);
  assert.equal(requests.length, 1);
  const template = fs.readFileSync(path.join(__dirname, '../../pages/search/search.wxml'), 'utf8');
  assert.match(template, /adjust-position="\{\{false\}\}"/);
  assert.match(template, /catchtap="handleMainTabChange"/);
  assert.match(template, /line-height: \{\{navHeight\}\}px/);
});
