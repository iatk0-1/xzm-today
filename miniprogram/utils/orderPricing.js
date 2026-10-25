// 金额输入用整数分校验，服务端会再次核验成本并保存最终分摊。
function cents(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const parts = text.split('.');
  const result = Number(parts[0]) * 100 + Number(((parts[1] || '') + '00').slice(0, 2));
  return Number.isSafeInteger(result) && result <= 999999999 ? result : null;
}
function amount(value) { return (value / 100).toFixed(2); }
function preview(draft, costAmount, costComplete) {
  const online = cents(draft.onlineAmount), offline = cents(draft.offlineAmount), shipping = cents(draft.shippingFee);
  const cost = cents(costAmount);
  let error = '';
  if (online == null || online < 1) error = '线上应付至少0.01元，最多两位小数';
  else if (offline == null || shipping == null) error = '线下实收和运费须大于等于0，最多两位小数';
  else if (online + offline > 999999999) error = '成交总额不能超过9999999.99元';
  else if (!costComplete || cost == null) error = '请点击右上方“快捷设置商品成本”补齐成本';
  else if (online + offline - shipping < cost) error = '扣除运费后的成交额不能低于商品成本';
  else if (offline > 0 && !draft.peerOrder) error = '有线下收款时请标记为同行订单';
  else if (offline > 0 && !String(draft.offlineMethod || '').trim()) error = '请填写线下收款方式';
  else if (offline > 0 && !draft.offlineConfirmed) error = '请核实线下款已到账';
  else if (!String(draft.reason || '').trim()) error = '请填写改价原因';
  return {
    total: online == null || offline == null ? '—' : amount(online + offline),
    goods: online == null || offline == null || shipping == null ? '—' : amount(online + offline - shipping),
    error, valid: !error
  };
}
function total(order) { return (Number(order.payAmount || 0) + Number(order.offlinePaidAmount || 0)).toFixed(2); }
function peerDefaults(draft) {
  const online = cents(draft.onlineAmount), offline = cents(draft.offlineAmount), shipping = cents(draft.shippingFee);
  if (online == null || offline == null || shipping == null) {
    return { error: '请先填写有效的线上应付、线下实收和运费' };
  }
  const actualTotal = online + offline;
  const nextOnline = shipping + 1;
  if (actualTotal > 999999999 || nextOnline > 999999999 || actualTotal < nextOnline) {
    return { error: '成交总额须至少包含0.01元商品金额和运费，请先调整金额' };
  }
  return { patch: {
    peerOrder: true,
    onlineAmount: amount(nextOnline),
    offlineAmount: amount(actualTotal - nextOnline),
    reason: '线下开单',
    offlineConfirmed: false
  } };
}
function refundQtyAmount(item, qty) {
  if (item && item.settlementAmount != null && Number(item.orderQty) > 0) {
    return Math.ceil(Math.round(Number(item.settlementAmount) * 100) * qty / Number(item.orderQty)) / 100;
  }
  return Number(item && item.salePrice || 0) * qty;
}
module.exports = { cents, amount, preview, total, peerDefaults, refundQtyAmount };
