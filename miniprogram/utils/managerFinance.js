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
  return { ...row, statusLabel: labels[row.status] || '结果待查询',
    terminal: ['SUCCESS', 'PARTIAL', 'BLOCKED'].includes(row.status) && Number(row.heldAmount || 0) === 0,
    items: (row.items || []).map(item => ({ ...item, statusLabel: itemLabels[item.status] || '结果待查询' })) };
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
module.exports = { money, cents, requireText, isoTime, confirmAction, segmentsWithLabels, toggleBoundary, changeBoundary, transferStatus, isTerminal, profitSharingStatus, profitSharingRow, withdrawalRequestRow, newWithdrawalRequestKey };
