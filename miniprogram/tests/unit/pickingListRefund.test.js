const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
const calls = [];
const modals = [];
let preview;
let refundResult;
let queryResult;
const storage = new Map();
global.Page = value => { config = value; };
global.wx = {
  getStorageSync: key => key === 'userInfo' ? { userId: '1' } : storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  showModal: options => {
    modals.push(options);
    if (options.success) options.success({ confirm: true });
  },
  showToast() {},
  showLoading() {},
  hideLoading() {}
};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {
    get: async url => {
      if (url.includes('/refund-preview')) return preview;
      if (url.includes('/refund-requests/')) {
        if (queryResult instanceof Error) throw queryResult;
        return queryResult;
      }
      throw new Error('不应请求其他接口');
    },
    post: async (url, body, options) => {
      calls.push({ url, body, options });
      return typeof refundResult === 'function' ? refundResult(url, body) : refundResult;
    }
  };
  if (request.endsWith('utils/auth')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/pickingList/pickingList.js');
Module._load = originalLoad;

function page() {
  const result = Object.assign({}, config);
  result.data = JSON.parse(JSON.stringify(config.data));
  result.setData = values => Object.assign(result.data, values);
  result.data.refundSku = { skuId: '9' };
  result.loadRecommendations = async () => {};
  return result;
}

const entry = {
  order: { id: '100', outTradeNo: 'O100' },
  pendingQty: 2,
  relatedItems: [{ orderItemId: '200', pendingQty: 2 }]
};

test('待报退款只提交关联订单行的待报数量和金额', async () => {
  calls.length = 0;
  preview = { availableRefundAmount: '50.00', items: [
    { orderItemId: '200', availableQty: 2, salePrice: '10.00', availableRefundAmount: '20.00' },
    { orderItemId: '201', availableQty: 4, salePrice: '10.00', availableRefundAmount: '40.00' }
  ] };
  refundResult = { status: 'success' };
  const result = await page().refundOneOrder(entry);
  assert.equal(result.status, 'success');
  assert.deepEqual(calls[0].body.items, [{ orderItemId: '200', qty: 2, refundAmount: '20.00' }]);
  assert.equal(calls[0].url, '/picking-list/skus/9/orders/100/refunds');
});

test('负责人退款走当前 SKU 接口，不把同订单其他商品带进请求', async () => {
  calls.length = 0;
  preview = { availableRefundAmount: '20.00', items: [
    { orderItemId: '200', availableQty: 2, salePrice: '10.00', availableRefundAmount: '20.00' }
  ] };
  refundResult = { status: 'success' };
  const instance = page();
  instance.data.isStallManager = true;
  instance.data.refundReturnPurchaseOrder = true;
  await instance.refundOneOrder(entry);
  assert.equal(calls[0].url, '/picking-list/skus/9/orders/100/refunds');
  assert.deepEqual(calls[0].body.items, [{ orderItemId: '200', qty: 2, refundAmount: '20.00' }]);
  assert.equal(calls[0].body.returnPurchaseOrder, true);
});

test('负责人可见报单记录、报单选择及退款按钮', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const template = fs.readFileSync(path.join(__dirname, '../../pages/pickingList/pickingList.wxml'), 'utf8');
  assert.match(template, /class="btn-history" bindtap="goToOrders"/);
  assert.match(template, /class="action-bar" wx:if="\{\{filterStatus === 'pending'\}\}"/);
  assert.equal(template.includes('!isStallManager'), false);
  assert.match(template, /仅退当前商品的待报数量/);
});

test('可退数量不足时停止且不提交退款', async () => {
  calls.length = 0;
  preview = { availableRefundAmount: '50.00', items: [
    { orderItemId: '200', availableQty: 1, salePrice: '10.00', availableRefundAmount: '10.00' }
  ] };
  await assert.rejects(page().refundOneOrder(entry), /可退数量不足/);
  assert.equal(calls.length, 0);
});

test('微信返回处理中时继续提交后续订单，并区分成功与处理中数量', async () => {
  calls.length = 0;
  modals.length = 0;
  preview = { availableRefundAmount: '50.00', items: [
    { orderItemId: '200', availableQty: 2, salePrice: '10.00', availableRefundAmount: '20.00' }
  ] };
  refundResult = url => ({ status: url.includes('/100/') ? 'processing' : 'success' });
  const instance = page();
  await instance.executeRefunds([entry, { ...entry, order: { id: '101', outTradeNo: 'O101' } }]);
  assert.equal(calls.length, 2);
  assert.match(modals[0].content, /已成功退款 2 件，微信处理中 2 件/);
  assert.match(modals[0].content, /请勿重复提交/);
});

test('退款真实失败时暂停后续订单并报告未完成数量', async () => {
  calls.length = 0;
  modals.length = 0;
  preview = { availableRefundAmount: '50.00', items: [
    { orderItemId: '200', availableQty: 2, salePrice: '10.00', availableRefundAmount: '20.00' }
  ] };
  refundResult = url => ({ status: url.includes('/100/') ? 'failed' : 'success', errorMessage: '退款已关闭' });
  await page().executeRefunds([entry, { ...entry, order: { id: '101', outTradeNo: 'O101' } }]);
  assert.equal(calls.length, 1);
  assert.match(modals[0].content, /退款失败 2 件，尚未提交 2 件.*退款已关闭/);
});

test('断线后查询原请求，已受理则继续后续订单，不重复发起', async () => {
  calls.length = 0;
  modals.length = 0;
  storage.clear();
  queryResult = { status: 'processing' };
  refundResult = url => {
    if (url.includes('/100/')) throw { errMsg: 'request:fail abort' };
    return { status: 'success' };
  };
  await page().executeRefunds([entry, { ...entry, order: { id: '101' } }]);
  assert.equal(calls.length, 2);
  assert.match(calls[0].options.idempotencyKey, /^pr_/);
  assert.match(modals[0].content, /已成功退款 2 件，微信处理中 2 件/);
  assert.equal(storage.size, 0);
});

test('查不清时单独统计待确认，暂停后续订单，页面重开也只查原请求', async () => {
  calls.length = 0;
  modals.length = 0;
  storage.clear();
  queryResult = new Error('查询断网');
  refundResult = () => { throw { errMsg: 'request:fail' }; };
  await page().executeRefunds([entry, { ...entry, order: { id: '101' } }]);
  assert.equal(calls.length, 1);
  assert.match(modals[0].content, /结果待确认 2 件，退款失败 0 件，尚未提交 2 件/);
  const savedKey = storage.get('picking-refund-request:1:9:100');
  assert.ok(savedKey);
  queryResult = { status: 'success' };
  assert.equal((await page().refundOneOrder(entry)).status, 'success');
  assert.equal(calls.length, 1);
  assert.equal(storage.size, 0);
});

test('明确拒绝请求时标记尚未提交，不保留待确认编号', async () => {
  calls.length = 0;
  modals.length = 0;
  storage.clear();
  refundResult = () => { throw { statusCode: 400, message: '可退数量不足' }; };
  await page().executeRefunds([entry]);
  assert.match(modals[0].content, /结果待确认 0 件，退款失败 0 件，尚未提交 2 件/);
  assert.equal(storage.size, 0);
});

test('刷新列表失败不会丢失已经成功的退款统计', async () => {
  modals.length = 0;
  refundResult = { status: 'success' };
  const instance = page();
  instance.refreshSkuRecommendations = async () => { throw new Error('断网'); };
  await instance.executeRefunds([entry]);
  assert.match(modals[0].content, /已成功退款 2 件.*列表刷新失败/);
});

test('刷新后待报增加也不超过卡片点击时的数量', () => {
  const limited = page().limitRefundEntries([
    { pendingQty: 2, relatedItems: [{ orderItemId: '1', pendingQty: 2 }] },
    { pendingQty: 2, relatedItems: [{ orderItemId: '2', pendingQty: 2 }] }
  ], 3);
  assert.deepEqual(limited.map(item => item.pendingQty), [2, 1]);
});

test('八笔退款第七笔断线但已成功时，准确计数并继续第八笔', async () => {
  calls.length = 0;
  modals.length = 0;
  storage.clear();
  queryResult = { status: 'success' };
  refundResult = url => {
    if (url.includes('/106/')) throw { errMsg: 'request:fail abort' };
    return { status: 'processing' };
  };
  const entries = Array.from({ length: 8 }, (_, index) => ({ ...entry,
    pendingQty: 1, relatedItems: [{ orderItemId: '200', pendingQty: 1 }],
    order: { id: String(100 + index) }
  }));
  await page().executeRefunds(entries);
  assert.equal(calls.length, 8);
  assert.equal(new Set(calls.map(call => call.options.idempotencyKey)).size, 8);
  assert.match(modals[0].content, /已成功退款 1 件，微信处理中 7 件/);
});
