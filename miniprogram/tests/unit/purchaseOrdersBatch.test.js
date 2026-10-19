const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
global.Page = config => { pageConfig = config; };
global.wx = { showToast() {}, showModal() {}, showLoading() {}, hideLoading() {} };

const requests = [];
const responses = [];
const purchaseWrites = [];
let submitPurchase = async () => {};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) {
    return { get: url => {
      requests.push(url);
      return responses.shift();
    } };
  }
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  if (request.endsWith('utils/quantityOperation')) return { run: async (api, path, payload) => {
    purchaseWrites.push({ path, payload });
    return submitPurchase();
  } };
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

test('商品视角默认0件，跨页保留已选数量，全选补齐零数量且仅选择可报单SKU', async () => {
  const page = createPage();
  page.data.viewMode = 'products';
  responses.push(Promise.resolve({ content: [{ skuId: '1', canPurchase: true }], hasNext: true }),
    Promise.resolve({ content: [{ skuId: '2', canPurchase: true }, { skuId: '3', canPurchase: false }], hasNext: false }));
  await page.loadSkus();
  assert.equal(page.data.skuList[0].purchaseQty, 0);
  page.togglePurchaseSelect({ currentTarget: { dataset: { skuId: '1' } } });
  assert.equal(page.data.skuList[0].purchaseQty, 1);
  page.setPurchaseQty('1', '8');
  await page.loadSkus(false);
  assert.equal(page.data.skuList[0].purchaseQty, '8');
  assert.equal(page.data.purchaseSelectedCount, 1);
  assert.equal(page.data.purchaseAllSelected, false);
  page.togglePurchaseSelectAll();
  assert.equal(page.data.purchaseSelectedCount, 2);
  assert.equal(page.data.purchaseTotalQty, 9);
  assert.equal(page.data.skuList[2].purchaseSelected, false);
  page.togglePurchaseSelectAll();
  assert.equal(page.data.purchaseSelectedCount, 0);
  assert.equal(page.data.purchaseTotalQty, 0);
});

test('追加报单按当前成本合计并提示缺失条数，弹窗修改同步回卡片且不受历史数量限制', () => {
  const page = createPage();
  page.data.skuList = [
    { skuId: '1', totalQty: 2, purchaseSelected: true, purchaseQty: 12, costPrice: '19.90', recordedCostAmount: 999 },
    { skuId: '2', totalQty: 3, purchaseSelected: true, purchaseQty: 3, costPrice: null }
  ];
  page.updatePurchaseSelection();
  page.openPurchaseModal();
  assert.equal(page.data.showPurchaseModal, true);
  assert.equal(page.data.purchaseCost, '238.80');
  assert.equal(page.data.purchaseMissingCost, 1);
  page.adjustPurchaseQty({ currentTarget: { dataset: { skuId: '1', delta: 1, preview: true } } });
  assert.equal(page.data.purchaseCost, '258.70');
  assert.equal(page.data.skuList[0].purchaseQty, 13);
  assert.equal(page.data.purchaseTotalQty, 16);
  page.onPurchaseQtyInput({ currentTarget: { dataset: { skuId: '2', preview: true } }, detail: { value: '' } });
  page.normalizePurchaseQty({ currentTarget: { dataset: { skuId: '2', preview: true } } });
  assert.equal(page.data.purchasePreview[1].purchaseQty, 0);
  assert.equal(page.data.purchaseTotalQty, 13);
  assert.equal(page.data.purchasePreviewCount, 1);
  assert.equal(page.data.purchaseMissingCost, 0);
  page.closePurchaseModal();
  assert.equal(page.data.skuList[0].purchaseQty, 13);
});

test('确认追加只提交选中SKU和本次数量，强制stock，提交中拦住重复操作，成功后刷新', async () => {
  const page = createPage();
  purchaseWrites.length = 0;
  page.data.viewMode = 'products';
  page.data.status = 'cancelled';
  page.data.selectedStall = '3';
  page.data.skuList = [
    { skuId: '9007199254740993', purchaseSelected: true, purchaseQty: '20', totalQty: 2, costPrice: 10 },
    { skuId: '2', purchaseSelected: false, purchaseQty: 9 }
  ];
  page.updatePurchaseSelection();
  page.openPurchaseModal();
  let finish;
  submitPurchase = () => new Promise(resolve => { finish = resolve; });
  responses.push(Promise.resolve({ content: [{ skuId: '9007199254740993', totalQty: 2 }], hasNext: false }));
  const sending = page.confirmPurchase();
  await page.confirmPurchase();
  page.setPurchaseQty('9007199254740993', 999, true);
  page.closePurchaseModal();
  assert.equal(page.data.showPurchaseModal, true);
  assert.equal(page.data.purchaseBusy, true);
  assert.equal(page.data.purchasePreview[0].purchaseQty, '20');
  assert.equal(purchaseWrites.length, 1);
  assert.equal(purchaseWrites[0].path, '/picking-list/order');
  assert.equal(purchaseWrites[0].payload.purpose, 'stock');
  assert.equal(purchaseWrites[0].payload.items.length, 1);
  assert.equal(purchaseWrites[0].payload.items[0].skuId, '9007199254740993');
  assert.equal(purchaseWrites[0].payload.items[0].qty, 20);
  finish();
  await sending;
  assert.equal(page.data.showPurchaseModal, false);
  assert.equal(page.data.purchaseBusy, false);
  assert.equal(page.data.purchaseSelectedCount, 0);
  assert.equal(page.data.skuList[0].purchaseQty, 0);
  assert.equal(page.data.selectedStall, '3');
  assert.equal(page.data.status, 'cancelled');
  submitPurchase = async () => {};
});

test('追加报单失败保留选中数量和弹窗，非法数量不提交', async () => {
  const page = createPage();
  purchaseWrites.length = 0;
  page.data.skuList = [{ skuId: '1', purchaseSelected: true, purchaseQty: 4, costPrice: 10 }];
  page.updatePurchaseSelection();
  page.openPurchaseModal();
  submitPurchase = async () => { throw new Error('网络失败'); };
  await page.confirmPurchase();
  assert.equal(page.data.showPurchaseModal, true);
  assert.equal(page.data.skuList[0].purchaseSelected, true);
  assert.equal(page.data.purchasePreview[0].purchaseQty, 4);
  assert.equal(page.data.purchaseBusy, false);
  for (const qty of ['0', '-1', '1.5', '1件', '2147483648', '']) {
    page.setPurchaseQty('1', qty, true);
    await page.confirmPurchase();
  }
  assert.equal(purchaseWrites.length, 1);
  submitPurchase = async () => {};
});

test('追加弹窗编辑返回使用最新成本但保留数量，历史成本汇总不被改写', async () => {
  const page = createPage();
  page.data.skuList = [{ skuId: '1', productId: '101', purchaseSelected: true, purchaseQty: 5,
    costPrice: null, recordedCostAmount: 88.88, costSummary: '原报成本合计 ¥88.88' }];
  page.updatePurchaseSelection();
  page.openPurchaseModal();
  page._purchaseEditedProduct = '101';
  responses.push(Promise.resolve({ product: { name: '更新名称', coverUrl: 'https://example.com/new.jpg' },
    costPrice: 20, skus: [{ id: '1', spec: '红', size: 'M', costPrice: 12.5 }] }));
  await page.onShow();
  assert.equal(page.data.purchaseCost, '62.50');
  assert.equal(page.data.purchaseMissingCost, 0);
  assert.equal(page.data.purchasePreview[0].purchaseQty, 5);
  assert.equal(page.data.purchasePreview[0].productName, '更新名称');
  assert.equal(page.data.skuList[0].costSummary, '原报成本合计 ¥88.88');
  assert.equal(page.data.skuList[0].recordedCostAmount, 88.88);
});

test('商品视角跨筛选累计待报单，弹窗包含隐藏商品并保留修改数量，切回不重复添加', async () => {
  const page = createPage();
  page.data.viewMode = 'products';
  page.data.skuList = [{ skuId: '1', purchaseSelected: true, purchaseQty: 8 }];
  page.updatePurchaseSelection();
  responses.push(Promise.resolve({ content: [{ skuId: '2' }], hasNext: false }));
  await page.selectTag({ currentTarget: { dataset: { tag: '10' } } });
  assert.equal(page.data.purchaseSelectedCount, 1);
  assert.equal(page.data.purchaseTotalQty, 8);
  assert.equal(page.data.purchaseAllSelected, false);
  assert.equal(page.data.skuList[0].skuId, '2');
  assert.equal(page.data.skuList[0].purchaseQty, 0);
  assert.equal(page.data.skuList[0].purchaseSelected, false);
  page.setPurchaseQty('2', '3');
  assert.equal(page.data.purchaseSelectedCount, 2);
  assert.equal(page.data.purchaseTotalQty, 11);
  page.openPurchaseModal();
  assert.deepEqual(page.data.purchasePreview.map(item => String(item.skuId)), ['1', '2']);
  page.setPurchaseQty('1', '12', true);
  assert.equal(page.data.purchaseTotalQty, 15);
  page.closePurchaseModal();
  responses.push(Promise.resolve({ content: [{ skuId: '1', costPrice: '10.00' }], hasNext: false }));
  await page.selectTag({ currentTarget: { dataset: { tag: 'all' } } });
  assert.equal(page.data.skuList[0].purchaseSelected, true);
  assert.equal(page.data.skuList[0].purchaseQty, '12');
  assert.equal(page.data.pendingOrderList.length, 2);
  assert.equal(page.data.purchaseAllSelected, true);
  page.togglePurchaseSelectAll();
  assert.deepEqual(page.data.pendingOrderList.map(item => item.skuId), ['2'], '取消全选仅移除当前筛选可见商品');
  assert.equal(page.data.purchaseTotalQty, 3);
});

test('隐藏商品在确认弹窗减到零即移出待报单，再加回可恢复，成功提交清理全部已报SKU', async () => {
  const page = createPage();
  page.data.viewMode = 'products';
  page.data.skuList = [{ skuId: '1', purchaseSelected: true, purchaseQty: 2, costPrice: 10 }];
  page.updatePurchaseSelection();
  responses.push(Promise.resolve({ content: [{ skuId: '2', costPrice: 20 }], hasNext: false }));
  await page.selectStall({ currentTarget: { dataset: { stall: '2' } } });
  page.setPurchaseQty('2', 3);
  page.openPurchaseModal();
  page.setPurchaseQty('1', 0, true);
  assert.deepEqual(page.data.pendingOrderList.map(item => item.skuId), ['2']);
  page.setPurchaseQty('1', 4, true);
  assert.equal(page.data.purchaseSelectedCount, 2);
  assert.equal(page.data.purchaseTotalQty, 7);
  assert.equal(page.data.purchaseCost, '100.00');
  purchaseWrites.length = 0;
  responses.push(Promise.resolve({ content: [], hasNext: false }));
  await page.confirmPurchase();
  assert.deepEqual(purchaseWrites[0].payload.items.map(item => [item.skuId, item.qty]), [['1', 4], ['2', 3]]);
  assert.deepEqual(page.data.pendingOrderList, []);
  assert.equal(page.data.purchaseSelectedCount, 0);
});

test('商品视角待报单跨记录视角、时间和状态筛选保留，空结果仍可报单', async () => {
  const page = createPage();
  page.data.viewMode = 'products';
  page.data.skuList = [{ skuId: '1', purchaseSelected: true, purchaseQty: 5 }];
  page.updatePurchaseSelection();
  responses.push(Promise.resolve({ content: [], hasNext: false }), Promise.resolve({ content: [], hasNext: false }));
  await page.toggleView();
  page.setData({ status: 'all', dateRange: { startDate: '2026-10-01', endDate: '2026-10-19' } });
  await page.toggleView();
  assert.equal(page.data.skuList.length, 0);
  assert.equal(page.data.purchaseSelectedCount, 1);
  assert.equal(page.data.purchaseTotalQty, 5);
  page.openPurchaseModal();
  assert.equal(page.data.purchasePreview[0].skuId, '1');
});

test('加减及手输正整数自动勾选，减到0或输入0取消，不产生负数', () => {
  const page = createPage();
  page.data.skuList = [{ skuId: '1', purchaseQty: 0, purchaseSelected: false }];
  const event = delta => ({ currentTarget: { dataset: { skuId: '1', delta } } });
  page.adjustPurchaseQty(event(-1));
  assert.equal(page.data.skuList[0].purchaseQty, 0);
  assert.equal(page.data.purchaseSelectedCount, 0);
  page.adjustPurchaseQty(event(1));
  assert.equal(page.data.skuList[0].purchaseQty, 1);
  assert.equal(page.data.purchaseSelectedCount, 1);
  assert.equal(page.data.purchaseAllSelected, true);
  page.adjustPurchaseQty(event(-1));
  assert.equal(page.data.skuList[0].purchaseQty, 0);
  assert.equal(page.data.skuList[0].purchaseSelected, false);
  assert.equal(page.data.purchaseTotalQty, 0);
  assert.equal(page.data.purchaseAllSelected, false);
  page.onPurchaseQtyInput({ ...event(), detail: { value: '8' } });
  assert.equal(page.data.skuList[0].purchaseSelected, true);
  assert.equal(page.data.purchaseTotalQty, 8);
  page.togglePurchaseSelect(event());
  assert.equal(page.data.purchaseSelectedCount, 0);
  page.adjustPurchaseQty(event(-1));
  assert.equal(page.data.purchaseTotalQty, 7, '取消勾选后再点减也要自动选中');
  page.onPurchaseQtyInput({ ...event(), detail: { value: '0' } });
  assert.equal(page.data.purchaseSelectedCount, 0);
  page.normalizePurchaseQty(event());
  assert.equal(page.data.skuList[0].purchaseQty, 0, '失焦不回弹到1');
});

test('弹窗零数量不提交，重新加到1可恢复选择及成本合计', async () => {
  const page = createPage();
  purchaseWrites.length = 0;
  page.data.skuList = [
    { skuId: '1', purchaseSelected: true, purchaseQty: 1, costPrice: '10.00' },
    { skuId: '2', purchaseSelected: true, purchaseQty: 2, costPrice: '20.00' }
  ];
  page.updatePurchaseSelection();
  page.openPurchaseModal();
  const event = delta => ({ currentTarget: { dataset: { skuId: '1', delta, preview: true } } });
  page.adjustPurchaseQty(event(-1));
  assert.equal(page.data.skuList[0].purchaseSelected, false);
  assert.equal(page.data.purchasePreviewCount, 1);
  assert.equal(page.data.purchaseCost, '40.00');
  page.adjustPurchaseQty(event(1));
  assert.equal(page.data.skuList[0].purchaseSelected, true);
  assert.equal(page.data.purchasePreviewCount, 2);
  assert.equal(page.data.purchaseCost, '50.00');
  page.adjustPurchaseQty(event(-1));
  responses.push(Promise.resolve({ content: [], hasNext: false }));
  await page.confirmPurchase();
  assert.equal(purchaseWrites.length, 1);
  assert.deepEqual(purchaseWrites[0].payload.items.map(item => [item.skuId, item.qty]), [['2', 2]]);
});
