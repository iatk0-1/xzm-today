// 金额以分校验；业务 ID 始终保持字符串，资金终态只信任后端。
function money(value, allowZero = false) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('请输入最多两位小数的金额');
  const parts = text.split('.');
  const cents = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 9999999999 || cents < (allowZero ? 0 : 1)) throw new Error('金额必须在允许范围内，成本及付款金额必须大于零');
  return (cents / 100).toFixed(2);
}
function segmentsWithLabels(segments) {
  return (segments || []).map(segment => ({ ...segment, label: `${segment.lower} ${segment.lowerInclusive ? '≤' : '<'} x${segment.upper == null ? '' : ` ${segment.upperInclusive ? '≤' : '<'} ${segment.upper}`}` }));
}
function toggleBoundary(segments, index) {
  const result = segments.map(segment => ({ ...segment }));
  if (index < 0 || index >= result.length - 1) return result;
  result[index].upperInclusive = !result[index].upperInclusive;
  result[index + 1].lowerInclusive = !result[index].upperInclusive;
  return result;
}
function changeBoundary(segments, index, value) {
  const number = Number(money(value));
  if (index < 0 || index >= segments.length - 1 || number <= Number(segments[index].lower) || (segments[index + 1].upper != null && number >= Number(segments[index + 1].upper))) throw new Error('分界点必须严格递增');
  const result = segments.map(segment => ({ ...segment }));
  result[index].upper = number;
  result[index + 1].lower = number;
  return result;
}
function transferStatus(status) {
  return ({ CREATED: '正在发起', ACCEPTED: '微信已受理', PROCESSING: '转账中', WAIT_USER_CONFIRM: '待确认收款', TRANSFERRING: '转账中', SUCCESS: '到账成功', FAIL: '转账失败', FAILED: '转账失败', CANCELLED: '已撤销', CANCELING: '撤销处理中', UNKNOWN: '结果查询中' })[status] || status || '结果查询中';
}
function isTerminal(status) { return ['SUCCESS', 'FAIL', 'CANCELLED'].includes(status); }
function profitSharingStatus(status) {
  return ({ CREATED: '等待发起分账', PROCESSING: '微信分账处理中', SUCCESS: '分账到账成功', CLOSED: '分账已关闭' })[status] || '分账结果待查询（' + String(status || '未知') + '）';
}
function profitSharingRow(row) {
  return { ...row, channel: 'PROFIT_SHARING', statusLabel: profitSharingStatus(row.status),
    terminal: row.status === 'SUCCESS' || row.status === 'CLOSED' };
}
function withdrawalRequestRow(row) {
  const labels = { PROCESSING: '提现处理中', SUCCESS: '全部到账', PARTIAL: '部分到账，请核对快照差额', BLOCKED: '本次未付款，请查看原因' };
  const itemLabels = { WAITING: '申请已记录，等待处理', PROCESSING: '微信处理中', SUCCESS: '已到账', CLOSED: '该笔未付，分账已关闭', BLOCKED: '本单未付，暂不符合条件' };
  return { ...row, sourceLabel: row.source === 'ADMIN' ? '管理员代发起' : '负责人本人发起', requestedTime: displayTime(row.createdAt), statusLabel: labels[row.status] || '结果待查询',
    terminal: ['SUCCESS', 'PARTIAL', 'BLOCKED'].includes(row.status) && Number(row.heldAmount || 0) === 0,
    items: (row.items || []).map(item => ({ ...item, deadlineLabel: item.deadline ? displayTime(item.deadline) : '不适用',
      statusLabel: itemLabels[item.status] || '结果待查询' })) };
}
function newWithdrawalRequestKey() {
  return 'mw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14).padEnd(12, '0') + '_' + Math.random().toString(36).slice(2, 14).padEnd(12, '0');
}
function confirmAction(title, content) {
  return new Promise(resolve => wx.showModal({
    title, content, success: result => resolve(!!result.confirm), fail: () => resolve(false)
  }));
}
function requireText(value, label) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error('请填写' + label);
  return text;
}
function isoTime(value, label, optional = false) {
  const text = String(value || '').trim();
  if (!text && optional) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error(label + '须填写带时区的时间，如 2026-10-02T09:00:00+08:00');
  }
  return text;
}
function cents(value) {
  return Math.round(Number(money(value, true)) * 100);
}
const auditLabels = {
  COMMISSION_SET: '设置商品佣金', COMMISSION_CONFIG_APPLIED: '全局佣金配置生效', HISTORY_CONFIRMED: '确认历史应付佣金', HISTORY_EXCLUDED: '确认历史不计佣',
  OFFLINE_SETTLED: '登记线下付款', OFFLINE_REVERSED: '冲正线下付款登记', DEBT_OFFSET: '抵扣退款欠款', DEBT_OFFSET_RELEASED: '解除退款欠款抵扣',
  WITHDRAWAL_SUCCESS: '历史转账到账', WITHDRAWAL_FAIL: '历史转账失败', WITHDRAWAL_CANCELLED: '历史转账撤销',
  WITHDRAWAL_MANUAL_SUCCESS: '人工核验历史转账已付款', WITHDRAWAL_MANUAL_CANCELLED: '人工核验历史转账未付款',
  PROFIT_SHARING_RECEIVER_REGISTERED: '登记分账接收关系', PROFIT_SHARING_WITHDRAWAL_REQUESTED: '发起佣金提现', SELF_WITHDRAWAL_CHANGED: '调整负责人自助提现开关',
  PROFIT_SHARING_CREATED: '发起微信分账', PROFIT_SHARING_WITHDRAWAL_ITEM_BLOCKED: '提现订单暂不符合分账条件',
  PROFIT_SHARING_SUCCESS: '微信分账到账', PROFIT_SHARING_CLOSED: '微信分账关闭',
  PROFIT_SHARING_MANUAL_SUCCESS: '人工核验分账已付款', PROFIT_SHARING_MANUAL_CLOSED: '人工核验分账未付款',
  MANAGEMENT_FREEZE_RETIRED: '解除历史管理冻结', WITHDRAWAL_BLOCK_RETIRED: '解除历史提现限制'
};
function displayText(value) {
  const text = value == null ? '' : String(value).trim();
  return ['null', 'undefined'].includes(text.toLowerCase()) ? '' : text;
}
function timeMillis(value) {
  if (value == null || value === '') return NaN;
  const text = String(value).trim();
  if (typeof value === 'number' || /^\d{10}(?:\d{3})?$/.test(text)) {
    const number = Number(value);
    return Math.abs(number) < 100000000000 ? number * 1000 : number;
  }
  // 后端也会返回无时区的北京时间字符串；显式补时区，避免手机解析后再多加8小时。
  const local = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (local) return Date.parse(`${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}:${local[6] || '00'}+08:00`);
  return Date.parse(text);
}
function displayTime(value) {
  const millis = timeMillis(value);
  if (!Number.isFinite(millis) || !Number.isFinite(new Date(millis + 8 * 3600000).getTime())) return '时间未记录';
  // 业务时间统一显示北京时间，不依赖手机时区。
  return new Date(millis + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}
function incomeProductRow(row) {
  return { ...row, productName: displayText(row.productName) || '商品名称未记录',
    productImage: displayText(row.productImage),
    specLabel: [row.skuSpec, row.skuSize].map(displayText).filter(Boolean).join(' / ') || '规格未记录',
    bundleLabel: [row.bundleProductName, row.bundleGroupName].map(displayText).filter(Boolean).join(' · ') };
}
function incomeRecordRow(row) {
  return { ...incomeProductRow(row), orderedTime: displayTime(row.orderedAt) };
}
function incomeEligibilityRow(row) {
  return { ...row, orderedTime: displayTime(row.orderedAt),
    deadlineLabel: row.deadline ? displayTime(row.deadline) : '不适用',
    items: (Array.isArray(row.items) ? row.items : []).map(incomeProductRow) };
}
function settlementOrderRow(row) {
  const result = incomeEligibilityRow(row);
  result.items = result.items.map(item => {
    const originalQty = item.originalQty == null ? item.qty : item.originalQty;
    const hasRefund = Number(item.refundedQty) > 0 || Number(item.refundedAmount) > 0;
    // 退款数量由后端按成功退款流水计算，缺少新字段时不推测退款件数。
    return { ...item, originalQty,
      hasRefund, refundedAmountLabel: displayMoney(item.refundedAmount),
      refundLabel: Number(item.refundedQty) > 0 ? '已退款 ' + item.refundedQty + ' 件' : '已退款（未退件）' };
  });
  result.hasRefundedItems = result.items.some(item => item.hasRefund);
  return result;
}
function displayMoney(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? '未记录' : Number(value).toFixed(2);
}
function displayReason(value) {
  const relations = { STORE: '门店', STAFF: '员工', STORE_OWNER: '店主', PARTNER: '合作伙伴', HEADQUARTER: '总部', BRAND: '品牌方', DISTRIBUTOR: '分销商', USER: '用户', SUPPLIER: '供应商', CUSTOM: '自定义关系' };
  return displayText(value)
    .replace(/(关系=)([A-Z_]+)/g, (match, prefix, type) => prefix + (relations[type] || '其他关系'))
    .replace(/；分配区间=null\/null；激活区间=null\/null/g, '；未补充任职时间区间')
    .replace(/recordId=/g, '佣金明细编号=').replace(/itemId=/g, '提现明细编号=')
    .replace(/transaction_id=/g, '微信交易号=').replace(/requestKey=/g, '提现申请编号=');
}
function managerDetailRow(row, tab) {
  const orderLabels = { pending: '待付款', unpaid: '待付款', stocking: '备货中', paid: '已付款', partial_shipped: '部分发货', shipped: '已发货', completed: '已完成', cancelled: '已取消', canceled: '已取消', closed: '已关闭' };
  const afterSaleLabels = { pending: '售后待审核', approved: '售后已通过', rejected: '售后已拒绝', received: '售后已收货', refunded: '已退款', cancelled: '售后已取消', canceled: '售后已取消', closed: '售后已关闭' };
  const creatorName = displayText(row.creatorName) || displayText(row.creatorPhone) || '未设置昵称';
  const operatorName = displayText(row.operatorName) || displayText(row.operatorPhone) || (row.operatorId ? '未设置昵称的操作人' : '系统自动处理');
  return { ...row,
    productName: displayText(row.productName) || '商品名称未记录',
    productImage: displayText(row.productImage),
    specLabel: [row.skuSpec, row.skuSize].map(displayText).filter(Boolean).join(' / ') || '规格未记录',
    bundleLabel: [row.bundleProductName, row.bundleGroupName].map(displayText).filter(Boolean).join(' · '),
    buyerName: displayText(row.buyerName) || displayText(row.buyerPhone) || '买家未设置昵称', creatorName, operatorName,
    salePriceLabel: displayMoney(row.salePrice), lineAmountLabel: displayMoney(row.lineAmount), orderPayLabel: displayMoney(row.orderPayAmount),
    commissionLabel: displayMoney(row.commissionAmount), unitCommissionLabel: displayMoney(row.unitCommission), amountLabel: displayMoney(row.amount),
    createdTime: displayTime(row.createdAt || row.created_at), orderedTime: displayTime(row.orderedAt || row.createdAt),
    paidTimeLabel: displayTime(row.paidAt || row.paid_at), updatedTime: displayTime(row.updatedAt || row.createdAt),
    deadlineLabel: row.deadline ? displayTime(row.deadline) : '不适用',
    orderStatusLabel: orderLabels[row.orderStatus] || '订单状态待核实',
    afterSaleLabel: row.afterSaleStatus ? afterSaleLabels[row.afterSaleStatus] || '有售后记录' : '无售后',
    refundedLabel: displayMoney(row.refundedAmount),
    historyStatusLabel: row.status === 'UNCONFIRMED' ? '待核对' : row.status === 'EXCLUDED' ? '已核对 · 不计佣' : '已核对 · 计佣',
    actionLabel: auditLabels[row.action] || '其他财务操作', reasonLabel: displayReason(row.reason),
    receiverResultLabel: ({ SUCCESS: '已到账', CLOSED: '已关闭', PENDING: '处理中', PROCESSING: '处理中' })[row.receiverResult] || '待查询',
    channel: tab === 'sharing' ? 'PROFIT_SHARING' : 'LEGACY_TRANSFER',
    statusLabel: tab === 'sharing' ? profitSharingStatus(row.status) : transferStatus(row.status)
  };
}
module.exports = { money, cents, requireText, isoTime, confirmAction, segmentsWithLabels, toggleBoundary, changeBoundary, transferStatus, isTerminal, profitSharingStatus, profitSharingRow, withdrawalRequestRow, newWithdrawalRequestKey, displayText, timeMillis, displayTime, managerDetailRow, incomeRecordRow, incomeEligibilityRow, settlementOrderRow };
