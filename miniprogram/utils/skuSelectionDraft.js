const auth = require('../utils/auth');

function draftKey(productId) {
  const user = typeof auth.getUserInfo === 'function' ? auth.getUserInfo() : null;
  const account = user && (user.id || user.userId || user.openid) || 'guest';
  return `sku-selection-v1:${account}:${productId}`;
}

function readDraft(key) {
  try {
    const draft = wx.getStorageSync(key);
    return draft && typeof draft === 'object' && draft.quantities && typeof draft.quantities === 'object'
      ? draft : { quantities: {}, revision: '' };
  } catch (err) {
    console.warn('读取已选规格缓存失败:', err);
    return { quantities: {}, revision: '' };
  }
}

function writeDraft(key, quantities) {
  const draft = { quantities: { ...quantities }, revision: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
  try { wx.setStorageSync(key, draft); } catch (err) { console.warn('保存已选规格缓存失败:', err); }
  return draft;
}

// 订单成功后只清除本次提交的版本，防止结算期间新选的规格被旧订单清空。
function clearSubmittedDraft(snapshot) {
  if (!snapshot || !snapshot.key) return;
  if (readDraft(snapshot.key).revision !== snapshot.revision) return;
  try { wx.removeStorageSync(snapshot.key); } catch (err) { console.warn('清除已选规格缓存失败:', err); }
}

function clearCheckoutDrafts(items) {
  (items || []).forEach(item => clearSubmittedDraft(item.skuSelectionDraft));
}

module.exports = { draftKey, readDraft, writeDraft, clearSubmittedDraft, clearCheckoutDrafts };
