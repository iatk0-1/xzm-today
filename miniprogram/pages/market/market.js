const { getErrorMessage } = require('../../utils/error');
const pageSync = require('../../utils/pageSync');
// miniprogram/pages/market/market.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const managementNavigation = require('../../utils/managementNavigation');
const customerServiceNavigation = require('../../utils/customerServiceNavigation');
const customerServiceUnread = require('../../utils/customerServiceUnread');

Page(pageSync.wrap({
  data: {
    wishes: [],
    leftColumn: [],   // 左列心愿
    rightColumn: [],  // 右列心愿
    isAdmin: false,
    isStallManager: false,
    managingWishes: false,
    selectedWishIds: [],
    selectedWishCount: 0,
    allWishesSelected: false,
    deletingWishes: false,
    messageUnreadCount: 0,
    messageUnreadLabel: '0',
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
    this._skipNextMarketRefresh = false;
    this._hasLoadedMarketData = false;
    this.checkAdmin();
  },

  onShow: function() {
    customerServiceUnread.start(this);
    this.checkAdmin();
    if (this._isRefreshingMarket) {
      return;
    }
    if (!this._hasLoadedMarketData) {
      this.loadWishes();
    } else if (this._skipNextMarketRefresh) {
      // 从心愿详情返回时保留当前分页和滚动位置，不要重新加载第一页。
      this._skipNextMarketRefresh = false;
    }
    // 返回时由 pageSync 更新变动心愿，保留列表顺序和分页。
  },

  onHide: function() {
    customerServiceUnread.stop(this);
  },

  onUnload: function() {
    customerServiceUnread.stop(this);
  },

  // 触底加载更多
  onReachBottom: function() {
    if (!this.data.hasMore || this.data.loading || this.data.deletingWishes) return;
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
    if (this.data.deletingWishes) {
      this.setData({ refreshing: false });
      return Promise.resolve();
    }
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
    this.setData({ isStallManager: !!auth.isStallManager() });
    if (auth.isAdmin()) {
      this.setData({ isAdmin: true });
    } else {
      this.setData({ isAdmin: false });
    }
    const wasManaging = this.data.managingWishes;
    if (!this.data.isAdmin) this.setData({ managingWishes: false, selectedWishIds: [] });
    if (wasManaging) this.updateWishColumns(this.data.wishes, {}, true);
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
      wx.showToast({ title: getErrorMessage(err, '加载失败'), icon: 'none' });
    } finally {
      if (!silent) {
        wx.hideLoading();
      }
      this._wishesTask = null;
      this._hasLoadedMarketData = true;
    }
  },

  updateWishColumns: function(wishes, extraData, preserveColumns = false) {
    const selectable = this.data.isAdmin ? wishes : [];
    const selectableIds = new Set(selectable.map(wish => String(wish.id)));
    const selectedWishIds = (this.data.managingWishes ? this.data.selectedWishIds : [])
      .filter(id => selectableIds.has(id));
    const selectedIds = new Set(selectedWishIds);
    wishes = wishes.map(wish => ({ ...wish,
      canDelete: selectableIds.has(String(wish.id)),
      selected: selectedIds.has(String(wish.id))
    }));
    const byId = new Map(wishes.map(item => [String(item.id), item]));
    const leftColumn = preserveColumns
      ? this.data.leftColumn.filter(item => byId.has(String(item.id))).map(item => byId.get(String(item.id))) : [];
    const rightColumn = preserveColumns
      ? this.data.rightColumn.filter(item => byId.has(String(item.id))).map(item => byId.get(String(item.id))) : [];
    if (!preserveColumns) wishes.forEach(function(item, index) {
      if (index % 2 === 0) leftColumn.push(item);
      else rightColumn.push(item);
    });

    this.setData(Object.assign({
      wishes: wishes,
      leftColumn: leftColumn,
      rightColumn: rightColumn,
      selectedWishIds: selectedWishIds,
      selectedWishCount: selectedWishIds.length,
      allWishesSelected: selectable.length > 0 && selectedWishIds.length === selectable.length
    }, extraData || {}));
  },

  // 改造：点赞/取消点赞
  handleLike: async function(e) {
    if (this.data.managingWishes) {
      this.toggleWishSelection(e);
      return;
    }
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
      wx.showToast({ title: getErrorMessage(err, '登录状态恢复失败，请稍后重试'), icon: 'none' });
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

    // 点赞只更新当前卡片，列表位置保持用户正在浏览时的稳定顺序。
    this.updateWishColumns(currentWishes);

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

      this.updateWishColumns(currentWishes);

      const errorMsg = getErrorMessage(err, '操作失败');
      wx.showToast({ title: errorMsg, icon: 'none' });
    }
  },

  toggleWishManagement: async function() {
    if (this.data.deletingWishes) return;
    if (!auth.isAdmin()) {
      this.checkAdmin();
      wx.showToast({ title: '仅管理员可管理心愿', icon: 'none' });
      return;
    }
    if (!this.data.managingWishes) {
      try {
        await auth.ensureAuthenticated({ silent: true });
        this.checkAdmin();
        if (!this.data.isAdmin) {
          wx.showToast({ title: '仅管理员可管理心愿', icon: 'none' });
          return;
        }
      } catch (err) {
        wx.showToast({ title: getErrorMessage(err, '请先登录'), icon: 'none' });
        return;
      }
    }
    this.setData({ managingWishes: !this.data.managingWishes, selectedWishIds: [] });
    this.updateWishColumns(this.data.wishes, {}, true);
  },

  toggleWishSelection: function(e) {
    if (!auth.isAdmin() || !this.data.managingWishes || this.data.deletingWishes) return;
    const id = String(e.currentTarget.dataset.id);
    const wish = this.data.wishes.find(item => String(item.id) === id);
    if (!wish || !wish.canDelete) {
      wx.showToast({ title: '该心愿不可选，请刷新后重试', icon: 'none' });
      return;
    }
    const selected = new Set(this.data.selectedWishIds);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    this.setData({ selectedWishIds: Array.from(selected) });
    this.updateWishColumns(this.data.wishes, {}, true);
  },

  toggleSelectAllWishes: function() {
    if (!auth.isAdmin() || this.data.deletingWishes || !this.data.managingWishes) return;
    // 全选当前已加载、且当前身份有删除权限的心愿；新加载的卡片仍可单独勾选。
    const selectedWishIds = this.data.allWishesSelected ? []
      : this.data.wishes.filter(wish => wish.canDelete).map(wish => String(wish.id));
    this.setData({ selectedWishIds: Array.from(new Set(selectedWishIds)) });
    this.updateWishColumns(this.data.wishes, {}, true);
  },

  deleteSelectedWishes: async function() {
    if (!auth.isAdmin() || !this.data.managingWishes || this.data.deletingWishes) return;
    const wishIds = this.data.selectedWishIds.slice();
    if (!wishIds.length) {
      wx.showToast({ title: '请先选择心愿', icon: 'none' });
      return;
    }
    if (wishIds.length > 1000) {
      wx.showToast({ title: '一次最多删除1000条心愿', icon: 'none' });
      return;
    }
    this.setData({ deletingWishes: true });
    let loadingShown = false;
    try {
      const result = await new Promise((resolve, reject) => wx.showModal({
        title: '删除心愿',
        content: `确定删除选中的 ${wishIds.length} 条心愿吗？删除后将不再展示。`,
        confirmText: '删除', confirmColor: '#d32f2f', success: resolve, fail: reject
      }));
      if (!result.confirm) return;
      // 等待当前分页请求完成，避免删除后旧请求把已删除卡片追加回来。
      if (this._wishesTask) await this._wishesTask;
      wx.showLoading({ title: '删除中...', mask: true });
      loadingShown = true;
      const response = await api.post('/wishes/batch/delete', { wishIds });
      const removed = new Set(response.wishIds.map(String));
      this.setData({ selectedWishIds: [] });
      this.updateWishColumns(this.data.wishes.filter(wish => !removed.has(String(wish.id))));
      wx.hideLoading();
      loadingShown = false;
      // 删除会改变后端分页偏移，重新加载首屏以免后续翻页漏掉心愿。
      await this.loadWishes(true, true);
      wx.showToast({ title: `已删除${response.count}条心愿`, icon: 'none' });
    } catch (err) {
      console.error('批量删除心愿失败:', err);
      wx.showToast({ title: getErrorMessage(err, '删除失败，请稍后重试'), icon: 'none' });
    } finally {
      if (loadingShown) wx.hideLoading();
      this.setData({ deletingWishes: false });
    }
  },

  // 上传心愿
  uploadWish: function() {
    if (this.data.deletingWishes) return;
    wx.navigateTo({
      url: '/pages/publishWish/publishWish'
    });
  },

  // 跳转到心愿详情
  goToWishDetail: function(e) {
    if (this.data.managingWishes) {
      this.toggleWishSelection(e);
      return;
    }
    var wishId = e.currentTarget.dataset.id;
    if (wishId) {
      this._skipNextMarketRefresh = true;
      wx.navigateTo({
        url: '/pages/wishDetail/wishDetail?id=' + wishId,
        fail: function() { this._skipNextMarketRefresh = false; }.bind(this)
      });
    }
  },

  // 跳转到商品
  goToProduct: function(e) {
    if (this.data.managingWishes) {
      this.toggleWishSelection({ currentTarget: { dataset: { id: e.currentTarget.dataset.wishId } } });
      return;
    }
    const productId = e.currentTarget.dataset.id;
    if (productId) {
      this._skipNextMarketRefresh = true;
      wx.navigateTo({
        url: `/pages/detail/detail?id=${productId}`,
        fail: () => { this._skipNextMarketRefresh = false; }
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
  goToMessages: function() {
    wx.reLaunch({ url: '/pages/messages/messages' });
  },
  handleCustomerServiceContact: function(e) {
    customerServiceNavigation.openFromContact(e);
  },
  goToCreateProduct: function() {
    managementNavigation.openProductCreate();
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
}, async function(changes) {
  for (const change of changes.filter(item => item.entity === 'wishes' && item.created && !item.removed)) {
    if (this.data.wishes.some(item => String(item.id) === change.id)) continue;
    const wish = await api.get('/wishes/' + change.id);
    const images = wish.images && wish.images.length ? wish.images : (wish.image ? [wish.image] : []);
    const item = { ...wish, images, image: wish.image || images[0] || '', title: wish.title || wish.content || '' };
    const column = this.data.leftColumn.length <= this.data.rightColumn.length ? 'leftColumn' : 'rightColumn';
    this.setData({ wishes: this.data.wishes.concat(item), [column]: this.data[column].concat(item) });
  }
  await pageSync.updateList(this, changes, {
    entity: 'wishes', field: 'wishes', url: id => '/wishes/' + id,
    normalize(wish) {
      const images = wish.images && wish.images.length ? wish.images : (wish.image ? [wish.image] : []);
      return { ...wish, images, image: wish.image || images[0] || '', title: wish.title || wish.content || '' };
    }
  });
  this.updateWishColumns(this.data.wishes, {}, true);
}));
