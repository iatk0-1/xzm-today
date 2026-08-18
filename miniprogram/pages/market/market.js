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
  },

  onShow: function() {
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

      console.log('=== loadWishes 返回数据 ===');
      console.log('res.content:', res.content);
      if (res.content && res.content.length > 0) {
        console.log('第一个 wish 示例:', res.content[0]);
        console.log('第一个 wish 的 _id:', res.content[0]._id);
        console.log('第一个 wish 的 id:', res.content[0].id);
      }

      // 后端返回 PageResult: { content, page, size, totalElements, totalPages, hasNext, ... }
      const newWishes = (res.content || []).map(function(wish) {
        var images = Array.isArray(wish.images) && wish.images.length > 0
          ? wish.images
          : (wish.image ? [wish.image] : []);
        return Object.assign({}, wish, {
          images: images,
          image: wish.image || images[0] || '',
          title: wish.title || wish.content || ''
        });
      });
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

      console.log('leftColumn 第一个元素:', leftColumn[0]);
      console.log('rightColumn 第一个元素:', rightColumn[0]);

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
    console.log('=== handleLike 开始 ===');
    console.log('event dataset:', e.currentTarget.dataset);

    const wishId = e.currentTarget.dataset.id;
    console.log('wishId:', wishId);

    if (!wishId) {
      console.error('wishId 为空');
      wx.showToast({ title: '操作失败：ID为空', icon: 'none' });
      return;
    }

    let currentWishes = this.data.wishes;
    console.log('当前 wishes 数量:', currentWishes.length);

    // 根据 wishId 查找目标心愿（使用 id 字段而非 _id）
    const targetIndex = currentWishes.findIndex(wish => wish.id === wishId);
    console.log('找到的索引:', targetIndex);

    if (targetIndex === -1) {
      console.error('未找到对应的心愿');
      wx.showToast({ title: '操作失败：未找到', icon: 'none' });
      return;
    }

    let targetWish = currentWishes[targetIndex];
    const originalLiked = targetWish.isLiked;
    const originalLikes = targetWish.likes || 0;
    console.log('原始状态 - isLiked:', originalLiked, 'likes:', originalLikes);

    // 先更新本地状态
    targetWish.isLiked = !targetWish.isLiked;
    if (targetWish.isLiked) {
      targetWish.likes = originalLikes + 1;
    } else {
      targetWish.likes = Math.max(0, originalLikes - 1);
    }
    console.log('新状态 - isLiked:', targetWish.isLiked, 'likes:', targetWish.likes);

    // 重新分配左右列数据
    const leftColumn = [];
    const rightColumn = [];
    currentWishes.forEach((item, index) => {
      if (index % 2 === 0) {
        leftColumn.push(item);
      } else {
        rightColumn.push(item);
      }
    });

    this.setData({
      wishes: currentWishes,
      leftColumn: leftColumn,
      rightColumn: rightColumn
    });

    // 调用后端 API
    try {
      const apiUrl = `/wishes/${wishId}/${targetWish.isLiked ? 'like' : 'unlike'}`;
      console.log('准备调用 API:', apiUrl);

      if (targetWish.isLiked) {
        await api.post(`/wishes/${wishId}/like`);
      } else {
        await api.post(`/wishes/${wishId}/unlike`);
      }

      console.log('API 调用成功');
    } catch (err) {
      console.error('API 调用失败:', err);
      console.error('错误详情:', JSON.stringify(err));

      // 回滚状态
      targetWish.isLiked = originalLiked;
      targetWish.likes = originalLikes;

      // 重新分配左右列数据
      const leftColumn = [];
      const rightColumn = [];
      currentWishes.forEach((item, index) => {
        if (index % 2 === 0) {
          leftColumn.push(item);
        } else {
          rightColumn.push(item);
        }
      });

      this.setData({
        wishes: currentWishes,
        leftColumn: leftColumn,
        rightColumn: rightColumn
      });

      const errorMsg = err.message || err.error || '操作失败';
      wx.showToast({ title: errorMsg, icon: 'none' });
    }
  },

  // 上传心愿
  uploadWish: function() {
    wx.navigateTo({
      url: '/pages/publishWish/publishWish'
    });
  },

  // 跳转到心愿详情
  goToWishDetail: function(e) {
    var wishId = e.currentTarget.dataset.id;
    if (wishId) {
      wx.navigateTo({
        url: '/pages/wishDetail/wishDetail?id=' + wishId
      });
    }
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
    wx.navigateTo({ url: '/pages/messages/messages' });
  },
  goToAdmin: function() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '无权限', icon: 'none' });
      return;
    }
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
  },

  onShareAppMessage: function() {
    return {
      title: '现在买 · 许愿市集',
      path: '/pages/market/market',
      imageUrl: ''
    };
  },

  onShareTimeline: function() {
    return {
      title: '现在买 · 许愿市集 — 说出你的心愿，潮流好物来找你',
      query: '',
      imageUrl: ''
    };
  }
});
