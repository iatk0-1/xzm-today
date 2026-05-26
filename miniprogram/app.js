// miniprogram/app.js
const auth = require('./utils/auth');
const api = require('./utils/api');

App({
  onLaunch: function () {
    console.log('小程序启动');
    this.initAuth();
  },

  onShow: function (options) {
    // 处理微信确认收货组件的回调
    // 组件通过 navigateBackMiniProgram 返回，结果在 referrerInfo 中
    var refInfo = options && options.referrerInfo;
    if (refInfo && refInfo.appId === 'wx1183b055aeec94d1' && refInfo.extraData) {
      var data = refInfo.extraData;
      console.log('[确认收货回调]', JSON.stringify(data));

      if (data.status === 'success') {
        var orderId = this.pendingConfirmOrderId;
        if (orderId) {
          this.pendingConfirmOrderId = null;
          this.handleConfirmReceiptSuccess(orderId);
        }
      } else if (data.status === 'fail' || data.status === 'cancel') {
        this.pendingConfirmOrderId = null;
        console.log('[确认收货] 用户取消或失败, status=' + data.status);
      }
    }
  },

  // 处理确认收货成功
  handleConfirmReceiptSuccess: function(orderId) {
    wx.showLoading({ title: '处理中...' });
    api.post('/orders/' + orderId + '/receive')
      .then(function() {
        wx.hideLoading();
        wx.showToast({ title: '交易完成', icon: 'success' });
      })
      .catch(function(err) {
        wx.hideLoading();
        var msg = '操作失败';
        if (err && err.data && err.data.message) msg = err.data.message;
        else if (err && err.message) msg = err.message;
        wx.showToast({ title: msg, icon: 'none' });
      });
  },

  // 初始化认证流程
  initAuth: async function() {
    wx.showLoading({ title: '初始化中...', mask: true });

    try {
      await auth.ensureTokenValid();
      console.log('认证初始化完成');
      this.globalData.isAuthReady = true;

      const userInfo = auth.getUserInfo();
      this.globalData.userInfo = userInfo;
      this.globalData.avatarUrl = userInfo?.avatarUrl;

      if (this.onAuthReady) {
        this.onAuthReady();
      }
    } catch (err) {
      console.error('认证初始化失败:', err);
      this.globalData.isAuthReady = false;
      this.globalData.avatarUrl = null;
    } finally {
      wx.hideLoading();
    }
  },

  globalData: {
    userInfo: null,
    isAuthReady: false,
    avatarUrl: null
  },

  // 待确认的订单 ID（由 orderDetail 页面设置）
  pendingConfirmOrderId: null
});
