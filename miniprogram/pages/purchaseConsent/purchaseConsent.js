// 保留旧入口，历史链接直接回到原页面，不再展示购买须知弹窗。
Page({
  isPurchaseConsentPage: true,
  onLoad(options = {}) {
    let target = '/pages/index/index';
    try {
      const value = decodeURIComponent(options.returnTo || '');
      if (/^\/pages\/[a-zA-Z0-9_/-]+(?:\?.*)?$/.test(value)
          && !value.startsWith('/pages/purchaseConsent/')) target = value;
    } catch (error) { /* 无效地址返回首页 */ }
    wx.reLaunch({ url: target });
  }
});
