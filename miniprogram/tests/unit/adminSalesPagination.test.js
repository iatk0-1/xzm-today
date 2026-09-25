const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
global.Page = config => { pageConfig = config; };
global.wx = { showToast() {}, stopPullDownRefresh() {} };

const requests = [];
let responses = [];
const overviewRequests = [];
let overviewResponses = [];
const filteredOverviewRequests = [];
let filteredOverviewResponses = [];
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) {
    return {
      get: (url, params) => {
        if (url === '/admin/sales/query/products') {
          requests.push(params);
          return responses.shift();
        }
        if (url === '/admin/sales/overview') {
          overviewRequests.push(params);
          return overviewResponses.shift() || Promise.resolve({});
        }
        if (url === '/admin/sales/query/overview') {
          filteredOverviewRequests.push(params);
          return filteredOverviewResponses.shift() || Promise.resolve({});
        }
        return Promise.resolve([]);
      }
    };
  }
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminSales/adminSales.js');
Module._load = originalLoad;

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  return page;
}

function product(productId) {
  return { productId, productName: `商品${productId}` };
}

test('销售页首次打开默认查询当天商品和统计', { concurrency: false }, async () => {
  requests.length = 0;
  overviewRequests.length = 0;
  filteredOverviewRequests.length = 0;
  responses = [Promise.resolve({ content: [], totalElements: 0 })];
  overviewResponses = [Promise.resolve({ soldQty: 2, totalAmount: 100, afterSaleCount: 0, afterSaleAmount: 0 })];
  const page = createPage();
  await page.onLoad();
  const today = page.formatDate(new Date());
  assert.equal(page.data.quickSelect, '1day');
  assert.equal(page.data.startDate, today);
  assert.equal(page.data.endDate, today);
  assert.equal(requests[0].startDate, today);
  assert.equal(requests[0].endDate, today);
  assert.deepEqual(overviewRequests[0], { startDate: today, endDate: today });
  assert.deepEqual(filteredOverviewRequests[0], { startDate: today, endDate: today });
});

test('档口和标签组合筛选后从第一页查询，翻页追加且不重复发请求', { concurrency: false }, async () => {
  requests.length = 0;
  responses = [
    Promise.resolve({ content: [product(1)], totalElements: 2 }),
    Promise.resolve({ content: [product(2)], totalElements: 2 })
  ];
  const page = createPage();
  page.data.selectedStall = 3;
  page.data.selectedTag = 5;
  page.data.keyword = '裙';
  page.data.startDate = '2026-09-01';
  await page.loadProducts();
  const loadingMore = page.loadMore();
  assert.equal(page.loadMore(), undefined);
  await loadingMore;

  assert.deepEqual(requests.map(params => params.page), [1, 2]);
  assert.ok(requests.every(params => params.stallId === 3 && params.tagId === 5));
  assert.ok(requests.every(params => params.keyword === '裙' && params.startDate === '2026-09-01'));
  assert.deepEqual(page.data.products.map(item => item.productId), [1, 2]);
  assert.equal(page.data.hasMore, false);
});

test('下一页失败后仍从同一页重试', { concurrency: false }, async () => {
  requests.length = 0;
  responses = [
    Promise.resolve({ content: [product(1)], totalElements: 2 }),
    Promise.reject(new Error('网络失败')),
    Promise.resolve({ content: [product(2)], totalElements: 2 })
  ];
  const page = createPage();
  await page.loadProducts();
  await page.loadMore();
  assert.equal(page.data.page, 1);
  assert.equal(page.data.hasMore, true);
  await page.loadMore();
  assert.deepEqual(requests.map(params => params.page), [1, 2, 2]);
  assert.deepEqual(page.data.products.map(item => item.productId), [1, 2]);
});

test('筛选切换后忽略旧请求，下拉刷新保留筛选并重置分页', { concurrency: false }, async () => {
  requests.length = 0;
  let finishOldRequest;
  responses = [
    new Promise(resolve => { finishOldRequest = resolve; }),
    Promise.resolve({ content: [product(2)], totalElements: 1 }),
    Promise.resolve({ content: [product(3)], totalElements: 1 })
  ];
  const page = createPage();
  const oldRequest = page.loadProducts();
  await page.selectTag({ currentTarget: { dataset: { tag: 5 } } });
  finishOldRequest({ content: [product(1)], totalElements: 1 });
  await oldRequest;
  assert.deepEqual(page.data.products.map(item => item.productId), [2]);
  await page.onListPullDownRefresh();
  assert.deepEqual(requests.map(params => params.page), [1, 1, 1]);
  assert.equal(requests[2].tagId, 5);
  assert.deepEqual(page.data.products.map(item => item.productId), [3]);
  assert.equal(page.data.isRefreshing, false);
});

test('销售页最近 1 天只查询当天，取消编辑不改已生效范围', { concurrency: false }, async () => {
  requests.length = 0;
  overviewRequests.length = 0;
  filteredOverviewRequests.length = 0;
  responses = [Promise.resolve({ content: [], totalElements: 0 })];
  overviewResponses = [Promise.resolve({ soldQty: 25, totalAmount: 3316.25, afterSaleCount: 1, afterSaleAmount: 132.65 })];
  const page = createPage();
  const today = page.formatDate(new Date());
  page.showDateRangeSelector();
  page.selectDateRange({ currentTarget: { dataset: { type: '1day' } } });
  assert.deepEqual(page.data.editingDateRange, {
    startDate: today, endDate: today, quickSelect: '1day'
  });
  page.closeDateModal();
  assert.equal(page.data.startDate, '');
  page.showDateRangeSelector();
  page.selectDateRange({ currentTarget: { dataset: { type: '1day' } } });
  page.confirmDateRange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0].startDate, today);
  assert.equal(requests[0].endDate, today);
  assert.equal(requests[0].page, 1);
  assert.deepEqual(overviewRequests[0], { startDate: today, endDate: today });
  assert.deepEqual(filteredOverviewRequests[0], { startDate: today, endDate: today });
  assert.deepEqual(page.data.overview, {
    soldQty: 25, totalAmount: 3316.25, afterSaleCount: 1, afterSaleAmount: 132.65
  });
});

test('销售统计忽略日期切换前的旧结果', { concurrency: false }, async () => {
  overviewRequests.length = 0;
  let resolveOld;
  overviewResponses = [
    new Promise(resolve => { resolveOld = resolve; }),
    Promise.resolve({ soldQty: 8, totalAmount: 100, afterSaleCount: 0, afterSaleAmount: 0 })
  ];
  const page = createPage();
  const oldRequest = page.loadOverview();
  page.data.startDate = '2026-09-25';
  const newRequest = page.loadOverview();
  await newRequest;
  resolveOld({ soldQty: 99, totalAmount: 999, afterSaleCount: 9, afterSaleAmount: 99 });
  await oldRequest;
  assert.equal(page.data.overview.soldQty, 8);
  assert.deepEqual(overviewRequests, [{}, { startDate: '2026-09-25' }]);
});

test('关键词、档口和标签变化时统计与商品列表使用同一组筛选条件', { concurrency: false }, async () => {
  requests.length = 0;
  overviewRequests.length = 0;
  filteredOverviewRequests.length = 0;
  responses = [
    Promise.resolve({ content: [], totalElements: 0 }),
    Promise.resolve({ content: [], totalElements: 0 }),
    Promise.resolve({ content: [], totalElements: 0 })
  ];
  filteredOverviewResponses = [Promise.resolve({}), Promise.resolve({}), Promise.resolve({})];
  const page = createPage();
  page.data.startDate = '2026-09-25';
  page.data.endDate = '2026-09-25';
  page.onSearchInput({ detail: { value: '  连衣裙  ' } });
  page.onSearch();
  await new Promise(resolve => setImmediate(resolve));
  page.selectStall({ currentTarget: { dataset: { stall: 3 } } });
  await new Promise(resolve => setImmediate(resolve));
  page.selectTag({ currentTarget: { dataset: { tag: 5 } } });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(requests.length, 3);
  assert.equal(overviewRequests.length, 0);
  assert.equal(filteredOverviewRequests.length, 3);
  for (let i = 0; i < requests.length; i++) {
    const { page: requestPage, size, ...filters } = requests[i];
    assert.equal(requestPage, 1);
    assert.equal(size, 20);
    assert.deepEqual(filteredOverviewRequests[i], filters);
  }
  assert.deepEqual(filteredOverviewRequests[2], {
    keyword: '连衣裙', stallId: 3, tagId: 5,
    startDate: '2026-09-25', endDate: '2026-09-25'
  });
});

test('筛选统计忽略旧筛选结果，上方日期统计保持原值', { concurrency: false }, async () => {
  filteredOverviewRequests.length = 0;
  let resolveOld;
  filteredOverviewResponses = [
    new Promise(resolve => { resolveOld = resolve; }),
    Promise.resolve({ soldQty: 3, totalAmount: 90, afterSaleCount: 1, afterSaleAmount: 10 })
  ];
  const page = createPage();
  page.data.overview = { soldQty: 100, totalAmount: 2000, afterSaleCount: 5, afterSaleAmount: 300 };
  const oldRequest = page.loadFilteredOverview();
  page.data.selectedTag = 5;
  await page.loadFilteredOverview();
  resolveOld({ soldQty: 99, totalAmount: 999, afterSaleCount: 9, afterSaleAmount: 99 });
  await oldRequest;
  assert.equal(page.data.filteredOverview.soldQty, 3);
  assert.equal(page.data.overview.soldQty, 100);
  assert.deepEqual(filteredOverviewRequests, [{}, { tagId: 5 }]);
});
