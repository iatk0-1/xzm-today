// 当前匹配与申请快照分别展示，不能拿整单状态倒推本次售后。
function quantitiesOf(value, qty) {
  const keys = ['unreportedQty', 'transitQty', 'stockQty', 'shippedQty'];
  const quantities = value && keys.map(key => Number(value[key]));
  if (!quantities || !keys.every(key => value[key] !== null && value[key] !== undefined)
      || !quantities.every(count => Number.isSafeInteger(count) && count >= 0)
      || quantities.reduce((sum, count) => sum + count, 0) !== Number(qty)) return null;
  return quantities;
}

function summary([unreported, transit, stock, shipped]) {
  return `未报单 ${unreported} 件 · 已备货未发 ${transit + stock} 件 · 已发货 ${shipped} 件`;
}

function format(item) {
  const requested = quantitiesOf(item && item.fulfillment, item && (item.requestedQty == null ? item.qty : item.requestedQty));
  const current = quantitiesOf(item && item.currentFulfillment, item && item.qty);
  const quantities = current || requested;
  if (!quantities) {
    return { fulfillmentKnown: false, fulfillmentText: '申请时未保存报单匹配，请核对报单记录', fulfillmentStockText: '' };
  }
  const [, transit, stock] = quantities;
  return {
    fulfillmentKnown: true,
    fulfillmentText: `${current ? '当前售后匹配' : '申请时匹配'}：${summary(quantities)}`,
    fulfillmentStockText: `其中：已报单在途 ${transit} 件 · 已入库现货 ${stock} 件`,
    applicationFulfillmentText: current && requested ? `申请时：${summary(requested)}` : ''
  };
}

module.exports = { format };
