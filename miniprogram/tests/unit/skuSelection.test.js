const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { getDefaultSkuSelection } = require('../../utils/skuSelection');

const pages = {};
let pickerAccount = 1;
let selectionCartRequests = [];
let selectionCartHandler = async () => ({});
global.getApp = () => ({});
const selectionStorage = new Map();
global.wx = {
  getStorageSync: key => selectionStorage.get(key),
  setStorageSync: (key, value) => selectionStorage.set(key, structuredClone(value)),
  removeStorageSync: key => selectionStorage.delete(key),
  showToast() {}, showLoading() {}, hideLoading() {},
  navigateTo(options) { if (options.success) options.success(); }
};
let keyboardHides = 0;
global.wx.hideKeyboard = () => { keyboardHides++; };
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return { post: async (url, data) => { selectionCartRequests.push({ url, data }); return selectionCartHandler(url, data); } };
  if (request.endsWith('utils/auth')) return { isAdmin: () => false, isStallManager: () => false, getUserInfo: () => ({ id: pickerAccount }) };
  if (request.endsWith('utils/shareImage')) return {};
  if (request.endsWith('utils/customerServiceUnread')) return {};
  if (request.endsWith('utils/pageSync')) return { wrap: config => config };
  return originalLoad.call(this, request, ...args);
};
try {
  for (const name of ['index', 'search', 'detail', 'liveRoomDetail']) {
    global.Page = config => { pages[name] = config; };
    require(`../../pages/${name}/${name === 'liveRoomDetail' ? 'detail' : name}.js`);
  }
} finally {
  Module._load = originalLoad;
}

function makeSkus(stocks = [0, 0, 0, 0, 5, 2]) {
  return ['黑色', '白色'].flatMap((color, colorIndex) => ['S', 'M', 'L'].map((size, sizeIndex) => {
    const index = colorIndex * 3 + sizeIndex;
    return { skuId: index + 1, color, size, stock: stocks[index], price: 20 + index, imageUrl: `${color}-${size}.jpg` };
  }));
}

function event(dataset) {
  return { currentTarget: { dataset } };
}

function createPage(name, skus, bundleGroups, preserveCache = false) {
  if (!preserveCache) selectionStorage.clear();
  const page = Object.assign({}, pages[name]);
  page.data = JSON.parse(JSON.stringify(pages[name].data));
  page.setData = patch => Object.assign(page.data, patch);
  const product = { id: 1, coverUrl: 'cover.jpg', skuMatrix: skus, bundleGroups };
  page.data.product = product;
  if (name === 'liveRoomDetail') Object.assign(page.data, { canBuy: true, session: { status: 'live' } });
  if (name === 'search') Object.assign(page.data, { focus: false, searchEditing: false });
  page.open = () => page.openSkuPanel(event({ product, action: 'cart' }));
  return page;
}

function option(page, kind, value) {
  return page.data[`${kind}Options`].find(item => item.value === value);
}

test('仅首页打开规格弹窗触发全量预下载，切换与结算继续保留原始图片地址', t => {
  const requests = [];
  const previews = [];
  let checkout;
  t.mock.method(global.wx, 'hideKeyboard', () => {});
  const previous = { ...global.wx };
  Object.assign(global.wx, {
    downloadFile(options) { requests.push(options); return { abort() {} }; },
    previewImage(options) { previews.push(options); },
    setStorageSync(key, value) { checkout = value; },
    navigateTo(options) { if (options.success) options.success(); }
  });
  t.after(() => {
    for (const key of Object.keys(global.wx)) if (!(key in previous)) delete global.wx[key];
    Object.assign(global.wx, previous);
  });
  const skus = [
    { skuId: 1, color: '红色', stock: 5, price: 20, imageUrl: 'https://cdn/red.jpg' },
    { skuId: 2, color: '蓝色', stock: 5, price: 20, imageUrl: 'https://cdn/blue.jpg' }
  ];
  for (const name of ['search', 'detail']) createPage(name, skus).open();
  assert.equal(requests.length, 0);
  const page = createPage('index', skus);
  page.open();
  assert.equal(page.data.showSku, true);
  assert.deepEqual(requests.map(request => request.url), skus.map(sku => sku.imageUrl));
  requests[1].success({ statusCode: 200, tempFilePath: '/tmp/blue' });
  page.selectColor(event({ color: '蓝色' }));
  assert.equal(page.data.currentSkuImage, skus[1].imageUrl);
  assert.equal(page.data.skuPanelImagePaths[skus[1].imageUrl], '/tmp/blue');
  page.previewSkuPanelImage(event({}));
  assert.equal(previews[0].current, '/tmp/blue');
  page.confirmAddToCart(event({ action: 'buy' }));
  assert.equal(checkout[0].coverUrl, skus[1].imageUrl);
});

test('首页预下载迟到回调不串商品，关闭中止下载，本地图出错回退网络地址', t => {
  const requests = [];
  global.wx.downloadFile = options => {
    const request = { ...options, aborted: false };
    requests.push(request);
    return { abort() { request.aborted = true; options.fail(); } };
  };
  t.after(() => { delete global.wx.downloadFile; });
  const page = createPage('index', [{ skuId: 1, stock: 3, imageUrl: 'https://cdn/old.jpg' }]);
  page.open();
  const product = { id: 2, coverUrl: 'https://cdn/new.jpg', skuMatrix: [] };
  page.openSkuPanel(event({ product }));
  assert.equal(requests[0].aborted, true);
  requests[0].success({ statusCode: 200, tempFilePath: '/tmp/old' });
  assert.deepEqual(page.data.skuPanelImagePaths, {});
  requests[1].success({ statusCode: 200, tempFilePath: '/tmp/new' });
  page.onSkuPanelImageError(event({ url: product.coverUrl }));
  assert.deepEqual(page.data.skuPanelImagePaths, {});
  page.openSkuPanel(event({ product }));
  page.closeSkuPanel(event({}));
  assert.equal(requests[2].aborted, true);
  requests[2].success({ statusCode: 200, tempFilePath: '/tmp/late' });
  assert.deepEqual(page.data.skuPanelImagePaths, {});
});

test('默认组合按照界面颜色、尺码顺序，而不是有货 SKU 的返回顺序', () => {
  const skus = makeSkus([0, 0, 0, 0, 5, 2]);
  // 尺码已按黑色的 S/M/L 确定展示顺序，白色的 L 却比 M 先返回。
  [skus[4], skus[5]] = [skus[5], skus[4]];
  assert.deepEqual(getDefaultSkuSelection(skus), { selectedColor: '白色', selectedSize: 'M' });
});

test('普通规格库存文案互斥：有现货优先显示，无现货恢复原角色和少量库存提示', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  for (const file of ['templates/productSkuPanel.wxml', 'components/productDetail/overlays.wxml']) {
    const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    const template = file.startsWith('components') ? fs.readFileSync(path.join(__dirname, '../../templates/productSkuPanel.wxml'), 'utf8') : source;
    if (file.startsWith('components')) assert.ok(source.includes('../../templates/productSkuPanel.wxml'));
    const branches = [...template.matchAll(/<view class="sku-stock[^"]*" wx:(if|elif)="\{\{(.*?)\}\}">([\s\S]*?)<\/view>/g)]
      .filter(branch => branch[2].includes('bundleSelections.length === 0'));
    assert.deepEqual(branches.map(branch => branch[1]), ['if', 'elif', 'elif']);
    function render(overrides) {
      const data = { bundleSelections: [], currentSkuFreeStockQty: 0, currentSkuStock: 10,
        currentSkuStockText: '10', currentSkuUnlimited: false, isAdmin: false, isStallManager: false, ...overrides };
      const branch = branches.find(item => vm.runInNewContext(item[2], data));
      return branch ? branch[3].trim().replace(/\{\{(.*?)\}\}/g, (_, expression) => vm.runInNewContext(expression, data)) : '';
    }
    assert.equal(render({ currentSkuFreeStockQty: 5, currentSkuStock: 2, isAdmin: true }), '现货：5件');
    assert.equal(render({ currentSkuFreeStockQty: 5, currentSkuUnlimited: true }), '现货：5件');
    assert.equal(render({ currentSkuStock: 2 }), '库存：仅剩2件');
    assert.equal(render({ isAdmin: true }), '库存：10');
    assert.equal(render({ isStallManager: true, currentSkuUnlimited: true, currentSkuStockText: '无限' }), '库存：无限');
    assert.equal(render({}), '');
  }
});

for (const name of ['index', 'search', 'detail']) {
  test(`${name}：数量输入可删空、保留零和超库存值，失焦后再校验`, () => {
    const page = createPage(name, makeSkus());
    page.open();
    for (const [input, expected] of [['', 0], ['0', 0], ['999', 5], ['003', 3]]) {
      page.skuQuantityInputFocus({ currentTarget: { id: 'sku-quantity-input', dataset: {} } });
      page.skuQuantityInput({ detail: { value: input } });
      assert.equal(page.data.quantity, input);
      page.skuQuantityInputBlur({ detail: { value: input } });
      assert.equal(page.data.quantity, expected);
      assert.equal(typeof page.data.quantity, 'number');
    }
    page.data.currentSkuUnlimited = true;
    page._pickedSkus.get(String(page.data.currentSkuId)).unlimitedStock = true;
    page.skuQuantityInput({ detail: { value: '123' } });
    page.skuQuantityInputBlur({ detail: { value: '123' } });
    assert.equal(page.data.quantity, 123);
  });

  test(`${name}：输入中点按钮只收键盘，下一次点击才正常执行`, () => {
    const page = createPage(name, makeSkus());
    page.open();
    page.skuQuantityInputFocus({ currentTarget: { id: 'sku-quantity-input', dataset: {} } });
    page.skuQuantityInput({ detail: { value: '2' } });
    const tap = { target: { id: 'plus' }, currentTarget: { dataset: {} } };
    const hides = keyboardHides;
    page.onSkuQuantityTouchStart(tap);
    page.skuQuantityPlus(tap);
    assert.equal(keyboardHides, hides + 1);
    assert.equal(page.data.quantity, 2);
    page.onSkuQuantityTouchStart(tap);
    page.skuQuantityPlus(tap);
    assert.equal(page.data.quantity, 3);
  });

  test(`${name}：先 blur 后 tap 也不误关弹窗、切规格、预览或提交购买`, () => {
    const actions = ['closeSkuPanel', 'selectColor', 'selectSize', 'skuQuantityMinus', 'skuQuantityPlus',
      'previewSkuPanelImage', name === 'detail' ? 'confirmSkuAction' : 'confirmAddToCart'];
    for (const action of actions) {
      const page = createPage(name, makeSkus([3, 3, 3, 3, 3, 3]));
      page.open();
      page.skuQuantityInputFocus({ currentTarget: { id: 'sku-quantity-input', dataset: {} } });
      page.skuQuantityInput({ detail: { value: '' } });
      const tap = { target: { id: 'other' }, currentTarget: { dataset: { color: '白色', size: 'L', action: 'buy' } } };
      page.onSkuQuantityTouchStart(tap);
      page.skuQuantityInputBlur({ detail: { value: '' } });
      page[action](tap);
      page.onSkuPanelTap(tap);
      assert.equal(page.data.showSku, true, action);
      assert.equal(page.data.selectedColor, '黑色', action);
      assert.equal(page.data.selectedSize, 'S', action);
      assert.equal(page.data.quantity, 0, action);
    }
  });

  test(`${name}：点击当前输入框继续编辑，空白区域先收键盘，再点遮罩才关闭`, () => {
    const page = createPage(name, makeSkus());
    page.open();
    const input = { target: { id: 'sku-quantity-input' }, currentTarget: { id: 'sku-quantity-input', dataset: {} } };
    page.onSkuQuantityTouchStart(input);
    page.skuQuantityInputFocus(input);
    page.skuQuantityInput({ detail: { value: '' } });
    const hides = keyboardHides;
    page.onSkuQuantityTouchStart(input);
    page.onSkuPanelTap(input);
    assert.equal(page.data.quantity, '');
    assert.equal(keyboardHides, hides);
    const outside = { target: { id: 'mask' } };
    page.onSkuQuantityTouchStart(outside);
    page.onSkuPanelTap(outside);
    assert.equal(keyboardHides, hides + 1);
    page.closeSkuPanel(outside); // 同一次点击即便继续传递也不能关闭。
    assert.equal(page.data.showSku, true);
    page.onSkuQuantityTouchStart(outside);
    page.closeSkuPanel(outside);
    assert.equal(page.data.showSku, false);
  });

  test(`${name}：打开弹窗跳过缺货组合，默认白色 M，并同步 SKU 价格、图片和库存`, () => {
    const page = createPage(name, makeSkus());
    page.open();
    assert.equal(page.data.showSku, true);
    assert.equal(page.data.selectedColor, '白色');
    assert.equal(page.data.selectedSize, 'M');
    assert.equal(page.data.currentSkuId, 5);
    assert.equal(page.data.currentSkuStock, 5);
    assert.equal(page.data.currentSkuPrice, 24);
    assert.equal(page.data.currentSkuImage, '白色-M.jpg');
    assert.equal(option(page, 'color', '黑色').disabled, true);
    assert.equal(option(page, 'color', '白色').disabled, false);
    assert.equal(option(page, 'size', 'S').disabled, true);
    assert.equal(option(page, 'size', 'M').disabled, false);
    assert.equal(option(page, 'size', 'L').disabled, false);
  });

  test(`${name}：全部有货时选第一组，关闭重开后重新默认选择`, () => {
    const page = createPage(name, makeSkus([1, 2, 3, 4, 5, 6]));
    page.open();
    assert.equal(page.data.selectedColor, '黑色');
    assert.equal(page.data.selectedSize, 'S');
    page.selectSize(event({ size: 'L' }));
    page.selectColor(event({ color: '白色' }));
    assert.equal(page.data.currentSkuId, 6);
    page.closeSkuPanel();
    page.open();
    assert.equal(page.data.currentSkuId, 1);
    assert.equal(page.data.quantity, 0);
  });

  test(`${name}：缺货颜色、缺货尺码和不存在的规格，即便触发点击也不能选中`, () => {
    const page = createPage(name, makeSkus());
    page.open();
    for (const color of ['黑色', '蓝色']) page.selectColor(event({ color }));
    for (const size of ['S', 'XL']) page.selectSize(event({ size }));
    assert.equal(page.data.selectedColor, '白色');
    assert.equal(page.data.selectedSize, 'M');
    assert.equal(page.data.currentSkuId, 5);
    page.selectSize(event({ size: 'L' }));
    assert.equal(page.data.currentSkuId, 6);
  });

  test(`${name}：换颜色保留可售尺码，否则选新颜色的首个有货尺码，数量跟随库存限制`, () => {
    const page = createPage(name, makeSkus([0, 8, 0, 2, 0, 6]));
    page.open();
    page.setPickedSkuQuantity(page.data.currentSkuId, 7);
    // 白色 M 没货，但白色整体有货，不能因当前 M 而禁用白色。
    assert.equal(option(page, 'color', '白色').disabled, false);
    page.selectColor(event({ color: '白色' }));
    assert.equal(page.data.selectedSize, 'S');
    assert.equal(page.data.currentSkuId, 4);
    assert.equal(page.data.quantity, 0);
    assert.equal(option(page, 'size', 'M').disabled, true);
    page.selectColor(event({ color: '黑色' }));
    assert.equal(page.data.selectedSize, 'M');
    assert.equal(option(page, 'size', 'S').disabled, true);

    const keep = createPage(name, makeSkus([0, 8, 0, 2, 3, 6]));
    keep.open();
    keep.selectColor(event({ color: '白色' }));
    assert.equal(keep.data.selectedSize, 'M');
    assert.equal(keep.data.currentSkuId, 5);
  });

  test(`${name}：未配置的颜色尺码组合也禁用`, () => {
    const page = createPage(name, [
      { skuId: 1, color: '黑色', size: 'S', stock: 2 },
      { skuId: 2, color: '白色', size: 'M', stock: 3 }
    ]);
    page.open();
    assert.equal(option(page, 'size', 'M').disabled, true);
    page.selectColor(event({ color: '白色' }));
    assert.equal(page.data.currentSkuId, 2);
    assert.equal(option(page, 'size', 'S').disabled, true);
  });

  test(`${name}：唯一缺货规格和无 SKU 商品不自动选中，也不遗留旧 SKU`, () => {
    for (const skus of [[{ skuId: 1, color: '黑色', size: 'S', stock: 0 }], []]) {
      const page = createPage(name, skus);
      page.data.currentSkuId = 999;
      page.data.currentSkuPrice = 999;
      page.open();
      assert.equal(page.data.selectedColor, '');
      assert.equal(page.data.selectedSize, '');
      assert.equal(page.data.currentSkuId, null);
      assert.equal(page.data.currentSkuStock, 0);
      assert.equal(page.data.currentSkuSoldOut, true);
      assert.ok(page.data.colorOptions.every(item => item.disabled));
      assert.ok(page.data.sizeOptions.every(item => item.disabled));
    }
  });

  test(`${name}：无限库存 SKU 即使数值库存为零也能自动选中和切换`, () => {
    const skus = makeSkus([0, 0, 0, 0, 0, 0]);
    skus[4].unlimitedStock = true;
    const page = createPage(name, skus);
    page.open();
    assert.equal(page.data.currentSkuId, 5);
    assert.equal(page.data.currentSkuUnlimited, true);
    assert.equal(option(page, 'size', 'M').disabled, false);
    assert.equal(option(page, 'color', '白色').disabled, false);
  });

  test(`${name}：只有一个规格维度或无规格维度时，也能匹配可售 SKU`, () => {
    for (const sku of [
      { skuId: 1, color: '白色', stock: 3 },
      { skuId: 2, size: 'M', stock: 3 },
      { skuId: 3, stock: 3 }
    ]) {
      const page = createPage(name, [sku]);
      page.open();
      assert.equal(page.data.currentSkuId, sku.skuId);
      assert.equal(page.data.currentSkuStock, 3);
    }
  });

  test(`${name}：套装各子项跳过缺货规格，缺货子项不会计入已选`, () => {
    const groups = [
      { name: '上衣', skus: makeSkus() },
      { name: '裤子', skus: makeSkus([0, 0, 0, 0, 0, 0]).map(sku => ({ ...sku, skuId: sku.skuId + 100 })) }
    ];
    const page = createPage(name, groups.flatMap(group => group.skus), groups);
    page.open();
    const [top, pants] = page.data.bundleSelections;
    assert.equal(top.selectedColor, '白色');
    assert.equal(top.selectedSize, 'M');
    assert.equal(top.selectedSku.skuId, 5);
    assert.equal(top.colorOptions.find(item => item.value === '黑色').disabled, true);
    assert.equal(top.sizeOptions.find(item => item.value === 'S').disabled, true);
    assert.equal(pants.selectedSku, null);
    assert.equal(pants.selectedColor, '');
    assert.equal(pants.selectedSize, '');
    assert.equal(page.data.bundleAllSelected, true);
    if (name === 'index') {
      assert.equal(page.data.bundleTotalCount, 0);
      assert.equal(page.data.bundleTotalPrice, '0.00');
    }
    page.selectBundleColor(event({ index: 0, color: '黑色' }));
    page.selectBundleSize(event({ index: 0, size: 'S' }));
    page.selectBundleColor(event({ index: 1, color: '白色' }));
    assert.equal(page.data.bundleSelections[0].selectedSku.skuId, 5);
    assert.equal(page.data.bundleSelections[1].selectedSku, null);
  });

  test(`${name}：套装切颜色时自动切到可售尺码`, () => {
    const skus = makeSkus([0, 8, 0, 2, 0, 6]);
    const page = createPage(name, skus, [{ name: '上衣', skus }]);
    page.open();
    page.selectBundleColor(event({ index: 0, color: '白色' }));
    const selection = page.data.bundleSelections[0];
    assert.equal(selection.selectedColor, '白色');
    assert.equal(selection.selectedSize, 'S');
    assert.equal(selection.selectedSku.skuId, 4);
    assert.equal(selection.sizeOptions.find(item => item.value === 'M').disabled, true);
  });

  test(`${name}：套装兼容 stockMain 和无限库存字段`, () => {
    const skus = [
      { id: 1, spec: '黑色', size: 'S', stockMain: 0 },
      { id: 2, spec: '白色', size: 'M', stockMain: 0, isUnlimitedStock: true, retailPrice: 30 }
    ];
    const page = createPage(name, [], [{ name: '上衣', skus }]);
    page.open();
    const selection = page.data.bundleSelections[0];
    assert.equal(selection.selectedSku.skuId, 2);
    assert.equal(selection.selectedSku.unlimitedStock, true);
    assert.equal(selection.selectedSku.price, 30);
  });
}

test('首页套装保留再次点击取消子项的交互，取消后不再计价', () => {
  const skus = makeSkus();
  const page = createPage('index', skus, [{ name: '上衣', skus }]);
  page.open();
  page.selectBundleColor(event({ index: 0, color: '白色' }));
  assert.equal(page.data.bundleSelections[0].selectedSku, null);
  assert.equal(page.data.bundleTotalCount, 0);
  assert.equal(page.data.bundleTotalPrice, '0.00');
  assert.equal(page.data.bundleAllSelected, false);
  page.selectBundleColor(event({ index: 0, color: '白色' }));
  assert.equal(page.data.bundleSelections[0].selectedSku.skuId, 5);
  assert.equal(page.data.bundleTotalCount, 0);
});

for (const name of ['index', 'search']) {
  test(`${name}：套装数量编辑不提前校验，失焦统一更新库存限制、件数和总价`, () => {
    const skus = makeSkus();
    const page = createPage(name, skus, [{ name: '上衣', skus }]);
    page.open();
    for (const [input, expected] of [['', 0], ['0', 0], ['99', 5], ['3', 3]]) {
      const e = { currentTarget: { id: 'bundle-quantity-0', dataset: { index: 0 } }, detail: { value: input } };
      page.skuQuantityInputFocus(e);
      page.bundleInput(e);
      assert.equal(page.data.bundleSelections[0].quantity, input);
      page.bundleInputBlur(e);
      assert.equal(page.data.bundleSelections[0].quantity, expected);
      assert.equal(page.data.bundleTotalCount, expected);
      assert.equal(page.data.bundleTotalPrice, (24 * expected).toFixed(2));
    }
  });

  test(`${name}：套装数量失焦后同一次点击不触发加减、选规格和购买`, () => {
    for (const action of ['bundleMinus', 'bundlePlus', 'selectBundleColor', 'selectBundleSize', 'previewBundleImage', 'confirmAddToCart']) {
      const skus = makeSkus();
      const page = createPage(name, skus, [{ name: '上衣', skus }]);
      page.open();
      const input = { currentTarget: { id: 'bundle-quantity-0', dataset: { index: 0 } }, detail: { value: '3' } };
      page.skuQuantityInputFocus(input);
      page.bundleInput(input);
      const button = { target: { id: 'other' }, currentTarget: { dataset: { index: 0, color: '白色', size: 'L', action: 'buy', url: 'image.jpg' } } };
      page.onSkuQuantityTouchStart(button);
      page.bundleInputBlur(input);
      page[action](button);
      assert.equal(page.data.showSku, true, action);
      assert.equal(page.data.bundleSelections[0].quantity, 3, action);
      assert.equal(page.data.bundleSelections[0].selectedSku.skuId, 5, action);
      assert.equal(page.data.bundleTotalPrice, '72.00', action);
    }
  });
}

for (const name of ['index', 'search', 'detail']) {
  test(`${name}：现货跟随选中规格，切换及清空不串数，购买上限仍使用可售库存`, () => {
    const skus = [
      { skuId: 1, color: '红色', size: 'M', stock: 10, freeStockQty: 2, price: 20 },
      { skuId: 2, color: '蓝色', size: 'M', stock: 3, freeStockQty: 0, price: 20 },
      { skuId: 3, color: '白色', size: 'M', stock: 0, unlimitedStock: true, freeStockQty: 7, price: 20 }
    ];
    const page = createPage(name, skus);
    page.open();
    assert.equal(page.data.currentSkuFreeStockQty, 2);
    page.setPickedSkuQuantity(page.data.currentSkuId, 4);
    page.checkSkuMatch();
    assert.equal(page.data.quantity, 4);
    assert.equal(page.data.currentSkuStock, 10);
    page.selectColor(event({ color: '蓝色' }));
    assert.equal(page.data.currentSkuFreeStockQty, 0);
    assert.equal(page.data.currentSkuStockText, '3');
    page.selectColor(event({ color: '白色' }));
    assert.equal(page.data.currentSkuFreeStockQty, 7);
    assert.equal(page.data.currentSkuUnlimited, true);
    page.setData({ selectedColor: '', selectedSize: '' });
    page.checkSkuMatch();
    assert.equal(page.data.currentSkuFreeStockQty, 0);
  });

  test(`${name}：套装从规格矩阵读取空闲现货，切换子项规格同步更新`, () => {
    const skus = [
      { skuId: 1, color: '红色', size: 'M', stock: 10, freeStockQty: 2, price: 20 },
      { skuId: 2, color: '蓝色', size: 'M', stock: 10, freeStockQty: 0, price: 20 }
    ];
    const bundleGroups = [{ name: '上衣', skus: skus.map(({ freeStockQty, skuId, ...sku }) => ({ ...sku, id: skuId })) }];
    const page = createPage(name, skus, bundleGroups);
    page.open();
    assert.equal(page.data.bundleSelections[0].selectedSku.freeStockQty, 2);
    page.selectBundleColor(event({ index: 0, color: '蓝色' }));
    assert.equal(page.data.bundleSelections[0].selectedSku.freeStockQty, 0);
  });
}

for (const name of ['index', 'search', 'detail', 'liveRoomDetail']) {
  test(`${name}：各规格数量独立保存，切回恢复件数，清单与颜色尺码角标同步`, () => {
    const skus = ['红色', '黑色'].flatMap((color, i) => ['S', 'M'].map((size, j) => ({
      skuId: i * 2 + j + 1, color, size, stock: 200, price: i ? 0.2 : 0.1
    })));
    const page = createPage(name, skus);
    page.open();
    assert.equal(page.data.quantity, 0);
    page.setPickedSkuQuantity(1, 2);
    page.selectSize(event({ size: 'M' }));
    assert.equal(page.data.quantity, 0);
    page.setPickedSkuQuantity(2, 3);
    page.selectColor(event({ color: '黑色' }));
    assert.equal(page.data.quantity, 0);
    page.setPickedSkuQuantity(4, 1);
    assert.equal(page.data.pickedTotalCount, 6);
    assert.equal(page.data.pickedTotalPrice, '0.70');
    page.selectColor(event({ color: '红色' }));
    assert.equal(page.data.quantity, 3);
    assert.equal(option(page, 'color', '红色').pickedCount, 5);
    assert.equal(option(page, 'color', '黑色').pickedCount, 1);
    assert.equal(option(page, 'size', 'M').pickedCount, 3);
    page.selectSize(event({ size: 'S' }));
    assert.equal(page.data.quantity, 2);
    page.pickedQuantityMinus(event({ skuId: '1' }));
    assert.equal(page.data.quantity, 1);
    page.pickedQuantityMinus(event({ skuId: '1' }));
    assert.equal(page.data.quantity, 0);
    assert.equal(page.data.pickedSkuItems.some(item => item.skuId === '1'), false);
    assert.equal(page.data.pickedTotalCount, 4);
  });

  test(`${name}：关闭再开及跨页面恢复缓存，使用最新库存和价格，账号互相隔离`, () => {
    const skus = [{ skuId: 1, color: '红色', size: 'M', stock: 10, price: 10 }];
    const page = createPage(name, skus);
    page.open();
    page.setPickedSkuQuantity(1, 7);
    page.closeSkuPanel(); page.open();
    assert.equal(page.data.quantity, 7);
    const restored = createPage(name, [{ ...skus[0], stock: 3, price: 12 }], undefined, true);
    restored.open();
    assert.equal(restored.data.quantity, 3);
    assert.equal(restored.data.pickedTotalPrice, '36.00');
    pickerAccount = 2;
    restored.open();
    assert.equal(restored.data.pickedTotalCount, 0);
    pickerAccount = 1;
    restored.open();
    assert.equal(restored.data.quantity, 3);
  });

  test(`${name}：多规格统一加购，失败保留清单且不重复提交，成功清空本地缓存`, async () => {
    selectionCartRequests = [];
    let reject;
    selectionCartHandler = () => new Promise((resolve, fail) => { reject = fail; });
    const skus = [
      { skuId: 1, color: '红色', size: 'M', stock: 10, price: 10 },
      { skuId: 2, color: '黑色', size: 'M', stock: 10, price: 12 }
    ];
    const page = createPage(name, skus);
    page.open(); page.setPickedSkuQuantity(1, 2); page.setPickedSkuQuantity(2, 3);
    const submit = name === 'detail' ? 'confirmSkuAction' : 'confirmAddToCart';
    const task = page[submit](event({ action: 'cart' }));
    page[submit](event({ action: 'cart' }));
    assert.equal(selectionCartRequests.length, 1);
    assert.deepEqual(selectionCartRequests[0].data.items.map(item => item.count), [2, 3]);
    reject({ message: '模拟批量加购失败' });
    await task;
    assert.equal(page.data.pickedTotalCount, 5);
    assert.equal(page.data.showSku, true);
    selectionCartHandler = async () => ({});
    await page[submit](event({ action: 'cart' }));
    assert.equal(page.data.pickedTotalCount, 0);
    assert.equal(selectionStorage.has(page._pickedDraftKey), false);
    page.open();
    assert.equal(page.data.quantity, 0);
  });

  test(`${name}：手动减到0且清单为空时补当前规格1件，有清单时不补当前零件数规格`, async () => {
    selectionCartRequests = [];
    selectionCartHandler = async () => ({});
    const page = createPage(name, [
      { skuId: 1, color: '红色', size: 'M', stock: 5, price: 10 },
      { skuId: 2, color: '黑色', size: 'M', stock: 5, price: 10 }
    ]);
    page.open(); page.skuQuantityPlus(); page.skuQuantityMinus();
    assert.equal(page.data.quantity, 0);
    const submit = name === 'detail' ? 'confirmSkuAction' : 'confirmAddToCart';
    await page[submit](event({ action: 'cart' }));
    assert.equal(selectionCartRequests[0].data.items[0].count, 1);
    page.open(); page.setPickedSkuQuantity(1, 2); page.selectColor(event({ color: '黑色' }));
    assert.equal(page.data.quantity, 0);
    await page[submit](event({ action: 'cart' }));
    assert.deepEqual(selectionCartRequests.at(-1).data.items.map(item => item.skuId), ['1']);
  });

  test(`${name}：立即购买提交全部规格，进入结算不清缓存，订单成功后才清对应版本`, async () => {
    const page = createPage(name, [
      { skuId: 1, color: '红色', size: 'M', stock: 10, price: 10 },
      { skuId: 2, color: '黑色', size: 'M', stock: 10, price: 12 }
    ]);
    page.open(); page.setPickedSkuQuantity(1, 2); page.setPickedSkuQuantity(2, 3);
    await page[name === 'detail' ? 'confirmSkuAction' : 'confirmAddToCart'](event({ action: 'buy' }));
    const checkout = selectionStorage.get('checkoutItems');
    assert.deepEqual(checkout.map(item => item.count), [2, 3]);
    assert.equal(selectionStorage.has(page._pickedDraftKey), true);
    const drafts = require('../../utils/skuSelectionDraft');
    drafts.clearCheckoutDrafts(checkout);
    assert.equal(selectionStorage.has(page._pickedDraftKey), false);
    page.open(); page.setPickedSkuQuantity(1, 4);
    drafts.clearCheckoutDrafts(checkout);
    assert.equal(selectionStorage.get(page._pickedDraftKey).quantities['1'], 4);
  });
}

test('件数角标超过99显示99+；仅单颜色或单尺码隐藏对应角标，图片色和均码按选项个数处理', () => {
  const { decorateOptions, normalizedProduct } = require('../../utils/skuSelectionList');
  const skus = normalizedProduct({ skuMatrix: [
    { skuId: 1, color: '红色', size: 'S', stock: 500 },
    { skuId: 2, color: '红色', size: 'M', stock: 500 },
    { skuId: 3, color: '黑色', size: 'M', stock: 500 }
  ] }).skuMatrix;
  const page = createPage('index', skus); page.open();
  page.setPickedSkuQuantity(1, 100); page.setPickedSkuQuantity(2, 2);
  assert.equal(page.data.pickedTotalCount, 102);
  assert.equal(page.data.pickedCountText, '99+');
  assert.equal(page.data.colorOptions[0].pickedCountText, '99+');
  assert.equal(page.data.sizeOptions[0].pickedCountText, '99+');
  const black = decorateOptions(skus, '黑色', { 3: 1 });
  assert.equal(black.sizeOptions.find(item => item.value === 'M').showPickedCount, true);
  assert.equal(black.sizeOptions.find(item => item.value === 'M').pickedCount, 1);
  const singleColor = decorateOptions(skus.slice(0, 2), '红色', { 1: 1 });
  assert.equal(singleColor.colorOptions[0].showPickedCount, false);
  const defaults = normalizedProduct({ skuMatrix: [{ skuId: 4, stock: 10 }] }).skuMatrix;
  const options = decorateOptions(defaults, '图片色', { 4: 2 });
  assert.equal(options.colorOptions[0].value, '图片色');
  assert.equal(options.sizeOptions[0].value, '均码');
  assert.equal(options.colorOptions[0].showPickedCount, false);
  assert.equal(options.sizeOptions[0].showPickedCount, false);
  const mixedSkus = normalizedProduct({ skuMatrix: [
    { skuId: 5, color: '图片色', size: '均码', stock: 10 },
    { skuId: 6, color: '绿色', size: 'L', stock: 10 }
  ] }).skuMatrix;
  const mixed = decorateOptions(mixedSkus, '图片色', { 5: 2, 6: 3 });
  assert.equal(mixed.colorOptions.find(item => item.value === '图片色').showPickedCount, true);
  assert.equal(mixed.colorOptions.find(item => item.value === '图片色').pickedCount, 2);
  assert.equal(mixed.sizeOptions.find(item => item.value === '均码').showPickedCount, true);
  assert.equal(mixed.sizeOptions.find(item => item.value === '均码').pickedCount, 2);
});

test('全部商品购买弹窗直接复用首页模板及样式，直播结束后不能打开购买', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const [template, styles] of [
    ['components/productDetail/overlays.wxml', 'components/productDetail/index.wxss'],
    ['pages/liveRoomDetail/detail.wxml', 'pages/liveRoomDetail/detail.wxss']
  ]) {
    assert.ok(fs.readFileSync(path.join(__dirname, '../..', template), 'utf8').includes('../../templates/productSkuPanel.wxml'));
    assert.ok(fs.readFileSync(path.join(__dirname, '../..', styles), 'utf8').includes('../../styles/productSkuPanel.wxss'));
  }
  const page = createPage('liveRoomDetail', [{ skuId: 1, stock: 5, price: 10 }]);
  page.data.canBuy = false;
  page.open();
  assert.equal(page.data.showSku, false);
});

for (const name of ['index', 'search', 'detail', 'liveRoomDetail']) {
  test(`${name}：套装同一子项可选多个规格，完整清单合并提交一组套装`, async () => {
    selectionCartRequests = [];
    selectionCartHandler = async () => ({});
    const skus = [
      { skuId: 11, color: '红色', size: 'M', stock: 10, price: 10, bundleGroupId: 1, bundleGroupName: '上衣' },
      { skuId: 12, color: '黑色', size: 'M', stock: 10, price: 12, bundleGroupId: 1, bundleGroupName: '上衣' },
      { skuId: 21, color: '黑色', size: 'M', stock: 10, price: 20, bundleGroupId: 2, bundleGroupName: '裤子' }
    ];
    const page = createPage(name, skus);
    page.open();
    page.setPickedSkuQuantity(11, 2); page.setPickedSkuQuantity(12, 3); page.setPickedSkuQuantity(21, 1);
    page.selectBundleColor(event({ index: 0, color: '黑色' }));
    assert.equal(page.data.bundleSelections[0].quantity, 3);
    assert.equal(page.data.pickedTotalPrice, '76.00');
    await page[name === 'detail' ? 'confirmSkuAction' : 'confirmAddToCart'](event({ action: 'cart' }));
    assert.equal(selectionCartRequests[0].data.items.length, 1);
    assert.deepEqual(selectionCartRequests[0].data.items[0].bundleConfig.map(item => item.count), [2, 3, 1]);
    assert.equal(page.data.pickedTotalCount, 0);
  });
}

for (const name of ['index', 'search', 'detail', 'liveRoomDetail']) {
  test(`${name}：已选入口切换展开收起，保留规格弹窗、件数和金额`, () => {
    const page = createPage(name, [{ skuId: 1, color: '红色', size: 'M', stock: 5, price: 20 }]);
    page.open(); page.setPickedSkuQuantity(1, 2);
    page.openPickedSkus();
    assert.equal(page.data.showPickedSkus, true);
    assert.equal(page.data.showSku, true);
    page.openPickedSkus();
    assert.equal(page.data.showPickedSkus, false);
    page.openPickedSkus(); page.closePickedSkus();
    assert.equal(page.data.showPickedSkus, false);
    assert.equal(page.data.pickedTotalCount, 2);
    assert.equal(page.data.pickedTotalPrice, '40.00');
    assert.equal(page.data.quantity, 2);
  });
}

test('首页购买入口与搜索加购入口分别保存默认操作', () => {
  const skus = [{ skuId: 1, color: '红色', size: 'M', stock: 5, price: 20 }];
  const home = createPage('index', skus); home.open();
  assert.equal(home.data.skuAction, 'buy');
  const search = createPage('search', skus); search.open();
  assert.equal(search.data.skuAction, 'cart');
});

test('详情根据外层按钮选择动作，重新从规格选择器进入恢复默认购买', () => {
  const page = createPage('detail', [{ skuId: 1, color: '红色', size: 'M', stock: 5, price: 20 }]);
  page.openSkuPanel(event({ action: 'cart' }));
  assert.equal(page.data.skuAction, 'cart');
  page.closeSkuPanel(); page.openSkuPanel(event({}));
  assert.equal(page.data.skuAction, 'buy');
  page.closeSkuPanel(); page.openSkuPanel(event({ action: 'buy' }));
  assert.equal(page.data.skuAction, 'buy');
});

test('直播加购和购买入口保存对应的默认操作', () => {
  const page = createPage('liveRoomDetail', [{ skuId: 1, color: '红色', size: 'M', stock: 5, price: 20 }]);
  page.open(); assert.equal(page.data.skuAction, 'cart');
  page.closeSkuPanel(); page.openSkuPanel(event({ product: page.data.product, action: 'buy' }));
  assert.equal(page.data.skuAction, 'buy');
});

for (const name of ['index', 'search', 'detail', 'liveRoomDetail']) {
  test(`${name}：切换规格每个渲染状态都保留完整件数，不出现角标先消失再补回的中间帧`, () => {
    const skus = makeSkus([20, 20, 20, 20, 20, 20]);
    const page = createPage(name, skus);
    page.open();
    skus.forEach(sku => page.setPickedSkuQuantity(sku.skuId, sku.skuId));
    const frames = [];
    page.setData = patch => {
      Object.assign(page.data, patch);
      frames.push({ patch: structuredClone(patch), data: structuredClone(page.data) });
    };
    page.selectColor(event({ color: '白色' }));
    assert.equal(frames.length, 1);
    assert.equal('colorOptions' in frames[0].patch, false, '颜色总件数未变化时不重新发送整份颜色列表');
    assert.equal(page.data.quantity, 4);
    page.selectSize(event({ size: 'M' }));
    assert.equal(frames.length, 2);
    assert.equal('colorOptions' in frames[1].patch, false);
    assert.equal('sizeOptions' in frames[1].patch, false, '只切尺码时不重新发送未变化的角标列表');
    assert.equal(page.data.quantity, 5);
    for (const { data } of frames) {
      assert.equal(data.pickedTotalCount, 21);
      const selectedSku = skus.find(sku => sku.skuId === data.currentSkuId);
      assert.equal(selectedSku.color, data.selectedColor);
      assert.equal(selectedSku.size, data.selectedSize);
      assert.equal(data.quantity, selectedSku.skuId);
      assert.deepEqual(data.colorOptions.map(option => option.pickedCount), [6, 15]);
      assert.deepEqual(data.sizeOptions.map(option => option.pickedCount), [4, 5, 6]);
      assert.ok([...data.colorOptions, ...data.sizeOptions].every(option => option.showPickedCount === true));
    }
    page.selectSize(event({ size: 'M' }));
    assert.equal(frames.length, 2, '重复选择相同规格不触发无意义重绘');
  });

  test(`${name}：套装切换子项规格时所有角标持续存在，总件数不经过错误中间值`, () => {
    const top = makeSkus([20, 20, 20, 20, 20, 20]);
    const pants = top.map(sku => ({ ...sku, skuId: sku.skuId + 100 }));
    const page = createPage(name, [...top, ...pants], [{ name: '上衣', skus: top }, { name: '裤子', skus: pants }]);
    page.open();
    [...top, ...pants].forEach(sku => page.setPickedSkuQuantity(sku.skuId, 2));
    const frames = [];
    page.setData = patch => { Object.assign(page.data, patch); frames.push(structuredClone(page.data)); };
    page.selectBundleColor(event({ index: 0, color: '白色' }));
    assert.equal(frames.length, 1);
    page.selectBundleSize(event({ index: 0, size: 'M' }));
    assert.equal(frames.length, 2);
    for (const data of frames) {
      assert.equal(data.pickedTotalCount, 24);
      assert.equal(data.bundleTotalCount, 24);
      for (const group of data.bundleSelections) {
        assert.equal(group.quantity, 2);
        assert.deepEqual(group.colorOptions.map(option => option.pickedCount), [6, 6]);
        assert.deepEqual(group.sizeOptions.map(option => option.pickedCount), [2, 2, 2]);
        assert.ok([...group.colorOptions, ...group.sizeOptions].every(option => option.showPickedCount === true));
      }
    }
  });
}
