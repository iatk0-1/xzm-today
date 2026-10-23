const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const inventory = require('../../utils/inventoryOperations');
function load(name, options = {}) {
  let config;
  const requests = [], writes = [], toasts = [], navigation = [], emitted = [], titles = [];
  const channel = { on() {}, emit: (...args) => emitted.push(args) };
  const wx = { showToast: value => toasts.push(value.title), setNavigationBarTitle: value => titles.push(value.title),
    navigateTo: value => navigation.push(value), navigateBack: () => navigation.push('back'), stopPullDownRefresh() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages', name, name + '.js'), 'utf8'), {
    console, wx, Page: value => { config = value; },
    require: module => {
      if (module.endsWith('/api')) return {
        get: async (route, query) => { requests.push({ route, query }); return options.get ? options.get(route, query) : {}; },
        post: async (route, payload) => { requests.push({ route, payload }); return options.post ? options.post(route, payload) : {}; }
      };
      if (module.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (module.endsWith('/quantityOperation')) return { pending: () => null, run: async (api, route, payload) => { writes.push({ route, payload }); if (options.write) return options.write(route, payload); } };
      if (module.endsWith('/autoSearch')) return { wrap: value => value };
      if (module.endsWith('/error')) return { getErrorMessage: (err, fallback) => err.message || fallback };
      if (module.endsWith('/pageSync')) return { publish() {} };
      return require(path.resolve(__dirname, '../../pages', name, module));
    }
  });
  const page = { ...config, data: JSON.parse(JSON.stringify(config.data)), getOpenerEventChannel: () => channel };
  page.setData = patch => Object.assign(page.data, patch);
  return { page, requests, writes, toasts, navigation, emitted, titles };
}
const event = dataset => ({ currentTarget: { dataset } });
function detail() { return { product: { id: '9007199254740993', name: '外套', coverUrl: '/coat.png' }, skus: [
  { skuId: '9007199254740995', spec: '红', size: 'M', qty: 5, readyToShipQty: 2, shortageQty: 3, abnormalQty: 2 },
  { skuId: '9007199254740997', spec: '蓝', size: 'L', qty: 0, readyToShipQty: 0, shortageQty: 0, abnormalQty: 0 }
], records: [] }; }

test('详情由商品编号独立加载全部规格，导航标题为商品名称，操作量默认0', async () => {
  const { page, requests, titles } = load('inventoryDetail', { get: async () => detail() });
  await page.onLoad({ id: '9007199254740993' });
  assert.equal(requests[0].route, '/sku-inventory/products/9007199254740993');
  assert.equal(titles.at(-1), '外套'); assert.equal(page.data.skus.length, 2);
  assert.equal(page.data.skus[0].qty, 5); assert.equal(page.data.skus[0].readyToShipQty, 2);
  assert.equal(page.data.skus[0].operationQty, '0'); assert.equal(page.data.skus[1].qty, 0);
  assert.equal(page.data.outgoingTotal, 0);
});

function correctionContext() { return { effectiveQty: 11, version: 0, shippedQty: 4, blockedReason: '',
  losses: [{ ledgerId: '9007199254740999', normalQty: 0, abnormalQty: 1, note: '异常误录已盘亏' }], history: [] }; }
function correctionDetail() { const result = detail(); result.records = [{ skuId: result.skus[0].skuId,
  receipts: [{ id: '9007199254740998', qty: 11, effectiveQty: 11, source: 'normal', canRevoke: false }] }]; return result; }

test('从原入库打开更正，保留长编号并展示本批已发下限', async () => {
  const { page, requests } = load('inventoryDetail', { get: async route => route.endsWith('/correction') ? correctionContext() : correctionDetail() });
  await page.onLoad({ id: '1' }); await page.openReceiptCorrection(event({ index: 0 }));
  assert.equal(requests.at(-1).route, '/sku-inventory/9007199254740995/receipts/9007199254740998/correction');
  assert.equal(page.data.correctionContext.shippedQty, 4); assert.equal(page.data.correctionQty, '11');
  assert.equal(page.data.correctionContext.losses[0].selected, false);
});

test('更正手输低于已发4件会拦截，步进最小4且非法数量不能预览', async () => {
  const { page, requests, toasts } = load('inventoryDetail', { get: async route => route.endsWith('/correction') ? correctionContext() : correctionDetail() });
  await page.onLoad({ id: '1' }); await page.openReceiptCorrection(event({ index: 0 }));
  page.correctionQtyChange({ ...event({}), detail: { value: '3' } }); await page.previewReceiptCorrection();
  assert.match(toasts.at(-1), /不能低于.*4/); assert.equal(requests.filter(r => r.payload).length, 0);
  page.correctionQtyChange(event({ delta: -1 })); assert.equal(page.data.correctionQty, '4');
  page.correctionQtyChange({ ...event({}), detail: { value: '1.5' } }); await page.previewReceiptCorrection();
  assert.match(toasts.at(-1), /非负整数/); assert.equal(requests.filter(r => r.payload).length, 0);
});

test('更正关联已经盘亏的异常后预览并提交，成功通知库存刷新', async () => {
  const { page, requests, writes, emitted } = load('inventoryDetail', {
    get: async route => route.endsWith('/correction') ? correctionContext() : correctionDetail(),
    post: async () => ({ beforeQty: 11, afterQty: 8, previewToken: 'checked-version', normalStockChange: -2, abnormalStockChange: 0 })
  });
  await page.onLoad({ id: '1' }); await page.openReceiptCorrection(event({ index: 0 }));
  page.correctionQtyChange({ ...event({}), detail: { value: '8' } });
  page.toggleCorrectionLoss(event({ id: '9007199254740999' }));
  await page.previewReceiptCorrection();
  assert.equal(requests.at(-1).payload.qty, 8); assert.equal(requests.at(-1).payload.lossLedgerIds[0], '9007199254740999');
  page.onCorrectionNoteInput({ detail: { value: ' 实际只收8件，异常1件已处理 ' } });
  page.confirm = async () => true; await page.submitReceiptCorrection();
  assert.equal(writes.length, 1); assert.match(writes[0].route, /9007199254740998\/correct$/);
  assert.equal(writes[0].payload.correction.qty, 8); assert.equal(writes[0].payload.previewToken, 'checked-version');
  assert.equal(writes[0].payload.note, '实际只收8件，异常1件已处理'); assert.equal(page.data.showCorrection, false);
  assert.equal(emitted.at(-1)[1].skuIds[0], '9007199254740995');
});

test('修改更正数量或盘亏选择会清除旧预览，缺原因不可提交', async () => {
  const { page, writes, toasts } = load('inventoryDetail', { get: async route => route.endsWith('/correction') ? correctionContext() : correctionDetail(),
    post: async () => ({ beforeQty: 11, afterQty: 8, previewToken: 'old-preview' }) });
  await page.onLoad({ id: '1' }); await page.openReceiptCorrection(event({ index: 0 }));
  page.correctionQtyChange({ ...event({}), detail: { value: '8' } }); await page.previewReceiptCorrection();
  await page.submitReceiptCorrection(); assert.match(toasts.at(-1), /更正原因/); assert.equal(writes.length, 0);
  page.correctionQtyChange(event({ delta: 1 })); assert.equal(page.data.correctionPreview, null);
  await page.previewReceiptCorrection(); page.toggleCorrectionLoss(event({ id: '9007199254740999' }));
  assert.equal(page.data.correctionPreview, null);
});

test('发货任务阻塞时显示原因且不调用预览，关闭后的迟到响应不重开窗口', async () => {
  const { page, toasts } = load('inventoryDetail', { get: async route => route.endsWith('/correction') ? { ...correctionContext(), blockedReason: '发货任务处理中' } : correctionDetail() });
  await page.onLoad({ id: '1' }); await page.openReceiptCorrection(event({ index: 0 }));
  await page.previewReceiptCorrection(); assert.match(toasts.at(-1), /发货任务处理中/);
  let finish; const late = load('inventoryDetail', { get: async route => route.endsWith('/correction') ? new Promise(resolve => { finish = resolve; }) : correctionDetail() });
  await late.page.onLoad({ id: '1' }); const pending = late.page.openReceiptCorrection(event({ index: 0 }));
  late.page.closeReceiptCorrection(); finish(correctionContext()); await pending;
  assert.equal(late.page.data.showCorrection, false); assert.equal(late.page.data.correctionContext, null);
});

test('更正失败清除预览并保留输入，不会显示成功或关闭面板', async () => {
  const { page, toasts } = load('inventoryDetail', { get: async route => route.endsWith('/correction') ? correctionContext() : correctionDetail(),
    post: async () => ({ beforeQty: 11, afterQty: 8, previewToken: 'stale' }), write: async () => { throw new Error('请重新预览后确认更正'); } });
  await page.onLoad({ id: '1' }); await page.openReceiptCorrection(event({ index: 0 }));
  page.correctionQtyChange({ ...event({}), detail: { value: '8' } }); await page.previewReceiptCorrection();
  page.onCorrectionNoteInput({ detail: { value: '录错' } }); page.confirm = async () => true; await page.submitReceiptCorrection();
  assert.equal(page.data.showCorrection, true); assert.equal(page.data.correctionPreview, null); assert.equal(page.data.correctionQty, '8');
  assert.match(toasts.at(-1), /重新预览/);
});
test('主Tab与功能Tab切换保留各主Tab选择，重新选择操作清零出库草稿', async () => {
  const { page } = load('inventoryDetail', { get: async () => detail() });
  await page.onLoad({ id: '1' });
  page.switchFunction(event({ id: 'exchange' }));
  page.rowQuantityChange(event({ skuId: page.data.skus[0].id, delta: 1 }));
  assert.equal(page.data.outgoingTotal, 1);
  page.switchTab(event({ id: 'returns' })); assert.equal(page.data.functionId, 'exchanges');
  page.switchFunction(event({ id: 'inspections' }));
  page.switchTab(event({ id: 'operate' })); assert.equal(page.data.functionId, 'exchange');
  assert.equal(page.data.skus[0].operationQty, '1');
  await page.loadDetail(event({}));
  assert.equal(page.data.skus[0].operationQty, '1');
  page.switchFunction(event({ id: 'history' })); assert.equal(page.data.outgoingTotal, 0);
  page.switchTab(event({ id: 'returns' })); assert.equal(page.data.functionId, 'inspections');
});
test('多选商品带回全部规格，已有数量按规格编号保留，取消选择移除对应商品', () => {
  const { page } = load('inventoryDetail');
  page.mergeExchangeProducts([{ id: '2', name: '毛衣', skus: [{ skuId: '21', spec: '白', qty: 0 }, { skuId: '22', spec: '黑', qty: 1 }] }]);
  page.rowQuantityChange(event({ target: 'exchange', productId: '2', skuId: '21', delta: 1 }));
  page.mergeExchangeProducts([{ id: '2', name: '毛衣', skus: [{ skuId: '21', spec: '白', qty: 2 }, { skuId: '22', spec: '黑', qty: 1 }] }, { id: '3', name: '裤子', skus: [{ skuId: '31', qty: 0 }] }]);
  assert.equal(page.data.exchangeProducts[0].skus.length, 2);
  assert.equal(page.data.exchangeProducts[0].skus[0].operationQty, '1');
  assert.equal(page.data.exchangeProducts[0].skus[0].qty, 2);
  assert.equal(page.data.incomingTotal, 1);
  page.removeExchangeProduct(event({ id: '2' })); assert.equal(page.data.incomingTotal, 0);
  assert.equal(page.data.exchangeProducts[0].id, '3');
});
test('数量步进最小0，异常库存到顶不再增加，手输无效数量标记并禁止提交', async () => {
  const { page, writes } = load('inventoryDetail', { get: async () => detail() });
  await page.onLoad({ id: '1' }); page.switchFunction(event({ id: 'exchange' }));
  const id = page.data.skus[0].id;
  page.rowQuantityChange(event({ skuId: id, delta: -1 })); assert.equal(page.data.outgoingTotal, 0);
  for (let index = 0; index < 3; index++) page.rowQuantityChange(event({ skuId: id, delta: 1 }));
  assert.equal(page.data.outgoingTotal, 2);
  page.rowQuantityChange({ ...event({ skuId: id }), detail: { value: '1.5' } });
  assert.equal(page.data.invalidQty, true); await page.submitOperation(); assert.equal(writes.length, 0);
});
test('两边总数相等才提交整笔多规格换货，成功清空数量并通知父页面', async () => {
  const { page, writes, emitted } = load('inventoryDetail', { get: async () => detail() });
  await page.onLoad({ id: '9007199254740993' }); page.switchFunction(event({ id: 'exchange' }));
  page.rowQuantityChange({ ...event({ skuId: page.data.skus[0].id }), detail: { value: '2' } });
  page.mergeExchangeProducts([{ id: '2', name: '毛衣', skus: [{ skuId: '21' }, { skuId: '22' }] }]);
  await page.submitOperation(); assert.equal(writes.length, 0);
  page.rowQuantityChange(event({ target: 'exchange', productId: '2', skuId: '21', delta: 1 }));
  page.rowQuantityChange(event({ target: 'exchange', productId: '2', skuId: '22', delta: 1 }));
  await page.submitOperation();
  assert.equal(writes.length, 1); assert.equal(writes[0].route, '/sku-inventory/products/9007199254740993/operations');
  assert.equal(writes[0].payload.items[0].qty, 2); assert.equal(writes[0].payload.targets.length, 2);
  assert.equal(page.data.outgoingTotal, 0); assert.equal(page.data.incomingTotal, 0);
  assert.equal(emitted[0][0], 'inventoryChanged');
  assert.deepEqual(Array.from(emitted[0][1].skuIds), ['9007199254740995', '21', '22']);
});
test('报单选择查询指定目标规格，换货不同商品的报单不能串行', async () => {
  const { page, requests } = load('inventoryDetail', { get: async () => ({ inventory: { spec: '白', size: 'L' }, reports: [
    { purchaseOrderId: '9007199254740999', shortageQty: 2 }, { purchaseOrderId: '2', shortageQty: 0 }
  ] }) });
  page.mergeExchangeProducts([{ id: '2', name: '毛衣', skus: [{ skuId: '21' }, { skuId: '22' }] }]);
  await page.openRecordPicker(event({ type: 'report', skuId: '21', productId: '2' }));
  assert.equal(requests[0].route, '/sku-inventory/21/detail');
  page.chooseRecord(event({ index: 1 })); assert.equal(page.data.exchangeProducts[0].skus[0].report, null);
  page.chooseRecord(event({ index: 0 })); assert.equal(page.data.exchangeProducts[0].skus[0].report.purchaseOrderId, '9007199254740999');
  assert.equal(page.data.exchangeProducts[0].skus[1].report, null);
});
test('关闭或切换记录选择器，迟到响应不能覆盖当前规格', async () => {
  let finish;
  const { page } = load('inventoryDetail', { get: () => new Promise(resolve => { finish = resolve; }) });
  const pending = page.openRecordPicker(event({ type: 'receipt', skuId: '1' }));
  page.closeRecordPicker(); finish({ inventory: {}, receipts: [{ id: 'old' }] }); await pending;
  assert.equal(page.data.showRecordPicker, false); assert.equal(page.data.pickerItems.length, 0);
});
test('商品查询组合状态、档口、标签、关键词，翻页与切换筛选保留多选', async () => {
  const { page, requests } = load('inventoryProductSelect', { get: async (route, query) => route === '/products/query' ? { content: [
    { id: String(query.page), name: '毛衣', status: 'off', skuMatrix: [{ skuId: '9007199254740999', color: '白', size: 'L', stock: 0 }] }
  ], hasNext: true } : [] });
  await page.onLoad();
  page.toggleProduct(event({ id: '1' }));
  page.setData({ keyword: '  毛衣  ', selectedStall: '41', selectedTag: '51' });
  await page.setFilter(event({ field: 'activeStatus', value: 'off' }));
  const query = requests.filter(request => request.route === '/products/query').at(-1).query;
  assert.equal(query.keyword, '毛衣'); assert.equal(query.status, 'off'); assert.equal(query.stallId, '41'); assert.equal(query.tagId, '51');
  assert.equal(page.data.selectedCount, 1); assert.equal(page.data.products[0].selected, true);
  page.onKeywordInput({ detail: { value: '未提交的关键词' } });
  await page.onReachBottom(); assert.equal(page.data.products.length, 2);
  assert.equal(requests.filter(request => request.route === '/products/query').at(-1).query.keyword, '毛衣');
  page.toggleAll(); assert.equal(page.data.selectedCount, 2);
  page.toggleAll(); assert.equal(page.data.selectedCount, 0);
});
test('确认多选逐商品读取完整规格，全部成功后返回，不只带回有货规格', async () => {
  const { page, emitted, navigation } = load('inventoryProductSelect', { get: async (route) => {
    if (route === '/products/query') return { content: [{ id: '2', name: '毛衣', skuMatrix: [{ skuId: '21', stock: 0 }] }] };
    if (route.includes('/sku-inventory/products/')) return { product: { id: '2', name: '毛衣' }, skus: [{ skuId: '21', qty: 0 }, { skuId: '22', qty: 3 }] };
    return [];
  } });
  await page.onLoad(); page.toggleProduct(event({ id: '2' })); await page.confirmSelection();
  assert.equal(emitted[0][0], 'productsSelected'); assert.equal(emitted[0][1].products[0].skus.length, 2);
  assert.equal(emitted[0][1].products[0].skus[0].qty, 0); assert.equal(navigation.at(-1), 'back');
});
test('读取所选商品任一项失败时不返回半份列表，选择保留供重试', async () => {
  const { page, emitted, navigation } = load('inventoryProductSelect', { get: async route => {
    if (route === '/products/query') return { content: [{ id: '2', skuMatrix: [{ skuId: '21' }] }] };
    if (route.includes('/sku-inventory/products/')) throw new Error('加载规格失败');
    return [];
  } });
  await page.onLoad(); page.toggleProduct(event({ id: '2' })); await page.confirmSelection();
  assert.equal(emitted.length, 0); assert.equal(navigation.length, 0); assert.equal(page.data.selectedCount, 1); assert.equal(page.data.confirming, false);
});
