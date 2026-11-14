const EXHAUSTED_MESSAGE = '售后次数已用尽，请联系客服协商处理';
const SHIPPED_MESSAGE = '订单已发货，无法申请售后，请联系客服协商处理';
const ALLOWED_STATUSES = ['stocking', 'paid', 'partial_shipped'];

function applicationState(order) {
  const visible = !!order && ALLOWED_STATUSES.includes(order.status);
  const count = Number(order && order.afterSaleSummary && order.afterSaleSummary.applicationCount) || 0;
  return { afterSaleVisible: visible, afterSaleExhausted: count >= 2 };
}

function blockedMessage(order) {
  const state = applicationState(order);
  if (!state.afterSaleVisible) {
    return order && ['shipped', 'completed'].includes(order.status)
      ? SHIPPED_MESSAGE : '该订单状态无法申请售后';
  }
  return state.afterSaleExhausted ? EXHAUSTED_MESSAGE : '';
}

function canApply(order) {
  const message = blockedMessage(order);
  if (!message) return true;
  wx.showModal({ title: '售后提示', content: message, showCancel: false, confirmColor: '#111111' });
  return false;
}

module.exports = { applicationState, blockedMessage, canApply, EXHAUSTED_MESSAGE };
