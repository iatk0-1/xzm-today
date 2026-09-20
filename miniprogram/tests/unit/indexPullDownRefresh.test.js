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
  navigateTo() {},
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
    return { ensureAuthenticated: async () => {}, isAdmin: () => false };
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
  assert.deepEqual(searchCalls()[0].params, { page: 1, size: 20, stallId: 's1', tagId: 't1' });

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

test('列表滚动区尺寸：窗口高度减掉导航栏，档口/分类再多让一条子导航', () => {
  const page = createPage();
  page.data.totalNavHeight = 100;

  page.updateListMetrics();
  assert.equal(page.data.listHeight, 700); // 800 - 100
  assert.equal(page.data.listTop, 0);

  page.setData({ currentMainTab: '档口' });
  page.updateListMetrics();
  assert.equal(page.data.listTop, 50); // 100rpx 在 375 宽的屏上是 50px
  assert.equal(page.data.listHeight, 650);

  page.setData({ currentMainTab: '上新' });
  page.updateListMetrics();
  assert.equal(page.data.listTop, 0);
  assert.equal(page.data.listHeight, 700);
});
