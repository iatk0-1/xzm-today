const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig = null;
global.Page = (config) => { pageConfig = config; };

global.wx = {
  showToast() {},
  stopPullDownRefresh() {}
};

const requestLog = [];
const responses = [];
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request.endsWith('utils/api')) {
    return {
      get: async (url, params) => {
        requestLog.push({ url, params });
        return responses.shift();
      }
    };
  }
  if (request.endsWith('utils/auth')) {
    return { ensureAuthenticated: async () => {} };
  }
  if (request.endsWith('utils/clipboard')) {
    return { copyText() {} };
  }
  return originalLoad.call(this, request, ...rest);
};

require('../../pages/adminAfterSaleList/adminAfterSaleList.js');

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch, callback) => {
    Object.keys(patch).forEach((key) => { page.data[key] = patch[key]; });
    if (callback) callback();
  };
  return page;
}

test('售后列表触底加载时请求下一页，而不是重复请求第一页', { concurrency: false }, async () => {
  requestLog.length = 0;
  responses.push(
    { page: 1, total: 3, items: [{ id: 1 }] },
    { page: 2, total: 3, items: [{ id: 2 }] }
  );

  const page = createPage();
  await page.loadAfterSales(true);
  await page.loadAfterSales(false);

  assert.deepEqual(requestLog.map((request) => request.params.page), [1, 2]);
  assert.equal(page.data.page, 2);
  assert.deepEqual(page.data.afterSales.map((item) => item.id), [1, 2]);
});

test('售后列表格式化订单状态、售后申请时间和下单时间', { concurrency: false }, async () => {
  requestLog.length = 0;
  responses.push({
    page: 1,
    total: 1,
    items: [{
      id: 1,
      status: 'pending',
      orderStatus: 'shipped',
      createdAt: '2026-09-22T10:20:30+08:00',
      orderCreatedAt: '2026-09-20T08:09:10+08:00'
    }]
  });

  const page = createPage();
  await page.loadAfterSales(true);

  assert.equal(page.data.afterSales[0].orderStatusDisplay, '已发货');
  assert.equal(page.data.afterSales[0].createdAtDisplay, '2026-09-22 10:20:30');
  assert.equal(page.data.afterSales[0].orderCreatedAtDisplay, '2026-09-20 08:09:10');
});

test('切换售后状态 Tab 时传递对应的后端状态参数', { concurrency: false }, () => {
  const page = createPage();
  const statuses = [];
  page.loadAfterSales = () => statuses.push(page.data.currentStatus);

  for (const tab of ['全部', '待审核', '已同意', '已拒绝', '已收货', '已退款', '已取消']) {
    page.switchTab({ currentTarget: { dataset: { tab } } });
  }

  assert.deepEqual(statuses, [null, 'pending', 'approved', 'rejected', 'received', 'refunded', 'cancelled']);
});

test('搜索售后订单号时把关键词传给列表接口', { concurrency: false }, async () => {
  requestLog.length = 0;
  responses.push({ page: 1, total: 0, items: [] });

  const page = createPage();
  page.data.searchKeyword = '  ORDER-1001  ';
  page.doSearch();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requestLog[0].params.keyword, 'ORDER-1001');
});
