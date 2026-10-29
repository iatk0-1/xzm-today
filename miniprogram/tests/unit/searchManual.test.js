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
  const cartRequests = [];
  const wx = {
    showLoading() {}, hideLoading() {}, showToast() {},
    navigateTo(options) { navigations.push(options.url); },
    hideKeyboard() { keyboardCalls.push('hide'); },
    setStorageSync() {},
    getMenuButtonBoundingClientRect: () => ({ top: 44, height: 32, bottom: 76 })
  };
  let config;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/search/search.js'), 'utf8'), {
    Page(value) { config = value; },
    require(name) {
      if (name.endsWith('/productSkuPanel')) {
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/productSkuPanel.js'), 'utf8'), {
          module, exports: module.exports, wx, console,
          require(dependency) {
            if (dependency.endsWith('/api')) return { post: async (url, data) => { cartRequests.push({ url, data }); return {}; } };
            return require(path.resolve(__dirname, '../../utils', path.basename(dependency)));
          }
        });
        return module.exports;
      }
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
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => false, isStallManager: () => false };
      if (name.endsWith('/stock')) return { isProductSoldOut: () => false };
      if (name.endsWith('/productFilters')) return require('../../utils/productFilters');
      throw new Error('未模拟依赖：' + name);
    },
    wx,
    setTimeout, clearTimeout, console
  });
  const page = { ...config, data: structuredClone(config.data) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return { page, requests, navigations, keyboardCalls, cartRequests, wx };
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

test('从首页进入：首轮查询恢复销量排序和档口，忽略旧月份参数，关键词及分页继续使用这些条件', async t => {
  const { page, requests } = setup(t);
  await page.onLoad({ tab: encodeURIComponent('销量'), salesMonths: '6', stallId: 's2', tagId: 't1' });
  assert.equal(page.data.currentMainTab, '销量');
  assert.equal(page.data.selectedStall, 's2');
  assert.deepEqual({ ...requests[0] }, { page: 1, size: 20, sort: 'sales', stallId: 's2', tagId: 't1' });

  page.onInput({ detail: { value: '棉袄' } });
  await page.doSearch();
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'sales', stallId: 's2', tagId: 't1', keyword: '棉袄' });
  page.onReachBottom();
  await flush();
  assert.equal(requests.at(-1).page, 2);
  assert.equal(requests.at(-1).salesMonths, undefined);
  assert.equal(requests.at(-1).keyword, '棉袄');
  page.onInput({ detail: { value: '' } });
  await page.doSearch();
  assert.equal(requests.at(-1).keyword, undefined);
  assert.equal(requests.at(-1).stallId, 's2');
  assert.equal(requests.at(-1).sort, 'sales');
});

test('现货入口、关键词及分页保持筛选，切回销量时保留关键词和档口', async t => {
  const { page, requests } = setup(t);
  await page.onLoad({ tab: encodeURIComponent('现货'), stallId: 's2' });
  assert.equal(page.data.currentMainTab, '现货');
  assert.equal(requests[0].sort, 'stock');
  page.onInput({ detail: { value: '棉袄' } });
  await page.doSearch();
  page.onReachBottom();
  await flush();
  assert.deepEqual({ ...requests.at(-1) }, { page: 2, size: 20, sort: 'stock', stallId: 's2', keyword: '棉袄' });
  const count = requests.length;
  await page.handleMainTabChange(event({ tab: '现货' }));
  assert.equal(requests.length, count);
  await page.handleMainTabChange(event({ tab: '销量' }));
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'sales', stallId: 's2', keyword: '棉袄' });
});

test('搜索页排序与档口独立：切换全部销量、上新和全部档口时保留已搜索词', async t => {
  const { page, requests } = setup(t);
  page.data.keyword = '外套';
  await page.doSearch();
  await page.selectStall(event({ stall: 's1' }));
  await page.handleMainTabChange(event({ tab: '销量' }));
  assert.equal(requests.at(-1).salesMonths, undefined);
  const count = requests.length;
  page.handleMainTabChange(event({ tab: '销量' }));
  assert.equal(requests.length, count);
  await page.handleMainTabChange(event({ tab: '上新' }));
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'newest', stallId: 's1', keyword: '外套' });
  await page.selectStall(event({ stall: 'all' }));
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'newest', keyword: '外套' });
});

test('点击筛选同时应用输入词，搜索历史和档口面板互斥', async t => {
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
  page.toggleAllPanel();
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
  await page.selectStall(event({ stall: 's2' }));
  resolveOld({ content: [{ id: 'outdated' }], hasNext: true });
  await initial;
  assert.equal(requests.length, 2);
  assert.deepEqual({ ...requests.at(-1) }, { page: 1, size: 20, sort: 'sales', stallId: 's2', keyword: '棉袄' });
  assert.equal(page.data.results[0].id, 'latest');
  assert.equal(page.data.results.length, 1);
  assert.equal(page.data.appliedKeyword, '棉袄');
  assert.equal(page.data.loading, false);
});

test('未指定条件默认上新；旧月份参数不再影响查询；旧档口入口仍保留筛选', async t => {
  const { page, requests } = setup(t);
  await page.onLoad();
  assert.deepEqual({ ...requests[0] }, { page: 1, size: 20, sort: 'newest' });
  await page.onLoad({ tab: '档口', stallId: 's1', salesMonths: '99' });
  assert.equal(page.data.currentMainTab, '上新');
  assert.equal(requests.at(-1).stallId, 's1');
  await page.onLoad({ tab: '%E9%ZZ', salesMonths: '3' });
  assert.equal(page.data.currentMainTab, '上新');
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

test('重复点销量不重复查询，不重复收键盘或写入输入焦点', async t => {
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


test('档口选中后按可视区域最小滚动，两端限制在内容边界，保留用户手动滚动位置', async t => {
  const { page, wx } = setup(t);
  const callbacks = [];
  const selectors = [];
  wx.createSelectorQuery = () => ({
    in(owner) { assert.equal(owner, page); return this; },
    select(selector) { selectors.push(selector); return this; },
    boundingClientRect() { return this; }, scrollOffset() { return this; },
    exec(callback) { callbacks.push(callback); }
  });
  await page.selectStall(event({ stall: 's2' }));
  callbacks.shift()([
    { left: 80, width: 240 }, { left: 280, width: 80 }, { scrollLeft: 100 }, { width: 700 }
  ]);
  assert.equal(page.data.stallScrollLeft, 140);
  assert.deepEqual(selectors, ['.stall-scroll', '#stall-s2', '.stall-scroll', '.stall-tags', '.stall-edge-fade-right']);
  await page.selectStall(event({ stall: 'first' }));
  callbacks.shift()([
    { left: 80, width: 240 }, { left: 60, width: 80 }, { scrollLeft: 10 }, { width: 700 }
  ]);
  assert.equal(page.data.stallScrollLeft, 0);
  await page.selectStall(event({ stall: 'last' }));
  callbacks.shift()([
    { left: 80, width: 240 }, { left: 390, width: 80 }, { scrollLeft: 400 }, { width: 700 }
  ]);
  assert.equal(page.data.stallScrollLeft, 460);
  const previous = page.data.stallScrollLeft;
  await page.selectStall(event({ stall: 'all' }));
  assert.equal(callbacks.length, 0);
  assert.equal(page.data.stallScrollLeft, previous);
});

test('档口定位忽略旧选择或页面卸载后的测量结果', async t => {
  const { page, wx } = setup(t);
  const callbacks = [];
  wx.createSelectorQuery = () => ({
    in() { return this; }, select() { return this; }, boundingClientRect() { return this; },
    scrollOffset() { return this; }, exec(callback) { callbacks.push(callback); }
  });
  const result = [{ left: 80, width: 240 }, { left: 280, width: 80 }, { scrollLeft: 100 }, { width: 700 }];
  await page.selectStall(event({ stall: 's1' }));
  await page.selectStall(event({ stall: 's2' }));
  callbacks.shift()(result);
  assert.equal(page.data.stallScrollLeft, 0);
  page.onUnload();
  callbacks.shift()(result);
  assert.equal(page.data.stallScrollLeft, 0);
});


test('搜索页标签已完整显示时不滚动，左右遮挡时只补齐被遮住的距离', t => {
  const { page, wx } = setup(t);
  page.setData({ selectedStall: 's1', stallScrollLeft: 100 });
  const patches = [];
  const originalSetData = page.setData;
  page.setData = (patch, callback) => { patches.push(patch); originalSetData(patch, callback); };
  let tagLeft = 80;
  wx.createSelectorQuery = () => ({
    in() { return this; }, select() { return this; }, boundingClientRect() { return this; },
    scrollOffset() { return this; },
    exec(callback) { callback([{ left: 80, width: 240 }, { left: tagLeft, width: 80 }, { scrollLeft: 100 }, { width: 700 }]); }
  });
  try {
    for (tagLeft of [83.5, 160, 240]) page.ensureSelectedStallVisible();
    assert.equal(patches.length, 0);
    tagLeft = 60;
    page.ensureSelectedStallVisible();
    assert.equal(page.data.stallScrollLeft, 76.5);
    patches.length = 0;
    tagLeft = 280;
    page.ensureSelectedStallVisible();
    assert.deepEqual(patches.map(patch => ({ ...patch })), [{ stallScrollLeft: 140 }]);
  } finally {
    delete wx.createSelectorQuery;
  }
});


test('搜索页档口让开渐隐遮罩后完整展示，清晰区域内的标签不滚动', t => {
  const { page, wx } = setup(t);
  page.setData({ selectedStall: 's1', stallScrollLeft: 100 });
  const patches = [];
  const originalSetData = page.setData;
  page.setData = (patch, callback) => { patches.push(patch); originalSetData(patch, callback); };
  let tagLeft = 160;
  wx.createSelectorQuery = () => ({
    in() { return this; }, select() { return this; }, boundingClientRect() { return this; },
    scrollOffset() { return this; },
    exec(callback) { callback([{ left: 80, width: 240 }, { left: tagLeft, width: 80 }, { scrollLeft: 100 }, { width: 700 }, { width: 24 }]); }
  });
  try {
    page.ensureSelectedStallVisible();
    assert.equal(patches.length, 0);
    tagLeft = 83.5;
    page.ensureSelectedStallVisible();
    assert.equal(patches.length, 0);
    assert.equal(page.data.stallScrollLeft, 100);
    tagLeft = 240;
    page.ensureSelectedStallVisible();
    assert.equal(page.data.stallScrollLeft, 112);
  } finally {
    delete wx.createSelectorQuery;
  }
});


test('搜索页左侧定位按屏幕宽度换算7rpx留白', t => {
  const { page, wx } = setup(t);
  const previousWindowInfo = wx.getWindowInfo;
  const previousSelectorQuery = wx.createSelectorQuery;
  page.setData({ selectedStall: 's1' });
  wx.createSelectorQuery = () => ({
    in() { return this; }, select() { return this; }, boundingClientRect() { return this; },
    scrollOffset() { return this; },
    exec(callback) { callback([{ left: 80, width: 240 }, { left: 60, width: 80 }, { scrollLeft: 100 }, { width: 700 }]); }
  });
  try {
    for (const width of [375, 750]) {
      wx.getWindowInfo = () => ({ windowWidth: width });
      page.ensureSelectedStallVisible();
      assert.equal(page.data.stallScrollLeft, 80 - 7 * width / 750);
    }
  } finally {
    if (previousWindowInfo) wx.getWindowInfo = previousWindowInfo;
    else delete wx.getWindowInfo;
    if (previousSelectorQuery) wx.createSelectorQuery = previousSelectorQuery;
    else delete wx.createSelectorQuery;
  }
});


test('搜索卡片输入中点加购仅结束输入，正常点击打开规格并提交所选SKU和数量', async t => {
  const { page, cartRequests, navigations } = setup(t);
  const product = { id: 'p1', name: '测试商品', skuMatrix: [
    { skuId: 's0', color: '黑色', size: 'M', stock: 0, price: 20 },
    { skuId: 's1', color: '白色', size: 'M', stock: 5, price: 30 }
  ] };
  page.onSearchFocus();
  page.onProductTouchStart();
  await page.openSkuPanel(event({ product }));
  assert.equal(page.data.showSku, false);
  assert.equal(page.data.focus, false);
  assert.equal(cartRequests.length, 0);
  page.onProductTouchStart();
  page.openSkuPanel(event({ product }));
  assert.equal(page.data.showSku, true);
  assert.equal(page.data.currentSkuId, 's1');
  assert.equal(page.data.currentSkuPrice, 30);
  page.skuQuantityPlus();
  page.confirmAddToCart(event({ action: 'cart' }));
  await flush();
  assert.equal(cartRequests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(cartRequests[0])), {
    url: '/cart/items', data: { productId: 'p1', skuId: 's1', color: '白色', size: 'M', count: 2 }
  });
  assert.equal(page.data.showSku, false);
  assert.deepEqual(navigations, []);
});

test('搜索卡片左右列提供加购按钮，首页和搜索页均使用共享规格弹窗', () => {
  const template = fs.readFileSync(path.join(__dirname, '../../pages/search/search.wxml'), 'utf8');
  assert.equal((template.match(/catchtap="openSkuPanel"/g) || []).length, 2);
  for (const page of ['index', 'search']) {
    const html = fs.readFileSync(path.join(__dirname, '../../pages', page, page + '.wxml'), 'utf8');
    assert.match(html, /include src="..\/..\/templates\/productSkuPanel.wxml"/);
  }
});
