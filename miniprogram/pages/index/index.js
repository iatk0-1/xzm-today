const { getErrorMessage } = require('../../utils/error');
const pageSync = require('../../utils/pageSync');
// miniprogram/pages/index/index.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const managementNavigation = require('../../utils/managementNavigation');
const customerServiceNavigation = require('../../utils/customerServiceNavigation');
const customerServiceUnread = require('../../utils/customerServiceUnread');
const { groupStalls } = require('../../utils/productFilters');
const { isProductSoldOut } = require('../../utils/stock');
const productSkuPanel = require('../../utils/productSkuPanel');
const app = getApp();

Page(pageSync.wrap({
  data: {
    // 1. 顶部大厂导航栏适配参数
    navTop: 0,
    navHeight: 0,
    totalNavHeight: 0,

    // 2. 小红书同款交互参数
    currentMainTab: '上新',
    showTag: false,
    selectedStall: '',
    stallScrollLeft: 0,
    selectedTag: '',
    stallList: [], // 从后端加载，初始为空
    tagList: [], // 从后端加载，初始为空
    groupedStalls: [], // ✨核心：新增A-Z分组后的档口矩阵
    showAllPanel: false, // 新增：控制展开全部面板的开关

    // 3. 商品与权限参数
    isAdmin: false,
    isStallManager: false,
    messageUnreadCount: 0,
    messageUnreadLabel: '0',
    productList: [],
    leftColumn: [],  // 左列商品
    rightColumn: [], // 右列商品

    ...productSkuPanel.initialData,

    // 5. 分页参数
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,

    // 6. 下拉刷新与滚动区尺寸
    // 自定义导航栏会盖住页面级下拉刷新的转圈动画，所以列表用 scroll-view 自带刷新
    refreshing: false,
    listHeight: 0,
    listTop: 0
  },

  onLoad: function(options) {
    this._pageClosed = false;
    this._isInitializingHome = false;
    this._isRefreshingHome = false;
    this._skipNextHomeRefresh = false;
    this._hasLoadedHomeData = false;

    // 从分享链接恢复筛选条件；标签入口虽然隐藏，但标签参数仍需保留。
    this.restoreShareFilters(options || {});

    this.checkAdmin();

    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    this.setData({
      navTop: menuButtonInfo.top,
      navHeight: menuButtonInfo.height,
      totalNavHeight: menuButtonInfo.bottom + 40
    });
    this.updateListMetrics();

    // 等待认证完成后加载所有数据
    this.waitForAuthAndLoad();
  },

  restoreShareFilters: function(options) {
    const stallId = options.stallId || '';
    const tagId = options.tagId || '';
    const shareTab = options.tab || '';

    // 标签入口保持隐藏，带标签参数的分享页不主动展开标签面板。
    // 兼容旧档口分享链接；档口筛选与上新/销量排序独立。
    const currentMainTab = shareTab === '销量' ? '销量' : '上新';

    this.setData({
      currentMainTab: currentMainTab,
      selectedStall: stallId,
      selectedTag: tagId,
      showTag: false,
      showAllPanel: false
    });
  },

  onShow: function() {
    customerServiceUnread.start(this);
    // 每次显示页面时检查管理员状态
    this.checkAdmin();

    // 首次进入时由 onLoad 负责初始化，避免 onLoad/onShow 同时发起重复请求。
    if (this._isInitializingHome || this._isRefreshingHome) {
      return;
    }

    // 页面实例还没有完成首次加载时，继续走认证后初始化流程。
    if (!this.hasLoadedHomeData()) {
      this.waitForAuthAndLoad();
      return;
    }

    // 从商品详情返回时保留当前分页和滚动位置，不要把列表重置到第一页。
    if (this._skipNextHomeRefresh) {
      this._skipNextHomeRefresh = false;
      return;
    }

    // 返回时仅同步变动商品，由 pageSync 按 ID 更新。
  },

  onUnload: function() {
    this._pageClosed = true;
    customerServiceUnread.stop(this);
    this._isInitializingHome = false;
    this._isRefreshingHome = false;
  },

  onHide: function() {
    customerServiceUnread.stop(this);
  },

  hasLoadedHomeData: function() {
    return this._hasLoadedHomeData === true;
  },

  // 取窗口尺寸：新老基础库都兜住
  getWindowSize: function() {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo();
      if (info && info.windowHeight && info.windowWidth) {
        return { height: info.windowHeight, width: info.windowWidth };
      }
    }
    const legacy = typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null;
    return {
      height: (legacy && legacy.windowHeight) || 667,
      width: (legacy && legacy.windowWidth) || 375
    };
  },

  // 档口筛选常驻，列表始终让开 88rpx 子导航。
  updateListMetrics: function() {
    const win = this.getWindowSize();
    const listTop = Math.round(88 * win.width / 750);
    const listHeight = Math.max(200, win.height - (this.data.totalNavHeight || 0) - listTop);

    if (listTop === this.data.listTop && listHeight === this.data.listHeight) return;
    this.setData({ listTop: listTop, listHeight: listHeight });
  },

  // 首页也复用全局认证 Promise，避免定时轮询和业务请求并发启动。
  waitForAuthAndLoad: function() {
    if (this._isInitializingHome || this.hasLoadedHomeData()) {
      return;
    }

    this._isInitializingHome = true;
    wx.showLoading({ title: '加载中...' });

    const ensureAuth = app && typeof app.ensureAuthenticated === 'function'
      ? app.ensureAuthenticated({ silent: true })
      : auth.ensureAuthenticated({ silent: true });

    ensureAuth
      .catch((err) => {
        // 首页公共内容仍允许尝试加载，受保护请求会由 api.js 再次处理认证。
        console.warn('首页认证恢复失败，继续加载公共内容:', err);
      })
      .then(() => {
        if (!this._isInitializingHome) return;
        this.checkAdmin();
        return this.loadAllData();
      })
      .then(() => {
        if (this._isInitializingHome) {
          this._hasLoadedHomeData = true;
        }
      })
      .catch((err) => {
        console.error('首页数据加载失败:', err);
      })
      .finally(() => {
        wx.hideLoading();
        this._isInitializingHome = false;
      });
  },

  // 加载所有数据（商品、档口、标签）
  loadAllData: function() {
    return Promise.all([
      this.getProductsList(),
      this.loadStallList(),
      this.loadTagList()
    ]);
  },

  // 从后端 API 获取商品列表（支持分页）
  // options.silent: 静默加载，不弹全局 loading 遮罩（下拉刷新时用原生刷新动画）
  getProductsList: function(reset = true, options = {}) {
    const silent = options.silent === true;

    if (reset) {
      this._productsQueryVersion = (this._productsQueryVersion || 0) + 1;
    }

    // 切换条件时等待旧请求结束，再用最后一次选择重查；旧响应不再写入列表。
    if (this.data.loading) {
      if (reset) {
        if (!this._pendingProductsReset) {
          this._pendingProductsReset = Promise.resolve(this._productsTask)
            .catch(() => {})
            .then(() => {
              this._pendingProductsReset = null;
              return this.getProductsList(true, options);
            });
        }
        return this._pendingProductsReset;
      }
      return this._productsTask || Promise.resolve();
    }

    if (reset) {
      this.setData({ page: 1, productList: [], leftColumn: [], rightColumn: [], hasMore: true });
    }

    if (!this.data.hasMore) {
      return Promise.resolve();
    }

    const task = this.fetchProducts(reset, silent);
    this._productsTask = task;
    return task;
  },

  fetchProducts: async function(reset, silent) {
    const queryVersion = this._productsQueryVersion || 0;
    this.setData({ loading: true, loadError: '' });

    if (reset && !silent) {
      wx.showLoading({ title: '加载中...' });
    }

    try {
      const { page, pageSize, selectedStall, selectedTag, currentMainTab } = this.data;

      // 构建查询参数
      const params = {
        page: page,
        size: pageSize,
        sort: currentMainTab === '销量' ? 'sales' : 'newest'
      };

      // 如果选择了档口，按档口筛选（使用 stall 参数）
      if (selectedStall) {
        params.stallId = selectedStall;
      }

      // 如果选择了标签，按标签筛选（使用 tag 参数）
      if (selectedTag) {
        params.tagId = selectedTag;
      }

      const res = await api.get('/products/query', params);
      if (queryVersion !== (this._productsQueryVersion || 0)) return;

      // 后端返回 PageResult: { content, page, size, totalElements, totalPages, hasNext, ... }
      const newProducts = (res.content || []).map(function(product) {
        return Object.assign({}, product, { soldOut: isProductSoldOut(product) });
      });
      const hasMore = res.hasNext !== undefined ? res.hasNext : newProducts.length === pageSize;

      const allProducts = reset ? newProducts : this.data.productList.concat(newProducts);
      
      // 将商品分配到左右两列（奇数位置放左列，偶数位置放右列）
      const leftColumn = [];
      const rightColumn = [];
      allProducts.forEach((item, index) => {
        if (index % 2 === 0) {
          leftColumn.push(item);
        } else {
          rightColumn.push(item);
        }
      });

      this.setData({
        productList: allProducts,
        leftColumn: leftColumn,
        rightColumn: rightColumn,
        page: this.data.page + 1,
        hasMore: hasMore,
        loading: false
      });
    } catch (err) {
      console.error('拉取商品失败:', err);
      if (queryVersion === (this._productsQueryVersion || 0)) {
        this.setData({ loadError: getErrorMessage(err, '商品列表加载失败，请稍后重试') });
      }
    } finally {
      if (reset && !silent) wx.hideLoading();
      this.setData({ loading: false });
      this._productsTask = null;
    }
  },

  retryProducts: function() { return this.getProductsList(!this.data.productList.length, { silent: true }); },

  // 触底加载更多
  onReachBottom: function() {
    if (this.data.hasMore && !this.data.loading) {
      this.getProductsList(false);
    }
  },

  // 刷新首页数据：重新拉商品首屏、档口和标签（下拉刷新与页面级刷新共用同一套）
  refreshHomeData: function() {
    if (this._isRefreshingHome) {
      return this._refreshingTask || Promise.resolve();
    }

    this._isRefreshingHome = true;
    this.checkAdmin();

    // 有分页请求在飞行中时先等它落地，再重新拉首屏
    const waitIdle = this.data.loading && this._productsTask
      ? this._productsTask.catch(() => {})
      : Promise.resolve();

    const task = waitIdle
      .then(() => Promise.all([
        this.getProductsList(true, { silent: true }),
        this.loadStallList(),
        this.loadTagList()
      ]))
      .catch((err) => {
        console.error('首页刷新失败:', err);
      })
      .finally(() => {
        this._isRefreshingHome = false;
        this._refreshingTask = null;
        this.setData({ refreshing: false });
      });

    this._refreshingTask = task;
    return task;
  },

  // scroll-view 内置下拉刷新：手指释放时触发
  onRefresh: function() {
    this.setData({ refreshing: true });
    return this.refreshHomeData();
  },

  // 兜底：页面级下拉刷新（自定义导航栏会盖住它的转圈动画，正常走不上这条路）
  onPullDownRefresh: function() {
    if (this._isRefreshingHome) return Promise.resolve();
    return this.refreshHomeData().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 从后端 API 获取档口列表（纯前端 A-Z 拼音分组架构）
  loadStallList: async function() {
    try {
      const stalls = await api.get('/stalls');

      this.setData({
        stallList: stalls, // 纯净的列表供滑动区使用，不加"全部"
        groupedStalls: groupStalls(stalls)
      }, () => this.ensureSelectedStallVisible());
    } catch (err) {
      console.error('加载档口列表失败:', err);
      this.setData({ stallList: [], groupedStalls: [] });
    }
  },

  // 从后端 API 获取标签列表
  loadTagList: async function() {
    try {
      const tags = await api.get('/tags');
      this.setData({ tagList: tags }); // 纯净的列表供滑动区使用，不加"全部"
    } catch (err) {
      console.error('加载标签列表失败:', err);
      this.setData({ tagList: [] });
    }
  },

  // 检查管理员（使用本地 auth 模块）
  checkAdmin: function() {
    this.setData({ isAdmin: !!auth.isAdmin(), isStallManager: !!auth.isStallManager() });
  },

  // 排序与档口筛选独立，销量统一统计全部历史，重复点击不重复查询。
  handleMainTabChange(e) {
    const tabName = e.currentTarget.dataset.tab;
    if (tabName !== '上新' && tabName !== '销量') return;
    if (this.data.currentMainTab === tabName) return;
    this.setData({ currentMainTab: tabName, showAllPanel: false });
    return this.getProductsList();
  },

  closeTagPanel() {
    this.setData({ showTag: false });
  },

  // === 新增：全部面板的开启与关闭 ===
  toggleAllPanel() { 
    this.setData({ showAllPanel: !this.data.showAllPanel });
  },
  closeAllPanel() { 
    this.setData({ showAllPanel: false }); 
  },
  // 只截住冒泡手势，面板内的 scroll-view 继续处理自身滚动。
  stopPanelTouchMove() {},
  
  selectStall(e) {
    const stallId = e.currentTarget.dataset.stall;
    const stallName = e.currentTarget.dataset.name;

    this.setData({
      selectedStall: stallId === 'all' ? '' : stallId,
      selectedStallName: stallId === 'all' ? '' : stallName,
      showAllPanel: false // 点击后自动收起全屏面板
    }, () => this.ensureSelectedStallVisible());

    // 档口行高度固定，切换时静默刷新商品，避免全局提示干扰横向滚动。
    return this.getProductsList(true, { silent: true });
  },

  ensureSelectedStallVisible: function() {
    const stallId = this.data.selectedStall;
    if (!stallId || typeof wx.createSelectorQuery !== 'function') return;
    const query = wx.createSelectorQuery().in(this);
    query.select('.sub-nav-scroll').boundingClientRect();
    query.select('#stall-' + stallId).boundingClientRect();
    query.select('.sub-nav-scroll').scrollOffset();
    query.select('.sub-nav-container').boundingClientRect();
    query.select('.stall-edge-fade-right').boundingClientRect();
    query.exec(results => {
      if (this._pageClosed || this.data.selectedStall !== stallId) return;
      const [viewport, tag, offset, content, fade] = results;
      if (!viewport || !tag || !offset || !content) return;
      // 左侧保留7rpx留白；测量和scroll-left使用px，按窗口宽度换算。
      const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo()
        : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null);
      const leftInset = 7 * ((windowInfo && windowInfo.windowWidth) || 375) / 750;
      const inset = Math.min(fade ? fade.width / 2 : 0, viewport.width / 2);
      const visibleLeft = viewport.left + leftInset;
      const tagRight = tag.left + tag.width;
      const viewportRight = viewport.left + viewport.width - inset;
      let delta = 0;
      if (tag.left < visibleLeft) delta = tag.left - visibleLeft;
      else if (tagRight > viewportRight) delta = tagRight - viewportRight;
      else return;
      const maxLeft = Math.max(0, content.width - viewport.width);
      const scrollLeft = Math.max(0, Math.min(maxLeft, offset.scrollLeft + delta));
      if (Math.abs(offset.scrollLeft - scrollLeft) < 1) return;
      const applyTarget = () => this.setData({ stallScrollLeft: scrollLeft });
      // 手动滑动后再次选择同一目标时，先同步实际位置，再启动一次原生滚动。
      if (this.data.stallScrollLeft === scrollLeft) {
        this.setData({ stallScrollLeft: offset.scrollLeft }, applyTarget);
      } else {
        applyTarget();
      }
    });
  },

  selectTag(e) {
    const tagId = e.currentTarget.dataset.tag;
    const tagName = e.currentTarget.dataset.name;

    this.setData({
      selectedTag: tagId === 'all' ? '' : tagId,
      selectedTagName: tagId === 'all' ? '' : tagName,
      showTag: false,
      showAllPanel: false, // 点击后自动收起全屏面板
      currentMainTab: '分类'
    });

    this.updateListMetrics();
    this.getProductsList();
    wx.showToast({ title: tagId === 'all' ? '已显示全部' : '已切换至：' + tagName, icon: 'none' });
  },

  // 基础跳转功能
  goToSearch: function() {
    const query = this.buildShareQuery();
    wx.navigateTo({ url: '/pages/search/search' + (query ? '?' + query : '') });
  },
  goToCart: function() { wx.navigateTo({ url: '/pages/cart/cart' }); },
  goToDetail: function(e) {
    this._skipNextHomeRefresh = true;
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id,
      fail: () => { this._skipNextHomeRefresh = false; }
    });
  },
  goToMarket: function() { wx.reLaunch({ url: '/pages/market/market' }); },
  goToUser: function() { wx.reLaunch({ url: '/pages/user/user' }); },
  goToIndex: function() { wx.reLaunch({ url: '/pages/index/index' }); },
  goToMessages: function() { wx.reLaunch({ url: '/pages/messages/messages' }); },
  handleCustomerServiceContact: function(e) { customerServiceNavigation.openFromContact(e); },
  goToLiveRoom: function() { wx.navigateTo({ url: '/pages/liveRoomList/index' }); },

  // 加号打开新增商品、草稿箱浮动菜单。
  goToCreateProduct: function() {
    managementNavigation.openProductMenu(this);
  },

  ...productSkuPanel.methods,

  buildShareQuery: function() {
    const query = [];
    const currentMainTab = this.data.currentMainTab || '上新';

    if (currentMainTab !== '上新') {
      query.push('tab=' + encodeURIComponent(currentMainTab));
    }
    if (this.data.selectedStall) {
      query.push('stallId=' + encodeURIComponent(this.data.selectedStall));
    }
    if (this.data.selectedTag) {
      query.push('tagId=' + encodeURIComponent(this.data.selectedTag));
    }

    return query.join('&');
  },

  onShareAppMessage: function() {
    const tabName = this.data.currentMainTab || '上新';
    const query = this.buildShareQuery();
    return {
      title: `现在买 - ${tabName}`,
      path: '/pages/index/index' + (query ? '?' + query : ''),
      imageUrl: ''
    };
  },

  onShareTimeline: function() {
    const query = this.buildShareQuery();
    return {
      title: '现在买 - 潮流服饰好物',
      query: query,
      imageUrl: ''
    };
  }
}, async function(changes) {
  await pageSync.updateList(this, changes, {
    entity: 'products', field: 'productList', url: id => '/products/' + id,
    normalize: product => ({ ...product, soldOut: isProductSoldOut(product) }),
    matches: product => product.status === 'on'
      && (!this.data.selectedStall || (product.stallIds || []).some(id => String(id) === String(this.data.selectedStall)))
      && (!this.data.selectedTag || (product.relateTagIds || []).some(id => String(id) === String(this.data.selectedTag)))
  });
  const byId = new Map(this.data.productList.map(item => [String(item.id), item]));
  this.setData({
    leftColumn: this.data.leftColumn.filter(item => byId.has(String(item.id))).map(item => byId.get(String(item.id))),
    rightColumn: this.data.rightColumn.filter(item => byId.has(String(item.id))).map(item => byId.get(String(item.id)))
  });
}));
