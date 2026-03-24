// miniprogram/pages/user/user.js
const auth = require('../../utils/auth');

Page({
  data: {
    isAdmin: false,
    navTop: 0,
    navHeight: 0
  },

  onLoad: function() {
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    this.setData({
      navTop: menuButtonInfo.top,
      navHeight: menuButtonInfo.height
    });
    this.checkAdmin();
  },

  onShow: function() {
    // 每次显示页面时检查管理员状态
    this.checkAdmin();
  },

  // 检查是否为主理人
  checkAdmin: function() {
    if (auth.isAdmin()) {
      this.setData({ isAdmin: true });
    } else {
      this.setData({ isAdmin: false });
    }
  },

  // 跳转订单列表
  goToOrderList: function(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.navigateTo({
      url: `/pages/orderList/orderList?status=${status}`
    });
  },

  // 基础工具跳转
  goToAddress: function() {
    wx.chooseAddress({
      success: () => {
        wx.showToast({ title: '地址已同步', icon: 'success' });
      }
    });
  },

  // 底部 Tab 导航
  goToIndex: function() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
  goToMarket: function() {
    wx.reLaunch({ url: '/pages/market/market' });
  },

  // 老板专属入口
  goToAdmin: function() {
    wx.showActionSheet({
      itemList: ['发布新商品', '订单发货管理', '商品上下架管理'],
      itemColor: '#111111',
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/admin/admin' });
        } else if (res.tapIndex === 1) {
          wx.navigateTo({ url: '/pages/adminOrder/adminOrder' });
        } else if (res.tapIndex === 2) {
          wx.navigateTo({ url: '/pages/adminProduct/adminProduct' });
        }
      }
    });
  }
});
