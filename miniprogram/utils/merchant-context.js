// 当前经营商户上下文。merchantId 只能从登录返回的 memberships 中选择。
const STORAGE_KEY = 'merchantContext';
const auth = require('./auth');

function getCurrentMerchant() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || null;
  } catch (e) {
    return null;
  }
}

function setCurrentMerchant(merchantId) {
  const membership = auth.getMerchantMembership(merchantId);
  if (!membership) {
    throw new Error('当前用户不是该商户成员');
  }
  const status = String(membership.memberStatus || membership.status || 'active').toLowerCase();
  if (status !== 'active') {
    throw new Error('当前商户成员关系已失效');
  }
  const context = {
    merchantId: membership.merchantId,
    merchantName: membership.merchantName || '',
    selectedAt: Date.now()
  };
  wx.setStorageSync(STORAGE_KEY, context);
  return context;
}

function clearCurrentMerchant() {
  wx.removeStorageSync(STORAGE_KEY);
}

function requireCurrentMerchant() {
  const context = getCurrentMerchant();
  if (!context || !auth.getMerchantMembership(context.merchantId)) {
    clearCurrentMerchant();
    throw new Error('请先选择有效的商户经营身份');
  }
  return context;
}

module.exports = {
  getCurrentMerchant,
  setCurrentMerchant,
  clearCurrentMerchant,
  requireCurrentMerchant
};
