const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
global.Page = config => { pageConfig = config; };
global.wx = { showToast() {}, stopPullDownRefresh() {} };

const requests = [];
let responses = [];
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) {
    return {
      get: (url, params) => {
        if (url === '/admin/sales/query/products') {
          requests.push(params);
          return responses.shift();
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
