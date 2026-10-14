const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let config;
global.Page = value => { config = value; };
const requests = [];
const toasts = [];
const storage = new Map();
const publications = [];
let handler;
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {
    get: async (url, data) => { requests.push({ method: 'GET', url, data }); return handler(url, data); },
    post: async (url, data) => { requests.push({ method: 'POST', url, data }); return handler(url, data); }
  };
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {}, getUserInfo: () => ({ userId: 'admin1' }) };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/skuInventory/skuInventory.js');
Module._load = originalLoad;

function page() {
  const value = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
  value.setData = (patch, callback) => { Object.assign(value.data, patch); if (callback) callback(); };
  value.data.productList = [
    { id: '1', name: '棉袄', coverUrl: '/cover.jpg', skus: [
      { id: '11', spec: '红色', size: 'M', imageUrl: '/red.jpg', shortageQty: 3 },
      { id: '12', spec: '蓝色', size: 'L', shortageQty: 4 }
    ] },
    { id: '2', name: '裤子', skus: [{ id: '21', spec: '黑色', size: 'M' }] },
    { id: '3', name: '无规格', skus: [] }
  ];
  value.data.productList = value.restoreReceiveProducts(value.data.productList);
  return value;
}
function qtyEvent(index, value) { return { currentTarget: { dataset: { index } }, detail: { value } }; }
function stepEvent(index, delta) { return { currentTarget: { dataset: { index, delta } } }; }
function cardEvent(productId, skuId, value, delta) {
  return { currentTarget: { dataset: { productId, skuId, delta } }, detail: { value } };
}
function prepareBatch(inventory) {
  inventory.adjustCardReceiveQty(cardEvent('1', undefined, undefined, 1));
  inventory.adjustCardReceiveQty(cardEvent('2', undefined, undefined, 1));
  inventory.openBatchReceiveModal();
}
test.beforeEach(() => {
  requests.length = 0; toasts.length = 0; publications.length = 0; storage.clear();
  global.wx = {
    showToast: value => toasts.push(value.title),
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
    removeStorageSync: key => storage.delete(key)
  };
  handler = () => ({ content: [], hasNext: false });
});

test('数量默认0，全选只选有规格的商品，批量弹窗只包含待入库的正数量规格和图片', () => {
  const inventory = page();
  assert.deepEqual(inventory.data.productList.flatMap(product => product.skus.map(sku => sku.receiveQty)), [0, 0, 0]);
  inventory.openBatchReceiveModal();
  assert.equal(inventory.data.showBatchReceiveModal, false);
  inventory.toggleProductSelection({ currentTarget: { dataset: { id: '1' } } });
  assert.equal(inventory.data.selectedCount, 1);
  assert.equal(inventory.data.allSelected, false);
  inventory.openBatchReceiveModal();
  assert.equal(inventory.data.showBatchReceiveModal, false);
  inventory.onCardReceiveQtyInput(cardEvent('1', '11', '2'));
  inventory.openBatchReceiveModal();
  assert.deepEqual(inventory.data.batchReceiveItems.map(item => [item.skuId, item.qty, item.imageUrl]),
    [['11', 2, '/red.jpg']]);
  assert.equal(inventory.data.batchReceiveSource, 'normal');
  inventory.closeBatchReceiveModal();
  inventory.toggleSelectAll();
  assert.equal(inventory.data.selectedCount, 2);
  assert.equal(inventory.data.allSelected, true);
  assert.equal(inventory.data.productList[2].selected, false);
  inventory.adjustCardReceiveQty(cardEvent('1', '12', undefined, 1));
  inventory.adjustCardReceiveQty(cardEvent('2', '21', undefined, 1));
  inventory.openBatchReceiveModal();
  assert.equal(inventory.data.batchReceiveItems.length, 3);
  assert.equal(inventory.data.batchReceiveItems[2].imageUrl, '/images/default-goods-image.png');
  inventory.toggleSelectAll();
  assert.equal(inventory.data.selectedCount, 0);
  assert.equal(inventory.data.allSelected, false);
  assert.equal(inventory.data.pendingReceiveItems.length, 0);
  assert.equal(inventory.data.productList[0].skus[0].receiveQty, '2');
});

test('弹窗编辑同步卡片和待入库列表，最低0，切换来源和取消重开保留数量', () => {
  const inventory = page();prepareBatch(inventory);
  inventory.adjustBatchReceiveQty(stepEvent(0, -1));
  assert.equal(inventory.data.batchReceiveItems[0].qty, 0);
  inventory.adjustBatchReceiveQty(stepEvent(0, 1));
  inventory.onBatchReceiveQtyInput(qtyEvent(1, '3'));
  assert.equal(inventory.data.batchReceiveTotal, 5);
  assert.equal(inventory.data.batchReceiveSkuCount, 3);
  inventory.changeBatchReceiveSource({ currentTarget: { dataset: { source: 'history' } } });
  assert.equal(inventory.data.batchReceiveSource, 'history');
  assert.equal(inventory.data.batchReceiveTotal, 5);
  inventory.onBatchReceiveQtyInput(qtyEvent(0, ''));
  inventory.normalizeBatchReceiveQty(qtyEvent(0, ''));
  assert.equal(inventory.data.batchReceiveItems[0].qty, 0);
  assert.equal(inventory.data.productList[0].skus[0].receiveQty, 0);
  inventory.closeBatchReceiveModal();inventory.openBatchReceiveModal();
  assert.equal(inventory.data.batchReceiveTotal, 4);
  assert.equal(inventory.data.pendingReceiveTotal, 4);
  assert.equal(inventory.data.batchReceiveSource, 'history');
  assert.deepEqual(inventory.data.batchReceiveItems.map(item => [item.skuId, item.qty]), [['12', 3], ['21', 1]]);
});

test('全0和负数小数等无效输入不提交，保留原输入供修正', async () => {
  const inventory = page();prepareBatch(inventory);
  inventory.data.batchReceiveItems.forEach((item, index) => inventory.setBatchReceiveQty(index, 0));
  await inventory.confirmBatchReceive();
  for (const value of ['-1', '1.5', 'abc', '2147483648']) {
    inventory.onBatchReceiveQtyInput(qtyEvent(0, value));
    inventory.normalizeBatchReceiveQty(qtyEvent(0, value));
    assert.equal(inventory.data.batchReceiveItems[0].qty, value);
    await inventory.confirmBatchReceive();
  }
  assert.equal(requests.length, 0);
  assert.equal(storage.size, 0);
});

test('翻页和换筛选保留已有选择及待入库，全选只操作当前加载商品', async () => {
  const inventory = page();inventory.toggleSelectAll();
  inventory.setCardReceiveQty('1', '11', 2);
  inventory.data.page = 2;
  handler = () => ({ content: [{ productId: '4', productName: '新商品', skuId: '41', qty: 0 }], hasNext: false });
  await inventory.loadProducts(false);
  assert.equal(inventory.data.selectedCount, 2);
  assert.equal(inventory.data.allSelected, false);
  inventory.toggleProductSelection({ currentTarget: { dataset: { id: '4' } } });
  assert.equal(inventory.data.selectedCount, 3);
  await inventory.selectStall({ currentTarget: { dataset: { stall: '99' } } });
  assert.equal(inventory.data.selectedCount, 3);
  assert.equal(inventory.data.allSelected, true);
  assert.deepEqual(inventory.data.pendingReceiveItems.map(item => [item.skuId, item.qty]), [['11', 2]]);
  inventory.toggleSelectAll();
  assert.equal(inventory.data.selectedCount, 2);
  assert.equal(inventory.data.allSelected, false);
  assert.equal(inventory.data.pendingReceiveTotal, 2);
  inventory.openBatchReceiveModal();
  assert.deepEqual(inventory.data.batchReceiveItems.map(item => item.skuId), ['11']);
});

test('批量历史入库只提交正数量，成功刷新当前筛选并清除选择和重试记录', async () => {
  const inventory = page();prepareBatch(inventory);
  inventory.setData({ inventoryTab: 'shortage', selectedStall: '99', selectedTag: '88', keyword: ' 棉袄 ' });
  inventory.onBatchReceiveQtyInput(qtyEvent(0, '2'));
  inventory.onBatchReceiveQtyInput(qtyEvent(1, '0'));
  inventory.onBatchReceiveQtyInput(qtyEvent(2, '3'));
  inventory.changeBatchReceiveSource({ currentTarget: { dataset: { source: 'history' } } });
  await inventory.confirmBatchReceive();
  const request = requests.find(item => item.method === 'POST');
  assert.equal(request.url, '/sku-inventory/batch-receive');
  assert.match(request.data.requestId, /^receipt_/);
  assert.deepEqual(request.data.items, [{ skuId: '11', qty: 2 }, { skuId: '21', qty: 3 }]);
  assert.equal(request.data.source, 'history');
  assert.deepEqual(requests.at(-1).data, { page: 1, size: 20, tab: 'shortage', keyword: '棉袄', stallId: '99', tagId: '88' });
  assert.equal(inventory.data.showBatchReceiveModal, false);
  assert.equal(inventory.data.selectedCount, 0);
  assert.equal(inventory.data.batchReceiveSaving, false);
  assert.equal(inventory.data.pendingReceiveItems.length, 0);
  assert.equal(inventory.data.batchReceiveItems.length, 0);
  assert.deepEqual([...inventory.receiveDrafts().values()].flatMap(product => product.skus.map(sku => sku.receiveQty)), [0, 0, 0]);
  assert.equal(storage.size, 0);
});

test('卡片单规格自动勾选，总控按各自数量加减，减到0移出待入库且不出现负数', () => {
  const inventory = page();
  inventory.onCardReceiveQtyInput(cardEvent('1', '11', '3'));
  inventory.normalizeCardReceiveQty(cardEvent('1', '11'));
  assert.equal(inventory.data.productList[0].selected, true);
  assert.deepEqual(inventory.data.pendingReceiveItems.map(item => [item.skuId, item.qty]), [['11', 3]]);
  inventory.adjustCardReceiveQty(cardEvent('1', undefined, undefined, -1));
  assert.deepEqual(inventory.data.productList[0].skus.map(sku => sku.receiveQty), [2, 0]);
  inventory.adjustCardReceiveQty(cardEvent('1', undefined, undefined, 1));
  assert.deepEqual(inventory.data.productList[0].skus.map(sku => sku.receiveQty), [3, 1]);
  inventory.adjustCardReceiveQty(cardEvent('1', '12', undefined, -1));
  assert.deepEqual(inventory.data.pendingReceiveItems.map(item => [item.skuId, item.qty]), [['11', 3]]);
  for (let i = 0; i < 4; i++) inventory.adjustCardReceiveQty(cardEvent('1', undefined, undefined, -1));
  assert.deepEqual(inventory.data.productList[0].skus.map(sku => sku.receiveQty), [0, 0]);
  assert.equal(inventory.data.pendingReceiveTotal, 0);
  inventory.toggleProductSelection({ currentTarget: { dataset: { id: '1' } } });
  inventory.adjustCardReceiveQty(cardEvent('1', undefined, undefined, -1));
  assert.equal(inventory.data.productList[0].selected, true);
  assert.equal(inventory.data.pendingReceiveItems.length, 0);
});

test('成功清理本批包括弹窗中减到0的商品，未提交的取消选择草稿仍保留', async () => {
  const inventory = page();prepareBatch(inventory);
  inventory.setBatchReceiveQty(2, 0);
  inventory.setData({ productList: [...inventory.data.productList,
    { id: '4', name: '保留草稿', selected: false, skus: [{ id: '41', receiveQty: 7 }] }] });
  inventory.updateProductSelection();
  await inventory.confirmBatchReceive();
  assert.equal(inventory.data.selectedCount, 0);
  assert.equal(inventory.data.pendingReceiveTotal, 0);
  assert.equal(inventory.receiveDrafts().get('2').selected, false);
  assert.equal(inventory.receiveDrafts().get('2').skus[0].receiveQty, 0);
  assert.equal(inventory.receiveDrafts().get('4').skus[0].receiveQty, 7);
});

test('取消选择保留数量，重新勾选或再次调整数量加入列表，同SKU不重复', async () => {
  const inventory = page();
  inventory.setCardReceiveQty('1', '11', 2);
  inventory.toggleProductSelection({ currentTarget: { dataset: { id: '1' } } });
  assert.equal(inventory.data.pendingReceiveItems.length, 0);
  assert.equal(inventory.data.productList[0].skus[0].receiveQty, 2);
  inventory.toggleProductSelection({ currentTarget: { dataset: { id: '1' } } });
  assert.equal(inventory.data.pendingReceiveTotal, 2);
  inventory.toggleProductSelection({ currentTarget: { dataset: { id: '1' } } });
  inventory.adjustCardReceiveQty(cardEvent('1', '11', undefined, 1));
  assert.equal(inventory.data.pendingReceiveTotal, 3);
  handler = () => ({ content: [{ productId: 1, productName: '棉袄更新', skuId: 11, spec: '红色', qty: 7 }], hasNext: true });
  await inventory.loadProducts();
  await inventory.loadProducts(false);
  assert.equal(inventory.data.productList[0].selected, true);
  assert.equal(inventory.data.productList[0].skus[0].receiveQty, 3);
  assert.equal(inventory.data.pendingReceiveItems.length, 1);
  assert.equal(inventory.data.pendingReceiveItems[0].productName, '棉袄更新');
});

test('切换档口标签日期关键词库存分类保留隐藏的待入库，返回原商品恢复数量', async () => {
  const inventory = page();
  inventory.setCardReceiveQty('1', '11', 4);
  handler = () => ({ content: [{ productId: '4', productName: '新商品', skuId: '41', qty: 2 }], hasNext: false });
  let pending;
  inventory.loadProducts = function(...args) { pending = config.loadProducts.apply(this, args); return pending; };
  await inventory.selectStall({ currentTarget: { dataset: { stall: '99' } } });
  inventory.setCardReceiveQty('4', '41', 2);
  await inventory.selectTag({ currentTarget: { dataset: { tag: '88' } } });
  inventory.setData({ keyword: '新商品' });await inventory.search();
  inventory.changeInventoryTab({ currentTarget: { dataset: { tab: 'stock' } } });await pending;
  inventory.setData({ editingDateRange: { startDate: '2026-10-01', endDate: '2026-10-14' } });
  inventory.confirmDateRange();await pending;
  assert.deepEqual(inventory.data.pendingReceiveItems.map(item => [item.skuId, item.qty]), [['11', 4], ['41', 2]]);
  inventory.openBatchReceiveModal();
  inventory.onBatchReceiveQtyInput(qtyEvent(0, '5'));
  inventory.closeBatchReceiveModal();
  assert.equal(inventory.data.pendingReceiveTotal, 7);
  handler = () => ({ content: [{ productId: '1', productName: '棉袄', skuId: '11', qty: 8 }], hasNext: false });
  await inventory.loadProducts();
  assert.equal(inventory.data.productList[0].selected, true);
  assert.equal(inventory.data.productList[0].skus[0].receiveQty, '5');
  inventory.openBatchReceiveModal();
  assert.equal(inventory.data.batchReceiveTotal, 7);
});

test('卡片无效数量保留供修正，隐藏的无效已选规格阻止入库，总控超过上限不部分修改', async () => {
  const inventory = page();
  inventory.setCardReceiveQty('2', '21', 1);
  for (const value of ['-1', '1.5', 'abc', '2147483648']) {
    inventory.onCardReceiveQtyInput(cardEvent('1', '11', value));
    inventory.normalizeCardReceiveQty(cardEvent('1', '11'));
    inventory.openBatchReceiveModal();
    assert.equal(inventory.data.showBatchReceiveModal, false);
    assert.equal(inventory.data.productList[0].skus[0].receiveQty, value);
  }
  inventory.setCardReceiveQty('1', '11', 2147483647);
  inventory.adjustCardReceiveQty(cardEvent('1', undefined, undefined, 1));
  assert.deepEqual(inventory.data.productList[0].skus.map(sku => sku.receiveQty), [2147483647, 0]);
  inventory.setCardReceiveQty('1', '11', 'abc');
  await inventory.loadProducts();
  inventory.openBatchReceiveModal();
  assert.equal(inventory.data.showBatchReceiveModal, false);
  assert.equal(requests.filter(item => item.method === 'POST').length, 0);
});

test('提交锁阻止连点和修改，网络失败后保留原请求，重进页面仍能确认同一批次', async () => {
  const inventory = page();prepareBatch(inventory);
  inventory.setBatchReceiveQty(1, 0);inventory.setBatchReceiveQty(2, 0);
  inventory.onBatchReceiveQtyInput(qtyEvent(0, '2'));
  let fail;
  handler = () => new Promise((resolve, reject) => { fail = reject; });
  const first = inventory.confirmBatchReceive();
  await new Promise(resolve => setImmediate(resolve));
  await inventory.confirmBatchReceive();
  inventory.onBatchReceiveQtyInput(qtyEvent(0, '9'));
  inventory.changeBatchReceiveSource({ currentTarget: { dataset: { source: 'history' } } });
  inventory.closeBatchReceiveModal();
  assert.equal(requests.length, 1);
  assert.equal(inventory.data.showBatchReceiveModal, true);
  assert.equal(inventory.data.batchReceiveItems[0].qty, '2');
  assert.equal(inventory.data.batchReceiveSource, 'normal');
  inventory.adjustCardReceiveQty(cardEvent('1', undefined, undefined, 1));
  inventory.toggleSelectAll();
  inventory.toggleProductSelection({ currentTarget: { dataset: { id: '1' } } });
  assert.equal(inventory.data.productList[0].skus[0].receiveQty, '2');
  assert.equal(inventory.data.productList[0].selected, true);
  fail(new Error('网络超时'));
  const originalError = console.error;console.error = () => {};
  try { await first; } finally { console.error = originalError; }
  assert.equal(inventory.data.batchRetryPending, true);
  const retry = page();retry.restoreBatchReceive();
  assert.equal(retry.data.showBatchReceiveModal, true);
  assert.equal(retry.data.batchReceiveTotal, 2);
  retry.onBatchReceiveQtyInput(qtyEvent(0, '10'));
  assert.equal(retry.data.batchReceiveItems[0].qty, '2');
  handler = () => ({ content: [], hasNext: false });
  await retry.confirmBatchReceive();
  const posts = requests.filter(item => item.method === 'POST');
  assert.deepEqual(posts[1].data, posts[0].data);
  assert.equal(storage.size, 0);
});

test('明确失败可继续编辑，保存请求失败时不发入库请求', async () => {
  const inventory = page();prepareBatch(inventory);
  inventory.onBatchReceiveQtyInput(qtyEvent(0, '2'));
  handler = () => { throw { statusCode: 400, message: '商品规格不存在' }; };
  const originalError = console.error;console.error = () => {};
  try {
    await inventory.confirmBatchReceive();
    assert.equal(inventory.data.batchRetryPending, false);
    assert.equal(inventory.data.showBatchReceiveModal, true);
    inventory.onBatchReceiveQtyInput(qtyEvent(0, '3'));
    assert.equal(inventory.data.batchReceiveItems[0].qty, '3');
    wx.setStorageSync = () => { throw new Error('存储已满'); };
    await inventory.confirmBatchReceive();
    assert.equal(requests.length, 1);
    assert.equal(inventory.data.batchReceiveSaving, false);
  } finally { console.error = originalError; }
});
