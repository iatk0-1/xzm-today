const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
const calls = [];
let preview;
let refundResult;
global.Page = value => { config = value; };
global.wx = {
  showModal: options => options.success && options.success({ confirm: true }),
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
      return refundResult;
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

test('微信返回处理中时不继续提交后续订单', async () => {
  calls.length = 0;
  preview = { availableRefundAmount: '50.00', items: [
    { orderItemId: '200', availableQty: 2, salePrice: '10.00', availableRefundAmount: '20.00' }
  ] };
  refundResult = { status: 'processing' };
  const instance = page();
  await instance.executeRefunds([entry, entry]);
  assert.equal(calls.length, 1);
});

test('刷新后待报增加也不超过卡片点击时的数量', () => {
  const limited = page().limitRefundEntries([
    { pendingQty: 2, relatedItems: [{ orderItemId: '1', pendingQty: 2 }] },
    { pendingQty: 2, relatedItems: [{ orderItemId: '2', pendingQty: 2 }] }
  ], 3);
  assert.deepEqual(limited.map(item => item.pendingQty), [2, 1]);
});
