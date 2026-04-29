// miniprogram/pages/market/market.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    wishes: [],
    leftColumn: [],   // 左列心愿
    rightColumn: [],  // 右列心愿
    isAdmin: false,
    // 分页参数
    page: 0,
    pageSize: 20,
    hasMore: true
  },

  onLoad: function() {
    this.checkAdmin();
    this.loadWishes();
  },

  // 触底加载更多
  onReachBottom: function() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadWishes(false);
  },

  checkAdmin: function() {
    if (auth.isAdmin()) {
      this.setData({ isAdmin: true });
    } else {
      this.setData({ isAdmin: false });
    }
  },

  // 改造：从后端 API 获取心愿列表（支持分页）
  loadWishes: async function(reset = true) {
    if (reset) {
      this.setData({ page: 0, wishes: [], hasMore: true });
    }

    if (!this.data.hasMore || this.data.loading) return;

    this.setData({ loading: true });
    wx.showLoading({ title: '探索中...' });

    try {
      const { page, pageSize } = this.data;
      const res = await api.get(`/wishes?page=${page}&size=${pageSize}`);

      // 后端返回 PageResult: { content, page, size, totalElements, totalPages, hasNext, ... }
      const newWishes = res.content || [];
      const hasMore = res.hasNext !== undefined ? res.hasNext : newWishes.length === pageSize;

      // 将心愿分配到左右两列（奇数位置放左列，偶数位置放右列）
      const allWishes = reset ? newWishes : [...this.data.wishes, ...newWishes];
      const leftColumn = [];
      const rightColumn = [];
      allWishes.forEach((item, index) => {
        if (index % 2 === 0) {
          leftColumn.push(item);
        } else {
          rightColumn.push(item);
        }
      });

      this.setData({
        wishes: allWishes,
        leftColumn: leftColumn,
        rightColumn: rightColumn,
        page: this.data.page + 1,
        hasMore: hasMore,
        loading: false
      });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
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
      itemList: ['发布新商品', '商品上下架管理', '库存管理', '拣货推荐', '订单管理', '售后管理'],
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
          wx.navigateTo({ url: '/pages/adminAfterSaleList/adminAfterSaleList' });
        }
      }
    });
  }
});
