const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = dataset => ({ currentTarget: { dataset } });
const sku = (overrides = {}) => ({ skuId: '11', color: '黑色', size: 'M', price: 20, stock: 10, freeStockQty: 1, ...overrides });
const product = (matrix = [sku()]) => ({ id: '90071992547409931', name: '羽绒服', status: 'on', coverUrl: 'cover.jpg', skuMatrix: matrix });

function harness(kind = 'list', options = {}) {
  const initial = options.product || product();
  const calls = [], modals = [], navigation = [], toasts = [], storage = new Map();
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
      removeStorageSync: key => storage.delete(key), showLoading() {}, hideLoading() {}, showToast(value) { toasts.push(value); }, hideKeyboard() {},
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
  const ready = page.openSkuPanel(event({ product: initial, action: 'buy' }));
  page.buy = () => page[kind === 'list' ? 'confirmAddToCart' : 'confirmSkuAction'](event({ action: 'buy' }));
  page.cart = () => page[kind === 'list' ? 'confirmAddToCart' : 'confirmSkuAction'](event({ action: 'cart' }));
  return { page, calls, modals, navigation, toasts, storage, ready };
}


const productReads = env => env.calls.filter(call => /^\/(?:live-)?products\/[^/]+$/.test(call.url));
for (const kind of ['list', 'detail', 'embedded-half', 'embedded-full']) {
  test(`${kind}：每次打开拉最新规格，购买和加购不额外核对，现货快照进入结算`, async () => {
    let fresh = product([sku({ freeStockQty: 0, stock: 4, price: 25 })]);
    const env = harness(kind, { get: async () => ({ product: plain(fresh) }) });
    assert.equal(env.page.data.skuDataLoading, true);
    await env.page.buy();assert.equal(env.navigation.length, 0);
    await env.ready;
    assert.equal(env.page.data.skuDataLoading, false);assert.equal(env.page.data.currentSkuFreeStockQty, 0);
    assert.equal(env.page.data.currentSkuStock, 4);assert.equal(env.page.data.currentSkuPrice, 25);
    env.page.setPickedSkuQuantity('11', 2);await env.page.buy();
    assert.equal(env.navigation.length, 1);assert.equal(env.modals.length, 0);assert.equal(productReads(env).length, 1);
    assert.equal(env.storage.get('checkoutItems')[0].readyStockQty, 0);assert.equal(env.storage.get('checkoutItems')[0].count, 2);
    fresh = product([sku({ freeStockQty: 3, stock: 6, price: 30 })]);
    await env.page.openSkuPanel(event({ product: product(), action: 'cart' }));
    assert.equal(productReads(env).length, 2);assert.equal(env.page.data.currentSkuFreeStockQty, 3);
    assert.equal(env.page.data.quantity, 2);assert.equal(env.page.data.currentSkuPrice, 30);
    assert.equal(env.page.data.colorOptions[0].hasReadyStock, true);
    await env.page.cart();assert.equal(productReads(env).length, 2);
    assert.equal(env.calls.filter(call => call.url === '/cart/items/batch').length, 1);
  });

  test(`${kind}：关闭重开也发请求，旧响应不能覆盖本次的新SKU数据`, async () => {
    const pending = [];
    const env = harness(kind, { get: () => new Promise(resolve => pending.push(resolve)) });
    env.page.closeSkuPanel();
    const reopened = env.page.openSkuPanel(event({ product: product() }));
    pending[1]({ product: product([sku({ freeStockQty: 4 })]) });await reopened;
    pending[0]({ product: product([sku({ freeStockQty: 0 })]) });await env.ready;
    assert.equal(productReads(env).length, 2);assert.equal(env.page.data.currentSkuFreeStockQty, 4);
    assert.equal(env.page.data.skuDataLoading, false);
  });
}

test('规格刷新同步列表缓存、图片、价格、现货角标和对应件数，有限库存上限自动收敛', async () => {
  let finish;
  const env = harness('list', { get: () => new Promise(resolve => { finish = resolve; }) });
  const initial = product();
  for (const field of ['productList', 'leftColumn', 'rightColumn', 'results', 'products', 'filteredProducts']) env.page.data[field] = [plain(initial)];
  env.page.setPickedSkuQuantity('11', 3);
  finish({ product: product([sku({ stock: 1, freeStockQty: 0, price: 30, imageUrl: 'new.jpg' })]) });await env.ready;
  assert.equal(env.page.data.quantity, 1);assert.equal(env.page.data.pickedTotalPrice, '30.00');
  assert.equal(env.page.data.currentSkuImage, 'new.jpg');assert.equal(env.page.data.sizeOptions[0].hasReadyStock, false);
  assert.equal(env.storage.get(env.page._pickedDraftKey).quantities['11'], 1);
  for (const field of ['productList', 'leftColumn', 'rightColumn', 'results', 'products', 'filteredProducts']) assert.equal(env.page.data[field][0].skuMatrix[0].freeStockQty, 0);
});

test('空清单直接购买仍补1件，但不请求SKU或弹现货提示', async () => {
  const env = harness();await env.ready;
  await env.page.buy();assert.equal(productReads(env).length, 1);
  assert.equal(env.storage.get('checkoutItems')[0].count, 1);assert.equal(env.modals.length, 0);
});

test('打开刷新发现售罄、规格删除、下架，保留原售罄禁购逻辑', async () => {
  for (const fresh of [product([sku({ stock: 0, freeStockQty: 9 })]), product([]), { ...product(), status: 'off' }]) {
    const env = harness('detail', { fresh });await env.ready;await env.page.buy();await env.page.cart();
    assert.equal(env.calls.some(call => call.method === 'POST'), false);assert.equal(env.navigation.length, 0);
    assert.equal(env.page.data.showSku, true);assert.equal(env.modals.length, 0);
    if (fresh.status === 'off') assert.equal(env.page.data.product.offSale, true);
    else assert.equal(env.page.data.product.soldOut, true);
  }
});

test('打开刷新套装各子项，保留选择数量并将最新现货写入结算子项', async () => {
  const initial = product([sku({ bundleGroupId: 1, bundleGroupName: '上衣', freeStockQty: 2 }),
    sku({ skuId: '22', color: '白色', bundleGroupId: 2, bundleGroupName: '裤子', freeStockQty: 2 })]);
  const fresh = plain(initial);fresh.skuMatrix[0].freeStockQty = 0;
  const env = harness('detail', { product: initial, fresh });
  env.page.setPickedSkuQuantity('11', 2);env.page.setPickedSkuQuantity('22', 1);await env.ready;
  assert.deepEqual(plain(env.page.data.pickedSkuItems.map(row => [row.skuId, row.count, row.freeStockQty])), [['11', 2, 0], ['22', 1, 2]]);
  await env.page.buy();const bundle = env.storage.get('checkoutItems')[0];
  assert.deepEqual(bundle.bundleConfig.map(row => row.readyStockQty), [0, 1]);assert.equal(bundle.readyStockQty, 1);
  assert.equal(productReads(env).length, 1);
});

test('打开刷新失败或返回无效数据，阻止用旧数据购买；重新打开后可重新加载', async () => {
  for (const bad of [() => { throw { message: '网络连接异常，请重试' }; }, () => ({ product: { id: '其他商品', skuMatrix: [] } })]) {
    let fail = true;const env = harness('list', { get: async () => fail ? bad() : { product: product() } });
    await env.ready;assert.equal(env.page.data.skuDataLoading, false);assert.ok(env.page.data.skuDataError);
    await env.page.buy();assert.equal(env.navigation.length, 0);assert.ok(env.toasts.length);
    env.page.closeSkuPanel();fail = false;await env.page.openSkuPanel(event({ product: product() }));
    await env.page.buy();assert.equal(env.navigation.length, 1);assert.equal(env.page.data.skuDataError, '');
  }
});

test('刷新期间切换商品或销毁组件，旧响应不更新新商品也不继续购买', async () => {
  for (const dispose of [false, true]) {
    let finish;const env = harness('detail', { get: () => new Promise(resolve => { finish = resolve; }) });
    if (dispose) env.page.disposeSkuPromotions();
    else env.page.setData({ currentProduct: { id: 'new', skuMatrix: [] }, product: { id: 'new', skuMatrix: [] } });
    finish({ product: product([sku({ freeStockQty: 0 })]) });await env.ready;
    assert.equal(env.navigation.length, 0);assert.equal(env.modals.length, 0);
    if (!dispose) assert.equal(env.page.data.currentProduct.id, 'new');
  }
});

test('加入购物车被服务器拒绝时提示但不重拉SKU、不自动重试', async () => {
  const env = harness('list', { post: async () => { throw { message: '可用库存不足' }; } });await env.ready;
  env.page.setPickedSkuQuantity('11', 3);await env.page.cart();
  assert.equal(env.modals[0].title, '库存不足');assert.equal(env.page.data.quantity, 3);
  assert.equal(env.calls.filter(call => call.url === '/cart/items/batch').length, 1);assert.equal(productReads(env).length, 1);
});

test('直播商品打开时使用直播详情接口，刷新后购买不二次校验', async () => {
  const initial = { ...product(), productType: 'live', sessionStatus: 'live' };
  const env = harness('list', { product: initial });await env.ready;await env.page.buy();
  assert.equal(productReads(env).length, 1);assert.equal(productReads(env)[0].url, '/live-products/' + initial.id);
  assert.equal(env.navigation.length, 1);
});

test('刷新期间切换具体规格，结果到达后保留当前选择与对应件数', async () => {
  let finish;
  const initial = product([sku(), sku({ skuId: '22', color: '白色', size: 'L' })]);
  const env = harness('detail', { product: initial, get: () => new Promise(resolve => { finish = resolve; }) });
  env.page.selectColor(event({ color: '白色' }));env.page.setPickedSkuQuantity('22', 3);
  const fresh = plain(initial);fresh.skuMatrix[1].freeStockQty = 0;
  finish({ product: fresh });await env.ready;
  assert.equal(env.page.data.currentSkuId, '22');assert.equal(env.page.data.quantity, 3);
  assert.equal(env.page.data.selectedColor, '白色');assert.equal(env.page.data.selectedSize, 'L');
  assert.equal(env.page.data.currentSkuFreeStockQty, 0);
});
