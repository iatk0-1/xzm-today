const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
let handler;
const requests = [];
const toasts = [];
global.Page = value => { config = value; };
global.wx = {
  showToast: value => toasts.push(value.title),
  createSelectorQuery() {
    return {
      in(page) { this.page = page; return this; },
      select(selector) { assert.equal(selector, '#selection-divider'); return this; },
      selectAll(selector) { assert.equal(selector, '.above-selection-item'); return this; },
      boundingClientRect() { return this; },
      exec(callback) {
        if (this.page.measureSelection) return this.page.measureSelection(callback);
        const keys = selectionKeys(this.page);
        callback([{ top: 570, height: 60 }, keys.map(key => ({
          dataset: { selectionKey: key }, height: 100, bottom: 500
        }))]);
      }
    };
  }
};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return { get: async (url, params) => {
    requests.push({ url, params });
    return handler(url, params);
  } };
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {}, isStallManager: () => false };
  return originalLoad.call(this, request, ...args);
};
const configs = {};
for (const name of ['pickingList', 'adminOrder', 'skuInventory']) {
  require(`../../pages/${name}/${name}.js`);
  configs[name] = config;
}
Module._load = originalLoad;

const definitions = [
  { name: '拣货单', key: 'pickingList', load: 'loadRecommendations', list: 'recommendList',
    selected: page => page.data.pendingOrderList, input: 'skuKeyword',
    row: id => ({ skuId: id, productName: '棉袄', recommendQty: 2 }) },
  { name: '订单', key: 'adminOrder', load: 'loadAllPendingItems', list: 'orderGroups',
    selected: page => page.data.pendingShipItems, input: 'searchKeyword',
    row: id => ({ orderId: id, orderItemId: id, skuId: id, unshippedQty: 2,
      productName: '棉袄', orderCreatedAt: '2026-11-01' }) },
  { name: '库存', key: 'skuInventory', load: 'loadProducts', list: 'productList',
    selected: page => [...page.receiveDrafts().values()].filter(product => product.selected), input: 'keyword',
    row: id => ({ productId: id, productName: '棉袄', skuId: id, qty: 2 }) }
];

function createPage(definition) {
  const page = { ...configs[definition.key], data: structuredClone(configs[definition.key].data) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  page.selectionDefinition = definition;
  requests.length = 0;
  toasts.length = 0;
  return page;
}
function selectionKeys(page) {
  const { key, list } = page.selectionDefinition;
  return key === 'adminOrder' ? page.data.orderGroups.flatMap(group => group.items.map(item => item.uniqueKey))
    : page.data[list].map(item => String(key === 'pickingList' ? item.skuId : item.id));
}
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const definition of definitions) {
  const { name, row, load, list, selected, input } = definition;
  test(`${name}：悬浮线选择不发分页请求，顶部继续查完全部分页并保留筛选条件`, async () => {
    const page = createPage(definition);
    page.setData({ selectedStall: '8', selectedTag: '9', [input]: ' 棉袄 ' });
    handler = (_url, params) => ({ content: [row(String(params.page))], hasNext: params.page < 3 });
    await page[load]();
    await page.selectLoadedItems();
    await page.selectLoadedItems();
    assert.equal(requests.length, 1);
    assert.equal(selected(page).length, 1);
    assert.equal(page.data.allSelected, false, '仍有未查询分页时不能显示全量已选');
    page.data[input] = '尚未确认的新关键词';
    await page.toggleSelectAll();
    assert.deepEqual(requests.map(request => request.params.page), [1, 2, 3]);
    assert.ok(requests.every(request => request.params.keyword === '棉袄'
      && request.params.stallId === '8' && request.params.tagId === '9'));
    assert.equal(page.data[list].length, 3);
    assert.equal(selected(page).length, 3);
    assert.equal(page.data.allSelected, true);
    assert.equal(page.data.selectingAll, false);
    await page.toggleSelectAll();
    assert.equal(selected(page).length, 0);
    assert.equal(requests.length, 3);
  });

  test(`${name}：后续分页失败停止全选，保留原选择且可重试`, async () => {
    const page = createPage(definition);
    handler = () => ({ content: [row('1')], hasNext: true });
    await page[load]();
    await page.selectLoadedItems();
    handler = () => { throw new Error('测试分页失败'); };
    const originalError = console.error;
    console.error = () => {};
    try { await page.toggleSelectAll(); } finally { console.error = originalError; }
    assert.equal(selected(page).length, 1);
    assert.equal(page.data.allSelected, false);
    assert.equal(page.data.selectingAll, false);
    assert.equal(page.data.loading, false);
    assert.equal(toasts.length, 1);
    handler = () => ({ content: [row('2')], hasNext: false });
    await page.toggleSelectAll();
    assert.equal(selected(page).length, 2);
    assert.equal(page.data.allSelected, true);
  });

  test(`${name}：全选查询期间重复点击只发一次请求，换筛选后忽略旧结果`, async () => {
    const page = createPage(definition);
    handler = () => ({ content: [row('1')], hasNext: true });
    await page[load]();
    let resolveOld;
    handler = () => new Promise(resolve => { resolveOld = resolve; });
    const selecting = page.toggleSelectAll();
    await tick();
    await page.toggleSelectAll();
    await page.selectLoadedItems();
    assert.equal(requests.length, 2);
    handler = () => ({ content: [row('9')], hasNext: false });
    page.data.selectedStall = '新筛选';
    await page[load]();
    resolveOld({ content: [row('2')], hasNext: false });
    await selecting;
    assert.equal(page.data[list].length, 1);
    assert.equal(selected(page).length, 0);
    assert.equal(page.data[list][0].selected, false);
    assert.equal(page.data.allSelected, false);
    assert.equal(page.data.selectingAll, false);
  });

  test(`${name}：按悬浮线实际位置选择，包含屏幕上方条目，跳过跨线和线下条目`, async () => {
    const page = createPage(definition);
    handler = () => ({ content: ['1', '2', '3', '4'].map(row), hasNext: true });
    await page[load]();
    const keys = selectionKeys(page);
    page.setLoadedItemsSelected(true, new Set([keys[3]]));
    let bottoms = [-20, 590, 620, 900];
    page.measureSelection = callback => callback([{ top: 570, height: 60 }, keys.map((key, index) => ({
      dataset: { selectionKey: key }, height: 100, bottom: bottoms[index]
    }))]);
    await page.selectLoadedItems();
    const selectedKeys = () => selectionKeys(page).filter(key => definition.key === 'adminOrder'
      ? page.data.orderGroups.flatMap(group => group.items).find(item => item.uniqueKey === key).selected
      : page.data[list].find(item => String(definition.key === 'pickingList' ? item.skuId : item.id) === key).selected);
    assert.deepEqual(selectedKeys(), [keys[0], keys[1], keys[3]], '保留线下已有选择，但不新选跨线或线下行');
    assert.equal(page.data.allSelected, false);
    assert.equal(requests.length, 1);
    bottoms = [-300, -90, 550, 750];
    await page.selectLoadedItems();
    assert.deepEqual(selectedKeys(), keys, '滚动后重新测量，选择新移到线上的条目');
    assert.equal(requests.length, 1);
  });

  test(`${name}：测量期间换筛选，旧坐标不会勾选新列表`, async () => {
    const page = createPage(definition);
    handler = () => ({ content: [row('1')], hasNext: false });
    await page[load]();
    let finishMeasure;
    const key = selectionKeys(page)[0];
    page.measureSelection = callback => { finishMeasure = callback; };
    const selecting = page.selectLoadedItems();
    handler = () => ({ content: [row('9')], hasNext: false });
    await page[load]();
    finishMeasure([{ top: 570, height: 60 }, [{ dataset: { selectionKey: key }, height: 100, bottom: 500 }]]);
    await selecting;
    assert.equal(selected(page).length, 0);
  });
}

test('库存：同商品跨页合并全部规格，全选保留已填入库数量', async () => {
  const definition = definitions[2];
  const page = createPage(definition);
  handler = (_url, params) => ({ content: [{ ...definition.row('1'), skuId: String(params.page) }], hasNext: params.page < 2 });
  await page.loadProducts();
  page.setCardReceiveQty('1', '1', '7');
  await page.toggleSelectAll();
  assert.equal(page.data.productList.length, 1);
  assert.deepEqual(page.data.productList[0].skus.map(sku => [sku.id, sku.receiveQty]), [['1', '7'], ['2', 0]]);
  assert.equal(page.data.pendingReceiveTotal, 7);
  assert.equal(page.data.allSelected, true);
});

test('订单：用户备注随分组、选中和待发货卡片保留，无备注时为空', async () => {
  const definition = definitions[1];
  const page = createPage(definition);
  handler = () => ({ content: [
    { ...definition.row('1'), remark: '请分开发货\n谢谢', adminRemark: '已核对' }, definition.row('2')
  ], hasNext: false });
  await page.loadAllPendingItems();
  await page.selectLoadedItems();
  assert.equal(page.data.orderGroups[0].items[0].remark, '请分开发货\n谢谢');
  assert.equal(page.data.pendingShipItems[0].remark, '请分开发货\n谢谢');
  assert.equal(page.data.pendingOrderGroups[0].items[0].remark, '请分开发货\n谢谢');
  assert.equal(page.data.orderGroups[1].items[0].remark, '');
});

test('订单：同一订单跨过悬浮线时，只勾选线上的商品项，订单不会显示整单已选', async () => {
  const definition = definitions[1];
  const page = createPage(definition);
  handler = () => ({ content: [definition.row('1'), { ...definition.row('2'), orderId: '1' }], hasNext: false });
  await page.loadAllPendingItems();
  const keys = selectionKeys(page);
  page.measureSelection = callback => callback([{ top: 570, height: 60 }, keys.map((key, index) => ({
    dataset: { selectionKey: key }, height: 150, bottom: index === 0 ? 550 : 750
  }))]);
  await page.selectLoadedItems();
  assert.deepEqual(page.data.orderGroups[0].items.map(item => item.selected), [true, false]);
  assert.equal(page.data.orderGroups[0].selected, false);
  assert.equal(page.data.pendingShipItems.length, 1);
  assert.equal(page.data.allSelected, false);
});
