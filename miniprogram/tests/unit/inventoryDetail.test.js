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

test('修改更正数量或历史纠错选择会清除旧预览，未填原因也能提交', async () => {
  const { page, writes, toasts } = load('inventoryDetail', { get: async route => route.endsWith('/correction') ? correctionContext() : correctionDetail(),
    post: async () => ({ beforeQty: 11, afterQty: 8, previewToken: 'old-preview' }) });
  await page.onLoad({ id: '1' }); await page.openReceiptCorrection(event({ index: 0 }));
  page.correctionQtyChange({ ...event({}), detail: { value: '8' } }); await page.previewReceiptCorrection();
  page.confirm = async () => true;
  await page.submitReceiptCorrection(); assert.equal(writes.length, 1); assert.equal(writes[0].payload.note, '');
  await page.openReceiptCorrection(event({ index: 0 }));
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
test('六个一级菜单切换保留记录选择，操作类型变化清空数量，历史入库单独进入', async () => {
  const { page } = load('inventoryDetail', { get: async () => detail() });
  await page.onLoad({ id: '1' });
  assert.deepEqual(Array.from(page.data.tabs, item => item.name), ['入库', '出库', '补报单', '换货', '退货', '报单记录']);
  page.switchTab(event({ id: 'exchange' }));
  assert.deepEqual(Array.from(page.data.functionTabs, item => item.name), ['换货', '换货记录', '换货未回']);
  page.rowQuantityChange(event({ skuId: page.data.skus[0].id, delta: 1 }));
  page.switchFunction(event({ id: 'exchange_pending' })); assert.equal(page.data.isOperating, false);
  page.switchTab(event({ id: 'inbound' })); assert.equal(page.data.functionId, 'normal');
  assert.equal(page.data.outgoingTotal, 0);
  page.switchTab(event({ id: 'exchange' })); assert.equal(page.data.functionId, 'exchange_pending');
  page.openHistory(); assert.equal(page.data.functionId, 'history'); assert.equal(page.data.historyMode, true);
  assert.equal(page.data.isOperating, true);
  page.closeHistory(); assert.equal(page.data.functionId, 'exchange_pending'); assert.equal(page.data.historyMode, false);
  page.switchTab(event({ id: 'exchange' })); page.switchFunction(event({ id: 'exchange' }));
  page.rowQuantityChange(event({ skuId: page.data.skus[0].id, delta: 1 }));
  await page.loadDetail(event({})); assert.equal(page.data.skus[0].operationQty, '1');
  page.switchTab(event({ id: 'reports' })); assert.equal(page.data.functionTabs.length, 0); assert.equal(page.data.recordView, 'reports');
});

test('各类记录按业务筛选，换货未回保留原始索引，改数量不会操作错记录', async () => {
  const response = detail(); response.records = [{ skuId: response.skus[0].skuId,
    ledger: ['arrival', 'outbound', 'return_out', 'exchange_out', 'shipment', 'stocktake_loss'].map((changeType, id) => ({ id, changeType })),
    reports: [{ purchaseOrderId: '1', purpose: 'normal' }, { purchaseOrderId: '2', purpose: 'backfill' }],
    exchanges: [{ id: 'done', qty: 2, receivedQty: 2 }, { id: 'pending', qty: 3, receivedQty: 1 }] }];
  const { page } = load('inventoryDetail', { get: async () => response }); await page.onLoad({ id: '1' });
  page.switchTab(event({ id: 'outbound' })); page.switchFunction(event({ id: 'outbound_records' }));
  assert.deepEqual(Array.from(page.data.visibleFlows, item => item.changeType), ['outbound', 'return_out', 'exchange_out', 'shipment']);
  page.switchTab(event({ id: 'return' })); page.switchFunction(event({ id: 'return_records' }));
  assert.deepEqual(Array.from(page.data.visibleFlows, item => item.changeType), ['return_out']);
  page.switchTab(event({ id: 'backfill' })); page.switchFunction(event({ id: 'backfill_records' }));
  assert.equal(page.data.visibleReports.length, 1); assert.equal(page.data.visibleReports[0].purchaseOrderId, '2');
  page.switchTab(event({ id: 'exchange' })); page.switchFunction(event({ id: 'exchange_pending' }));
  assert.equal(page.data.visibleExchanges.length, 1); assert.equal(page.data.visibleExchanges[0].recordIndex, 1);
  page.recordQtyChange(event({ kind: 'exchange', index: page.data.visibleExchanges[0].recordIndex, delta: 1 }));
  assert.equal(page.data.visibleExchanges[0].receiveQty, '1'); assert.equal(page.data.exchanges[0].receiveQty, '0');
  page.switchTab(event({ id: 'reports' })); assert.equal(page.data.visibleReports.length, 2);
});

test('出库不填备注可以提交，历史入库与普通出库使用各自接口参数', async () => {
  const { page, writes } = load('inventoryDetail', { get: async () => detail() }); await page.onLoad({ id: '1' });
  page.switchTab(event({ id: 'outbound' }));
  page.rowQuantityChange({ ...event({ skuId: page.data.skus[0].id }), detail: { value: '4' } });
  await page.submitOperation(); assert.equal(writes[0].payload.type, 'outbound'); assert.equal(writes[0].payload.action, 'outbound');
  assert.equal(writes[0].payload.note, '');
  page.openHistory(); page.rowQuantityChange(event({ skuId: page.data.skus[0].id, delta: 1 }));
  await page.submitOperation(); assert.equal(writes[1].payload.type, 'history');
});

test('换货按出库规格自动生成，改为其他同商品规格后数量继续同步，归零移除', async () => {
  const { page } = load('inventoryDetail', { get: async () => detail() }); await page.onLoad({ id: '1' });
  page.switchTab(event({ id: 'exchange' })); const source = page.data.skus[0].id, target = page.data.skus[1].id;
  page.rowQuantityChange(event({ skuId: source, delta: 1 }));
  assert.equal(page.data.exchangeLines.length, 1); assert.equal(page.data.exchangeLines[0].targetSkuId, source);
  assert.equal(page.data.incomingTotal, 1);
  page.changeExchangeSpec({ ...event({ sourceId: source }), detail: { value: '1' } });
  assert.equal(page.data.exchangeLines[0].targetSkuId, target);
  page.rowQuantityChange(event({ skuId: source, delta: 1 }));
  assert.equal(page.data.exchangeLines[0].qty, 2); assert.equal(page.data.exchangeLines[0].targetSkuId, target);
  await page.loadDetail(); assert.equal(page.data.exchangeLines[0].targetSkuId, target);
  page.rowQuantityChange({ ...event({ skuId: source }), detail: { value: '0' } });
  assert.equal(page.data.exchangeLines.length, 0); assert.equal(page.data.incomingTotal, 0);
});

test('记录视图规格默认收起，可展开，切换记录再次收起，操作规格始终可编辑', async () => {
  const { page } = load('inventoryDetail', { get: async () => detail() }); await page.onLoad({ id: '1' });
  page.switchFunction(event({ id: 'receipts' })); assert.equal(page.data.specsExpanded, false);
  page.toggleSpecs(); assert.equal(page.data.specsExpanded, true);
  page.switchTab(event({ id: 'reports' })); assert.equal(page.data.specsExpanded, false);
  page.toggleSpecs(); page.toggleSpecs(); assert.equal(page.data.specsExpanded, false);
  page.switchTab(event({ id: 'outbound' })); assert.equal(page.data.isOperating, true);
});

test('补报单步进上限为异常数量，手输超过异常量不能提交，无需选择收货记录', async () => {
  const { page, writes, toasts } = load('inventoryDetail', { get: async () => detail() }); await page.onLoad({ id: '1' });
  page.switchTab(event({ id: 'backfill' })); const id = page.data.skus[0].id;
  for (let i = 0; i < 3; i++) page.rowQuantityChange(event({ skuId: id, delta: 1 }));
  assert.equal(page.data.outgoingTotal, 2);
  page.rowQuantityChange({ ...event({ skuId: id }), detail: { value: '3' } });
  assert.equal(page.data.invalidQty, true); await page.submitOperation(); assert.equal(writes.length, 0); assert.match(toasts.at(-1), /异常数量/);
  page.rowQuantityChange({ ...event({ skuId: id }), detail: { value: '2' } }); await page.submitOperation();
  assert.equal(writes[0].payload.backfillMode, 'abnormal'); assert.equal(writes[0].payload.items[0].receiptId, null);
});

test('数量步进最小0，实际库存到顶不再增加，手输无效数量标记并禁止提交', async () => {
  const { page, writes } = load('inventoryDetail', { get: async () => detail() });
  await page.onLoad({ id: '1' }); page.switchTab(event({ id: 'exchange' })); page.switchFunction(event({ id: 'exchange' }));
  const id = page.data.skus[0].id;
  page.rowQuantityChange(event({ skuId: id, delta: -1 })); assert.equal(page.data.outgoingTotal, 0);
  for (let index = 0; index < 6; index++) page.rowQuantityChange(event({ skuId: id, delta: 1 }));
  assert.equal(page.data.outgoingTotal, 5);
  page.rowQuantityChange({ ...event({ skuId: id }), detail: { value: '1.5' } });
  assert.equal(page.data.invalidQty, true); await page.submitOperation(); assert.equal(writes.length, 0);
});
test('同商品换货提交保留出库与目标对应关系，成功清空数量并通知父页面', async () => {
  const { page, writes, emitted } = load('inventoryDetail', { get: async () => detail() });
  await page.onLoad({ id: '9007199254740993' }); page.switchTab(event({ id: 'exchange' }));
  const source = page.data.skus[0].id, target = page.data.skus[1].id;
  page.rowQuantityChange({ ...event({ skuId: source }), detail: { value: '2' } });
  page.changeExchangeSpec({ ...event({ sourceId: source }), detail: { value: '1' } });
  await page.submitOperation();
  assert.equal(writes.length, 1); assert.equal(writes[0].route, '/sku-inventory/products/9007199254740993/operations');
  assert.equal(writes[0].payload.items[0].qty, 2); assert.equal(writes[0].payload.targets[0].sourceSkuId, source);
  assert.equal(writes[0].payload.targets[0].skuId, target); assert.equal(writes[0].payload.targets[0].qty, 2);
  assert.equal(page.data.outgoingTotal, 0); assert.equal(page.data.incomingTotal, 0); assert.equal(page.data.exchangeLines.length, 0);
  assert.deepEqual(Array.from(emitted[0][1].skuIds), [source, target]);
});

test('报单选择查询目标规格，切换目标后清除旧报单，旧响应不能覆盖新规格', async () => {
  let finish;
  const { page, requests } = load('inventoryDetail', { get: route => route.includes('/products/') ? detail() : new Promise(resolve => { finish = resolve; }) });
  await page.onLoad({ id: '1' }); page.switchTab(event({ id: 'exchange' })); const source = page.data.skus[0].id;
  page.rowQuantityChange(event({ skuId: source, delta: 1 }));
  const pending = page.openRecordPicker(event({ sourceId: source }));
  assert.match(requests.at(-1).route, new RegExp(source + '/detail$'));
  page.changeExchangeSpec({ ...event({ sourceId: source }), detail: { value: '1' } });
  finish({ inventory: {}, reports: [{ purchaseOrderId: 'old', shortageQty: 2 }] }); await pending;
  assert.equal(page.data.showRecordPicker, false); assert.equal(page.data.pickerItems.length, 0);
  assert.equal(page.data.exchangeLines[0].report, null);
  const second = page.openRecordPicker(event({ sourceId: source }));
  assert.match(requests.at(-1).route, new RegExp(page.data.skus[1].id + '/detail$'));
  finish({ inventory: {}, reports: [{ purchaseOrderId: '9007199254740999', shortageQty: 2 }, { purchaseOrderId: '2', shortageQty: 0 }] }); await second;
  page.chooseRecord(event({ index: 1 })); assert.equal(page.data.exchangeLines[0].report, null);
  page.chooseRecord(event({ index: 0 })); assert.equal(page.data.exchangeLines[0].report.purchaseOrderId, '9007199254740999');
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
