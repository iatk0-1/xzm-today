const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// 这些用例共享小程序桩状态，必须串行执行，避免不同用例的请求日志互相污染。
const test = (name, fn) => nodeTest(name, { concurrency: false }, fn);

// ---- 桩：小程序运行时 ----
let pageConfig = null;
global.Page = (config) => { pageConfig = config; };
global.getApp = () => ({ ensureAuthenticated: async () => {} });

const wxCalls = { showLoading: 0, hideLoading: 0, stopPullDownRefresh: 0 };

global.wx = {
  getMenuButtonBoundingClientRect: () => ({ top: 44, height: 32, bottom: 76 }),
  getWindowInfo: () => ({ windowHeight: 800, windowWidth: 375 }),
  showLoading() { wxCalls.showLoading += 1; },
  hideLoading() { wxCalls.hideLoading += 1; },
  stopPullDownRefresh() { wxCalls.stopPullDownRefresh += 1; },
  showToast() {},
  navigateTo(options) { wxCalls.navigateUrl = options.url; },
  reLaunch() {}
};

// 请求全部走桩：记下每次调用，返回什么由用例自己定
let requestLog = [];
let requestHandler = async () => ({});

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request.endsWith('utils/api')) {
    return {
      get: async (url, params) => {
        requestLog.push({ url, params });
        return requestHandler(url, params);
      },
      post: async () => ({}),
      put: async () => ({}),
      patch: async () => ({}),
      delete: async () => ({})
    };
  }
  if (request.endsWith('utils/auth')) {
    return { ensureAuthenticated: async () => {}, isAdmin: () => false, isStallManager: () => false };
  }
  if (request.endsWith('utils/customerServiceUnread')) {
    return { start() {}, stop() {} };
  }
  return originalLoad.call(this, request, ...rest);
};

require('../../pages/index/index.js');

function makeProduct(id) {
  return { id, name: '商品' + id, skuMatrix: [{ stock: 10, unlimitedStock: false }] };
}

function createPage() {
  requestLog = [];
  wxCalls.showLoading = 0;
  wxCalls.hideLoading = 0;
  wxCalls.stopPullDownRefresh = 0;

  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch) => {
    Object.keys(patch).forEach((key) => { page.data[key] = patch[key]; });
  };
  return page;
}

function backendStub(options = {}) {
  const productPages = options.productPages || [[makeProduct('p1'), makeProduct('p2'), makeProduct('p3')]];
  let round = 0;

  return async (url) => {
    if (url === '/products/query') {
      if (options.failProducts) throw new Error('模拟网络异常');
      const content = productPages[Math.min(round, productPages.length - 1)];
      round += 1;
      return { content, hasNext: false, totalElements: content.length };
    }
    if (url === '/stalls') return options.stalls || [{ id: 's1', name: 'A档口' }, { id: 's2', name: 'B档口' }];
    if (url === '/tags') return options.tags || [{ id: 't1', name: '上衣' }];
    return {};
  };
}

function searchCalls() {
  return requestLog.filter((item) => item.url === '/products/query');
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('下拉刷新：释放时重新查询商品首屏，带上当前筛选条件并刷新档口/标签', async () => {
  const page = createPage();
  page.data.productList = [makeProduct('old')];
  page.data.leftColumn = [makeProduct('old')];
  page.data.rightColumn = [];
  page.data.page = 5; // 已经翻到后面几页
  page.data.hasMore = false; // 上一轮已经到底
  page.data.selectedStall = 's1';
  page.data.selectedTag = 't1';

  requestHandler = backendStub();
  const refresh = page.onRefresh();

  // 松手那一刻刷新态就得打开，否则指示器不转，看着像没反应
  assert.equal(page.data.refreshing, true);

  await refresh;

  assert.equal(page.data.refreshing, false);
  assert.equal(searchCalls().length, 1);
  assert.deepEqual(searchCalls()[0].params, { page: 1, size: 20, sort: 'newest', stallId: 's1', tagId: 't1' });

  const urls = requestLog.map((item) => item.url).sort();
  assert.deepEqual(urls, ['/products/query', '/stalls', '/tags']);

  assert.deepEqual(page.data.productList.map((item) => item.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(page.data.leftColumn.map((item) => item.id), ['p1', 'p3']);
  assert.deepEqual(page.data.rightColumn.map((item) => item.id), ['p2']);
  assert.equal(page.data.page, 2);
  assert.equal(page.data.hasMore, false);
  assert.equal(page.data.stallList.length, 2);
  assert.equal(page.data.tagList.length, 1);
});

test('下拉刷新：用原生刷新动画，不再弹全局 loading 遮罩', async () => {
  const page = createPage();
  requestHandler = backendStub();

  await page.onRefresh();

  assert.equal(wxCalls.showLoading, 0);
  assert.equal(wxCalls.hideLoading, 0);
});

test('页面重新显示：保留当前商品分页，主动下拉才刷新', async () => {
  const page = createPage();
  page._hasLoadedHomeData = true;
  page.data.page = 3;
  page.data.productList = [makeProduct('old')];
  requestHandler = backendStub();

  page.onShow();
  await flush();

  assert.deepEqual(requestLog, []);
  assert.equal(page.data.page, 3);
  assert.deepEqual(page.data.productList.map(item => item.id), ['old']);
});

test('首页首次初始化：page 从 1 开始时仍会发起三类查询', async () => {
  const page = createPage();
  requestHandler = backendStub();

  page.onLoad();
  page.onShow();
  await flush();
  await flush();

  const urls = requestLog.map((item) => item.url).sort();
  assert.deepEqual(urls, ['/products/query', '/stalls', '/tags']);
  assert.equal(page.hasLoadedHomeData(), true);
});

test('下拉刷新：接口异常也会收掉刷新态，不卡在转圈', async () => {
  const page = createPage();
  requestHandler = backendStub({ failProducts: true });

  await page.onRefresh();

  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.loading, false);
  assert.deepEqual(page.data.productList, []);
});

test('下拉刷新：刷新进行中重复下拉不会叠加请求', async () => {
  const page = createPage();
  let resolveProducts;
  requestHandler = async (url) => {
    if (url === '/products/query') {
      return new Promise((resolve) => { resolveProducts = resolve; });
    }
    if (url === '/stalls' || url === '/tags') return [];
    return {};
  };

  const first = page.onRefresh();
  await flush();
  const second = page.onRefresh();
  await flush();

  assert.equal(searchCalls().length, 1);
  resolveProducts({ content: [makeProduct('p1')], hasNext: false });
  await Promise.all([first, second]);

  assert.equal(searchCalls().length, 1);
  assert.equal(page.data.refreshing, false);
});

test('页面级下拉刷新兜底：跑完收起原生刷新动画', async () => {
  const page = createPage();
  requestHandler = backendStub();

  await page.onPullDownRefresh();

  assert.equal(wxCalls.stopPullDownRefresh, 1);
  assert.deepEqual(page.data.productList.map((item) => item.id), ['p1', 'p2', 'p3']);
});

test('下拉刷新：分页请求还在飞时先等它落地，再重新拉首屏', async () => {
  const page = createPage();
  let resolveLoadMore;
  requestHandler = async (url) => {
    if (url === '/products/query') {
      if (searchCalls().length === 1) {
        return new Promise((resolve) => { resolveLoadMore = resolve; });
      }
      return { content: [makeProduct('fresh')], hasNext: false };
    }
    if (url === '/stalls' || url === '/tags') return [];
    return {};
  };

  const loadMore = page.getProductsList(false); // 模拟触底加载
  await flush();
  const refresh = page.onRefresh();
  await flush();

  // 前一个请求没回来之前，刷新不会并发打第二个首屏请求
  assert.equal(searchCalls().length, 1);

  resolveLoadMore({ content: [makeProduct('page2')], hasNext: true });
  await Promise.all([loadMore, refresh]);

  assert.equal(searchCalls().length, 2);
  assert.deepEqual(page.data.productList.map((item) => item.id), ['fresh']);
  assert.equal(page.data.page, 2);
});

test('列表滚动区尺寸：上新和销量都给常驻档口筛选行让位', () => {
  const page = createPage();
  page.data.totalNavHeight = 100;

  page.updateListMetrics();
  assert.equal(page.data.listHeight, 656); // 800 - 100 - 44
  assert.equal(page.data.listTop, 44);

  page.setData({ currentMainTab: '销量' });
  page.updateListMetrics();
  assert.equal(page.data.listTop, 44); // 88rpx 在 375 宽的屏上是 44px
  assert.equal(page.data.listHeight, 656);

  page.setData({ currentMainTab: '上新' });
  page.updateListMetrics();
  assert.equal(page.data.listTop, 44);
  assert.equal(page.data.listHeight, 656);
});

const event = (dataset) => ({ currentTarget: { dataset } });

test('销量：首次点击按近一个月查询，再次点击只展开下拉框，选范围后重新查首屏', async () => {
  const page = createPage();
  requestHandler = backendStub();
  page.data.selectedStall = 's1';
  await page.handleMainTabChange(event({ tab: '销量' }));
  assert.equal(page.data.showSalesPanel, false);
  assert.deepEqual(searchCalls()[0].params, { page: 1, size: 20, sort: 'sales', salesMonths: 1, stallId: 's1' });

  page.handleMainTabChange(event({ tab: '销量' }));
  assert.equal(page.data.showSalesPanel, true);
  assert.equal(searchCalls().length, 1);
  for (const months of [3, 6, 12, 1]) {
    await page.selectSalesPeriod(event({ months }));
    assert.equal(page.data.showSalesPanel, false);
    assert.deepEqual(searchCalls().at(-1).params, { page: 1, size: 20, sort: 'sales', salesMonths: months, stallId: 's1' });
  }
});

test('档口：全部清除档口条件，切回上新保留筛选；两个面板互斥', async () => {
  const page = createPage();
  requestHandler = backendStub();
  await page.handleMainTabChange(event({ tab: '销量' }));
  page.handleMainTabChange(event({ tab: '销量' }));
  page.toggleAllPanel();
  assert.equal(page.data.showAllPanel, true);
  assert.equal(page.data.showSalesPanel, false);
  await page.selectStall(event({ stall: 's2', name: 'B档口' }));
  assert.equal(page.data.showAllPanel, false);
  assert.equal(searchCalls().at(-1).params.stallId, 's2');
  assert.equal(page.data.currentMainTab, '销量');
  await page.handleMainTabChange(event({ tab: '上新' }));
  assert.deepEqual(searchCalls().at(-1).params, { page: 1, size: 20, sort: 'newest', stallId: 's2' });
  await page.selectStall(event({ stall: 'all' }));
  assert.equal(page.data.selectedStall, '');
  assert.deepEqual(searchCalls().at(-1).params, { page: 1, size: 20, sort: 'newest' });
});

test('销量分页和下拉刷新保留所选时间范围，分享链接可以恢复条件', async () => {
  const page = createPage();
  requestHandler = backendStub();
  page.restoreShareFilters({ tab: '销量', salesMonths: '6', stallId: 's2', tagId: 't1' });
  assert.equal(page.data.showSalesPanel, false);
  assert.equal(page.data.salesMonths, 6);
  await page.getProductsList();
  page.data.hasMore = true;
  await page.getProductsList(false);
  assert.deepEqual(searchCalls().at(-1).params, { page: 2, size: 20, sort: 'sales', salesMonths: 6, stallId: 's2', tagId: 't1' });
  await page.onRefresh();
  assert.equal(searchCalls().at(-1).params.salesMonths, 6);
  assert.equal(searchCalls().at(-1).params.page, 1);
  const restored = createPage();
  restored.restoreShareFilters(Object.fromEntries(new URLSearchParams(page.buildShareQuery())));
  assert.equal(restored.data.currentMainTab, '销量');
  assert.equal(restored.data.salesMonths, 6);
  assert.equal(restored.data.selectedStall, 's2');
  restored.restoreShareFilters({ tab: '档口', stallId: 's1', salesMonths: '99' });
  assert.equal(restored.data.currentMainTab, '上新');
  assert.equal(restored.data.selectedStall, 's1');
  assert.equal(restored.data.salesMonths, 1);
});

test('快速切换筛选：丢弃旧响应，合并等待中的查询并使用最终条件', async () => {
  const page = createPage();
  let resolveOld;
  requestHandler = async () => {
    if (searchCalls().length === 1) return new Promise(resolve => { resolveOld = resolve; });
    return { content: [makeProduct('latest')], hasNext: false };
  };
  const initial = page.getProductsList();
  const sales = page.handleMainTabChange(event({ tab: '销量' }));
  const period = page.selectSalesPeriod(event({ months: 12 }));
  const stall = page.selectStall(event({ stall: 's2', name: 'B档口' }));
  resolveOld({ content: [makeProduct('outdated')], hasNext: true });
  await Promise.all([initial, sales, period, stall]);
  assert.equal(searchCalls().length, 2);
  assert.deepEqual(searchCalls().at(-1).params, { page: 1, size: 20, sort: 'sales', salesMonths: 12, stallId: 's2' });
  assert.deepEqual(page.data.productList.map(item => item.id), ['latest']);
  assert.deepEqual(page.data.leftColumn.map(item => item.id), ['latest']);
  assert.equal(page.data.page, 2);
  assert.equal(page.data.loading, false);
});

test('首页进入搜索：带上排序、销量范围和档口条件，上新时也保留已选时间范围', () => {
  const page = createPage();
  page.setData({ currentMainTab: '销量', salesMonths: 6, selectedStall: 's&2', selectedTag: 't1' });
  page.goToSearch();
  let url = new URL(wxCalls.navigateUrl, 'https://miniapp.test');
  assert.equal(url.pathname, '/pages/search/search');
  assert.equal(url.searchParams.get('tab'), '销量');
  assert.equal(url.searchParams.get('salesMonths'), '6');
  assert.equal(url.searchParams.get('stallId'), 's&2');
  assert.equal(url.searchParams.get('tagId'), 't1');

  page.setData({ currentMainTab: '上新' });
  page.goToSearch();
  url = new URL(wxCalls.navigateUrl, 'https://miniapp.test');
  assert.equal(url.searchParams.get('tab'), null);
  assert.equal(url.searchParams.get('salesMonths'), '6');
  assert.equal(url.searchParams.get('stallId'), 's&2');
});
