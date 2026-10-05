const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let config;
global.Page = value => { config = value; };
global.wx = { showToast() {} };
const requests = [];
const queryRequests = [];
const responses = [];
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return { get: async (url, data) => { requests.push(url); queryRequests.push({ url, data }); return responses.shift(); } };
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

test('首次进入和空白搜索不传关键词，有效关键词去除首尾空格并保留到翻页', async () => {
  queryRequests.length = 0;
  const page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  let pending;
  page.loadProducts = function(...args) {
    pending = config.loadProducts.apply(this, args);
    return pending;
  };

  responses.push({ content: [], hasNext: false });
  page.onLoad();
  await pending;
  assert.deepEqual(queryRequests[0], {
    url: '/sku-inventory/query', data: { page: 1, size: 20, tab: 'all' }
  });

  page.setData({ keyword: '  棉袄  ' });
  responses.push({ content: [], hasNext: true });
  page.search();
  await pending;
  assert.deepEqual(queryRequests[1].data, { page: 1, size: 20, tab: 'all', keyword: '棉袄' });

  responses.push({ content: [], hasNext: false });
  page.onReachBottom();
  await pending;
  assert.deepEqual(queryRequests[2].data, { page: 2, size: 20, tab: 'all', keyword: '棉袄' });

  for (const keyword of ['', '   ']) {
    page.setData({ keyword });
    responses.push({ content: [], hasNext: false });
    page.search();
    await pending;
    assert.deepEqual(queryRequests.at(-1).data, { page: 1, size: 20, tab: 'all' });
  }
});

test('仓库库存始终使用实际数量，不受可售库存无限标记影响', async () => {
  const page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  const ledgerSkuIds = [];
  page.loadLedger = skuId => ledgerSkuIds.push(skuId);
  responses.push({
    content: [
      { productId: '1', skuId: '11', qty: 6, unlimitedStock: true },
      { productId: '1', skuId: '12', qty: 0, unlimitedStock: true },
      { productId: '2', skuId: '21', unlimitedStock: true },
      { productId: '3', skuId: '31', qty: 3, unlimitedStock: false }
    ],
    hasNext: false
  });
  await page.loadProducts();
  assert.deepEqual(page.data.productList.flatMap(product => product.skus.map(sku => sku.availableQty)), [6, 0, 0, 3]);

  const product = page.data.productList[0];
  page.operateSku({ currentTarget: { dataset: { product, sku: product.skus[0] } } });
  assert.equal(page.data.showSkuModal, true);
  assert.equal(page.data.currentQty, 6);
  page.selectSku({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.currentQty, 0);
  assert.deepEqual(ledgerSkuIds, ['11', '12']);

  // 即使刷新前的 SKU 带有可售库存标记，也按接口返回的仓库数量更新。
  page.data.selectedSku.unlimitedStock = true;
  for (const qty of [9, 0]) {
    responses.push({ qty, unlimitedStock: true });
    await page.refreshSku('12');
    assert.equal(page.data.productList[0].skus[1].availableQty, qty);
    assert.equal(page.data.selectedProduct.skus[1].availableQty, qty);
    assert.equal(page.data.selectedSku.availableQty, qty);
    assert.equal(page.data.currentQty, qty);
  }
  assert.equal(page.data.productList[0].skus[0].availableQty, 6);
});
