// pages/printer-login/authorize.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    ticket: '',
    loading: false,
    authorized: false
  },

  onLoad(options) {
    // 从二维码参数中获取 ticket
    if (options.ticket) {
      this.setData({ ticket: options.ticket });
    } else {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  /**
   * 确认授权
   */
  async handleAuthorize() {
    if (!this.data.ticket) {
      wx.showToast({
        title: '参数错误',
        icon: 'none'
      });
      return;
    }

    this.setData({ loading: true });

    try {
      await auth.ensureAuthenticated({ silent: true });
      await api.post('/printer-accounts/qrcode/authorize', {
        ticket: this.data.ticket
      });
        this.setData({
          authorized: true,
          loading: false
        });

        wx.showToast({
          title: '授权成功',
          icon: 'success'
        });

        // 2秒后返回
        setTimeout(() => {
          wx.navigateBack();
        }, 2000);
    } catch (err) {
      this.setData({ loading: false });

      let errorMsg = '授权失败';
      if (err && err.data && err.data.message) {
        errorMsg = err.data.message;
      } else if (err && err.message) {
        errorMsg = err.message;
      }

      wx.showToast({
        title: errorMsg,
        icon: 'none',
        duration: 3000
      });
      console.error('授权失败', err);
    }
  },

  /**
   * 取消授权
   */
  handleCancel() {
    wx.navigateBack();
  }
});
