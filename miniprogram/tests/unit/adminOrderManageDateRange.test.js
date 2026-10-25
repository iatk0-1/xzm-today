const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
const pendingRequests = [];
const api = { get: (url, params) => new Promise(resolve => pendingRequests.push({ url, params, resolve })) };
global.Page = config => { pageConfig = config; };
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return api;
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  if (request.endsWith('utils/clipboard')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminOrderManage/adminOrderManage.js');
Module._load = originalLoad;

test('订单管理最近 1 天为当天，确认后按日期重查首屏', () => {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = patch => {
    for (const [key, value] of Object.entries(patch)) {
      if (key.startsWith('dateRange.')) page.data.dateRange[key.slice('dateRange.'.length)] = value;
      else page.data[key] = value;
    }
  };
  const loads = [];
  page.loadOrders = () => loads.push({ ...page.data.dateRange });
  page.selectDateRange({ currentTarget: { dataset: { type: '1day' } } });
  const today = page.formatDate(new Date());
  assert.equal(page.data.dateRange.startDate, today);
  assert.equal(page.data.dateRange.endDate, today);
  assert.equal(page.data.dateRange.quickSelect, '1day');
  page.confirmDateRange();
  assert.equal(loads.length, 1);
  assert.equal(loads[0].startDate, today);
});

test('时间按钮默认倒序，重复点击切换方向，换时间类型恢复倒序并保留日期', () => {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.data.dateRange = { startDate: '2026-10-01', endDate: '2026-10-10', quickSelect: '' };
  page.setData = patch => Object.assign(page.data, patch);
  const loads = [];
  page.loadOrders = () => loads.push([page.data.timeType, page.data.sortDirection]);
  assert.equal(page.data.sortDirection, 'desc');
  page.switchTimeType({ currentTarget: { dataset: { type: 'shipped' } } });
  assert.equal(page.data.timeType, 'shipped');
  assert.equal(page.data.dateRange.startDate, '2026-10-01');
  page.switchTimeType({ currentTarget: { dataset: { type: 'shipped' } } });
  assert.equal(page.data.sortDirection, 'asc');
  page.switchTimeType({ currentTarget: { dataset: { type: 'shipped' } } });
  assert.equal(page.data.sortDirection, 'desc');
  page.switchTimeType({ currentTarget: { dataset: { type: 'created' } } });
  assert.deepEqual(loads, [['shipped', 'desc'], ['shipped', 'asc'], ['shipped', 'desc'], ['created', 'desc']]);
});

test('切换时间类型发送对应筛选参数，旧请求后返回不会覆盖新排序', async () => {
  global.wx = { showLoading() {}, hideLoading() {}, showToast() {} };
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = patch => Object.assign(page.data, patch);
  const first = page.loadOrders();
  await new Promise(resolve => setImmediate(resolve));
  const oldRequest = pendingRequests.shift();
  assert.equal(oldRequest.params.timeType, 'created');
  assert.equal(oldRequest.params.sortDirection, 'desc');
  page.data.timeType = 'shipped';
  page.data.sortDirection = 'asc';
  page.data.dateRange.startDate = '2026-10-01';
  const second = page.loadOrders();
  await new Promise(resolve => setImmediate(resolve));
  const newRequest = pendingRequests.shift();
  assert.equal(newRequest.params.timeType, 'shipped');
  assert.equal(newRequest.params.sortDirection, 'asc');
  assert.equal(newRequest.params.startDate, '2026-10-01');
  assert.equal(newRequest.params.page, 1);
  newRequest.resolve({ content: [{ id: 'new', latestShippedAt: '2026-10-15T10:00:00+08:00' }], totalElements: 1 });
  await second;
  oldRequest.resolve({ content: [{ id: 'old' }], totalElements: 1 });
  await first;
  assert.equal(page.data.orders[0].id, 'new');
  assert.ok(page.data.orders[0].latestShippedAtDisplay);
});

test('订单列表初次加载和拣货入口刷新都保留SKU图，SKU无图才用商品图', async () => {
  global.wx = { showLoading() {}, hideLoading() {}, showToast() {} };
  const page = { ...pageConfig, data: structuredClone(pageConfig.data),
    setData(patch) { Object.assign(this.data, patch); } };
  const loading = page.loadOrders();
  await new Promise(resolve => setImmediate(resolve));
  pendingRequests.shift().resolve({ content: [{ id: '123', items: [
    { skuImageUrl: '/red.jpg', productImage: '/cover.jpg' }, { skuImageUrl: null, productImage: '/fallback.jpg' }
  ] }], totalElements: 1 });
  await loading;
  assert.equal(page.data.orders[0].items[0].skuImageUrl, '/red.jpg');
  assert.equal(page.data.orders[0].items[1].skuImageUrl, '/fallback.jpg');
  page.data.pickingSkuId = 'sku';
  const refreshing = page.refreshOrder('123');
  await new Promise(resolve => setImmediate(resolve));
  pendingRequests.shift().resolve({ order: { id: '123', items: [{ skuImageUrl: '/blue.jpg', productImage: '/cover.jpg' }] } });
  await refreshing;
  assert.equal(page.data.orders[0].items[0].skuImageUrl, '/blue.jpg');
});
