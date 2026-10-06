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
  value.setData = patch => Object.assign(value.data, patch);
  value.data.productList = [
    { id: '1', name: '棉袄', coverUrl: '/cover.jpg', skus: [
      { id: '11', spec: '红色', size: 'M', imageUrl: '/red.jpg', shortageQty: 3 },
      { id: '12', spec: '蓝色', size: 'L', shortageQty: 4 }
    ] },
    { id: '2', name: '裤子', skus: [{ id: '21', spec: '黑色', size: 'M' }] },
    { id: '3', name: '无规格', skus: [] }
  ];
  return value;
}
function qtyEvent(index, value) { return { currentTarget: { dataset: { index } }, detail: { value } }; }
function stepEvent(index, delta) { return { currentTarget: { dataset: { index, delta } } }; }
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

test('商品多选和全选只选有规格的商品，弹窗包含全部SKU、图片，数量默认0', () => {
  const inventory = page();
  inventory.openBatchReceiveModal();
  assert.equal(inventory.data.showBatchReceiveModal, false);
  inventory.toggleProductSelection({ currentTarget: { dataset: { id: '1' } } });
  assert.equal(inventory.data.selectedCount, 1);
  assert.equal(inventory.data.allSelected, false);
  inventory.openBatchReceiveModal();
  assert.deepEqual(inventory.data.batchReceiveItems.map(item => [item.skuId, item.qty, item.imageUrl]),
    [['11', 0, '/red.jpg'], ['12', 0, '/cover.jpg']]);
  assert.equal(inventory.data.batchReceiveSource, 'normal');
  inventory.closeBatchReceiveModal();
  inventory.toggleSelectAll();
  assert.equal(inventory.data.selectedCount, 2);
  assert.equal(inventory.data.allSelected, true);
  assert.equal(inventory.data.productList[2].selected, false);
  inventory.openBatchReceiveModal();
  assert.equal(inventory.data.batchReceiveItems.length, 3);
  assert.equal(inventory.data.batchReceiveItems[2].imageUrl, '/images/default-goods-image.png');
  inventory.toggleSelectAll();
  assert.equal(inventory.data.selectedCount, 0);
  assert.equal(inventory.data.allSelected, false);
});

test('数量加减最低0，支持直接输入，切换来源保留数量，取消后重开从0开始', () => {
  const inventory = page();inventory.toggleSelectAll();inventory.openBatchReceiveModal();
  inventory.adjustBatchReceiveQty(stepEvent(0, -1));
  assert.equal(inventory.data.batchReceiveItems[0].qty, 0);
  inventory.adjustBatchReceiveQty(stepEvent(0, 1));
  inventory.onBatchReceiveQtyInput(qtyEvent(1, '3'));
  assert.equal(inventory.data.batchReceiveTotal, 4);
  assert.equal(inventory.data.batchReceiveSkuCount, 2);
  inventory.changeBatchReceiveSource({ currentTarget: { dataset: { source: 'history' } } });
  assert.equal(inventory.data.batchReceiveSource, 'history');
  assert.equal(inventory.data.batchReceiveTotal, 4);
  inventory.onBatchReceiveQtyInput(qtyEvent(0, ''));
  inventory.normalizeBatchReceiveQty(qtyEvent(0, ''));
  assert.equal(inventory.data.batchReceiveItems[0].qty, 0);
  inventory.closeBatchReceiveModal();inventory.openBatchReceiveModal();
  assert.equal(inventory.data.batchReceiveTotal, 0);
  assert.equal(inventory.data.batchReceiveSource, 'normal');
});

test('全0和负数小数等无效输入不提交，保留原输入供修正', async () => {
  const inventory = page();inventory.toggleSelectAll();inventory.openBatchReceiveModal();
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

test('翻页保留已有选择，新商品不自动勾选，换筛选清除选择', async () => {
  const inventory = page();inventory.toggleSelectAll();
  inventory.data.page = 2;
  handler = () => ({ content: [{ productId: '4', productName: '新商品', skuId: '41', qty: 0 }], hasNext: false });
  await inventory.loadProducts(false);
  assert.equal(inventory.data.selectedCount, 2);
  assert.equal(inventory.data.allSelected, false);
  inventory.toggleProductSelection({ currentTarget: { dataset: { id: '4' } } });
  assert.equal(inventory.data.selectedCount, 3);
  await inventory.selectStall({ currentTarget: { dataset: { stall: '99' } } });
  assert.equal(inventory.data.selectedCount, 0);
  assert.equal(inventory.data.allSelected, false);
});

test('批量历史入库只提交正数量，成功刷新当前筛选并清除选择和重试记录', async () => {
  const inventory = page();inventory.toggleSelectAll();inventory.openBatchReceiveModal();
  inventory.setData({ inventoryTab: 'shortage', selectedStall: '99', selectedTag: '88', keyword: ' 棉袄 ' });
  inventory.onBatchReceiveQtyInput(qtyEvent(0, '2'));
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
  assert.equal(storage.size, 0);
});

test('提交锁阻止连点和修改，网络失败后保留原请求，重进页面仍能确认同一批次', async () => {
  const inventory = page();inventory.toggleSelectAll();inventory.openBatchReceiveModal();
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
  const inventory = page();inventory.toggleSelectAll();inventory.openBatchReceiveModal();
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
