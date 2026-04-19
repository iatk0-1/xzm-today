// miniprogram/pages/market/market.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    wishes: [],
    isAdmin: false
  },

  onLoad: function() {
    this.checkAdmin();
  },

  onShow: function() {
    this.loadWishes();
    this.checkAdmin();
  },

  checkAdmin: function() {
    if (auth.isAdmin()) {
      this.setData({ isAdmin: true });
    } else {
      this.setData({ isAdmin: false });
    }
  },

  // 改造：从后端 API 获取心愿列表
  loadWishes: async function() {
    wx.showLoading({ title: '探索中...' });

    try {
      const res = await api.get('/wishes');
      // 后端返回格式：{ wishes: [...] }
      this.setData({ wishes: res.wishes || res, isLoading: false });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      console.error('获取心愿失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 改造：点赞/取消点赞
  handleLike: async function(e) {
    const index = e.currentTarget.dataset.index;
    const wishId = e.currentTarget.dataset.id;
    let currentWishes = this.data.wishes;
    let targetWish = currentWishes[index];

    // 先更新本地状态
    targetWish.isLiked = !targetWish.isLiked;
    if (targetWish.isLiked) {
      targetWish.likes = (targetWish.likes || 0) + 1;
    } else {
      targetWish.likes = (targetWish.likes || 0) - 1;
      if (targetWish.likes < 0) targetWish.likes = 0;
    }

    this.setData({ wishes: currentWishes });

    // 调用后端 API
    try {
      if (targetWish.isLiked) {
        await api.post(`/wishes/${wishId}/like`);
      } else {
        await api.post(`/wishes/${wishId}/unlike`);
      }
    } catch (err) {
      // 回滚状态
      targetWish.isLiked = !targetWish.isLiked;
      if (targetWish.isLiked) {
        targetWish.likes = (targetWish.likes || 0) + 1;
      } else {
        targetWish.likes = (targetWish.likes || 0) - 1;
      }
      this.setData({ wishes: currentWishes });
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 上传心愿
  uploadWish: function() {
    wx.navigateTo({
      url: '/pages/publishWish/publishWish'
    });
  },

  // 跳转到商品
  goToProduct: function(e) {
    const productId = e.currentTarget.dataset.id;
    if (productId) {
      wx.navigateTo({
        url: `/pages/detail/detail?id=${productId}`
      });
    }
  },

  // 底部导航栏
  goToIndex: function() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
  goToMarket: function() {
    // 当前页面，不做操作
  },
  goToUser: function() {
    wx.reLaunch({ url: '/pages/user/user' });
  },
  goToMessage: function() {
    wx.showToast({ title: '功能开发中...', icon: 'none' });
  },
  goToAdmin: function() {
    wx.showActionSheet({
      itemList: ['发布新商品', '商品上下架管理', '库存管理', '拣货推荐', '订单管理', '订单发货管理'],
      itemColor: '#111111',
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/admin/admin' });
        } else if (res.tapIndex === 1) {
          wx.navigateTo({ url: '/pages/adminProduct/adminProduct' });
        } else if (res.tapIndex === 2) {
          wx.navigateTo({ url: '/pages/skuInventory/skuInventory' });
        } else if (res.tapIndex === 3) {
          wx.navigateTo({ url: '/pages/pickingList/pickingList' });
        } else if (res.tapIndex === 4) {
          wx.navigateTo({ url: '/pages/adminOrderManage/adminOrderManage' });
        } else if (res.tapIndex === 5) {
          wx.navigateTo({ url: '/pages/adminOrder/adminOrder' });
        }
      }
    });
  }
});
