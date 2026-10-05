const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let captured;
global.Page = config => { captured = config; };
const requests = [];
let handler;
const toasts = [];
const api = {
  get: async (url, data) => { requests.push({ method: 'GET', url, data }); return handler(url, data); },
  post: async (url, data) => { requests.push({ method: 'POST', url, data }); return handler(url, data); }
};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return api;
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  if (request.endsWith('utils/clipboard')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/skuInventory/skuInventory.js');
const inventoryConfig = captured;
require('../../pages/adminOrder/adminOrder.js');
const shippingConfig = captured;
Module._load = originalLoad;

function page(config) {
  const value = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
  value.setData = (patch, callback) => { Object.assign(value.data, patch); if (callback) callback(); };
  return value;
}
test.beforeEach(() => {
  requests.length = 0; toasts.length = 0;
  global.wx = { showToast: value => toasts.push(value.title), showModal: value => value.success({ confirm: true }) };
});

test('档口和标签筛选与关键词及库存 Tab 组合，翻页保留条件，全部仅清除对应筛选', async () => {
  handler = () => ({ content: [], hasNext: true });
  const inventory = page(inventoryConfig);
  inventory.setData({ keyword: '  棉袄  ', inventoryTab: 'shortage', page: 7, productList: [{ id: 'old', skus: [] }] });
  await inventory.selectStall({ currentTarget: { dataset: { stall: '41' } } });
  assert.deepEqual(requests.at(-1).data, { page: 1, size: 20, tab: 'shortage', keyword: '棉袄', stallId: '41' });
  assert.deepEqual(inventory.data.productList, []);
  await inventory.selectTag({ currentTarget: { dataset: { tag: '51' } } });
  assert.deepEqual(requests.at(-1).data, { page: 1, size: 20, tab: 'shortage', keyword: '棉袄', stallId: '41', tagId: '51' });
  await inventory.loadProducts(false);
  assert.deepEqual(requests.at(-1).data, { page: 2, size: 20, tab: 'shortage', keyword: '棉袄', stallId: '41', tagId: '51' });
  inventory.changeInventoryTab({ currentTarget: { dataset: { tab: 'stock' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests.at(-1).data, { page: 1, size: 20, tab: 'stock', keyword: '棉袄', stallId: '41', tagId: '51' });
  const count = requests.length;
  await inventory.selectStall({ currentTarget: { dataset: { stall: '41' } } });
  assert.equal(requests.length, count);
  await inventory.selectTag({ currentTarget: { dataset: { tag: 'all' } } });
  assert.deepEqual(requests.at(-1).data, { page: 1, size: 20, tab: 'stock', keyword: '棉袄', stallId: '41' });
  await inventory.selectStall({ currentTarget: { dataset: { stall: 'all' } } });
  assert.deepEqual(requests.at(-1).data, { page: 1, size: 20, tab: 'stock', keyword: '棉袄' });
});

test('筛选项从现有档口和标签接口加载，一项失败仍能使用另一项', async () => {
  const stalls = [{ id: '41', name: '一号档口' }];
  const tags = [{ id: '51', name: '秋装' }];
  handler = url => url === '/stalls/all' ? stalls : tags;
  const inventory = page(inventoryConfig);
  await inventory.loadFilterOptions();
  assert.deepEqual(inventory.data.stallList, stalls);
  assert.deepEqual(inventory.data.tagList, tags);
  handler = url => { if (url === '/stalls/all') throw new Error('档口加载失败'); return tags; };
  const originalError = console.error;
  console.error = () => {};
  try { await inventory.loadFilterOptions(); } finally { console.error = originalError; }
  assert.deepEqual(inventory.data.stallList, []);
  assert.deepEqual(inventory.data.tagList, tags);
  assert.equal(toasts.length, 1);
});

test('快速切换档口和标签时，旧筛选请求不能覆盖最新商品列表', async () => {
  let release;
  handler = (url, query) => query.tagId
    ? { content: [{ productId: '2', skuId: '21', qty: 1 }], hasNext: false }
    : new Promise(resolve => { release = resolve; });
  const inventory = page(inventoryConfig);
  const old = inventory.selectStall({ currentTarget: { dataset: { stall: '41' } } });
  await new Promise(resolve => setImmediate(resolve));
  await inventory.selectTag({ currentTarget: { dataset: { tag: '51' } } });
  release({ content: [{ productId: '1', skuId: '11', qty: 2 }], hasNext: true });
  await old;
  assert.deepEqual(inventory.data.productList.map(product => product.id), ['2']);
  assert.equal(inventory.data.hasMore, false);
  assert.equal(inventory.data.loading, false);
});

test('现货弹窗排除不可发规格，默认全选并填可发数量，允许调整某个规格', async () => {
  handler = () => [
    { productId: '1', productName: '棉袄', skuId: '11', qty: 6, abnormalQty: 1, shippableQty: 5 },
    { productId: '1', productName: '棉袄', skuId: '12', qty: 2, abnormalQty: 2, shippableQty: 0 },
    { productId: '2', productName: '裤子', skuId: '21', qty: 3, shippableQty: 3 }
  ];
  const inventory = page(inventoryConfig);
  await inventory.openShippingModal();
  assert.deepEqual(inventory.data.shippingProducts.map(p => p.skus.map(s => [s.id, s.selected, s.shipQty])), [
    [['11', true, 5]], [['21', true, 3]]
  ]);
  const event = { currentTarget: { dataset: { productIndex: 0, skuIndex: 0 } }, detail: { value: '2' } };
  inventory.onShippingQtyInput(event);
  inventory.toggleShippingSku(event);
  assert.equal(inventory.data.shippingProducts[0].skus[0].selected, false);
  assert.equal(inventory.data.shippingProducts[0].skus[0].shipQty, '2');
});

test('库存匹配结果通过页面事件传入批量发货列表，保留数量、订单和收货信息', async () => {
  const callbacks = new Map();
  const channel = { on: (name, callback) => callbacks.set(name, callback), emit: (name, value) => callbacks.get(name)(value) };
  const shipping = page(shippingConfig);
  shipping.getOpenerEventChannel = () => channel;
  for (const name of ['loadLogisticsAccounts', 'loadStallList', 'loadTagList', 'loadAllPendingItems', 'resumeBatchTask']) shipping[name] = () => {};
  await shipping.onLoad({ fromInventory: '1' });
  const match = {
    items: [{ item: { orderId: '5', orderItemId: '51', skuId: '11', productName: '棉袄', unshippedQty: 4,
      orderCreatedAt: '2026-10-01T00:00:00+08:00', recipientName: '张三', recipientPhone: '123', recipientAddress: '测试地址' }, shipQty: 2 }],
    unmatched: []
  };
  handler = () => match;
  global.wx.navigateTo = options => { assert.match(options.url, /fromInventory=1/); options.success({ eventChannel: channel }); };
  const inventory = page(inventoryConfig);
  inventory.data.shippingProducts = [{ skus: [{ id: '11', selected: true, shipQty: 2, shippableQty: 5 }] }];
  await inventory.goToStockShipping();
  assert.deepEqual(requests[0].data, { items: [{ skuId: '11', qty: 2 }] });
  assert.equal(shipping.data.showPendingShipList, true);
  assert.equal(shipping.data.pendingTotalQty, 2);
  assert.equal(shipping.data.pendingOrderCount, 1);
  assert.equal(shipping.data.pendingShipItems[0].recipientName, '张三');
  assert.equal(shipping.data.pendingShipItems[0].uniqueKey, '5_51_11');
  assert.equal(shipping.data.pendingShipItems[0].unshippedQty, 4);
});

test('小数、超出库存和未选规格不触发订单匹配', async () => {
  handler = () => { throw new Error('无效数量不应发请求'); };
  const inventory = page(inventoryConfig);
  for (const shipQty of ['1.5', '0', '-1', '6', 'abc']) {
    inventory.data.shippingProducts = [{ skus: [{ id: '11', selected: true, shipQty, shippableQty: 5 }] }];
    await inventory.goToStockShipping();
  }
  inventory.data.shippingProducts = [{ skus: [{ id: '11', selected: false, shipQty: 1, shippableQty: 5 }] }];
  await inventory.goToStockShipping();
  assert.equal(requests.length, 0);
  assert.equal(toasts.length, 6);
});

test('切换库存 Tab 后旧请求不覆盖新筛选结果', async () => {
  let release;
  handler = (url, params) => params.tab === 'all'
    ? new Promise(resolve => { release = resolve; })
    : { content: [{ productId: '2', skuId: '21', qty: 0, shortageQty: 3 }], hasNext: false };
  const inventory = page(inventoryConfig);
  const old = inventory.loadProducts();
  await new Promise(resolve => setImmediate(resolve));
  inventory.setData({ inventoryTab: 'shortage' });
  await inventory.loadProducts();
  release({ content: [{ productId: '1', skuId: '11', qty: 5 }], hasNext: true });
  await old;
  assert.deepEqual(inventory.data.productList.map(p => p.id), ['2']);
  assert.equal(inventory.data.loading, false);
  assert.equal(inventory.data.hasMore, false);
});

test('库存修改后同步数量并移出已不符合欠货筛选的商品', async () => {
  handler = () => ({ skuId: '11', qty: 5, shortageQty: 0, abnormalQty: 1, shippableQty: 4 });
  const inventory = page(inventoryConfig);
  inventory.data.inventoryTab = 'shortage';
  const product = { id: '1', skus: [{ id: '11', availableQty: 0, shortageQty: 5 }] };
  inventory.data.productList = [product];
  inventory.data.selectedProduct = product;
  inventory.data.selectedSku = product.skus[0];
  await inventory.refreshSku('11');
  assert.equal(inventory.data.productList.length, 0);
  assert.equal(inventory.data.selectedSku.shippableQty, 4);
  assert.equal(inventory.data.currentQty, 5);
});

test('历史入库明确传来源，盘点未填原因阻止提交', async () => {
  handler = url => url.includes('/detail') ? { inventory: { skuId: '11', qty: 2 }, reports: [], receipts: [], ledger: [] } : { skuId: '11', qty: 2 };
  const inventory = page(inventoryConfig);
  inventory.data.selectedSku = { id: '11' };
  inventory.data.operateType = 'stocktake';
  inventory.data.inputQty = '2';
  await inventory.confirmOperate();
  assert.equal(requests.length, 0);
  inventory.data.operateType = 'history';
  await inventory.confirmOperate();
  assert.deepEqual(requests[0], { method: 'POST', url: '/sku-inventory', data: { skuId: '11', qty: 2, source: 'history', note: '' } });
});
