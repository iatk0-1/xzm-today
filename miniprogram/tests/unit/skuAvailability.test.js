const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readyStockPrompt } = require('../../utils/readyStockPrompt');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = dataset => ({ currentTarget: { dataset } });
const sku = (overrides = {}) => ({ skuId: '11', color: '黑色', size: 'M', price: 20, stock: 10, freeStockQty: 1, ...overrides });
const product = (matrix = [sku()]) => ({ id: '90071992547409931', name: '羽绒服', status: 'on', coverUrl: 'cover.jpg', skuMatrix: matrix });

function harness(kind = 'list', options = {}) {
  const initial = options.product || product();
  const calls = [], modals = [], navigation = [], storage = new Map();
  let reads = 0;
  const api = { get: async url => {
    calls.push({ method: 'GET', url });
    if (url.endsWith('/promotions')) return [];
    reads++;
    return options.get ? options.get(reads) : { product: plain(options.fresh || initial) };
  }, post: async (url, data) => {
    calls.push({ method: 'POST', url, data: plain(data) });
    return options.post ? options.post(url, data) : {};
  } };
  const ctx = { console: { error() {}, warn() {} }, setTimeout, clearTimeout,
    wx: { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, plain(value)),
      removeStorageSync: key => storage.delete(key), showLoading() {}, hideLoading() {}, showToast() {}, hideKeyboard() {},
      showModal(value) { modals.push(value);if (options.autoConfirm !== false) value.success({ confirm: options.confirm === true }); },
      navigateTo(value) { navigation.push(value.url);value.success(); }
    }, getApp: () => ({}) };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };cache.set(filename, module);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { ...ctx, module, require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { isAdmin: () => false, isStallManager: () => false, getUserInfo: () => ({ id: 'user1' }) };
      if (name.endsWith('/shareImage')) return {};
      const target = path.resolve(path.dirname(filename), name + '.js');
      if (['skuSelectionList.js', 'skuSelectionDraft.js', 'skuQuantityEditor.js', 'productSkuPanel.js'].includes(path.basename(target))) return load(target);
      return require(target);
    } });
    return module.exports;
  }
  let config;
  if (kind === 'list') {
    const picker = load(path.resolve(__dirname, '../../utils/productSkuPanel.js'));
    config = { ...picker.methods, data: picker.initialData };
  } else config = load(path.resolve(__dirname, '../../components/productDetail/controller.js')).createProductDetailConfig();
  const page = { ...config, data: plain(config.data), setData(patch) { Object.assign(this.data, patch); } };
  page.data.product = initial;
  page.data.embedded = kind.startsWith('embedded');
  page.openSkuPanel(event({ product: initial, action: 'buy' }));
  page.buy = () => page[kind === 'list' ? 'confirmAddToCart' : 'confirmSkuAction'](event({ action: 'buy' }));
  page.cart = () => page[kind === 'list' ? 'confirmAddToCart' : 'confirmSkuAction'](event({ action: 'cart' }));
  return { page, calls, modals, navigation, storage };
}

for (const kind of ['list', 'detail', 'embedded-half', 'embedded-full']) {
  test(`${kind}：提交才核对现货，弹窗确认后刷新现货文字及颜色尺码角标，保留件数`, async () => {
    const env = harness(kind, { fresh: product([sku({ freeStockQty: 0 })]), autoConfirm: false });
    env.page.setPickedSkuQuantity('11', 2);
    assert.equal(env.calls.filter(call => call.url === '/products/90071992547409931').length, 0);
    const task = env.page.buy();await tick();
    assert.equal(env.navigation.length, 0);assert.equal(env.modals[0].title, '现货不足');
    assert.match(env.modals[0].content, /羽绒服.*黑色 \/ M.*只剩现货0件/);
    assert.equal(env.page.data.currentSkuFreeStockQty, 1, '提示关闭后再更新规格数据');
    env.modals[0].success({ confirm: false });await task;
    assert.equal(env.page.data.currentSkuFreeStockQty, 0);assert.equal(env.page.data.quantity, 2);
    assert.equal(env.page.data.pickedTotalCount, 2);assert.equal(env.page.data.showSku, true);
    assert.equal(env.page.data.colorOptions[0].hasReadyStock, false);assert.equal(env.page.data.sizeOptions[0].hasReadyStock, false);
    assert.equal(env.page.data.purchasePending, false);
    await env.page.buy();assert.equal(env.navigation[0], '/pages/checkout/checkout');
    assert.equal(env.storage.get('checkoutItems')[0].count, 2);
  });
}

test('部分现货加备货可正常购买，空清单自动补1件后也要检查最新数据', async () => {
  const mixed = harness();mixed.page.setPickedSkuQuantity('11', 2);await mixed.page.buy();
  assert.equal(mixed.modals.length, 0);assert.equal(mixed.navigation.length, 1);
  assert.equal(mixed.storage.get('checkoutSource'), 'sku');
  assert.equal(mixed.storage.get('checkoutItems')[0].readyStockQty, 1);
  const empty = harness('list', { fresh: product([sku({ freeStockQty: 0 })]) });await empty.page.buy();
  assert.equal(empty.modals[0].title, '现货不足');assert.equal(empty.navigation.length, 0);
  assert.equal(empty.page.data.pickedTotalCount, 1);
});

test('立即购买前检查可售库存，不足时不进入结算，最新库存上限同步到清单和缓存', async () => {
  const env = harness('list', { fresh: product([sku({ stock: 1 })]) });env.page.setPickedSkuQuantity('11', 3);
  await env.page.buy();assert.equal(env.modals[0].title, '库存不足');assert.match(env.modals[0].content, /当前可售1件/);
  assert.equal(env.calls.some(call => call.method === 'POST'), false);assert.equal(env.page.data.pickedTotalCount, 1);
  assert.equal(env.page.data.currentSkuStock, 1);assert.equal(env.storage.get(env.page._pickedDraftKey).quantities['11'], 1);
  await env.page.buy();assert.equal(env.navigation.length, 1);
});

test('售罄、规格删除或下架均阻止提交，详情弹窗能显示最新售罄状态', async () => {
  for (const fresh of [product([sku({ stock: 0, freeStockQty: 9 })]), product([]), { ...product(), status: 'off' }]) {
    const env = harness('detail', { fresh });env.page.setPickedSkuQuantity('11', 2);await env.page.buy();
    assert.equal(env.calls.some(call => call.method === 'POST'), false);assert.equal(env.navigation.length, 0);
    assert.equal(env.page.data.showSku, true);assert.equal(env.modals.length, 1);
    if (fresh.status === 'off') assert.equal(env.page.data.product.offSale, true);
    else { assert.equal(env.page.data.product.soldOut, true);assert.equal(env.page.data.pickedTotalCount, 0);
      assert.equal(env.page.data.colorOptions.some(option => option.hasReadyStock), false); }
  }
});

test('价格变化先更新再让用户确认，不按旧价格进入结算', async () => {
  const env = harness('list', { fresh: product([sku({ price: 25 })]) });env.page.setPickedSkuQuantity('11', 2);
  await env.page.buy();assert.equal(env.modals[0].title, '商品信息已更新');assert.equal(env.navigation.length, 0);
  assert.equal(env.page.data.pickedTotalPrice, '50.00');assert.equal(env.page.data.quantity, 2);
  await env.page.buy();assert.equal(env.storage.get('checkoutItems')[0].price, 25);
});

test('套装各子项独立核对，刷新后保留每项规格及件数，不从其他子项借用现货', async () => {
  const initial = product([sku({ bundleGroupId: 1, bundleGroupName: '上衣', freeStockQty: 2 }),
    sku({ skuId: '22', color: '白色', bundleGroupId: 2, bundleGroupName: '裤子', freeStockQty: 2 })]);
  const fresh = plain(initial);fresh.skuMatrix[0].freeStockQty = 1;
  const env = harness('detail', { product: initial, fresh });env.page.setPickedSkuQuantity('11', 2);env.page.setPickedSkuQuantity('22', 1);
  await env.page.buy();assert.equal(env.navigation.length, 0);assert.match(env.modals[0].content, /黑色 \/ M.*只剩现货1件/);
  assert.deepEqual(plain(env.page.data.pickedSkuItems.map(item => [item.skuId, item.count, item.freeStockQty])), [['11', 2, 1], ['22', 1, 2]]);
  assert.deepEqual(plain(env.page.data.bundleSelections.map(group => group.selectedSku.skuId)), ['11', '22']);
});

test('网络失败或响应无效不按缓存提交，重复点击只发一次核对请求', async () => {
  for (const get of [async () => { throw { message: '网络连接异常，请重试' }; }, async () => ({ product: { id: '其他商品', skuMatrix: [] } })]) {
    const env = harness('list', { get });env.page.setPickedSkuQuantity('11', 2);await env.page.buy();
    assert.equal(env.navigation.length, 0);assert.equal(env.modals[0].title, '库存核对失败');assert.equal(env.page.data.pickedTotalCount, 2);
  }
  let finish;const env = harness('list', { get: () => new Promise(resolve => { finish = resolve; }) });
  const task = env.page.buy();await env.page.buy();
  assert.equal(env.calls.filter(call => call.url === '/products/90071992547409931').length, 1);
  finish({ product: product() });await task;assert.equal(env.navigation.length, 1);
});

test('核对期间商品切换或组件销毁，旧响应不更新新商品也不继续购买', async () => {
  for (const dispose of [false, true]) {
    let finish;const env = harness('detail', { get: () => new Promise(resolve => { finish = resolve; }) });
    const task = env.page.buy();
    if (dispose) env.page.disposeSkuPromotions();
    else env.page.setData({ currentProduct: { id: 'new', skuMatrix: [] }, product: { id: 'new', skuMatrix: [] } });
    finish({ product: product([sku({ freeStockQty: 0 })]) });await task;
    assert.equal(env.navigation.length, 0);assert.equal(env.modals.length, 0);
    if (!dispose) assert.equal(env.page.data.currentProduct.id, 'new');
  }
});

test('加入购物车不预检或静默更新SKU，服务器拒绝后保留选择且不自动重试', async () => {
  const env = harness('list', { get: async attempt => ({ product: product([sku({ stock: attempt === 1 ? 10 : 1 })]) }),
    post: async () => { throw { message: '可用库存不足' }; } });
  env.page.setPickedSkuQuantity('11', 3);await env.page.cart();
  assert.equal(env.modals[0].title, '库存不足');assert.equal(env.page.data.quantity, 3);
  assert.equal(env.page.data.showSku, true);assert.equal(env.calls.filter(call => call.url === '/cart/items/batch').length, 1);
  assert.equal(env.calls.filter(call => call.url === '/products/90071992547409931').length, 0);
});

test('SKU现货提示与结算页共用文案和按钮，确认后核对最新数据并继续原购买动作', async () => {
  const env = harness('list', { fresh: product([sku({ freeStockQty: 0 })]), confirm: true });
  env.page.setPickedSkuQuantity('11', 2);await env.page.buy();
  const expected = readyStockPrompt([{ productName: '羽绒服', color: '黑色', size: 'M', readyStockQty: 0 }]);
  for (const key of ['title', 'content', 'confirmText', 'cancelText']) assert.equal(env.modals[0][key], expected[key]);
  assert.equal(env.modals[0].showCancel, undefined, '显示继续下单与暂不下单两个按钮');
  assert.equal(env.navigation.length, 1);assert.equal(env.storage.get('checkoutItems')[0].count, 2);
  assert.equal(env.calls.filter(call => call.url === '/products/90071992547409931').length, 2);
});

test('确认继续后现货再次减少，再次提示新数量；确认期间可售不足则停止继续', async () => {
  const env = harness('list', { product: product([sku({ freeStockQty: 2 })]), confirm: true,
    get: async attempt => ({ product: product([sku({ freeStockQty: attempt === 1 ? 1 : 0 })]) }) });
  env.page.setPickedSkuQuantity('11', 2);await env.page.buy();
  assert.equal(env.modals.length, 2);assert.match(env.modals[0].content, /只剩现货1件/);assert.match(env.modals[1].content, /只剩现货0件/);
  assert.equal(env.navigation.length, 1);
  const lostStock = harness('detail', { confirm: true, get: async attempt => ({ product: product([sku({ freeStockQty: 0, stock: attempt === 1 ? 10 : 1 })]) }) });
  lostStock.page.setPickedSkuQuantity('11', 2);await lostStock.page.buy();
  assert.equal(lostStock.modals.length, 2);assert.equal(lostStock.modals[1].title, '库存不足');
  assert.equal(lostStock.navigation.length, 0);assert.equal(lostStock.page.data.quantity, 1);
});

test('只有库存不足与库存现货同时不足分别完整提示，不因同SKU库存不足漏报现货', async () => {
  const only = harness('list', { fresh: product([sku({ stock: 1 })]) });only.page.setPickedSkuQuantity('11', 3);await only.page.buy();
  assert.equal(only.modals[0].title, '库存不足');
  assert.equal(only.modals[0].content, '当前「羽绒服」（黑色 / M）库存不足，当前可售1件。\n已选规格将按最新数据更新，请调整后重试。');
  assert.equal(only.modals[0].showCancel, false);
  const both = harness('list', { fresh: product([sku({ stock: 1, freeStockQty: 0 })]) });both.page.setPickedSkuQuantity('11', 3);await both.page.buy();
  assert.equal(both.modals[0].title, '库存及现货不足');
  assert.equal(both.modals[0].content, '当前「羽绒服」（黑色 / M）库存不足，当前可售1件；\n当前「羽绒服」（黑色 / M）现货不足，只剩现货0件。\n已选规格将按最新数据更新，请调整后重试。');
  assert.equal(both.modals[0].showCancel, false);assert.equal(both.navigation.length, 0);assert.equal(both.page.data.quantity, 1);
});

for (const kind of ['list', 'detail', 'embedded-half', 'embedded-full']) {
  test(`${kind}：暂不下单后关闭重开仍使用新SKU，不从旧点击数据恢复库存和价格`, async () => {
    const initial = product();const fresh = product([sku({ freeStockQty: 0, stock: 2 })]);
    const env = harness(kind, { product: initial, fresh });env.page.setPickedSkuQuantity('11', 2);
    if (kind === 'list') {
      env.page.data.productList = [plain(initial)];env.page.data.leftColumn = [plain(initial)];
      env.page.data.results = [plain(initial)];env.page.data.products = [plain(initial)];env.page.data.filteredProducts = [plain(initial)];
    }
    await env.page.buy();assert.equal(env.navigation.length, 0);env.page.closeSkuPanel();
    const readCount = env.calls.length;
    env.page.openSkuPanel(event({ product: initial, action: 'buy' }));
    assert.equal(env.page.data.currentSkuFreeStockQty, 0);assert.equal(env.page.data.currentSkuStock, 2);
    assert.equal(env.page.data.quantity, 2);assert.equal(env.page.data.colorOptions[0].hasReadyStock, false);
    assert.equal(env.calls.slice(readCount).some(call => call.url === '/products/90071992547409931'), false, '重开使用已同步的本次数据');
    if (kind === 'list') for (const field of ['productList', 'leftColumn', 'results', 'products', 'filteredProducts'])
      assert.equal(env.page.data[field][0].skuMatrix[0].freeStockQty, 0);
  });
}

test('重新拉取列表后优先使用新的列表数据，不被之前更新的SKU缓存覆盖', async () => {
  const initial = product();const env = harness('list', { product: initial, fresh: product([sku({ freeStockQty: 0 })]) });
  env.page.setPickedSkuQuantity('11', 2);await env.page.buy();env.page.closeSkuPanel();
  const reloaded = product([sku({ freeStockQty: 4, stock: 20 })]);env.page.data.productList = [reloaded];
  env.page.openSkuPanel(event({ product: reloaded, action: 'buy' }));
  assert.equal(env.page.data.currentSkuFreeStockQty, 4);assert.equal(env.page.data.currentSkuStock, 20);
});
