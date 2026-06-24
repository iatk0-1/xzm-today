// miniprogram/app.js
const auth = require('./utils/auth');
const api = require('./utils/api');

App({
  onLaunch: function () {
    console.log('小程序启动');

    // ── 注册隐私授权处理器（基础库 ≥ 2.32.3 必须） ──
    // 当用户触发 getPhoneNumber 等隐私接口时，微信会先回调此事件。
    // 开发者必须调用 resolve() 通知平台用户的选择，否则请求会"挂起"，
    // 导致后续点击直接返回 fail 而不再弹出授权组件。
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
        console.log('[隐私授权] 触发，来源:', eventInfo.referrer);
        // 保存 resolve 函数到全局，供隐私弹窗页面使用
        this.globalData.privacyResolve = resolve;
        // 显示隐私协议确认弹窗
        wx.showModal({
          title: '隐私协议',
          content: '为了保障您的账号安全、完成手机号绑定及订单通知，我们需要获取您的手机号信息。请阅读并同意《用户协议》和《隐私政策》。',
          confirmText: '同意',
          cancelText: '拒绝',
          success: (res) => {
            if (res.confirm) {
              console.log('[隐私授权] 用户同意');
              resolve({ event: 'agree' });
            } else {
              console.log('[隐私授权] 用户拒绝');
              // ★ 关键：拒绝时也必须调用 resolve，否则 getPhoneNumber 请求会挂起
              resolve({ event: 'disagree' });
              wx.showToast({ title: '需同意隐私协议才能获取手机号', icon: 'none', duration: 3000 });
            }
            this.globalData.privacyResolve = null;
          }
        });
      });
    }

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
