const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
let pages = [];
let requests = [];
let statusResponse;
let modalOptions;
let navigationOptions;
let deletedIds = [];
let managedDetailHandler = async () => ({});

global.Page = config => { pageConfig = config; };
global.wx = {
  showLoading() {},
  hideLoading() {},
  showToast() {},
  showModal(options) { modalOptions = options; },
  navigateTo(options) { navigationOptions = options; }
};

const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) {
    return {
      get: async (url, params) => {
        if (url.endsWith('?manage=true')) return managedDetailHandler(url);
        if (url === '/products/query') {
          requests.push(params);
          return pages.shift();
        }
        return [];
      },
      patch: async () => statusResponse,
      delete: async url => { deletedIds.push(url); }
    };
  }
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {}, isStallManager: () => false };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminProduct/adminProduct.js');
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

function product(id, status = 'on', name = `商品${id}`) {
  return { id, status, name, stallIds: [], relateTagIds: [] };
}

test('售罄筛选传给分页接口，补货后编辑商品会移出售罄列表', { concurrency: false }, async () => {
  const soldOut = { ...product(1), skuMatrix: [{ stock: 0 }] };
  const offSoldOut = { ...product(2, 'off'), skuMatrix: [{ stock: 0 }] };
  pages = [{ content: [soldOut, offSoldOut], hasNext: false }];
  requests = [];
  const page = createPage();
  page.data.activeStatus = 'sold_out';
  await page.loadProducts();
  assert.equal(requests[0].status, 'sold_out');
  assert.equal(requests[0].page, 1);
  assert.equal(page.data.products[0].soldOut, true);
  assert.equal(page.productMatchesFilters(offSoldOut), true);
  page.updateVisibleProduct({ ...soldOut, skuMatrix: [{ stock: 5 }] });
  assert.deepEqual(page.data.products.map(item => item.id), [2]);
});

test('列表售罄标记沿用规格库存口径，有库存或无限库存都不算售罄', () => {
  const page = createPage();
  for (const [skuMatrix, expected] of [
    [[{ stock: 0 }, { stock: 0 }], true],
    [[{ stock: 0 }, { stock: 1 }], false],
    [[{ stock: 0, unlimitedStock: true }], false],
    [[], true]
  ]) {
    assert.equal(page.normalizeProduct({ ...product(1), skuMatrix }).soldOut, expected);
  }
});

test('商品上架时间优先使用服务端最近上架时间，旧接口兼容创建时间，新商品空值不回退', () => {
  const page = createPage();
  const createdAt = '2025-01-01T10:00:00+08:00';
  assert.equal(page.normalizeProduct({ ...product(1), createdAt, listedAt: '2026-10-13T16:30:00Z' }).listedTimeStr, '10-14 00:30');
  assert.equal(page.normalizeProduct({ ...product(1), createdAt }).listedTimeStr, '01-01 10:00');
  assert.equal(page.normalizeProduct({ ...product(1), createdAt, listedAt: null, listedTimeStr: '旧值' }).listedTimeStr, '');
});

test('批量上下架后重新获取准确上架时间及跳过商品的实际状态', async () => {
  const page = createPage();
  page.setData({ selectedCount: 2, selectedProductIds: [1, 2], products: [product(1, 'off'), product(2, 'off')] });
  statusResponse = { updatedCount: 1, skippedCount: 1 };
  pages = [{ content: [{ ...product(1), listedAt: '2026-10-14T11:20:00+08:00' }, product(2, 'off')], hasNext: false }];
  requests = [];
  page.batchSetStatus({ currentTarget: { dataset: { status: 'on' } } });
  await modalOptions.success({ confirm: true });
  assert.equal(requests.length, 1);
  assert.deepEqual(page.data.products.map(item => item.status), ['on', 'off']);
  assert.equal(page.data.products[0].listedTimeStr, '10-14 11:20');
  assert.equal(page.data.selectedCount, 0);
});

test('商品加载期间输入关键词，加载完成后自动查询最新词并重置分页', { concurrency: false }, async () => {
  let resolveFirst;
  pages = [new Promise(resolve => { resolveFirst = resolve; }),
    { content: [product(2, 'on', '棉袄')], hasNext: false }];
  requests = [];
  const page = createPage();
  const firstLoad = page.loadProducts();
  await new Promise(resolve => setImmediate(resolve));
  page.onSearchInput({ detail: { value: '棉袄' } });
  await new Promise(resolve => setTimeout(resolve, 370));
  assert.equal(requests.length, 1);
  resolveFirst({ content: [product(1)], hasNext: true });
  await firstLoad;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].keyword, '棉袄');
  assert.equal(requests[1].page, 1);
  assert.deepEqual(page.data.products.map(item => item.id), [2]);
  page.onUnload();
});

test('详情返回不重新请求，编辑成功只替换原商品并保留分页', { concurrency: false }, async () => {
  pages = [
    { content: [product(1)], hasNext: true },
    { content: [product(2)], hasNext: false }
  ];
  requests = [];
  const page = createPage();
  page.onLoad();
  await new Promise(resolve => setImmediate(resolve));
  await page.loadProducts(false);
  assert.equal(page.data.page, 3);

  page.openProductEditor(2);
  navigationOptions.events.productUpdated(product(2, 'off', '新名字'));
  const requestCount = requests.length;
  page.onShow();
  assert.equal(requests.length, requestCount); // 返回页面只安排定时检查，不重置原分页列表

  assert.deepEqual(page.data.products.map(item => item.name), ['商品1', '新名字']);
  assert.equal(page.data.products[1].status, 'off');
  assert.equal(page.data.page, 3);
  assert.deepEqual(requests.map(params => params.page), [1, 2]);
  assert.equal(pages.length, 0);
});

test('单件下架和删除就地更新当前列表，筛选不匹配时移除商品', { concurrency: false }, async () => {
  pages = [
    { content: [product(1), product(2)], hasNext: true },
    { content: [product(3)], hasNext: false }
  ];
  requests = [];
  deletedIds = [];
  const page = createPage();
  await page.loadProducts();
  await page.loadProducts(false);
  page.data.activeStatus = 'on';
  statusResponse = { product: product(2, 'off') };

  await page.toggleStatus({ currentTarget: { dataset: { id: 2, status: 'on' } } });
  assert.deepEqual(page.data.products.map(item => item.id), [1, 3]);
  assert.equal(page.data.page, 3);

  page.deleteProduct({ currentTarget: { dataset: { id: 3 } } });
  await modalOptions.success({ confirm: true });
  assert.deepEqual(deletedIds, ['/products/3']);
  assert.deepEqual(page.data.products.map(item => item.id), [1]);
  assert.equal(page.data.page, 3);
  assert.deepEqual(requests.map(params => params.page), [1, 2]);
  assert.equal(pages.length, 0);
});

test('管理列表非阻塞补齐优惠和现货，保持状态、多选、负责人和分页信息', async () => {
  const resolvers = [];
  managedDetailHandler = url => new Promise(resolve => resolvers.push({ url, resolve }));
  try {
    const page = createPage();
    page.data.isStallManager = true;
    pages = [{ content: [1, 2].map(id => ({ ...product(id, id === 1 ? 'off' : 'on'),
      skuMatrix: [{ stock: 5, freeStockQty: 2 }] })), hasNext: true }];
    await page.loadProducts();
    page.toggleProductId(1);
    assert.equal(page.data.isLoading, false);
    assert.deepEqual(page.data.products[0].cardTags.map(tag => tag.label), ['现货']);
    assert.deepEqual(resolvers.map(item => item.url), ['/products/1?manage=true', '/products/2?manage=true']);
    resolvers.forEach(({ resolve }) => resolve({ promotions: {
      firstScheme: { type: 'FIRST', enabled: true }, otherScheme: { type: 'RATE', enabled: true }
    } }));
    await page._cardTagsTask;
    assert.deepEqual(page.data.products.map(item => item.status), ['off', 'on']);
    assert.deepEqual(page.data.products[0].cardTags.map(tag => tag.label), ['首单优惠', '多件多折', '现货']);
    assert.equal(page.data.products[0].selected, true);
    assert.equal(page.data.selectedCount, 1);
    assert.equal(page.data.page, 2);
    assert.equal('leftColumn' in page.data, false);
  } finally { managedDetailHandler = async () => ({}); }
});

test('优惠和现货筛选保留关键词、档口、标签条件并使用服务端分页，刷新重回第一页', async () => {
  for (const status of ['promotion', 'ready_stock']) {
    const page = createPage();
    page.setData({ activeStatus: status, searchKeyword: ' 棉袄 ', selectedStall: 's1', selectedTag: 't1' });
    pages = [{ content: [], hasNext: true }, { content: [], hasNext: false }, { content: [], hasNext: false }];
    requests = [];
    await page.loadProducts();
    await page.loadMore();
    await page.onRefresh();
    assert.deepEqual(requests.map(query => query.page), [1, 2, 1]);
    assert.ok(requests.every(query => query.status === status && query.manage === true
      && query.keyword === '棉袄' && query.stallId === 's1' && query.tagId === 't1'));
  }
});

test('快速切换优惠和现货仅应用最终筛选，旧请求不覆盖新列表', async () => {
  const page = createPage();
  let resolveOld;
  pages = [new Promise(resolve => { resolveOld = resolve; }), {
    content: [{ ...product(2), skuMatrix: [{ stock: 3, freeStockQty: 1 }] }], hasNext: false
  }];
  requests = [];
  const first = page.loadProducts();
  await new Promise(resolve => setImmediate(resolve));
  page.selectStatusTab({ currentTarget: { dataset: { status: 'promotion' } } });
  page.selectStatusTab({ currentTarget: { dataset: { status: 'ready_stock' } } });
  resolveOld({ content: [product(1)], hasNext: true });
  await first;
  await page._cardTagsTask;
  assert.deepEqual(requests.map(query => query.status), ['all', 'ready_stock']);
  assert.deepEqual(page.data.products.map(item => item.id), [2]);
});

test('编辑后取消优惠或消耗完现货时移出对应列表，保留其他商品', async () => {
  const page = createPage();
  const first = page.normalizeProduct({ ...product(1), skuMatrix: [{ stock: 5, freeStockQty: 2 }],
    promotions: { firstScheme: { type: 'FIRST', enabled: true } } });
  const other = page.normalizeProduct({ ...product(2), skuMatrix: [{ stock: 5, freeStockQty: 2 }] });
  page.setData({ products: [first, other], activeStatus: 'promotion' });
  page.updateVisibleProduct({ id: 1, promotions: { firstScheme: null, otherScheme: null } });
  assert.deepEqual(page.data.products.map(item => item.id), [2]);
  page.setData({ products: [first, other], activeStatus: 'ready_stock' });
  page.updateVisibleProduct({ id: 1, skuMatrix: [{ stock: 5, freeStockQty: 0 }] });
  assert.deepEqual(page.data.products.map(item => item.id), [2]);
});

test('优惠配置尚未返回时保留商品，补充查询确认优惠已取消后才移出优惠列表', async () => {
  const page = createPage();
  const item = page.normalizeProduct({ ...product(1), skuMatrix: [{ stock: 5, freeStockQty: 2 }] });
  page.setData({ activeStatus: 'promotion', products: [item], selectedProductIds: ['1'], selectedCount: 1 });
  assert.equal(page.productMatchesFilters(item), true);
  managedDetailHandler = async () => ({ promotions: { firstScheme: null, otherScheme: null } });
  try {
    await page.loadProductTags([item]);
    assert.deepEqual(page.data.products, []);
    assert.equal(page.data.selectedCount, 0);
  } finally { managedDetailHandler = async () => ({}); }
});
