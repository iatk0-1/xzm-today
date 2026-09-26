const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let config;
global.Page = value => { config = value; };
global.wx = { showToast() {} };
const requests = [];
const responses = [];
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return { get: async url => { requests.push(url); return responses.shift(); } };
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/skuInventory/skuInventory.js');
Module._load = originalLoad;

test('库存变更仅查询当前 SKU，分页追加不会复制旧商品或丢失同商品的新 SKU', async () => {
  const page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  page.data.productList = [{ id: '1', skus: [{ id: '11', availableQty: 2 }] }];
  page.data.page = 3;
  page.data.selectedProduct = page.data.productList[0];
  page.data.selectedSku = page.data.productList[0].skus[0];
  responses.push({ qty: 7 });
  await page.refreshSku('11');
  assert.deepEqual(requests, ['/sku-inventory/11']);
  assert.equal(page.data.page, 3);
  assert.equal(page.data.productList[0].skus[0].availableQty, 7);
  assert.equal(page.data.selectedSku.availableQty, 7);
  responses.push({ content: [{ productId: '1', skuId: '12', qty: 4 }, { productId: '2', skuId: '21', qty: 5 }], hasNext: false });
  await page.loadProducts(false);
  assert.deepEqual(page.data.productList.map(item => item.id), ['1', '2']);
  assert.deepEqual(page.data.productList[0].skus.map(item => item.id), ['11', '12']);
  assert.equal(page.data.page, 4);
});
