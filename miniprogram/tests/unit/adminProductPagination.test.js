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
  assert.equal(page.onShow, undefined);

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
