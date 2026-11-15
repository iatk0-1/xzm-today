const { getErrorMessage } = require('./error');

async function load(page, api, orderId, admin = false) {
  const request = {};
  page._specHistoryRequest = request;
  page.setData({ specChanges: [], specChangesError: '', specChangesLoading: true });
  try {
    const prefix = admin ? '/admin/orders-manage/orders' : '/orders';
    const records = await api.get(`${prefix}/${orderId}/spec-changes`);
    if (!Array.isArray(records)) throw new Error('商品规格修改记录格式不正确');
    if (page._specHistoryRequest !== request) return;
    page.setData({ specChanges: records.map(row => ({ ...row,
      sourceLabel: [row.sourceSpec || '默认规格', row.sourceSize || '均码'].join(' / '),
      targetLabel: [row.targetSpec || '默认规格', row.targetSize || '均码'].join(' / '),
      timeDisplay: page.formatTime(row.createdAt) })) });
  } catch (error) {
    if (page._specHistoryRequest === request) page.setData({
      specChangesError: getErrorMessage(error, '商品规格修改记录加载失败，请重试') });
  } finally {
    if (page._specHistoryRequest === request) page.setData({ specChangesLoading: false });
  }
}
module.exports = { load };
