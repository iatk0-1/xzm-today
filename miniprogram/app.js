// miniprogram/app.js
const auth = require('./utils/auth');

App({
  onLaunch: function () {
    // 云开发已移除，改用后端 API
    console.log('小程序启动，后端 API: https://xzm-dev.xianzaimai.com/api/v1');

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
      this.globalData.avatarUrl = userInfo?.avatarUrl; // 保存头像 URL

      // 不再强制绑定手机号，允许访客模式浏览
      // 手机号绑定将在下单等需要时触发

      // 触发认证完成事件
      if (this.onAuthReady) {
        this.onAuthReady();
      }
    } catch (err) {
      console.error('认证初始化失败:', err);
      this.globalData.isAuthReady = false;
      this.globalData.avatarUrl = null;
      // 即使认证失败，也允许访客模式浏览
    } finally {
      wx.hideLoading();
    }
  },

  globalData: {
    userInfo: null,
    isAuthReady: false,
    avatarUrl: null
  }
});
