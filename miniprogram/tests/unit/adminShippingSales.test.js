const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
global.Page = page => { config = page; };
global.wx = { showToast() {}, stopPullDownRefresh() {} };
const requests = [];
let replies = [];
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {
    get(url, params) {
      requests.push({ url, params });
      return replies.shift() || Promise.resolve({ content: [], totalElements: 0 });
    }
  };
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminShippingSales/adminShippingSales.js');
Module._load = originalLoad;

function page() {
  const instance = Object.assign({}, config);
  instance.data = JSON.parse(JSON.stringify(config.data));
  instance.setData = (patch, callback) => {
    Object.assign(instance.data, patch);
    if (callback) callback();
  };
  return instance;
}

test('统计页汇总所有页的数量，并在售后规格上显示去重状态', async () => {
  requests.length = 0;
  replies = [
    Promise.resolve({ sold_qty: 12, pending_qty: 7, shipped_qty: 5 }),
    Promise.resolve({ content: [
      { skuId: 1, afterSaleStatuses: 'pending,refunded,pending', soldQty: 8, pendingQty: 3, shippedQty: 5 }
    ], totalElements: 2 }),
    Promise.resolve({ content: [
      { skuId: 2, afterSaleStatuses: null, soldQty: 4, pendingQty: 4, shippedQty: 0 }
    ], totalElements: 2 })
  ];
  const instance = page();
  await instance.onLoad();
  assert.deepEqual(instance.data.overview, { soldQty: 12, pendingQty: 7, shippedQty: 5 });
  assert.deepEqual(instance.data.items[0].afterSaleLabels, ['待审核', '已退款']);
  assert.equal(instance.data.hasMore, true);
  await instance.onReachBottom();
  assert.equal(requests[2].params.page, 2);
  assert.equal(instance.data.items.length, 2);
  assert.equal(instance.data.hasMore, false);
});

test('切换状态时丢弃旧列表响应', async () => {
  requests.length = 0;
  let resolveOld;
  replies = [
    new Promise(resolve => { resolveOld = resolve; }),
    Promise.resolve({ content: [{ skuId: 2, afterSaleStatuses: 'approved' }], totalElements: 1 })
  ];
  const instance = page();
  const old = instance.loadItems(true);
  instance.switchTab({ currentTarget: { dataset: { status: 'after_sale' } } });
  await new Promise(resolve => setImmediate(resolve));
  resolveOld({ content: [{ skuId: 1 }], totalElements: 1 });
  await old;
  assert.equal(requests[1].params.status, 'after_sale');
  assert.equal(instance.data.items[0].skuId, 2);
});
