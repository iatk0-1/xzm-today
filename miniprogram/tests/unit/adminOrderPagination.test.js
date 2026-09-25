const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
global.Page = config => { pageConfig = config; };
global.wx = {
  showToast() {},
  stopPullDownRefresh() { this.refreshStopped = true; }
};

const requests = [];
let pages = [];
const productRequests = [];
let productPages = [];
let logisticsAccounts = [];
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) {
    return {
      get: async (url, params) => {
        if (url === '/shipments/pending-items/query') {
          requests.push({ url, params });
          return pages.shift();
        }
        if (url === '/products/query') {
          productRequests.push(params);
          return productPages.shift();
        }
        if (url === '/logistics/bound-accounts') return logisticsAccounts;
        return [];
      }
    };
  }
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  if (request.endsWith('utils/clipboard')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminOrder/adminOrder.js');
Module._load = originalLoad;

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  return page;
}

function item(orderId, orderItemId, date) {
  return {
    orderId, orderItemId, skuId: orderItemId, orderNo: `O-${orderId}`,
    orderCreatedAt: date, productName: '测试商品', totalQty: 1,
    shippedQty: 0, unshippedQty: 1
  };
}

test('分页追加时合并跨页订单，触底继续请求下一页', { concurrency: false }, async () => {
  requests.length = 0;
  pages = [
    { content: [item('10', '101', '2026-09-01T08:00:00+08:00')], hasNext: true },
    { content: [item('10', '102', '2026-09-01T08:00:00+08:00')], hasNext: false }
  ];
  const page = createPage();
  await page.loadAllPendingItems();
  await page.loadNextPendingPage();

  assert.deepEqual(requests.map(request => request.params.page), [1, 2]);
  assert.equal(page.data.orderGroups.length, 1);
  assert.equal(page.data.orderGroups[0].items.length, 2);
  assert.equal(page.data.hasMore, false);
});

test('全选逐页补齐剩余订单并按下单时间排列待发货列表', { concurrency: false }, async () => {
  requests.length = 0;
  pages = [
    { content: [item('10', '101', '2026-09-01T08:00:00+08:00')], hasNext: true },
    { content: [item('10', '102', '2026-09-01T08:00:00+08:00'),
      item('20', '201', '2026-09-02T08:00:00+08:00')], hasNext: false }
  ];
  const page = createPage();
  await page.loadAllPendingItems();
  await page.toggleSelectAll();

  assert.deepEqual(requests.map(request => request.params.page), [1, 2]);
  assert.equal(page.data.orderGroups.length, 2);
  assert.equal(page.data.pendingShipItems.length, 3);
  assert.deepEqual(page.data.pendingOrderGroups.map(group => group.orderId), ['10', '20']);
  assert.equal(page.data.allSelected, true);
});

test('下拉刷新保留筛选条件并从第一页重新查询', { concurrency: false }, async () => {
  requests.length = 0;
  pages = [
    { content: [item('10', '101', '2026-09-01T08:00:00+08:00')], hasNext: true },
    { content: [item('20', '201', '2026-09-02T08:00:00+08:00')], hasNext: false },
    { content: [item('30', '301', '2026-09-03T08:00:00+08:00')], hasNext: false }
  ];
  const page = createPage();
  page.data.selectedTag = '5';
  await page.loadAllPendingItems();
  await page.loadNextPendingPage();
  wx.refreshStopped = false;
  await page.onPullDownRefresh();

  assert.deepEqual(requests.map(request => request.params.page), [1, 2, 1]);
  assert.ok(requests.every(request => request.params.tagId === '5'));
  assert.deepEqual(page.data.orderGroups.map(group => group.orderId), ['30']);
  assert.equal(wx.refreshStopped, true);
});

test('搜索弹窗触底加载下一页并保留已有商品', { concurrency: false }, async () => {
  productRequests.length = 0;
  productPages = [
    { content: [{ id: 1, name: '羊毛衫' }], hasNext: true },
    { content: [{ id: 2, name: '羊毛裤' }], hasNext: false }
  ];
  const page = createPage();
  page.data.searchKeyword = '羊毛';
  await page.searchProducts();
  await page.loadMoreSearchProducts();
  await page.loadMoreSearchProducts();

  assert.deepEqual(productRequests.map(params => params.page), [1, 2]);
  assert.deepEqual(page.data.searchDropdown.map(product => product.id), [1, 2]);
  assert.equal(page.data.searchHasMore, false);
});

test('刷新物流账号时保留当前快递，即使账号顺序改变', { concurrency: false }, async () => {
  const first = { bizId: 'a', deliveryId: 'A', deliveryName: '甲快递' };
  const chosen = { bizId: 'b', deliveryId: 'B', deliveryName: '乙快递' };
  const page = createPage();
  page.data.logisticsAccounts = [first, chosen];
  page.data.logisticsIndex = 1;
  logisticsAccounts = [{ ...chosen, quotaNum: 12 }, first];

  await page.loadLogisticsAccounts();

  assert.equal(page.data.logisticsIndex, 0);
  assert.equal(page.data.logisticsAccounts[page.data.logisticsIndex].bizId, 'b');
  assert.equal(page.data.logisticsAccounts[page.data.logisticsIndex].quotaNum, 12);
});

test('发货前校验逐页查询，跨页找到已选订单项', { concurrency: false }, async () => {
  requests.length = 0;
  pages = [
    { content: [item('10', '101', '2026-09-01T08:00:00+08:00')], hasNext: true },
    { content: [item('20', '201', '2026-09-02T08:00:00+08:00')], hasNext: false }
  ];
  const page = createPage();
  page.data.pendingShipItems = [{
    ...item('20', '201', '2026-09-02T08:00:00+08:00'),
    uniqueKey: '20_201_201', canShip: true, shipQty: 1
  }];
  await page.refreshPendingShipItems();

  assert.deepEqual(requests.map(request => request.params.page), [1, 2]);
  assert.equal(page.data.pendingShipItems[0].canShip, true);
  assert.equal(page.data.pendingShipItems[0].shipQty, 1);
});
