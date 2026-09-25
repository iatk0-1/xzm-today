// miniprogram/pages/index/index.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { formatStock, hasStock, isProductSoldOut, isSkuSoldOut } = require('../../utils/stock');
const app = getApp();

Page({
  data: {
    // 1. 顶部大厂导航栏适配参数
    navTop: 0,
    navHeight: 0,
    totalNavHeight: 0,

    // 2. 小红书同款交互参数
    currentMainTab: '上新',
    showStall: false,
    showTag: false,
    selectedStall: '',
    selectedTag: '',
    stallList: [], // 从后端加载，初始为空
    tagList: [], // 从后端加载，初始为空
    groupedStalls: [], // ✨核心：新增A-Z分组后的档口矩阵
    showAllPanel: false, // 新增：控制展开全部面板的开关

    // 3. 商品与权限参数
    isAdmin: false,
    productList: [],
    leftColumn: [],  // 左列商品
    rightColumn: [], // 右列商品

    // 4. 底部 SKU (颜色/尺码) 弹窗参数
    showSku: false,
    currentProduct: null,
    uniqueColors: [],
    uniqueSizes: [],
    selectedColor: '',
    selectedSize: '',
    currentSkuPrice: null,
    currentSkuStock: null,
    currentSkuImage: null,
    currentSkuId: null,
    currentSkuUnlimited: false,
    currentSkuSoldOut: false,
    quantity: 1,

    // 套装子项选择
    bundleSelections: [],
    bundleAllSelected: false,

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
    // 档口页仍按分享前的状态显示；没有筛选时回到默认的“上新”。
    const currentMainTab = shareTab === '档口' || stallId ? '档口' : '上新';

    this.setData({
      currentMainTab: currentMainTab,
      selectedStall: stallId,
      selectedTag: tagId,
      showStall: false,
      showTag: false,
      showAllPanel: false
    });
  },

  onShow: function() {
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

    // 从其他页面返回时刷新首页，商品、档口、标签一起更新；筛选条件和滚动位置保留。
    this.refreshHomeData();
  },

  onUnload: function() {
    this._isInitializingHome = false;
    this._isRefreshingHome = false;
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

  // 列表滚动区尺寸：窗口高度减去顶部导航；档口/分类还要给吸顶子导航让位
  updateListMetrics: function() {
    const win = this.getWindowSize();
    const subNavVisible = this.data.currentMainTab === '档口' || this.data.currentMainTab === '分类';
    // 子导航留白 100rpx，按屏宽换算成 px
    const listTop = subNavVisible ? Math.round(100 * win.width / 750) : 0;
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

    // 已有请求在飞行中：直接复用它，避免两次响应回来把列表搅乱
    if (this.data.loading) {
      return this._productsTask || Promise.resolve();
    }

    if (reset) {
      this.setData({ page: 1, productList: [], hasMore: true });
    }

    if (!this.data.hasMore) {
      return Promise.resolve();
    }

    const task = this.fetchProducts(reset, silent);
    this._productsTask = task;
    return task;
  },

  fetchProducts: async function(reset, silent) {
    this.setData({ loading: true });

    if (reset && !silent) {
      wx.showLoading({ title: '加载中...' });
    }

    try {
      const { page, pageSize, selectedStall, selectedTag } = this.data;

      // 构建查询参数
      const params = {
        page: page,
        size: pageSize
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

      // 后端返回 PageResult: { content, page, size, totalElements, totalPages, hasNext, ... }
      const newProducts = (res.content || []).map(function(product) {
        return Object.assign({}, product, { soldOut: isProductSoldOut(product) });
      });
      const hasMore = res.hasNext !== undefined ? res.hasNext : newProducts.length === pageSize;

      if (reset && !silent) {
        wx.hideLoading();
      }

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
      if (reset && !silent) {
        wx.hideLoading();
      }
      console.error('拉取商品失败:', err);
      this.setData({ loading: false });
      // 不弹窗，允许空列表显示
      this.setData({ productList: reset ? [] : this.data.productList });
    } finally {
      this._productsTask = null;
    }
  },

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

      // ✨核心魔法：前端极简拼音首字母提取器
      const getPinYinFirstLetter = (str) => {
        if (!str || !str.trim()) return '#';
        let char = str.trim()[0];
        if (/[A-Za-z]/.test(char)) return char.toUpperCase(); // 英文直接大写
        if (!/[\u4e00-\u9fa5]/.test(char)) return '#'; // 符号归入#
        const letters = "ABCDEFGHJKLMNOPQRSTWXYZ".split('');
        const zh = "阿八嚓哒妸发旮哈讥咔垃痳拿噢妑七呥扨它穵夕丫帀".split('');
        for (let i = 0; i < zh.length; i++) {
          if ((!zh[i+1] || zh[i+1].localeCompare(char, 'zh-Hans-CN') > 0) && char.localeCompare(zh[i], 'zh-Hans-CN') >= 0) {
            return letters[i];
          }
        }
        return '#';
      };

      // 数据清洗与 A-Z 分装
      let groupedObj = {};
      stalls.forEach(stall => {
        let initial = getPinYinFirstLetter(stall.name);
        if (!groupedObj[initial]) groupedObj[initial] = [];
        groupedObj[initial].push(stall);
      });

      // 整理成按 A-Z 排序的数组，# 放最后
      let groupedStalls = Object.keys(groupedObj).sort((a, b) => {
        if (a === '#') return 1;
        if (b === '#') return -1;
        return a.localeCompare(b);
      }).map(key => ({
        letter: key,
        list: groupedObj[key].slice().sort((a, b) =>
          String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
        )
      }));

      this.setData({
        stallList: stalls, // 纯净的列表供滑动区使用，不加"全部"
        groupedStalls: groupedStalls
      });
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
    this.setData({ isAdmin: !!auth.isAdmin() });
  },

  // 小红书灵魂交互逻辑
  handleMainTabChange(e) {
    const tabName = e.currentTarget.dataset.tab;

    if (tabName === '档口') {
      this.setData({ currentMainTab: '档口', showStall: true, showTag: false, showAllPanel: false });
    } else if (tabName === '分类') {
      this.setData({ currentMainTab: '分类', showTag: true, showStall: false, showAllPanel: false });
    } else if (tabName === '上新') {
      this.setData({
        currentMainTab: '上新', showStall: false, showTag: false, showAllPanel: false, selectedStall: '', selectedTag: ''
      });
      this.getProductsList();
    }

    this.updateListMetrics();
  },

  closeStallPanel() {
    this.setData({ showStall: false });
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
  
  selectStall(e) {
    const stallId = e.currentTarget.dataset.stall;
    const stallName = e.currentTarget.dataset.name;

    this.setData({
      selectedStall: stallId === 'all' ? '' : stallId,
      selectedStallName: stallId === 'all' ? '' : stallName,
      showStall: false,
      showAllPanel: false, // 点击后自动收起全屏面板
      currentMainTab: '档口'
    });

    this.updateListMetrics();
    this.getProductsList();
    wx.showToast({ title: stallId === 'all' ? '已显示全部' : '已切换至：' + stallName, icon: 'none' });
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
  goToSearch: function() { wx.navigateTo({ url: '/pages/search/search' }); },
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
  goToMessage: function() { wx.navigateTo({ url: '/pages/messages/messages' }); },
  goToLiveRoom: function() { wx.navigateTo({ url: '/pages/liveRoomList/index' }); },

  // 老板专属入口
  goToAdmin: function() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '无权限', icon: 'none' });
      return;
    }
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
  },

  // SKU 选规格与购物车逻辑
  openSkuPanel(e) {
    const product = e.currentTarget.dataset.product;

    // Build bundle groups from API or from skuMatrix
    var bundleGroups = product.bundleGroups;
    if (!bundleGroups || bundleGroups.length === 0) {
      var matrix = product.skuMatrix || [];
      if (matrix.length > 0 && matrix[0].bundleGroupName) {
        var groupMap = {};
        matrix.forEach(function(s) { var k = s.bundleGroupId || s.bundleGroupName; if (!groupMap[k]) groupMap[k] = { name: s.bundleGroupName, skus: [] }; groupMap[k].skus.push({ skuId: s.skuId, color: s.color, size: s.size, price: s.price, stock: s.stock, unlimitedStock: s.unlimitedStock, imageUrl: s.imageUrl }); });
        bundleGroups = Object.values(groupMap);
      }
    }

// 套装商品：初始化子项选择
if (bundleGroups && bundleGroups.length > 0) {
  // ✨ 新增逻辑 1：提取所有真实价格算区间，提取所有单品名称做拼接
  var allPrices = [];
  var bundleNames = [];
  bundleGroups.forEach(function(bg) {
    bundleNames.push(bg.name); // 收集商品名称（如上衣、裤子）
    if (bg.skus) {
      bg.skus.forEach(function(sku) {
        if (sku.price) allPrices.push(Number(sku.price));
        else if (sku.retailPrice) allPrices.push(Number(sku.retailPrice));
      });
    }
  });
  // 算最高和最低价
  var minP = allPrices.length > 0 ? Math.min.apply(null, allPrices) : 0;
  var maxP = allPrices.length > 0 ? Math.max.apply(null, allPrices) : 0;
  var rangeStr = (minP === maxP) ? '¥' + minP : '¥' + minP + ' - ¥' + maxP;
  var joinedNames = bundleNames.join('，'); // 拼接文案，如：上衣，裤子，牛仔裤

  var rawSel = bundleGroups.map(function(bg) {
    var skus = bg.skus || [];
    var colors = Array.from(new Set(skus.map(function(s) { return s.color || s.spec; })));
    var sizes = Array.from(new Set(skus.map(function(s) { return s.size; })));
    var hasStock = skus.some(function(s) { return s.unlimitedStock || s.stock > 0; });
    return { bundleGroupName: bg.name, skus: skus, uniqueColors: colors, uniqueSizes: sizes, selectedColor: '', selectedSize: '', selectedSku: null, quantity: 1, isOutOfStock: !hasStock };
  });
  var result = this._computeBundleSelections(rawSel, -1, null, null);
  this.setData({ 
    currentProduct: product, 
    currentSkuImage: product.coverUrl || product.image, 
    currentSkuId: null,
    currentSkuUnlimited: false,
    currentSkuSoldOut: false,
    quantity: 1,
    showSku: true,
    bundleSelections: result.bundleSelections, 
    bundleAllSelected: result.bundleAllSelected,
    bundlePriceRange: rangeStr, // ✨ 价格区间下发到前端
    bundleNamesStr: result.bundleNamesStr // ✨ 修复：初始化时接收大脑传来的“待选择”状态
  });
  return;
}

    let colors = [];
    let sizes = [];

    if (product.skuMatrix && product.skuMatrix.length > 0) {
      // 后端返回：color (颜色), size (尺码)
      colors = Array.from(new Set(product.skuMatrix.map(s => s.color || '')));
      sizes = Array.from(new Set(product.skuMatrix.map(s => s.size || '')));
      // 过滤空值
      colors = colors.filter(c => c);
      sizes = sizes.filter(s => s);
    }

    this.setData({
      currentProduct: product,
      uniqueColors: colors,
      uniqueSizes: sizes,
      selectedColor: colors.length === 1 ? colors[0] : '',
      selectedSize: sizes.length === 1 ? sizes[0] : '',
      currentSkuPrice: null,
      currentSkuStock: null,
      currentSkuImage: product.coverUrl || product.image,
      currentSkuId: null,
      currentSkuUnlimited: false,
      currentSkuSoldOut: false,
      quantity: 1,
      bundleSelections: [],
      bundleAllSelected: false,
      showSku: true
    });
    this.checkSkuMatch();
  },

  closeSkuPanel() {
    this.setData({ showSku: false });
  },

  selectColor(e) {
    this.setData({ selectedColor: e.currentTarget.dataset.color });
    this.checkSkuMatch();
  },

  selectSize(e) {
    this.setData({ selectedSize: e.currentTarget.dataset.size });
    this.checkSkuMatch();
  },

  checkSkuMatch() {
    const { currentProduct, selectedColor, selectedSize } = this.data;
    if (selectedColor && selectedSize && currentProduct.skuMatrix) {
      const match = currentProduct.skuMatrix.find(s =>
        s.color === selectedColor && s.size === selectedSize
      );
      if (match) {
        // 有 SKU 信息，使用 SKU 的价格、库存和图片
        this.setData({
          currentSkuPrice: match.price,
          currentSkuStock: match.stock,
          currentSkuUnlimited: match.unlimitedStock || false,
          currentSkuSoldOut: isSkuSoldOut(match),
          currentSkuStockText: formatStock(match.stock, match.unlimitedStock),
          currentSkuId: match.skuId,
          currentSkuImage: match.imageUrl || (currentProduct.coverUrl || currentProduct.image),
          quantity: this.normalizeSkuQuantity(this.data.quantity, match.stock, match.unlimitedStock)
        });
      } else {
        // 没有匹配的 SKU 信息，库存为 0，使用商品封面图
        this.setData({
          currentSkuPrice: null,
          currentSkuStock: 0,
          currentSkuUnlimited: false,
          currentSkuSoldOut: false,
          currentSkuStockText: '0',
          currentSkuId: null,
          currentSkuImage: currentProduct.coverUrl || currentProduct.image,
          quantity: 1
        });
      }
    }
  },

  normalizeSkuQuantity(value, stock, unlimitedStock) {
    var quantity = parseInt(value, 10);
    if (isNaN(quantity) || quantity < 1) quantity = 1;
    if (!unlimitedStock && stock != null && Number(stock) > 0) {
      quantity = Math.min(quantity, Number(stock));
    }
    return quantity;
  },

  skuQuantityMinus() {
    if (this.data.quantity <= 1) return;
    this.setData({ quantity: this.data.quantity - 1 });
  },

  skuQuantityPlus() {
    const { quantity, currentSkuStock, currentSkuUnlimited } = this.data;
    const hasStockLimit = !currentSkuUnlimited && currentSkuStock !== null;
    const maxQuantity = hasStockLimit ? Number(currentSkuStock) : 99;
    if (maxQuantity <= 0) {
      wx.showToast({ title: '该规格已售罄', icon: 'none' });
      return;
    }
    if (quantity >= maxQuantity) {
      wx.showToast({ title: '已达到库存上限', icon: 'none' });
      return;
    }
    this.setData({ quantity: quantity + 1 });
  },

  skuQuantityInput(e) {
    const { currentSkuStock, currentSkuUnlimited } = this.data;
    this.setData({
      quantity: this.normalizeSkuQuantity(e.detail.value, currentSkuStock, currentSkuUnlimited)
    });
  },

  skuQuantityInputBlur(e) {
    const { currentSkuStock, currentSkuUnlimited } = this.data;
    this.setData({
      quantity: this.normalizeSkuQuantity(e.detail.value, currentSkuStock, currentSkuUnlimited)
    });
  },

  // 套装子项选择处理
  selectBundleColor(e) {
    var result = this._computeBundleSelections(this.data.bundleSelections, e.currentTarget.dataset.index, 'selectedColor', e.currentTarget.dataset.color);
    this.setData(result);
  },

  selectBundleSize(e) {
    var result = this._computeBundleSelections(this.data.bundleSelections, e.currentTarget.dataset.index, 'selectedSize', e.currentTarget.dataset.size);
    this.setData(result);
  },

  _computeBundleSelections: function(sel, changeIdx, changeField, changeValue) {
    var allCheckedSelected = true;
    var hasChecked = false;
    var latestImage = null; // ✨ 专门捕获买家最新点击的那张图片

    var newSel = sel.map(function(s, i) {
      var ns = Object.assign({}, s);

      if (i === changeIdx && changeField) {
          // 极简反选逻辑：再点一次选中的规格，即视为取消
          if (ns[changeField] === changeValue) {
              ns[changeField] = ''; 
          } else {
              ns[changeField] = changeValue;
          }
      }

      ns.selectedSku = null;
      var needColor = ns.uniqueColors && ns.uniqueColors.length > 0;
      var needSize = ns.uniqueSizes && ns.uniqueSizes.length > 0;
      var colorOk = !needColor || ns.selectedColor;
      var sizeOk = !needSize || ns.selectedSize;

      if (colorOk && sizeOk && ns.skus && ns.skus.length > 0) {
          var match = ns.skus.find(function(sku) {
              var cMatch = !needColor || (sku.color || sku.spec) === ns.selectedColor;
              var sMatch = !needSize || sku.size === ns.selectedSize;
              return cMatch && sMatch;
          });
          if (match) {
            ns.selectedSku = { skuId: match.skuId || match.id, color: match.color || match.spec, size: match.size, price: match.price || match.retailPrice, stock: match.stock, unlimitedStock: match.unlimitedStock, imageUrl: match.imageUrl };
            if (!ns.quantity) ns.quantity = 1; // 默认数量置为1
            ns.computedPrice = parseFloat((Number(ns.selectedSku.price || 0) * ns.quantity).toFixed(2)); // ✨ 新增：自动计算并挂载卡片小计金额
        }
      }

      // ✨ 核心逻辑：拦截买家刚刚点击的那件商品，提取它的专属图片上报
      if (i === changeIdx) {
          if (ns.selectedSku && ns.selectedSku.imageUrl) {
              latestImage = ns.selectedSku.imageUrl;
          } else if (ns.selectedColor && ns.skus) {
              var colorMatch = ns.skus.find(function(sku) { return (sku.color || sku.spec) === ns.selectedColor && sku.imageUrl; });
              if (colorMatch) latestImage = colorMatch.imageUrl;
          }
          if (!latestImage && ns.skus && ns.skus.length > 0 && ns.skus[0].imageUrl) {
              latestImage = ns.skus[0].imageUrl;
          }
      }

      var isPartiallySelected = (needColor && ns.selectedColor && needSize && !ns.selectedSize) || (needSize && ns.selectedSize && needColor && !ns.selectedColor);
      
      if (ns.selectedSku) {
        hasChecked = true;
    } else if (isPartiallySelected) {
        allCheckedSelected = false; // 如果有选了一半的规格，阻断结算
    }
    return ns;
  });

  // ✨ 核心修复：动态计算“已选”商品名称组合，没选就输出“待选择”
  var selectedNames = newSel.filter(function(s) { return s.selectedSku != null; }).map(function(s) { return s.bundleGroupName; });
  var dynamicNamesStr = selectedNames.length > 0 ? selectedNames.join('，') : '待选择';

  // ✨ 新增：遍历已选商品，计算总件数和总金额
  var tCount = 0;
  var tPrice = 0;
  newSel.forEach(function(s) {
    if (s.selectedSku) {
      tCount += s.quantity;
      tPrice += s.computedPrice || (Number(s.selectedSku.price || 0) * s.quantity);
    }
  });

  var result = { 
    bundleSelections: newSel, 
    bundleAllSelected: hasChecked && allCheckedSelected,
    bundleNamesStr: dynamicNamesStr, 
    bundleTotalCount: tCount, // ✨ 传递合计件数给前端
    bundleTotalPrice: tPrice.toFixed(2) // ✨ 传递合计金额给前端
  };
  // ✨ 将捕获到的图片更新到页面顶部
  if (latestImage) {
      result.currentSkuImage = latestImage;
  }
  return result;
},

  // ====== 开放图片全屏预览 ======
  previewBundleImage(e) {
    var url = e.currentTarget.dataset.url;
    if (url) { wx.previewImage({ urls: [url], current: url }); }
  },

  // SKU 面板商品图预览（单张）
  previewSkuPanelImage() {
    var product = this.data.currentProduct || {};
    var current = this.data.currentSkuImage || product.coverUrl || product.image;
    if (current) {
      wx.previewImage({ urls: [current], current: current });
    }
  },

// ====== 精巧的数量增减器核心控制 ======
// ✨ 新增助手函数：点加减号时，同步重新算一次底部总价
_updateBundleTotals(sel) {
  var tCount = 0;
  var tPrice = 0;
  sel.forEach(function(s) {
    if (s.selectedSku) {
      tCount += s.quantity;
      tPrice += s.computedPrice || (Number(s.selectedSku.price || 0) * s.quantity);
    }
  });
  this.setData({ 
    bundleSelections: sel,
    bundleTotalCount: tCount,
    bundleTotalPrice: tPrice.toFixed(2)
  });
},
bundleMinus(e) {
  var index = e.currentTarget.dataset.index;
  var sel = this.data.bundleSelections;
  if (sel[index].quantity > 1) {
    sel[index].quantity--;
    sel[index].computedPrice = parseFloat((Number(sel[index].selectedSku.price || 0) * sel[index].quantity).toFixed(2)); 
    this._updateBundleTotals(sel); // ✨ 刷新视图和总价
  }
},
bundlePlus(e) {
  var index = e.currentTarget.dataset.index;
  var sel = this.data.bundleSelections;
  var sku = sel[index].selectedSku;
  if (sku && (sku.unlimitedStock || sel[index].quantity < sku.stock)) {
    sel[index].quantity++;
    sel[index].computedPrice = parseFloat((Number(sku.price || 0) * sel[index].quantity).toFixed(2)); 
    this._updateBundleTotals(sel); // ✨ 刷新视图和总价
  } else {
    wx.showToast({ title: '没库存了哦～', icon: 'none' });
  }
},
bundleInput(e) {
  var index = e.currentTarget.dataset.index;
  var val = parseInt(e.detail.value);
  var sel = this.data.bundleSelections;
  var sku = sel[index].selectedSku;
  if (!sku) return;
  if (isNaN(val) || val < 1) val = 1;
  if (!sku.unlimitedStock && val > sku.stock) {
    val = sku.stock;
    wx.showToast({ title: '没库存了哦～', icon: 'none' });
  }
  sel[index].quantity = val;
  sel[index].computedPrice = parseFloat((Number(sku.price || 0) * val).toFixed(2)); 
  this._updateBundleTotals(sel); // ✨ 刷新视图和总价
},
bundleInputBlur(e) {
  var index = e.currentTarget.dataset.index;
  var val = parseInt(e.detail.value);
  var sel = this.data.bundleSelections;
  if (isNaN(val) || val < 1) {
    sel[index].quantity = 1;
    sel[index].computedPrice = parseFloat((Number(sel[index].selectedSku.price || 0) * 1).toFixed(2)); 
    this._updateBundleTotals(sel); // ✨ 刷新视图和总价
  }
},


  // 套装商品加入购物车
  addToCartWithBundle(bundleConfig) {
    wx.showLoading({ title: '添加中...' });
    var cartData = {
      productId: this.data.currentProduct.id,
      skuId: bundleConfig[0].skuId,
      color: bundleConfig[0].color,
      size: bundleConfig[0].size,
      count: 1, 
      bundleConfig: bundleConfig
    };
    api.post('/cart/items', cartData)
      .then(function() {
        wx.hideLoading();
        wx.showToast({ title: '已加入购物车', icon: 'success' });
        // 大厂逻辑：加入购物车不关闭弹窗，保障买家的连续购物流
      })
      .catch(function(err) {
        wx.hideLoading();
        if (err.error === 'UNAUTHORIZED') wx.showToast({ title: '请先登录', icon: 'none' });
        else wx.showToast({ title: '添加失败', icon: 'none' });
      });
  },

  confirmAddToCart(e) {
    const actionType = e.currentTarget.dataset.action;
    const { currentProduct, bundleSelections, bundleAllSelected, selectedColor, selectedSize, currentSkuPrice, currentSkuStock, currentSkuUnlimited, currentSkuId, currentSkuImage, uniqueColors, uniqueSizes, quantity } = this.data;
    if (!currentProduct) return;

    if (bundleSelections && bundleSelections.length > 0) {
      if (!bundleAllSelected) return wx.showToast({ title: '请完善已选的规格', icon: 'none' });
      var selectedSubs = bundleSelections.filter(function(s) { return s.selectedSku != null; });
      if (selectedSubs.length === 0) return wx.showToast({ title: '请至少勾选一个商品', icon: 'none' });
      
      var bundleConfig = selectedSubs.map(function(s) {
        return { bundleGroupName: s.bundleGroupName, skuId: s.selectedSku.skuId, color: s.selectedSku.color, size: s.selectedSku.size, price: s.selectedSku.price, imageUrl: s.selectedSku.imageUrl || '', count: s.quantity };
      });

      if (actionType === 'buy') {
        this.setData({ showSku: false });
        var totalPrice = 0;
        bundleConfig.forEach(function(b) { totalPrice += (Number(b.price) || 0) * b.count; });
        var item = {
          productId: currentProduct.id, skuId: bundleConfig[0].skuId,
          name: currentProduct.name, image: currentProduct.coverUrl,
          selectedColor: bundleConfig[0].color, selectedSize: bundleConfig[0].size,
          price: totalPrice, finalPrice: totalPrice,
          count: 1, bundleConfig: bundleConfig
        };
        wx.setStorageSync('checkoutItems', [item]);
        wx.navigateTo({ url: '/pages/checkout/checkout' });
      } else {
        this.addToCartWithBundle(bundleConfig);
      }
      return;
    }


    if (uniqueColors.length > 0 && !selectedColor) {
      return wx.showToast({ title: '请选择颜色', icon: 'none' });
    }
    if (uniqueSizes.length > 0 && !selectedSize) {
      return wx.showToast({ title: '请选择尺码', icon: 'none' });
    }
    if (!hasStock(currentSkuStock, currentSkuUnlimited)) {
      return wx.showToast({ title: '该规格已售罄', icon: 'none' });
    }

    // 使用后端返回的 id 字段
    const productId = currentProduct.id || currentProduct._id;

    if (actionType === 'buy') {
      this.setData({ showSku: false });
      // 立即购买模式，使用本地存储传递数据
      const finalItem = {
        productId: productId,
        skuId: currentSkuId,
        name: currentProduct.name,
        image: currentProduct.coverUrl,
        coverUrl: currentSkuImage || currentProduct.coverUrl,  // 优先使用 SKU 图片
        selectedColor: selectedColor,
        selectedSize: selectedSize,
        finalPrice: currentSkuPrice,
        price: Number(currentSkuPrice || currentProduct.price || currentProduct.retailPrice || 0),
        count: quantity,
        selected: true
      };
      wx.setStorageSync('checkoutItems', [finalItem]);
      wx.navigateTo({ url: '/pages/checkout/checkout' });
    } else {
      // 加入购物车模式，调用后端 API
      wx.showLoading({ title: '添加中...' });

      const cartData = {
        productId: productId,
        skuId: currentSkuId || 0,
        color: selectedColor || '默认',
        size: selectedSize || '均码',
        count: quantity
      };

      api.post('/cart/items', cartData)
        .then(() => {
          wx.hideLoading();
          wx.showToast({ title: '已加入购物车', icon: 'success' });
          this.setData({ showSku: false });
        })
        .catch(err => {
          wx.hideLoading();
          console.error('添加购物车失败:', err);
          if (err.error === 'UNAUTHORIZED') {
            wx.showToast({ title: '请先登录', icon: 'none' });
          } else {
            wx.showToast({ title: '添加失败', icon: 'none' });
          }
        });
    }
  },

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
});
