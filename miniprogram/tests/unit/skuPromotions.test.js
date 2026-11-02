const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const display = require('../../utils/skuPromotionDisplay');
const skuMoneyText = require('../../utils/skuMoneyText');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve;const promise = new Promise(r => { resolve = r; });return { promise, resolve }; };
const offer = status => ({ type: 'FIRST', amount: 10, rules: [], status });
const product = id => ({ id, name: '新优惠商品', skuMatrix: [
  { skuId: id + '1', color: '红', size: 'M', price: 100, stock: 100 },
  { skuId: id + '2', color: '蓝', size: 'M', price: 100, stock: 100 }
] });
function quote(skuId, count, discount = 10, status = 'AVAILABLE') {
  return { originalGoodsAmount: 100 * count, discountAmount: discount, goodsAmount: 100 * count - discount,
    items: [{ skuId, quantity: count, settlementAmount: 100 * count - discount }],
    applied: discount ? [{ scheme: { type: 'FIRST' }, discountAmount: discount }] : [], offers: { p: [offer(status)] } };
}
function picker(handlers = {}) {
  const storage = new Map(), calls = [], purchases = [];
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => { storage.set(key, value);if (key === 'checkoutItems') purchases.push(value); },
    removeStorageSync: key => storage.delete(key), showToast() {}, hideKeyboard() {},
    navigateTo: value => value.success(), showLoading() {}, hideLoading() {} };
  const api = { get: handlers.get || (async () => [offer('AVAILABLE')]),
    post: async (url, data) => { calls.push({ url, data: plain(data) });return handlers.post ? handlers.post(url, data) : quote(data.items[0].skuId, data.items[0].qty); } };
  function load(name) {
    const filename = path.resolve(__dirname, '../../utils', name + '.js'), module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, wx, console,
      require(dependency) {
        if (dependency.endsWith('/api')) return api;
        if (dependency.endsWith('/auth')) return { getUserInfo: () => ({ id: 1 }) };
        if (dependency.endsWith('/skuSelectionDraft')) return load('skuSelectionDraft');
        return require(path.resolve(path.dirname(filename), dependency));
      } });return module.exports;
  }
  const selection = load('skuSelectionList');
  const config = selection.enhancePicker({
    openSkuPanel(e) {
      const p = e.currentTarget.dataset.product;
      this.setData({ currentProduct: p, showSku: true, currentSkuId: p.skuMatrix[0].skuId,
        currentSkuPrice: 100, selectedColor: '红', selectedSize: 'M', bundleSelections: [] });
    }, closeSkuPanel() { this.setData({ showSku: false }); }, checkSkuMatch() {}, onUnload() {}
  });
  const page = { ...config, data: structuredClone(selection.initialData), setData(patch) { Object.assign(this.data, patch); } };
  page.open = p => page.openSkuPanel({ currentTarget: { dataset: { product: p } } });
  return { page, calls, purchases };
}

test('弹窗金额先四舍五入到分，再省略小数末尾的零，最多两位小数且不吞掉零元', () => {
  for (const [value, expected] of [[299, '299'], ['299.00', '299'], ['299.999', '300'],
    ['299.004', '299'], ['299.005', '299.01'], ['299.126', '299.13'], ['299.10', '299.1'],
    ['299.104', '299.1'], ['299.196', '299.2'], [100, '100'], ['0.10', '0.1'],
    [1.005, '1.01'], [0, '0'], ['0.004', '0'], ['0.005', '0.01']]) {
    assert.equal(skuMoneyText(value), expected);
  }
});

test('弹窗未选及已选整元展示一致，展示格式不改变计算金额和下单原价', async () => {
  const { page, purchases } = picker();page.open(product('p'));await tick();
  assert.equal(page.data.currentSkuOriginalPriceText, '100');
  page.setPickedSkuQuantity('p1', 2);await tick();
  assert.equal(page.data.skuMoneyText.pickedOriginalPrice, '200');
  assert.equal(page.data.skuMoneyText.pickedGoodsPrice, '190');
  assert.equal(page.data.skuMoneyText.pickedDiscountPrice, '10');
  assert.equal(page.data.skuMoneyText.pickedAverageUnitPrice, '95');
  assert.equal(page.data.pickedSkuItems[0].unitPriceDisplay, '95');
  assert.equal(page.data.pickedSkuItems[0].priceDisplay, '100');
  assert.equal(page.data.pickedPromotionRows[0].amountDisplay, '10');
  assert.equal(page.data.pickedGoodsPrice, '190.00');
  await page.confirmAddToCart({ currentTarget: { dataset: { action: 'buy' } } });
  assert.equal(purchases[0][0].price, 100);assert.equal(purchases[0][0].count, 2);
});

test('首单已付款及待支付占用都显示已使用，规则只展示购买者需要的内容', () => {
  const result = display.offersForDisplay([offer('USED'), offer('RESERVED'),
    { type: 'AMOUNT', rules: [{ thresholdAmount: 100, amount: 10 }, { thresholdAmount: 200, amount: 30 }] },
    { type: 'RATE', rules: [{ minimumQty: 3, discountPercent: 85 }] },
    { type: 'QUANTITY', rules: [{ minimumQty: 2, amount: 5 }] }]);
  assert.equal(result[0].statusText, '已使用');assert.equal(result[1].statusText, '已使用');
  assert.deepEqual(result[0].rulesText, ['首单优惠减10元']);
  assert.deepEqual(result[2].rulesText, ['满100元减10元', '满200元减30元']);
  assert.deepEqual(result[3].rulesText, ['满3件打8.5折']);assert.deepEqual(result[4].rulesText, ['满2件减5元']);
});

test('先首单再多件多折，单价仅按行成交额展示，合计保留准确分币尾差', () => {
  const items = [{ skuId: '1', count: 2, price: 99.99 }, { skuId: '2', count: 1, price: 49.99 }];
  const result = display.pricing(items, { originalGoodsAmount: 249.97, discountAmount: 43.45, goodsAmount: 206.52,
    applied: [{ scheme: { type: 'FIRST' }, discountAmount: 7.01 }, { scheme: { type: 'RATE' }, discountAmount: 36.44 }],
    items: [{ skuId: '1', quantity: 2, settlementAmount: 165.21 }, { skuId: '2', quantity: 1, settlementAmount: 41.31 }] });
  assert.equal(result.pickedOriginalPrice, '249.97');assert.equal(result.pickedGoodsPrice, '206.52');
  assert.equal(result.pickedDiscountPrice, '43.45');assert.equal(result.pickedSkuItems[0].unitPriceText, '82.61');
  assert.equal(result.pickedSkuItems[0].unitApproximate, true);
  assert.deepEqual(result.pickedDiscountRows.map(row => row.label), ['首单优惠', '多件多折']);
});

test('零元分摊不会回退原价，错误的成交合计或优惠明细被拒绝', () => {
  const items = [{ skuId: '1', count: 1, price: 100 }, { skuId: '2', count: 1, price: 0.01 }];
  const value = { originalGoodsAmount: 100.01, discountAmount: 100, goodsAmount: 0.01,
    applied: [{ scheme: { type: 'FIRST' }, discountAmount: 100 }],
    items: [{ skuId: '1', quantity: 1, settlementAmount: 0 }, { skuId: '2', quantity: 1, settlementAmount: 0.01 }] };
  assert.equal(display.pricing(items, value).pickedSkuItems[0].unitPriceText, '0.00');
  assert.throws(() => display.pricing(items, { ...value, goodsAmount: 0.02 }), /金额校验/);
  assert.throws(() => display.pricing(items, { ...value, applied: [] }), /明细合计/);
});

test('未加入清单的当前SKU仍显示原价；切回已选SKU恢复其成交单价，清空后不残留优惠', async () => {
  const { page } = picker();page.open(product('p'));await tick();
  page.setPickedSkuQuantity('p1', 1);await tick();assert.equal(page.data.currentSkuUnitPrice, '90.00');
  assert.equal(page.data.currentSkuDiscounted, true);
  page.checkSkuMatch({ selectedColor: '蓝' });assert.equal(page.data.currentSkuId, 'p2');assert.equal(page.data.currentSkuDiscounted, false);
  page.checkSkuMatch({ selectedColor: '红' });assert.equal(page.data.currentSkuUnitPrice, '90.00');
  page.setPickedSkuQuantity('p1', 0);assert.equal(page.data.currentSkuDiscounted, false);
  assert.equal(page.data.pickedGoodsPrice, '0.00');assert.equal(page.data.pickedDiscountRows.length, 0);
});

test('连续加减保留最新清单的报价，旧网络响应不能覆盖最新单价和合计', async () => {
  const first = deferred(), second = deferred();let count = 0;
  const { page, calls } = picker({ post: () => ++count === 1 ? first.promise : second.promise });
  page.open(product('p'));await tick();page.setPickedSkuQuantity('p1', 2);page.setPickedSkuQuantity('p1', 3);
  assert.equal(calls.length, 1);first.resolve(quote('p1', 2));await tick();
  assert.equal(calls.length, 2);assert.equal(calls[1].data.items[0].qty, 3);assert.equal(page.data.skuQuoteLoading, true);
  second.resolve(quote('p1', 3, 60));await tick();
  assert.equal(page.data.pickedGoodsPrice, '240.00');assert.equal(page.data.currentSkuUnitPrice, '80.00');assert.equal(page.data.skuQuoteLoading, false);
});

test('切回缓存的清单后，其他清单的在途报价不能让金额卡在计算中', async () => {
  const pending = deferred();const { page } = picker({ post: (url, data) => data.items[0].qty === 1 ? quote('p1', 1) : pending.promise });
  page.open(product('p'));await tick();page.setPickedSkuQuantity('p1', 1);await tick();
  page.setPickedSkuQuantity('p1', 2);page.setPickedSkuQuantity('p1', 1);
  assert.equal(page.data.skuQuoteLoading, false);pending.resolve(quote('p1', 2));await tick();
  assert.equal(page.data.pickedGoodsPrice, '90.00');assert.equal(page.data.skuQuoteLoading, false);
});

test('数量立即更新，优惠重算期间保留金额和单价，返回后统一替换且清空立即归零', async () => {
  const pending = deferred();const { page } = picker({
    post: (url, data) => data.items[0].qty === 1 ? quote('p1', 1) : pending.promise
  });
  page.open(product('p'));await tick();page.setPickedSkuQuantity('p1', 1);await tick();
  page.setPickedSkuQuantity('p1', 2);
  assert.equal(page.data.quantity, 2);assert.equal(page.data.pickedSkuItems[0].count, 2);
  assert.equal(page.data.skuQuoteLoading, true);
  assert.equal(page.data.pickedOriginalPrice, '100.00');assert.equal(page.data.pickedGoodsPrice, '90.00');
  assert.equal(page.data.pickedDiscountPrice, '10.00');assert.equal(page.data.pickedAverageUnitPrice, '90.00');
  assert.equal(page.data.pickedSkuItems[0].unitPriceText, '90.00');assert.equal(page.data.pickedHasDiscount, true);
  assert.equal(page.data.pickedPromotionRows[0].amount, '10.00');
  pending.resolve(quote('p1', 2, 30));await tick();
  assert.equal(page.data.pickedOriginalPrice, '200.00');assert.equal(page.data.pickedGoodsPrice, '170.00');
  assert.equal(page.data.pickedDiscountPrice, '30.00');assert.equal(page.data.pickedAverageUnitPrice, '85.00');
  assert.equal(page.data.pickedSkuItems[0].unitPriceText, '85.00');assert.equal(page.data.skuQuoteLoading, false);
  page.clearPickedSkus();assert.equal(page.data.pickedGoodsPrice, '0.00');assert.equal(page.data.pickedHasDiscount, false);
});

test('后端确认待支付占用时展示已使用，不扣首单；立即购买仍传原价', async () => {
  const { page, purchases, calls } = picker({ post: (url, data) => quote(data.items[0].skuId, 1, 0, 'RESERVED') });
  page.open(product('p'));await tick();page.setPickedSkuQuantity('p1', 1);await tick();
  assert.equal(page.data.promotionOffers[0].statusText, '已使用');assert.equal(page.data.pickedDiscountPrice, '0.00');
  assert.equal(calls[0].data.items.length, 1);assert.equal(calls[0].data.items[0].salePrice, 100);
  await page.confirmAddToCart({ currentTarget: { dataset: { action: 'buy' } } });
  assert.equal(purchases[0][0].price, 100);assert.equal(purchases[0][0].finalPrice, 100);
});

test('更换商品或卸载后，旧商品的报价不能串到新弹窗或回写已销毁组件', async () => {
  const pending = deferred();const { page } = picker({ post: (url, data) => data.items[0].skuId === 'p1' ? pending.promise : quote('b1', 1, 20) });
  page.open(product('p'));await tick();page.setPickedSkuQuantity('p1', 1);
  page.open(product('b'));await tick();page.setPickedSkuQuantity('b1', 1);
  pending.resolve(quote('p1', 1));await tick();await tick();assert.equal(page.data.pickedGoodsPrice, '80.00');
  const calls = [];page.onUnload();page.setData = data => calls.push(data);
  await page.loadSkuPromotions();assert.equal(calls.length, 0);
});

test('套装报价保留各子件原价和数量，按一套提交而不将子件数当作优惠套数', () => {
  const result = display.quoteItems([{ skuId: '1', count: 2, price: 30 }, { skuId: '2', count: 3, price: 20 }], true);
  assert.equal(result.length, 1);assert.equal(result[0].qty, 1);assert.equal(result[0].salePrice, 120);
  assert.deepEqual(result[0].bundleConfig.map(row => row.count), [2, 3]);
});

test('订单详情按原价、优惠、运费和成交合计展示，手工改价独立列示', () => {
  const discounted = display.orderAmounts({ items: [{ salePrice: 100, qty: 2 }], goodsAmount: 170, promotionDiscount: 30, shippingFee: 8 });
  assert.equal(discounted.originalGoodsAmountText, '200.00');assert.equal(discounted.promotionDiscountText, '30.00');assert.equal(discounted.amountTotalText, '178.00');
  const adjusted = display.orderAmounts({ items: [{ salePrice: 200, qty: 1 }], goodsAmount: 120, shippingFee: 8, priceRevision: 1 });
  assert.equal(adjusted.manualAdjustmentText, '80.00');assert.equal(adjusted.hasManualAdjustment, true);assert.equal(adjusted.amountTotalText, '128.00');
});

test('订单商品显示成交单价和原价，保留原售价快照且正确处理大整数行编号', () => {
  const order = { promotionDiscount: 1, items: [{ id: '90071992547409931', salePrice: '1.10', qty: 1 }] };
  const items = display.orderItemPrices(order, { items: [{ orderItemId: '90071992547409931', settlementAmount: '0.10' }] });
  assert.equal(items[0].displayUnitPrice, '0.10');assert.equal(items[0].originalUnitPrice, '1.10');assert.equal(items[0].showOriginalPrice, true);
  assert.equal(items[0].salePrice, '1.10');assert.equal(order.items[0].displayUnitPrice, undefined);
});

test('零元成交单价不能回退为原价，多件单价按成交行小计分摊展示', () => {
  const items = display.orderItemPrices({ promotionDiscount: 1, items: [{ id: '1', qty: 1, salePrice: 1 }, { id: '2', qty: 2, salePrice: 99.99 }] }, {
    items: [{ orderItemId: '1', settlementAmount: 0 }, { orderItemId: '2', settlementAmount: 165.21 }] });
  assert.equal(items[0].displayUnitPrice, '0.00');assert.equal(items[0].showOriginalPrice, true);
  assert.equal(items[1].displayUnitPrice, '82.61');assert.equal(items[1].originalUnitPrice, '99.99');
});

test('用户端套装合并子件成交额，管理员逐子件展示时不重复合并', () => {
  const pricing = { items: [{ orderItemId: '1', skuId: 'a', settlementAmount: 90 }, { orderItemId: '2', skuId: 'b', settlementAmount: 60 }] };
  const virtual = display.orderItemPrices({ promotionDiscount: 50, items: [{ id: '1', qty: 1, salePrice: 200,
    bundleProductName: '套装', bundleConfig: [{ skuId: 'a' }, { skuId: 'b' }] }] }, pricing);
  assert.equal(virtual[0].displayUnitPrice, '150.00');assert.equal(virtual[0].originalUnitPrice, '200.00');
  const raw = display.orderItemPrices({ promotionDiscount: 50, items: [{ id: '1', qty: 2, salePrice: 60,
    bundleProductName: '套装', bundleGroupName: '上衣', bundleConfig: [{ skuId: 'a' }, { skuId: 'b' }] }] }, pricing);
  assert.equal(raw[0].displayUnitPrice, '45.00');
});

test('普通订单直接显示原单价，改价订单按成交分摊，分摊未加载时不误标原价为成交价', () => {
  const order = { items: [{ id: '1', qty: 2, salePrice: 100 }] };
  assert.equal(display.orderItemPrices(order, null)[0].displayUnitPrice, '100.00');
  assert.equal(display.orderItemPrices(order, null)[0].showOriginalPrice, false);
  order.priceRevision = 1;assert.equal(display.orderItemPrices(order, null)[0].displayUnitPrice, null);
  const adjusted = display.orderItemPrices(order, { items: [{ orderItemId: '1', settlementAmount: 150 }] });
  assert.equal(adjusted[0].displayUnitPrice, '75.00');assert.equal(adjusted[0].showOriginalPrice, true);
});

test('结算单价按请求行序号关联，相同SKU分开结算也不会串用另一行的分摊', () => {
  const items = [{ skuId: 'same', price: 100, count: 1 }, { skuId: 'same', price: 100, count: 2 }];
  const result = display.checkoutItemPrices(items, { goodsAmount: 270, discountAmount: 30, items: [
    { requestIndex: 1, skuId: 'same', settlementAmount: 181 }, { requestIndex: 0, skuId: 'same', settlementAmount: 89 }
  ] });
  assert.equal(result[0].displayUnitPrice, '89.00');assert.equal(result[1].displayUnitPrice, '90.50');
  assert.equal(result[1].originalUnitPrice, '100.00');assert.equal(result[0].showOriginalPrice, true);
  assert.equal(items[0].price, 100);assert.equal(items[0].displayUnitPrice, undefined);
});

test('结算套装先合计各子项成交额，再按购买套数展示套装单价和子件单价', () => {
  const items = [{ skuId: 'a', price: 200, count: 2, bundleConfig: [{ skuId: 'a', price: 120, count: 1 }, { skuId: 'b', price: 40, count: 2 }] }];
  const result = display.checkoutItemPrices(items, { goodsAmount: 340, discountAmount: 60, items: [
    { requestIndex: 0, skuId: 'a', quantity: 2, settlementAmount: 204 }, { requestIndex: 0, skuId: 'b', quantity: 4, settlementAmount: 136 }
  ] });
  assert.equal(result[0].displayUnitPrice, '170.00');assert.equal(result[0].originalUnitPrice, '200.00');
  assert.equal(result[0].bundleConfig[0].displayUnitPrice, '102.00');assert.equal(result[0].bundleConfig[1].displayUnitPrice, '34.00');
  assert.equal(result[0].bundleConfig[1].originalUnitPrice, '40.00');assert.equal(items[0].bundleConfig[1].price, 40);
});

test('结算零元分摊不回退原价，未报价时不把原价当作优惠成交价', () => {
  const items = [{ skuId: 'a', price: 100, count: 1 }, { skuId: 'b', price: 0.01, count: 1 }];
  const result = display.checkoutItemPrices(items, { goodsAmount: 0.01, discountAmount: 100, items: [
    { requestIndex: 0, skuId: 'a', settlementAmount: 0 }, { requestIndex: 1, skuId: 'b', settlementAmount: 0.01 }
  ] });
  assert.equal(result[0].displayUnitPrice, '0.00');assert.equal(result[0].showOriginalPrice, true);
  assert.equal(result[1].showOriginalPrice, false);assert.equal(display.checkoutItemPrices(items, null)[0].displayUnitPrice, null);
});

test('结算优惠缺少分摊或分摊合计错误时拒绝展示错误单价', () => {
  const items = [{ skuId: 'a', price: 100, count: 1 }];
  assert.throws(() => display.checkoutItemPrices(items, { goodsAmount: 90, discountAmount: 10 }), /明细加载失败/);
  assert.throws(() => display.checkoutItemPrices(items, { goodsAmount: 90, discountAmount: 10, items: [{ requestIndex: 0, settlementAmount: 95 }] }), /合计不一致/);
});

test('已配置但未触发的优惠类型仍显示零元，已使用的首单也保留零元行', () => {
  const offers = display.offersForDisplay([offer('USED'), { type: 'RATE', rules: [{ minimumQty: 3, discountPercent: 85 }] }]);
  const rows = display.pickerDiscountRows(offers, []);
  assert.deepEqual(rows.map(row => [row.label, row.amount, row.active]), [['首单优惠', '0.00', false], ['多件多折', '0.00', false]]);
  const active = display.pickerDiscountRows(offers, [{ label: '多件多折', amount: '30.00' }]);
  assert.equal(active[0].active, false);assert.equal(active[1].active, true);assert.equal(active[1].amount, '30.00');
  assert.equal(active[1].key, rows[1].key);
});

test('已选多规格展示优惠后总价，右侧单价使用全部已选商品的平均单价', async () => {
  const p = product('p');p.skuMatrix[1].price = 200;
  const { page } = picker({ get: async () => [{ type: 'AMOUNT', rules: [{ thresholdAmount: 300, amount: 40 }], status: 'AVAILABLE' }],
    post: (url, data) => data.items.length === 1 ? quote('p1', 2, 0) : {
      originalGoodsAmount: 400, goodsAmount: 360, discountAmount: 40,
      items: [{ skuId: 'p1', quantity: 2, settlementAmount: 180 }, { skuId: 'p2', quantity: 1, settlementAmount: 180 }],
      applied: [{ scheme: { type: 'AMOUNT' }, discountAmount: 40 }] }
  });
  page.open(p);await tick();page.setPickedSkuQuantity('p1', 2);await tick();
  assert.equal(page.data.pickedHasDiscount, false);assert.equal(page.data.pickedGoodsPrice, '200.00');
  page.setPickedSkuQuantity('p2', 1);await tick();
  assert.equal(page.data.pickedGoodsPrice, '360.00');assert.equal(page.data.pickedOriginalPrice, '400.00');
  assert.equal(page.data.pickedAverageUnitPrice, '120.00');assert.equal(page.data.pickedHasDiscount, true);
  page.checkSkuMatch({ selectedColor: '蓝' });assert.equal(page.data.pickedGoodsPrice, '360.00');
  assert.equal(page.data.pickedAverageUnitPrice, '120.00');
});

test('清空已选同步清除金额、角标和缓存，旧报价返回也不能恢复已清空的清单', async () => {
  const pending = deferred();const { page, calls } = picker({ post: () => pending.promise });
  page.open(product('p'));await tick();page.setPickedSkuQuantity('p1', 2);
  page.setData({ purchasePending: true });page.clearPickedSkus();assert.equal(page.data.pickedTotalCount, 2);
  page.setData({ purchasePending: false });
  page.clearPickedSkus();
  assert.equal(page.data.pickedTotalCount, 0);assert.equal(page.data.pickedSkuItems.length, 0);
  assert.equal(page.data.pickedGoodsPrice, '0.00');assert.equal(page.data.pickedDiscountPrice, '0.00');
  assert.equal(page.data.pickedHasDiscount, false);assert.equal(page.data.quantity, 0);
  assert.equal(page.data.pickedPromotionRows[0].amount, '0.00');
  pending.resolve(quote('p1', 2));await tick();assert.equal(page.data.pickedTotalCount, 0);
  assert.equal(calls.length, 1);page.open(product('p'));await tick();assert.equal(page.data.pickedTotalCount, 0);
});
