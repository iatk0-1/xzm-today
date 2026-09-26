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
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
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
