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
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  return page;
}

test('撤销单项保留分页和展开状态，仅修改对应批次计数', () => {
  const page = createPage();
  page.data.page = 4;
  page.data.batchList = [{ id: '1', expanded: true, itemCount: 2, totalQty: 7, orderedCount: 2, cancelledCount: 0,
    detailList: [{ id: '11', skuId: '5', qty: 3, status: 'ordered', selected: true },
      { id: '12', skuId: '6', qty: 4, status: 'ordered', selected: true }] }];
  page.updateCancelledOrders(['11']);
  assert.equal(page.data.page, 4);
  assert.equal(page.data.batchList[0].expanded, true);
  assert.equal(page.data.batchList[0].totalQty, 4);
  assert.equal(page.data.batchList[0].itemCount, 1);
  assert.equal(page.data.batchList[0].selectedCount, 1);
  assert.deepEqual(page.data.batchList[0].detailList.map(item => item.id), ['12']);
  page.data.status = 'all';
  page.updateCancelledOrders(['12']);
  assert.equal(page.data.batchList[0].detailList[0].status, 'cancelled');
  assert.equal(page.data.batchList[0].detailList[0].selected, false);
  assert.equal(page.data.batchList[0].cancelledCount, 1);
});

test('批次可同时展开，勾选互不影响，搜索刷新后全部收起', async () => {
  requests.length = 0;
  responses.push(
    Promise.resolve({ content: [
      { id: '9007199254740993', batchNo: '202609250001', createdAt: '2026-09-25T10:00:00+08:00', itemCount: 2, totalQty: 3, orderedCount: 1, cancelledCount: 1 },
      { id: '9007199254740994', batchNo: '202609250002', createdAt: '2026-09-25T11:00:00+08:00', itemCount: 1, totalQty: 4, orderedCount: 1, cancelledCount: 0 }
    ], hasNext: false }),
    Promise.resolve([
      { id: '1', status: 'ordered', qty: 2 },
      { id: '2', status: 'cancelled', qty: 1 }
    ]),
    Promise.resolve([{ id: '3', status: 'ordered', qty: 4 }]),
    Promise.resolve({ content: [
      { id: '9007199254740993', batchNo: '202609250001', createdAt: '2026-09-25T10:00:00+08:00', itemCount: 2, totalQty: 3, orderedCount: 1, cancelledCount: 1 },
      { id: '9007199254740994', batchNo: '202609250002', createdAt: '2026-09-25T11:00:00+08:00', itemCount: 1, totalQty: 4, orderedCount: 1, cancelledCount: 0 }
    ], hasNext: false }),
    Promise.resolve([{ id: '1', status: 'ordered', qty: 2 }, { id: '2', status: 'cancelled', qty: 1 }]),
    Promise.resolve([{ id: '3', status: 'ordered', qty: 4 }]),
    Promise.resolve({ content: [
      { id: '9007199254740993', batchNo: '202609250001', createdAt: '2026-09-25T10:00:00+08:00', itemCount: 2, totalQty: 3, orderedCount: 1, cancelledCount: 1 },
      { id: '9007199254740994', batchNo: '202609250002', createdAt: '2026-09-25T11:00:00+08:00', itemCount: 1, totalQty: 4, orderedCount: 1, cancelledCount: 0 }
    ], hasNext: false })
  );
  const page = createPage();
  await page.loadBatches();
  assert.equal(requests.length, 1);
  assert.equal(page.data.batchList.length, 2);
  assert.equal(page.data.batchList[0].batchNo, '202609250001');
  assert.ok(page.data.batchList.every(batch => !batch.expanded));

  await page.toggleBatch({ currentTarget: { dataset: { id: '9007199254740993' } } });
  assert.equal(requests.length, 2);
  assert.match(requests[1], /9007199254740993\/items/);
  assert.equal(page.data.batchList[0].detailList.length, 2);
  await page.toggleBatch({ currentTarget: { dataset: { id: '9007199254740994' } } });
  assert.ok(page.data.batchList.every(batch => batch.expanded));
  assert.deepEqual(page.data.batchList.map(batch => batch.detailList.length), [2, 1]);

  page.toggleSelectAll({ currentTarget: { dataset: { batchId: '9007199254740993' } } });
  assert.deepEqual(page.data.batchList.map(batch => batch.selectedCount), [1, 0]);
  assert.deepEqual(page.data.batchList[0].detailList.map(item => item.selected), [true, false]);

  page.toggleBatch({ currentTarget: { dataset: { id: '9007199254740993' } } });
  assert.deepEqual(page.data.batchList.map(batch => batch.expanded), [false, true]);
  await page.toggleBatch({ currentTarget: { dataset: { id: '9007199254740993' } } });
  assert.equal(requests.length, 3);
  assert.deepEqual(page.data.batchList.map(batch => batch.expanded), [true, true]);
  assert.equal(page.data.batchList[0].selectedCount, 1);

  await page.loadBatches();
  await Promise.resolve();
  assert.ok(page.data.batchList.every(batch => batch.expanded));
  await page.search();
  assert.ok(page.data.batchList.every(batch => !batch.expanded));
  assert.ok(page.data.batchList.every(batch => batch.detailList.length === 0));
});

test('列表触底加载期间停在底部可接着翻页，列表下拉刷新重新查询第一页', async () => {
  requests.length = 0;
  let listBottom = 1200;
  wx.createSelectorQuery = () => {
    const query = {
      select() { return this; },
      boundingClientRect() { return this; },
      exec(callback) { callback([{ bottom: listBottom }, { bottom: 700 }]); }
    };
    return query;
  };

  let finishSecondPage;
  let finishRefresh;
  responses.push(
    Promise.resolve({ content: [{ id: '1', createdAt: '2026-09-25T10:00:00+08:00' }], hasNext: true }),
    new Promise(resolve => { finishSecondPage = resolve; }),
    Promise.resolve({ content: [{ id: '3', createdAt: '2026-09-25T10:02:00+08:00' }], hasNext: false }),
    new Promise(resolve => { finishRefresh = resolve; })
  );

  const page = createPage();
  await page.loadBatches();
  assert.equal(requests.length, 1);
  page.onListScrollToLower();
  await Promise.resolve();
  assert.match(requests[1], /page=2/);
  page.onListScrollToLower();
  assert.equal(requests.length, 2);

  listBottom = 750;
  finishSecondPage({ content: [{ id: '2', createdAt: '2026-09-25T10:01:00+08:00' }], hasNext: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(requests[2], /page=3/);
  assert.deepEqual(page.data.batchList.map(batch => batch.id), ['1', '2', '3']);

  const refreshing = page.onListPullDownRefresh();
  assert.equal(page.data.refreshing, true);
  await Promise.resolve();
  assert.match(requests[3], /page=1/);
  finishRefresh({ content: [{ id: '4', createdAt: '2026-09-25T10:03:00+08:00' }], hasNext: false });
  await refreshing;
  assert.deepEqual(page.data.batchList.map(batch => batch.id), ['4']);
  assert.equal(page.data.refreshing, false);
  delete wx.createSelectorQuery;
});

test('时间范围取消不生效，确认后筛选批次且翻页沿用日期，清除后恢复', async () => {
  requests.length = 0;
  responses.push(
    Promise.resolve({ content: [], hasNext: true }),
    Promise.resolve({ content: [], hasNext: false }),
    Promise.resolve({ content: [], hasNext: false })
  );
  const page = createPage();
  page.showDateRangeSelector();
  page.onStartDateChange({ detail: { value: '2026-09-01' } });
  page.onEndDateChange({ detail: { value: '2026-09-25' } });
  page.closeDateModal();
  assert.deepEqual(page.data.dateRange, { startDate: '', endDate: '', quickSelect: '' });

  page.showDateRangeSelector();
  page.onStartDateChange({ detail: { value: '2026-09-01' } });
  page.onEndDateChange({ detail: { value: '2026-09-25' } });
  await page.confirmDateRange();
  assert.match(requests[0], /page=1.*startDate=2026-09-01&endDate=2026-09-25/);
  await page.loadBatches(false);
  assert.match(requests[1], /page=2.*startDate=2026-09-01&endDate=2026-09-25/);

  await page.clearDateRange();
  assert.match(requests[2], /page=1/);
  assert.doesNotMatch(requests[2], /startDate|endDate/);
});
