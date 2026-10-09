const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { getDefaultSkuSelection } = require('../../utils/skuSelection');

const pages = {};
global.getApp = () => ({});
global.wx = {};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {};
  if (request.endsWith('utils/auth')) return { isAdmin: () => false, isStallManager: () => false };
  if (request.endsWith('utils/shareImage')) return {};
  if (request.endsWith('utils/customerServiceUnread')) return {};
  if (request.endsWith('utils/pageSync')) return { wrap: config => config };
  return originalLoad.call(this, request, ...args);
};
try {
  for (const name of ['index', 'detail']) {
    global.Page = config => { pages[name] = config; };
    require(`../../pages/${name}/${name}.js`);
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

function createPage(name, skus, bundleGroups) {
  const page = Object.assign({}, pages[name]);
  page.data = JSON.parse(JSON.stringify(pages[name].data));
  page.setData = patch => Object.assign(page.data, patch);
  const product = { id: 1, coverUrl: 'cover.jpg', skuMatrix: skus, bundleGroups };
  page.data.product = product;
  page.open = () => page.openSkuPanel(event({ product, action: 'cart' }));
  return page;
}

function option(page, kind, value) {
  return page.data[`${kind}Options`].find(item => item.value === value);
}

test('默认组合按照界面颜色、尺码顺序，而不是有货 SKU 的返回顺序', () => {
  const skus = makeSkus([0, 0, 0, 0, 5, 2]);
  // 尺码已按黑色的 S/M/L 确定展示顺序，白色的 L 却比 M 先返回。
  [skus[4], skus[5]] = [skus[5], skus[4]];
  assert.deepEqual(getDefaultSkuSelection(skus), { selectedColor: '白色', selectedSize: 'M' });
});

for (const name of ['index', 'detail']) {
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
    assert.equal(page.data.quantity, 1);
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
    page.data.quantity = 7;
    // 白色 M 没货，但白色整体有货，不能因当前 M 而禁用白色。
    assert.equal(option(page, 'color', '白色').disabled, false);
    page.selectColor(event({ color: '白色' }));
    assert.equal(page.data.selectedSize, 'S');
    assert.equal(page.data.currentSkuId, 4);
    assert.equal(page.data.quantity, 2);
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
      { name: '裤子', skus: makeSkus([0, 0, 0, 0, 0, 0]) }
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
      assert.equal(page.data.bundleTotalCount, 1);
      assert.equal(page.data.bundleTotalPrice, '24.00');
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
  assert.equal(page.data.bundleTotalCount, 1);
});
