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

test('报单记录展示留存的单价和小计，混合历史记录时提示成本不完整', async () => {
  responses.push(
    Promise.resolve({ content: [
      { id: '1', itemCount: 2, recordedCostAmount: '59.70', missingCostCount: 1 },
      { id: '2', itemCount: 1, recordedCostAmount: '12.30', missingCostCount: 0 },
      { id: '3', itemCount: 1, recordedCostAmount: '0.00', missingCostCount: 1 }
    ], hasNext: false }),
    Promise.resolve([
      { id: '11', status: 'ordered', qty: 3, costPrice: '19.90', costAmount: '59.70' },
      { id: '12', status: 'ordered', qty: 1, costPrice: null, costAmount: null }
    ])
  );
  const page = createPage();
  await page.loadBatches();
  assert.equal(page.data.batchList[0].costSummary, '已记录原报成本 ¥59.70，另 1 条成本未记录');
  assert.equal(page.data.batchList[1].costSummary, '原报成本合计 ¥12.30');
  assert.equal(page.data.batchList[2].costSummary, '成本未记录');
  await page.toggleBatch({ currentTarget: { dataset: { id: '1' } } });
  assert.equal(page.data.batchList[0].detailList[0].costPriceText, '19.90');
  assert.equal(page.data.batchList[0].detailList[0].costAmountText, '59.70');
  assert.equal(page.data.batchList[0].detailList[1].costPriceText, null);
  assert.equal(page.data.batchList[0].detailList[1].costAmountText, null);

  page.updateCancelledOrders(['12']);
  assert.equal(page.data.batchList[0].missingCostCount, 0);
  assert.equal(page.data.batchList[0].costSummary, '原报成本合计 ¥59.70');
});

test('撤销已报记录后同步扣减成本，全部 tab 保留原报金额，零成本仍有记录', () => {
  const page = createPage();
  page.data.batchList = [{ id: '1', itemCount: 3, totalQty: 10, orderedCount: 3, cancelledCount: 0,
    detailList: [
      { id: '11', qty: 3, status: 'ordered', costAmount: '59.70' },
      { id: '12', qty: 7, status: 'ordered', costAmount: '0.70' },
      { id: '13', qty: 1, status: 'ordered', costAmount: '0.00' }
    ] }];
  page.updateCancelledOrders(['11']);
  assert.equal(page.data.batchList[0].recordedCostAmount, '0.70');
  assert.equal(page.data.batchList[0].costSummary, '原报成本合计 ¥0.70');
  page.data.status = 'all';
  page.updateCancelledOrders(['12']);
  assert.equal(page.data.batchList[0].recordedCostAmount, '0.70');
  assert.equal(page.data.batchList[0].detailList[0].status, 'cancelled');
  assert.equal(page.formatBatchCost({ itemCount: 1, recordedCostAmount: '0.00', missingCostCount: 0 }), '原报成本合计 ¥0.00');
});

test('默认记录视角，切换商品视角保留筛选并从第一页汇总，明细也带档口和标签', async () => {
  requests.length = 0;
  const page = createPage();
  assert.equal(page.data.viewMode, 'records');
  page.setData({ selectedStall: '3', selectedTag: '5', appliedKeyword: '棉袄',
    dateRange: { startDate: '2026-10-01', endDate: '2026-10-19' }, page: 4 });
  responses.push(Promise.resolve({ content: [{ skuId: '9007199254740993', totalQty: '10',
    invalidQty: '2', effectiveQty: '8', recordCount: '2', batchCount: '2', recordedCostAmount: '199.00', missingCostCount: '0' }], hasNext: true }),
  Promise.resolve({ content: [], hasNext: false }), Promise.resolve({ content: [{ id: '1' }], hasNext: false }), Promise.resolve([]));
  await page.toggleView();
  assert.equal(page.data.viewMode, 'products');
  assert.match(requests[0], /\/orders\/skus\/query\?status=ordered&page=1&size=20/);
  for (const query of ['stallId=3', 'tagId=5', 'startDate=2026-10-01', 'endDate=2026-10-19']) assert.ok(requests[0].includes(query));
  assert.equal(page.data.skuList[0].effectiveQty, '8');
  assert.equal(page.data.skuList[0].costSummary, '原报成本合计 ¥199.00');
  await page.loadBatches(false);
  assert.match(requests[1], /page=2/);
  await page.toggleView();
  assert.equal(page.data.viewMode, 'records');
  assert.match(requests[2], /\/orders\/batches\/query\?.*page=1/);
  await page.toggleBatch({ currentTarget: { dataset: { id: '1' } } });
  assert.match(requests[3], /stallId=3&tagId=5/);
});

test('商品弹窗按精确 SKU 分页查询关联批次，查看全部可收起且不重复当前记录', async () => {
  requests.length = 0;
  const page = createPage();
  page.setData({ viewMode: 'products', skuList: [{ skuId: '9007199254740993', productName: '棉袄' }],
    selectedStall: '3', selectedTag: '5', appliedKeyword: '棉袄' });
  responses.push(Promise.resolve({ content: [{ id: '7', totalQty: 2 }], hasNext: true }),
    Promise.resolve([{ id: '11', skuId: '9007199254740993', qty: 2, status: 'ordered', costPrice: 10, costAmount: 20 }]),
    Promise.resolve([
      { id: '11', skuId: '9007199254740993', qty: 2, status: 'ordered' },
      { id: '12', skuId: '66', qty: 4, status: 'cancelled' },
      { id: '13', skuId: '9007199254740993', qty: 1, status: 'cancelled' }
    ]), Promise.resolve({ content: [{ id: '8' }], hasNext: false }));
  await page.openSkuRecords({ currentTarget: { dataset: { skuId: '9007199254740993' } } });
  assert.match(requests[0], /skuId=9007199254740993/);
  assert.equal(page.data.relatedBatches[0].expanded, false);
  const event = { currentTarget: { dataset: { id: '7' } } };
  await page.toggleRelatedBatch(event);
  assert.match(requests[1], /status=ordered.*stallId=3&tagId=5&skuId=9007199254740993/);
  assert.equal(page.data.relatedBatches[0].detailList[0].costAmountText, '20.00');
  await page.toggleAllSkuRecords(event);
  assert.equal(requests[2], '/picking-list/orders/batches/7/items?status=all');
  assert.equal(page.data.relatedBatches[0].showAll, true);
  assert.deepEqual(page.data.relatedBatches[0].extraItems.map(item => item.id), ['12', '13']);
  await page.toggleAllSkuRecords(event);
  assert.equal(page.data.relatedBatches[0].showAll, false);
  assert.equal(page.data.relatedBatches[0].detailList.length, 1);
  await page.toggleAllSkuRecords(event);
  assert.equal(requests.length, 3, '重新展开使用当前批次缓存');
  await page.toggleRelatedBatch(event);
  await page.toggleRelatedBatch(event);
  assert.equal(page.data.relatedBatches[0].showAll, false, '重新打开批次默认只展示当前 SKU');
  await page.loadRelatedBatches();
  assert.match(requests[3], /page=2.*skuId=9007199254740993/);
  assert.deepEqual(page.data.relatedBatches.map(item => item.id), ['7', '8']);
});

test('快速切换视角和关闭商品弹窗后忽略过期响应', async () => {
  const page = createPage();
  let finishRecords;
  let finishModal;
  responses.push(new Promise(resolve => { finishRecords = resolve; }),
    Promise.resolve({ content: [{ skuId: '1' }], hasNext: false }),
    new Promise(resolve => { finishModal = resolve; }));
  const oldRequest = page.loadBatches();
  await Promise.resolve();
  await page.toggleView();
  finishRecords({ content: [{ id: 'old' }], hasNext: true });
  await oldRequest;
  assert.deepEqual(page.data.batchList, []);
  assert.equal(page.data.hasMore, false);
  const modalRequest = page.openSkuRecords({ currentTarget: { dataset: { skuId: '1' } } });
  page.closeSkuRecords();
  finishModal({ content: [{ id: 'old-modal' }], hasNext: true });
  await modalRequest;
  assert.equal(page.data.showSkuRecords, false);
  assert.deepEqual(page.data.relatedBatches, []);
});

test('弹窗全部明细失败可重试，收起后仍保留当前 SKU', async () => {
  const page = createPage();
  page.data.skuList = [{ skuId: '1' }];
  responses.push(Promise.resolve({ content: [{ id: '7' }], hasNext: false }),
    Promise.resolve([{ id: '11', skuId: '1', status: 'ordered' }]), Promise.reject(new Error('网络异常')),
    Promise.resolve([{ id: '11', skuId: '1' }, { id: '12', skuId: '2' }]));
  await page.openSkuRecords({ currentTarget: { dataset: { skuId: '1' } } });
  const event = { currentTarget: { dataset: { id: '7' } } };
  await page.toggleRelatedBatch(event);
  await page.toggleAllSkuRecords(event);
  assert.equal(page.data.relatedBatches[0].allLoaded, false);
  assert.ok(page.data.relatedBatches[0].allError);
  await page.retryRelatedDetails({ currentTarget: { dataset: { id: '7', all: true } } });
  assert.equal(page.data.relatedBatches[0].allLoaded, true);
  assert.equal(page.data.relatedBatches[0].extraItems[0].id, '12');
  await page.toggleAllSkuRecords(event);
  assert.equal(page.data.relatedBatches[0].showAll, false);
  assert.equal(page.data.relatedBatches[0].detailList[0].id, '11');
});
