// miniprogram/app.js
const auth = require('./utils/auth');

App({
  onLaunch: function () {
    // 云开发已移除，改用后端 API
    console.log('小程序启动，后端 API: https://api.xzm-dev.xianzaimai.com/api/v1');

    // 初始化登录状态
    this.initAuth();
  },

  // 初始化认证流程
  initAuth: async function() {
    wx.showLoading({ title: '初始化中...', mask: true });

    try {
      await auth.ensureTokenValid();
      console.log('认证初始化完成');
      this.globalData.isAuthReady = true;

      // 获取用户信息
      const userInfo = auth.getUserInfo();
      this.globalData.userInfo = userInfo;

      // 检查手机号绑定状态
      if (userInfo && !userInfo.isPhoneBound) {
        // 未绑定手机号，跳转到绑定页面
        wx.reLaunch({ url: '/pages/bindPhone/bindPhone' });
      } else {
        // 已绑定或新用户，触发认证完成事件
        if (this.onAuthReady) {
          this.onAuthReady();
        }
      }
    } catch (err) {
      console.error('认证初始化失败:', err);
      this.globalData.isAuthReady = false;
      // 即使认证失败，也允许访客模式浏览
    } finally {
      wx.hideLoading();
    }
  },

  globalData: {
    userInfo: null,
    isAuthReady: false
  }
});
