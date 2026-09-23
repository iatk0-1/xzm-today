const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig = null;
let requestHandler = async () => [];
const requestLog = [];

global.Page = (config) => { pageConfig = config; };
global.wx = {
  showToast() {},
  stopPullDownRefresh() {}
};

const originalLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request.endsWith('utils/api')) {
    return {
      get: async (url, params) => {
        requestLog.push({ url, params });
        return requestHandler(url, params);
      },
      post: async () => ({})
    };
  }
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  if (request.endsWith('utils/clipboard')) return { copyText() {}, copyRecipient() {} };
  return originalLoad.call(this, request, ...rest);
};

require('../../pages/adminChangeRequestManage/adminChangeRequestManage.js');

function createRequest(id) {
  return {
    request: {
      id: String(id),
      orderId: String(id),
      requestType: 'item_remark',
      status: 'pending',
      itemRemarks: []
    },
    orderStatus: 'paid',
    outTradeNo: String(id),
    orderItems: [{
      id: String(id),
      productName: '测试商品',
      productImage: '/images/test.jpg',
      skuSpec: '图片色',
      skuSize: '均码',
      qty: 1,
      remark: ''
    }]
  };
}

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch) => {
    Object.keys(patch).forEach((key) => { page.data[key] = patch[key]; });
  };
  return page;
}

nodeTest('申请审批列表触底时请求下一页并追加数据', async () => {
  requestLog.length = 0;
  const firstPage = Array.from({ length: 20 }, (_, index) => createRequest(index + 1));
  requestHandler = async (url, params) => {
    assert.equal(url, '/admin/orders-manage/change-requests');
    return params.page === 1 ? firstPage : [createRequest(21)];
  };

  const page = createPage();
  await page.loadRequests(true);
  assert.equal(page.data.requests.length, 20);
  assert.equal(page.data.page, 1);
  assert.equal(page.data.hasMore, true);

  await page.onScrollToLower();
  assert.deepEqual(requestLog.map(item => item.params.page), [1, 2]);
  assert.equal(page.data.requests.length, 21);
  assert.equal(page.data.requests[20].orderId, '21');
  assert.equal(page.data.page, 2);
  assert.equal(page.data.hasMore, false);
});
