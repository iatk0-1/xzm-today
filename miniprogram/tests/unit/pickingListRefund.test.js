const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
const calls = [];
const modals = [];
let preview;
let refundResult;
global.Page = value => { config = value; };
global.wx = {
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
      throw new Error('不应请求其他接口');
    },
    post: async (url, body) => {
      calls.push({ url, body });
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
  assert.match(modals[0].content, /未完成 4 件.*退款已关闭/);
});

test('刷新后待报增加也不超过卡片点击时的数量', () => {
  const limited = page().limitRefundEntries([
    { pendingQty: 2, relatedItems: [{ orderItemId: '1', pendingQty: 2 }] },
    { pendingQty: 2, relatedItems: [{ orderItemId: '2', pendingQty: 2 }] }
  ], 3);
  assert.deepEqual(limited.map(item => item.pendingQty), [2, 1]);
});
