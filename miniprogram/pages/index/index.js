// miniprogram/pages/index/index.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { formatStock, hasStock, isProductSoldOut } = require('../../utils/stock');
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

    // 套装子项选择
    bundleSelections: [],
    bundleAllSelected: false,

    // 5. 分页参数
    page: 0,
    pageSize: 20,
    hasMore: true,
    loading: false
  },

  onLoad: function() {
    this._isInitializingHome = false;
    this._authCheckTimer = null;
    this._authTimeoutTimer = null;

    this.checkAdmin();

    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    this.setData({
      navTop: menuButtonInfo.top,
      navHeight: menuButtonInfo.height,
      totalNavHeight: menuButtonInfo.bottom + 40
    });

    // 等待认证完成后加载所有数据
    this.waitForAuthAndLoad();
  },

  onShow: function() {
    // 每次显示页面时检查管理员状态
    this.checkAdmin();

    // 从商品详情返回时保留当前列表与滚动位置，不在 onShow 里重置首页数据
    if (!this.hasLoadedHomeData()) {
      this.waitForAuthAndLoad();
    }
  },

  onUnload: function() {
    this.clearHomeInitTimers();
  },

  hasLoadedHomeData: function() {
    return this.data.page > 0 || this.data.loading;
  },

  clearHomeInitTimers: function() {
    if (this._authCheckTimer) {
      clearTimeout(this._authCheckTimer);
      this._authCheckTimer = null;
    }
    if (this._authTimeoutTimer) {
      clearTimeout(this._authTimeoutTimer);
      this._authTimeoutTimer = null;
    }
  },

  // 等待认证完成并加载数据
  waitForAuthAndLoad: function() {
    if (this._isInitializingHome || this.hasLoadedHomeData()) {
      return;
    }

    // 检查是否已经认证完成
    if (app.globalData.isAuthReady) {
      this.checkAdmin();
      this._isInitializingHome = true;
      this.loadAllData().then(() => {
        this._isInitializingHome = false;
      });
      return;
    }

    this._isInitializingHome = true;

    // 显示加载提示
    wx.showLoading({ title: '加载中...' });

    const startLoad = () => {
      this.clearHomeInitTimers();
      wx.hideLoading();
      this.checkAdmin();
      this.loadAllData().then(() => {
        this._isInitializingHome = false;
      });
    };

    // 等待认证完成
    const checkAuth = () => {
      if (this.hasLoadedHomeData()) {
        this.clearHomeInitTimers();
        wx.hideLoading();
        this._isInitializingHome = false;
        return;
      }

      if (app.globalData.isAuthReady) {
        startLoad();
      } else {
        // 最多等待 5 秒
        this._authCheckTimer = setTimeout(checkAuth, 500);
      }
    };

    checkAuth();

    // 超时处理
    this._authTimeoutTimer = setTimeout(() => {
      if (this.hasLoadedHomeData()) {
        this.clearHomeInitTimers();
        wx.hideLoading();
        this._isInitializingHome = false;
        return;
      }

      if (!app.globalData.isAuthReady) {
        startLoad();
      }
    }, 5000);
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
  getProductsList: async function(reset = true) {
    if (reset) {
      this.setData({ page: 0, productList: [], hasMore: true });
    }

    if (!this.data.hasMore || this.data.loading) return;

    this.setData({ loading: true });

    if (reset) {
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
        params.stall = selectedStall;
      }

      // 如果选择了标签，按标签筛选（使用 tag 参数）
      if (selectedTag) {
        params.tag = selectedTag;
      }

      const res = await api.get('/products/search', params);

      // 后端返回 PageResult: { content, page, size, totalElements, totalPages, hasNext, ... }
      const newProducts = (res.content || []).map(function(product) {
        return Object.assign({}, product, { soldOut: isProductSoldOut(product) });
      });
      const hasMore = res.hasNext !== undefined ? res.hasNext : newProducts.length === pageSize;

      if (reset) {
        wx.hideLoading();
      }

      const allProducts = reset ? newProducts : [...this.data.productList, ...newProducts];
      
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
      if (reset) {
        wx.hideLoading();
      }
      console.error('拉取商品失败:', err);
      this.setData({ loading: false });
      // 不弹窗，允许空列表显示
      this.setData({ productList: reset ? [] : this.data.productList });
    }
  },

  // 触底加载更多
  onReachBottom: function() {
    if (this.data.hasMore && !this.data.loading) {
      this.getProductsList(false);
    }
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
      }).map(key => ({ letter: key, list: groupedObj[key] }));

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

    this.getProductsList();
    wx.showToast({ title: tagId === 'all' ? '已显示全部' : '已切换至：' + tagName, icon: 'none' });
  },

  // 基础跳转功能
  goToSearch: function() { wx.navigateTo({ url: '/pages/search/search' }); },
  goToCart: function() { wx.navigateTo({ url: '/pages/cart/cart' }); },
  goToDetail: function(e) { wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id }); },
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
  var minP = allPrices.length > 0 ? Math.min(...allPrices) : 0;
  var maxP = allPrices.length > 0 ? Math.max(...allPrices) : 0;
  var rangeStr = (minP === maxP) ? '¥' + minP : '¥' + minP + ' - ¥' + maxP;
  var joinedNames = bundleNames.join('，'); // 拼接文案，如：上衣，裤子，牛仔裤

  var rawSel = bundleGroups.map(function(bg) {
    var skus = bg.skus || [];
    var colors = [...new Set(skus.map(function(s) { return s.color || s.spec; }))];
    var sizes = [...new Set(skus.map(function(s) { return s.size; }))];
    var hasStock = skus.some(function(s) { return s.unlimitedStock || s.stock > 0; });
    return { bundleGroupName: bg.name, skus: skus, uniqueColors: colors, uniqueSizes: sizes, selectedColor: '', selectedSize: '', selectedSku: null, quantity: 1, isOutOfStock: !hasStock };
  });
  var result = this._computeBundleSelections(rawSel, -1, null, null);
  this.setData({ 
    currentProduct: product, 
    currentSkuImage: product.coverUrl || product.image, 
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
      colors = [...new Set(product.skuMatrix.map(s => s.color || ''))];
      sizes = [...new Set(product.skuMatrix.map(s => s.size || ''))];
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
          currentSkuStockText: formatStock(match.stock, match.unlimitedStock),
          currentSkuId: match.skuId,
          currentSkuImage: match.imageUrl || (currentProduct.coverUrl || currentProduct.image)
        });
      } else {
        // 没有匹配的 SKU 信息，库存为 0，使用商品封面图
        this.setData({
          currentSkuPrice: null,
          currentSkuStock: 0,
          currentSkuUnlimited: false,
          currentSkuStockText: '0',
          currentSkuId: null,
          currentSkuImage: currentProduct.coverUrl || currentProduct.image
        });
      }
    }
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
    const { currentProduct, bundleSelections, bundleAllSelected, selectedColor, selectedSize, currentSkuPrice, currentSkuStock, currentSkuUnlimited, currentSkuId, currentSkuImage, uniqueColors, uniqueSizes } = this.data;
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
        count: 1,
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
        count: 1
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

  onShareAppMessage: function() {
    const tabName = this.data.currentMainTab || '上新';
    return {
      title: `现在买 - ${tabName}`,
      path: '/pages/index/index',
      imageUrl: ''
    };
  },

  onShareTimeline: function() {
    return {
      title: '现在买 - 潮流服饰好物',
      query: '',
      imageUrl: ''
    };
  }
});
