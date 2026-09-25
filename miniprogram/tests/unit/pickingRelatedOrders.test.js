const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
const requests = [];
global.Page = value => { config = value; };
global.wx = { showLoading() {}, hideLoading() {}, showToast() {} };
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {
    get: async (url, params) => {
      requests.push({ url, params });
      return { content: [{
        order: { id: '100', outTradeNo: 'O100', status: 'stocking', items: [] },
        pendingQty: 2, orderedQty: 1
      }], totalElements: 1 };
    }
  };
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  if (request.endsWith('utils/clipboard')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminOrderManage/adminOrderManage.js');
Module._load = originalLoad;

test('拣货关联模式按 SKU 和当前 tab 查询并展示关联数量', async () => {
  const page = Object.assign({}, config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.setData = values => Object.assign(page.data, values);
  page.data.pickingSkuId = '9';
  page.data.pickingStatus = 'ordered';
  await page.loadOrders();
  assert.equal(requests[0].url, '/picking-list/skus/9/orders/query');
  assert.deepEqual(requests[0].params, { status: 'ordered', page: 1, size: 20 });
  assert.equal(page.data.orders[0].pickingOrderedQty, 1);
  assert.equal(page.data.orders[0].id, '100');
});
