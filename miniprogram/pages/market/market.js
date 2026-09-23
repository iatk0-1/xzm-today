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
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    refreshing: false
  },

  onLoad: function() {
    this._isRefreshingMarket = false;
    this._wishesTask = null;
    this._hasLoadedMarketData = false;
    this.checkAdmin();
  },

  onShow: function() {
    this.checkAdmin();
    if (this._isRefreshingMarket) {
      return;
    }
    if (!this._hasLoadedMarketData) {
      this.loadWishes();
    } else {
      this.refreshMarketData();
    }
  },

  // 触底加载更多
  onReachBottom: function() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadWishes(false);
  },

  // scroll-view 内置下拉刷新：手指释放时触发
  onRefresh: function() {
    this.setData({ refreshing: true });
    return this.refreshMarketData();
  },

  // 页面级下拉刷新兜底，避免旧基础库没有触发 scroll-view 刷新事件时卡住
  onPullDownRefresh: function() {
    return this.refreshMarketData().then(function() {
      wx.stopPullDownRefresh();
    });
  },

  refreshMarketData: function() {
    if (this._isRefreshingMarket) {
      return this._wishesTask || Promise.resolve();
    }

    this._isRefreshingMarket = true;
    const waitIdle = this.data.loading && this._wishesTask
      ? this._wishesTask.catch(function() {})
      : Promise.resolve();

    const task = waitIdle
      .then(() => this.loadWishes(true, true))
      .catch(function(err) {
        console.error('刷新心愿失败:', err);
      })
      .finally(() => {
        this._isRefreshingMarket = false;
        this.setData({ refreshing: false });
      });

    this._refreshingTask = task;
    return task;
  },

  checkAdmin: function() {
    if (auth.isAdmin()) {
      this.setData({ isAdmin: true });
    } else {
      this.setData({ isAdmin: false });
    }
  },

  // 从后端 API 获取心愿列表（支持分页）
  loadWishes: function(reset = true, silent = false) {
    if (reset) {
      // 刷新期间保留旧列表，等新数据返回后一次性替换，避免页面闪成空状态。
      this.setData({ page: 1, hasMore: true });
    }

    if (!this.data.hasMore || this.data.loading) {
      return this._wishesTask || Promise.resolve();
    }

    const task = this.fetchWishes(reset, silent);
    this._wishesTask = task;
    return task;
  },

  fetchWishes: async function(reset, silent) {
    this.setData({ loading: true });
    if (!silent) {
      wx.showLoading({ title: '探索中...' });
    }

    try {
      const { page, pageSize } = this.data;
      const res = await api.get(`/wishes?page=${page}&size=${pageSize}`);

      // 后端返回 PageResult: { content, page, size, totalElements, totalPages, hasNext, ... }
      const newWishes = (res.content || []).map(function(wish) {
        var images = Array.isArray(wish.images) && wish.images.length > 0
          ? wish.images
          : (wish.image ? [wish.image] : []);
        return Object.assign({}, wish, {
          images: images,
          image: wish.image || images[0] || '',
          title: wish.title || wish.content || '',
          likes: Number(wish.likes) || 0
        });
      });
      const hasMore = res.hasNext !== undefined ? res.hasNext : newWishes.length === pageSize;

      // 后端已经按热度排序，前端继续兜底，分页追加后也保持全局顺序。
      const allWishes = (reset ? newWishes : this.data.wishes.concat(newWishes))
        .sort(function(a, b) { return b.likes - a.likes; });
      this.updateWishColumns(allWishes, {
        page: this.data.page + 1,
        hasMore: hasMore,
        loading: false
      });
    } catch (err) {
      console.error('加载心愿失败:', err);
      // 请求失败时也保留上一版列表，避免刷新失败后页面突然变空。
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      if (!silent) {
        wx.hideLoading();
      }
      this._wishesTask = null;
      this._hasLoadedMarketData = true;
    }
  },

  updateWishColumns: function(wishes, extraData) {
    const leftColumn = [];
    const rightColumn = [];
    wishes.forEach(function(item, index) {
      if (index % 2 === 0) {
        leftColumn.push(item);
      } else {
        rightColumn.push(item);
      }
    });

    this.setData(Object.assign({
      wishes: wishes,
      leftColumn: leftColumn,
      rightColumn: rightColumn
    }, extraData || {}));
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

    try {
      await auth.ensureAuthenticated({ silent: true });
    } catch (err) {
      wx.showToast({ title: '登录状态恢复失败，请稍后重试', icon: 'none' });
      return;
    }

    let currentWishes = this.data.wishes;
    console.log('当前 wishes 数量:', currentWishes.length);

    // 根据 wishId 查找目标心愿（使用 id 字段而非 _id）
    const targetIndex = currentWishes.findIndex(wish => String(wish.id) === String(wishId));
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

    this.updateWishColumns(currentWishes.slice().sort((a, b) => b.likes - a.likes));

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

      this.updateWishColumns(currentWishes.slice().sort((a, b) => b.likes - a.likes));

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
