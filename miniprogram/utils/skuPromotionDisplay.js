const LABELS = { FIRST: '首单优惠', AMOUNT: '满减优惠', RATE: '多件多折', QUANTITY: '多件优惠' };
const money = value => (Number(value) || 0).toFixed(2);
const number = value => String(Number(value));

function discountRows(applied) {
  return (applied || []).filter(row => Number(row.discountAmount) > 0)
    .map((row, key) => ({ key, label: LABELS[row.scheme.type], amount: money(row.discountAmount) }));
}

function pickerDiscountRows(offers, appliedRows) {
  const rows = new Map((offers || []).map(offer => [offer.label || LABELS[offer.type],
    { key: offer.type, label: offer.label || LABELS[offer.type], amount: '0.00', active: false }]));
  for (const applied of appliedRows || []) {
    const configured = rows.get(applied.label);
    rows.set(applied.label, { ...applied, key: configured ? configured.key : applied.label, active: Number(applied.amount) > 0 });
  }
  return [...rows.values()];
}

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
  const rows = discountRows(quote && quote.applied);
  if (quote && rows.reduce((sum, row) => sum + cents(row.amount), 0) !== discount) throw new Error('优惠明细合计不一致，请重试');
  return { pickedOriginalPrice: money(original / 100), pickedDiscountPrice: money(discount / 100),
    pickedGoodsPrice: money(goods / 100), pickedDiscountRows: rows,
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
  const rows = discountRows(quote.applied);
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

function orderItemPrices(order, pricing) {
  const lines = pricing && pricing.items || [];
  const byId = new Map(lines.map(line => [String(line.orderItemId), line]));
  const needsSettlement = Number(order.promotionDiscount) > 0 || Number(order.priceRevision) > 0;
  return (order.items || []).map(item => {
    const quantity = Math.max(1, Number(item.qty || 1));
    const original = Math.round(Number(item.salePrice || 0) * 100);
    let selectedLines;
    // 用户详情会把同一套装的扁平子件合成一行；管理员详情仍逐子件展示。
    if (item.bundleProductName && !item.bundleGroupName && item.bundleConfig && item.bundleConfig.length) {
      const skuIds = new Set(item.bundleConfig.map(sub => String(sub.skuId)));
      selectedLines = lines.filter(line => skuIds.has(String(line.skuId)));
    } else {
      const line = byId.get(String(item.id));selectedLines = line ? [line] : [];
    }
    const available = selectedLines.length > 0 && selectedLines.every(line => line.settlementAmount != null);
    const settled = item.settlementAmount != null ? Math.round(Number(item.settlementAmount) * 100) :
      available ? selectedLines.reduce((sum, line) => sum + Math.round(Number(line.settlementAmount) * 100), 0) :
      needsSettlement ? null : original * quantity;
    return { ...item, originalUnitPrice: money(original / 100),
      displayUnitPrice: settled == null ? null : money(Math.round(settled / quantity) / 100),
      showOriginalPrice: settled != null && settled !== original * quantity };
  });
}
function checkoutItemPrices(items, quote, readyStockSnapshot) {
  const groups = new Map();
  const hasLines = quote && Array.isArray(quote.items);
  if (quote && Number(quote.discountAmount) > 0 && !hasLines) throw new Error('商品成交明细加载失败，请重试');
  for (const line of hasLines ? quote.items : []) {
    const index = Number(line.requestIndex);
    if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('商品成交明细不匹配，请重试');
    if (!groups.has(index)) groups.set(index, []);
    groups.get(index).push(line);
  }
  const readyGroups = new Map();
  const readyLines = readyStockSnapshot === undefined ? hasLines ? quote.items : [] : readyStockSnapshot || [];
  for (const line of readyLines) {
    const index = Number(line.requestIndex);
    if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('商品现货明细不匹配，请重新进入结算');
    if (!readyGroups.has(index)) readyGroups.set(index, []);
    readyGroups.get(index).push(line);
  }
  const sum = lines => lines.reduce((total, line) => {
    const cents = Math.round(Number(line.settlementAmount) * 100);
    if (line.settlementAmount == null || !Number.isSafeInteger(cents) || cents < 0) throw new Error('商品成交金额无效，请重试');
    return total + cents;
  }, 0);
  const fields = (original, quantity, settled) => {
    if (settled != null && (settled < 0 || settled > original * quantity)) throw new Error('商品成交金额超出原价，请重试');
    return { originalUnitPrice: money(original / 100), displayUnitPrice: settled == null ? null : money(Math.round(settled / quantity) / 100),
      showOriginalPrice: settled != null && settled !== original * quantity };
  };
  // 结算使用独立的已确认现货快照，金额报价变化不静默替换现货件数。
  const readyQuantity = (lines, maximum) => {
    if (!lines.length || lines.some(line => !Number.isInteger(line.readyStockQty) || line.readyStockQty < 0)) return null;
    const count = lines.reduce((sum, line) => sum + line.readyStockQty, 0);
    return count <= maximum ? count : null;
  };
  let total = 0;
  const result = items.map((item, index) => {
    const original = Math.round(Number(item.finalPrice != null ? item.finalPrice : item.price || 0) * 100);
    const quantity = Math.max(1, Number(item.count || 1));
    const lines = groups.get(index) || [];
    const stockLines = readyGroups.get(index) || [];
    if (hasLines && !lines.length) throw new Error('商品成交明细缺失，请重试');
    const settled = quote ? hasLines ? sum(lines) : original * quantity : null;
    total += settled || 0;
    const pieces = item.bundleConfig && item.bundleConfig.length
      ? item.bundleConfig.reduce((sum, sub) => sum + Number(sub.count == null ? 1 : sub.count) * quantity, 0) : quantity;
    return { ...item, ...fields(original, quantity, settled), readyStockQty: readyQuantity(stockLines, pieces),
      bundleConfig: item.bundleConfig && item.bundleConfig.map(sub => {
        const subOriginal = Math.round(Number(sub.price || 0) * 100);
        const subQuantity = Number(sub.count == null ? 1 : sub.count) * quantity;
        const subLines = lines.filter(line => String(line.skuId) === String(sub.skuId));
        const subStockLines = stockLines.filter(line => String(line.skuId) === String(sub.skuId));
        if (hasLines && !subLines.length) throw new Error('套装成交明细缺失，请重试');
        const subSettled = quote ? hasLines ? sum(subLines) : subOriginal * subQuantity : null;
        return { ...sub, ...fields(subOriginal, subQuantity, subSettled), displayQuantity: subQuantity,
          readyStockQty: readyQuantity(subStockLines, subQuantity) };
      }) };
  });
  if (quote && total !== Math.round(Number(quote.goodsAmount) * 100)) throw new Error('商品成交明细合计不一致，请重试');
  return result;
}
module.exports = { offersForDisplay, quoteItems, pricing, amountSummary, orderAmounts, discountRows, pickerDiscountRows, orderItemPrices, checkoutItemPrices };
