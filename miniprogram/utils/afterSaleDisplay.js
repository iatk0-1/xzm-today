const cents = value => Math.round(Number(value || 0) * 100);
const money = value => (value / 100).toFixed(2);
const { hasOfflinePayment, shouldShowBreakdown } = require('./refundChannels');
const { parseDate } = require('./date');

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

// 仅整理页面展示字段，不改写审核、退款请求使用的原始金额和状态。
function summary(sale, isAdmin = false) {
  const requested = application(sale);
  const showOfflineRefund = hasOfflinePayment(sale.orderDetail, sale.refundPayment);
  const showsApplication = ['pending', 'rejected', 'cancelled'].includes(sale.status);
  const currentAmount = sale.totalRefundAmount == null
    ? (sale.refundAmount == null ? requested.reviewedAmount : sale.refundAmount)
    : sale.totalRefundAmount;
  const displayRefundAmount = showsApplication ? requested.totalAmount : money(cents(currentAmount));
  let statusHint = '';
  if (sale.status === 'pending') statusHint = '申请已提交，请等待审核';
  if (sale.status === 'approved') {
    statusHint = sale.type === 'return_refund'
      ? (sale.returnExpressNo
        ? (isAdmin ? '用户已填写退货物流，请核对寄回信息' : '退货物流已填写，等待后续处理')
        : (isAdmin ? '等待用户寄回商品并填写退货物流' : '请寄回商品，并填写退货物流'))
      : '审核已通过，请留意退款处理结果';
  }
  if (sale.status === 'received') statusHint = sale.warehouseCheck === 'fail'
    ? '验收未通过，请核对后续处理结果' : '商品已收货，请留意退款处理结果';
  if (sale.status === 'refunded') statusHint = showOfflineRefund && Number(sale.refundPayment && sale.refundPayment.offlineAmount) > 0
    ? '售后已结案，线下退款请联系客服核对' : '退款处理已完成，请留意到账结果';
  if (sale.status === 'rejected') statusHint = sale.rejectReason || '申请未通过审核';
  return {
    showOfflineRefund,
    showRefundBreakdown: shouldShowBreakdown(sale.orderDetail, sale.refundPayment),
    reasonTitle: String(sale.reason || '未填写').split(/\r?\n/)[0],
    reasonDescription: String(sale.reason || '').split(/\r?\n/).slice(1).join('\n'),
    evidenceImages: evidenceImages(sale.evidenceUrls),
    applicationRefundAmount: requested.totalAmount,
    applicationTotalQty: requested.items.length
      ? requested.items.reduce((total, item) => total + (Number(item.applicationQty) || 0), 0)
      : (Number(sale.totalQty) || 0),
    displayRefundAmount,
    refundAmountLabel: showsApplication ? '申请退款金额' : (sale.status === 'refunded' ? '退款金额' : '审核退款金额'),
    hasAdjustedTotal: !showsApplication && cents(requested.totalAmount) !== cents(displayRefundAmount),
    statusHint
  };
}

function evidenceImages(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
  } catch (error) { /* 旧记录使用逗号分隔字符串。 */ }
  return value.split(',').map(url => url.trim()).filter(Boolean);
}

// 页面时间轴独立于业务记录：最新进度优先，等待审核仅作为展示提示。
function timelineView(entries, status) {
  const result = entries.filter(entry => entry.status !== '等待用户退货').map(entry => ({
    ...entry,
    time: typeof entry.time === 'string' ? entry.time.replace(/^(\d{1,2})\/(\d{1,2})\s/, (_, month, day) => month.padStart(2, '0') + '-' + day.padStart(2, '0') + ' ') : entry.time,
    status: entry.status === '用户申请' ? '申请已提交'
      : (entry.status === '商家审核' && ['approved', 'received', 'refunded'].includes(status) ? '商家审核通过' : entry.status)
  }));
  if (status === 'pending') return result.concat({ status: '等待商家审核', waiting: true });
  return result.reverse();
}

// 只使用对应操作的日志时间，不能用主单 updatedAt 代替历史节点时间。
function progressTime(sale, actions, first = false) {
  const entries = (Array.isArray(sale.progress) ? sale.progress : [])
    .filter(entry => entry && actions.includes(entry.action) && entry.createdAt)
    .map(entry => ({ raw: entry.createdAt, timestamp: parseDate(entry.createdAt).getTime() }))
    .filter(entry => Number.isFinite(entry.timestamp));
  if (!entries.length) return null;
  return entries.reduce((selected, entry) =>
    (first ? entry.timestamp < selected.timestamp : entry.timestamp > selected.timestamp) ? entry : selected).raw;
}

module.exports = { application, summary, evidenceImages, timelineView, progressTime };
