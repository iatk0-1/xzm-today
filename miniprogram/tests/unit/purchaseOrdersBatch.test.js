const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
global.Page = config => { pageConfig = config; };
global.wx = { showToast() {}, showModal() {}, showLoading() {}, hideLoading() {} };

const requests = [];
const responses = [];
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) {
    return { get: url => {
      requests.push(url);
      return responses.shift();
    } };
  }
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/purchaseOrders/purchaseOrders.js');
Module._load = originalLoad;

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

test('首屏先显示批次，展开后才请求对应商品，并只选择已报单商品', async () => {
  requests.length = 0;
  responses.push(
    Promise.resolve({ content: [{ id: '9007199254740993', createdAt: '2026-09-25T10:00:00+08:00', itemCount: 2, totalQty: 3, orderedCount: 1, cancelledCount: 1 }], hasNext: false }),
    Promise.resolve([
      { id: '1', status: 'ordered', qty: 2 },
      { id: '2', status: 'cancelled', qty: 1 }
    ])
  );
  const page = createPage();
  await page.loadBatches();
  assert.equal(requests.length, 1);
  assert.equal(page.data.batchList.length, 1);
  assert.equal(page.data.detailList.length, 0);

  await page.toggleBatch({ currentTarget: { dataset: { id: '9007199254740993' } } });
  assert.equal(requests.length, 2);
  assert.match(requests[1], /9007199254740993\/items/);
  assert.equal(page.data.detailList.length, 2);
  page.toggleSelectAll();
  assert.equal(page.data.selectedCount, 1);
  assert.deepEqual(page.data.detailList.map(item => item.selected), [true, false]);
});
