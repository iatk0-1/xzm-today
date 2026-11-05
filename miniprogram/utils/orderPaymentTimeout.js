function hasReadyStock(order) {
  return !!order && Array.isArray(order.items) && order.items.some(item => Number(item.readyStockQty) > 0
    || (Array.isArray(item.bundleConfig) && item.bundleConfig.some(sub => Number(sub.readyStockQty) > 0)));
}

function paymentTimeoutMinutes(order) { return hasReadyStock(order) ? 3 : 30; }

function cancelPaymentMessage(order) {
  return hasReadyStock(order)
    ? '含现货的订单只保留3分钟，到期将自动取消订单，请尽快支付哦~'
    : '订单只保留30分钟，到期将自动取消订单，请尽快支付哦~';
}

module.exports = { hasReadyStock, paymentTimeoutMinutes, cancelPaymentMessage };
