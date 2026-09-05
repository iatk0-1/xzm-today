// miniprogram/pages/bindPhone/bindPhone.js
const auth = require('../../utils/auth');
const api = require('../../utils/api');

Page({
  data: {
  },

  onLoad: async function() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      // 检查是否已绑定手机号，如果已绑定则跳转回首页
      if (auth.isPhoneBound()) {
        wx.reLaunch({ url: '/pages/index/index' });
      }
    } catch (err) {
      console.error('绑定手机号页认证恢复失败:', err);
      wx.showToast({ title: '登录状态恢复失败，请稍后重试', icon: 'none' });
    }
  },

  // 获取手机号码并绑定
  getPhoneNumber: async function(e) {
    // 检查用户是否取消授权（包括明确拒绝和关闭对话框）
    if (e.detail.errMsg === 'getPhoneNumber:fail cancel' || e.detail.errMsg === 'getPhoneNumber:fail') {
      wx.showToast({ title: '已取消授权', icon: 'none' });
      return;
    }

    // 检查是否成功
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({ title: '获取手机号失败', icon: 'none' });
      return;
    }

    // 检查是否有有效的 code
    if (!e.detail.code) {
      wx.showToast({ title: '获取手机号失败', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '绑定中...' });

    try {
      // 调用后端绑定接口（新版微信返回 code，不需要 iv 和 encryptedData）
      await auth.bindPhone(e.detail.code);

      wx.hideLoading();
      wx.showToast({ title: '绑定成功', icon: 'success' });

      setTimeout(() => {
        wx.reLaunch({ url: '/pages/index/index' });
      }, 1500);
    } catch (err) {
      wx.hideLoading();

      wx.showModal({
        title: '提示',
        content: auth.getPhoneBindErrorMessage(err),
        showCancel: false
      });
    }
  },

  // 暂不绑定
  skip: function() {
    wx.showModal({
      title: '提示',
      content: '确定要跳过吗？绑定手机号后可在 APP、网页端使用同一账号',
      confirmText: '继续跳过',
      confirmColor: '#999',
      success: (res) => {
        if (res.confirm) {
          wx.reLaunch({ url: '/pages/index/index' });
        }
      }
    });
  }
});
