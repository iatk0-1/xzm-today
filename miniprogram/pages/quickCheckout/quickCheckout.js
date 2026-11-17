// 兼容已经分享的旧卡片，结算统一使用正常订单结算页。
Page({
  data: { error: '' },
  onLoad(options = {}) {
    this._token = options.token || '';
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.openCheckout();
  },
  openCheckout() {
    wx.redirectTo({ url: '/pages/checkout/checkout?token=' + encodeURIComponent(this._token),
      fail: () => this.setData({ error: '打开订单结算页失败，请重试' }) });
  }
});
