const cents = value => Math.round(Number(value || 0) * 100);
const money = value => (value / 100).toFixed(2);

// 商品清单和申请记录读取申请快照，审核后的金额单独展示。
function application(sale) {
  const orderItems = new Map(((sale.orderDetail && sale.orderDetail.items) || []).map(item => [String(item.id), item]));
  const items = (sale.items || []).map(item => ({
    ...item,
    displayImage: item.skuImageUrl || (orderItems.get(String(item.orderItemId)) || {}).skuImageUrl
      || item.productImage || (orderItems.get(String(item.orderItemId)) || {}).productImage || '',
    applicationRefundAmount: money(cents(item.requestedRefundAmount == null ? item.refundAmount : item.requestedRefundAmount)),
    applicationQty: item.requestedQty == null ? item.qty : item.requestedQty,
    applicationType: item.requestedAfterSaleType || item.afterSaleType
  }));
  const total = items.length
    ? items.reduce((sum, item) => sum + cents(item.applicationRefundAmount), 0)
    : cents(sale.totalRefundAmount == null ? sale.refundAmount : sale.totalRefundAmount);
  const reviewed = items.length
    ? items.filter(item => !['pending', 'rejected', 'cancelled'].includes(item.status))
      .reduce((sum, item) => sum + cents(item.refundAmount), 0)
    : cents(sale.totalRefundAmount == null ? sale.refundAmount : sale.totalRefundAmount);
  return { items, totalAmount: money(total), reviewedAmount: money(reviewed),
    type: items.length ? (items.some(item => item.applicationType === 'return_refund') ? 'return_refund' : 'refund') : sale.type };
}

module.exports = { application };
