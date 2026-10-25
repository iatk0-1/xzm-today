const { getErrorMessage } = require('./error');
const money = value => Number(value || 0).toFixed(2);
function format(value) {
  if (!value) return null;
  return { ...value, onlineAmount: money(value.onlineAmount), offlineAmount: money(value.offlineAmount),
    totalAmount: money(value.totalAmount), requestedOnlineAmount: money(value.requestedOnlineAmount),
    requestedOfflineAmount: money(value.requestedOfflineAmount), items: (value.items || []).map(row => ({ ...row,
      onlineAmount: money(row.onlineAmount), offlineAmount: money(row.offlineAmount),
      requestedOnlineAmount: money(row.requestedOnlineAmount), requestedOfflineAmount: money(row.requestedOfflineAmount) })) };
}
// 每次输入立即作废旧报价；只接受最后一次请求的结果，失败时不能沿用旧拆分提交。
async function preview(page, api, url, items, field) {
  const versionKey = '_' + field + 'Version';
  const version = page[versionKey] = (page[versionKey] || 0) + 1;
  page.setData({ [field]: null, [field + 'Loading']: items.length > 0, [field + 'Error']: '' });
  if (!items.length) return null;
  if (items.some(row => !Number.isInteger(Number(row.qty)) || Number(row.qty) < 1
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(row.refundAmount)) || Number(row.refundAmount) <= 0)) {
    page.setData({ [field + 'Loading']: false, [field + 'Error']: '请填写正确的退款数量和金额' }); return null;
  }
  try {
    const result = format(await api.post(url, { items }));
    if (version !== page[versionKey]) return null;
    page.setData({ [field]: result, [field + 'Loading']: false });
    return result;
  } catch (error) {
    if (version === page[versionKey]) page.setData({ [field + 'Loading']: false,
      [field + 'Error']: getErrorMessage(error, '退款金额拆分失败，请刷新后重试') });
    return null;
  }
}
module.exports = { format, preview };
