const LABELS = { FIRST: '首单优惠', AMOUNT: '满减优惠', RATE: '多件多折', QUANTITY: '多件优惠' };
const money = value => (Number(value) || 0).toFixed(2);
const number = value => String(Number(value));

function offersForDisplay(offers) {
  return offers.map(offer => ({ ...offer, label: LABELS[offer.type],
    statusText: { USED: '已使用', RESERVED: '已使用', EXPIRED: '已结束', FULL: '名额已满' }[offer.status] || '',
    rulesText: offer.type === 'FIRST' ? ['首单优惠减' + number(offer.amount) + '元'] : (offer.rules || []).map(rule => {
      if (offer.type === 'AMOUNT') return '满' + number(rule.thresholdAmount) + '元减' + number(rule.amount) + '元';
      if (offer.type === 'RATE') return '满' + rule.minimumQty + '件打' + number(Number(rule.discountPercent) / 10) + '折';
      return '满' + rule.minimumQty + '件减' + number(rule.amount) + '元';
    }) }));
}

// 请求始终保留原价；优惠后的分摊金额只用于展示，避免下单时重复优惠。
function quoteItems(items, bundle) {
  if (!bundle) return items.map(sku => ({ skuId: sku.skuId, qty: sku.count, salePrice: Number(sku.price), pool: 'main' }));
  if (!items.length) return [];
  const bundleConfig = items.map(sku => ({ skuId: sku.skuId, count: sku.count, price: Number(sku.price),
    bundleGroupName: sku.bundleGroupName, color: sku.color, size: sku.size, imageUrl: sku.imageUrl }));
  const cents = items.reduce((sum, sku) => sum + Math.round(Number(sku.price) * 100) * sku.count, 0);
  return [{ skuId: items[0].skuId, qty: 1, salePrice: cents / 100, pool: 'main', bundleConfig }];
}

function pricing(items, quote) {
  const original = items.reduce((sum, sku) => sum + Math.round(Number(sku.price) * 100) * sku.count, 0);
  const cents = value => Math.round(Number(value) * 100);
  const byId = new Map();
  let discount = 0, goods = original;
  if (quote) {
    discount = cents(quote.discountAmount);goods = cents(quote.goodsAmount);
    if (![original, discount, goods, cents(quote.originalGoodsAmount)].every(Number.isSafeInteger) ||
        cents(quote.originalGoodsAmount) !== original || discount < 0 || goods < 0 || discount + goods !== original || !Array.isArray(quote.items))
      throw new Error('优惠金额校验失败，请重试');
    for (const row of quote.items) {
      const key = String(row.skuId);
      if (byId.has(key)) throw new Error('优惠规格重复，请重试');
      byId.set(key, row);
    }
    if (byId.size !== items.length) throw new Error('优惠规格已变化，请重试');
    let allocated = 0;
    for (const sku of items) {
      const row = byId.get(String(sku.skuId));
      const settled = row && cents(row.settlementAmount);
      if (!row || Number(row.quantity) !== sku.count || !Number.isSafeInteger(settled) || settled < 0 ||
          settled > Math.round(Number(sku.price) * 100) * sku.count) throw new Error('优惠分摊校验失败，请重试');
      allocated += settled;
    }
    if (allocated !== goods) throw new Error('优惠分摊合计不一致，请重试');
  }
  const discountRows = (quote && quote.applied || []).filter(row => Number(row.discountAmount) > 0)
    .map((row, index) => ({ key: index, label: LABELS[row.scheme.type], amount: money(row.discountAmount) }));
  if (quote && discountRows.reduce((sum, row) => sum + cents(row.amount), 0) !== discount) throw new Error('优惠明细合计不一致，请重试');
  return { pickedOriginalPrice: money(original / 100), pickedDiscountPrice: money(discount / 100),
    pickedGoodsPrice: money(goods / 100), pickedDiscountRows: discountRows,
    pickedSkuItems: items.map(sku => {
      const row = byId.get(String(sku.skuId));
      const settled = row ? cents(row.settlementAmount) : Math.round(Number(sku.price) * 100) * sku.count;
      return { ...sku, discounted: settled < Math.round(Number(sku.price) * 100) * sku.count,
        settlementText: money(settled / 100), unitPriceText: money(Math.round(settled / sku.count) / 100),
        unitApproximate: settled % sku.count !== 0 };
    }) };
}
function amountSummary(quote, originalCents) {
  const original = Math.round(Number(quote.originalGoodsAmount) * 100);
  const goods = Math.round(Number(quote.goodsAmount) * 100), discount = Math.round(Number(quote.discountAmount) * 100);
  if (![original, goods, discount].every(Number.isSafeInteger) || goods < 0 || discount < 0 ||
      original !== originalCents || goods + discount !== original) throw new Error('商品优惠金额已变化，请重试');
  const rows = (quote.applied || []).filter(row => Number(row.discountAmount) > 0)
    .map((row, key) => ({ key, label: LABELS[row.scheme.type], amount: money(row.discountAmount) }));
  if (rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) !== discount) throw new Error('优惠明细合计不一致，请重试');
  return { originalGoodsAmount: money(original / 100), goodsAmount: money(goods / 100),
    discountAmount: money(discount / 100), promotionRows: rows };
}

function orderAmounts(order) {
  const discount = Math.round(Number(order.promotionDiscount || 0) * 100);
  const fee = Math.round(Number(order.shippingFee || 0) * 100);
  const goods = order.goodsAmount != null ? Math.round(Number(order.goodsAmount) * 100) :
    Math.round(Number(order.payAmount || order.totalPrice || 0) * 100) + Math.round(Number(order.offlinePaidAmount || 0) * 100) - fee;
  const original = (order.items || []).length ? order.items.reduce((sum, item) => sum + Math.round(Number(item.salePrice || 0) * 100) * Number(item.qty || 0), 0) : goods + discount;
  const adjustment = original - discount - goods;
  return { originalGoodsAmountText: money(original / 100), promotionDiscountText: money(discount / 100),
    goodsAmountText: money(goods / 100), amountTotalText: money((goods + fee) / 100),
    manualAdjustmentText: money(Math.abs(adjustment) / 100), manualAdjustmentSign: adjustment >= 0 ? '-' : '+',
    hasManualAdjustment: Number(order.priceRevision) > 0 && adjustment !== 0 };
}
module.exports = { offersForDisplay, quoteItems, pricing, amountSummary, orderAmounts };
