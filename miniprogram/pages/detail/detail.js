// miniprogram/pages/detail/detail.js
const api = require('../../utils/api');
const { formatStock, hasStock } = require('../../utils/stock');

Page({
  data: {
    statusBarHeight: 20,
    navHeight: 64,
    product: {},
    currentTab: 0,
    bannerImgs: [],
    lookbookImgs: [],
    detailImgs: [],
    currentDetailIndex: 1,
    relatedProducts: [],
    showSku: false,
    skuAction: 'cart',
    uniqueColors: [],
    uniqueSizes: [],
    selectedColor: '',
    selectedSize: '',
    currentSkuPrice: null,
    currentSkuStock: null,
    currentSkuImage: null,
    showVideo: false,
    currentAuraTab: '',
    // 套装子项选择
    bundleSelections: [],    // [{bundleGroupName, selectedColor, selectedSize, selectedSkuId, selectedPrice, selectedStock, selectedImage}]
    bundleAllSelected: false,
  },

  onLoad: function(options) {
    const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const sbHeight = sysInfo.statusBarHeight || 20;
    this.setData({
      statusBarHeight: sbHeight,
      navHeight: sbHeight + 44
    });

    const productId = options.id;
    if (productId) {
      this.getProductDetail(productId);
    } else {
      wx.showToast({ title: '商品数据丢失', icon: 'none', duration: 2000 });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  // 从后端 API 获取商品详情
  getProductDetail: async function(id) {
    wx.showLoading({ title: '加载中...' });

    try {
      const res = await api.get(`/products/${id}`);

      wx.hideLoading();

      // 后端返回格式：{ product: {...}, skus: [...] }
      // product.skuMatrix: { skuId, color, size, price, stock }
      const product = res.product || {};
      const skuMatrix = product.skuMatrix || [];

      // 处理轮播图（封面 + 轮播图）
      let banners = [];
      if (product.coverUrl) {
        banners.push(product.coverUrl);
      }
      if (product.bannerImages && product.bannerImages.length > 0) {
        banners = banners.concat(product.bannerImages);
      }

      // 提取唯一颜色和尺码
      let colors = [];
      let sizes = [];
      if (skuMatrix.length > 0) {
        colors = [...new Set(skuMatrix.map(s => s.color))].filter(c => c);
        sizes = [...new Set(skuMatrix.map(s => s.size))].filter(s => s);
      }

      this.setData({
        product: {
          ...product,
          skuMatrix: skuMatrix,
          image: product.coverUrl || product.image,
          title: product.name,
          displayPrice: product.displayPrice || (product.retailPrice ? String(product.retailPrice) : null),
          price: product.retailPrice ? String(product.retailPrice) : null,
          bannerImgs: banners,
          lookbookImgs: product.lookbookImages || [],
          detailImgs: product.detailImages || [],
          manualRelatedIds: product.relatedProductIds || [],
          productType: product.productType || 'normal',
          liveSessionId: product.liveSessionId,
          sessionStatus: product.sessionStatus,
          convertedToProductId: product.convertedToProductId,
          bundleGroups: res.bundleGroups || null  // 套装子项（ProductDetailResponse顶层字段）
        },
        bannerImgs: banners,
        lookbookImgs: product.lookbookImages || [],
        detailImgs: product.detailImages || [],
        uniqueColors: colors,
        uniqueSizes: sizes,
        selectedColor: colors.length === 1 ? colors[0] : '',
        selectedSize: sizes.length === 1 ? sizes[0] : ''
      });

      this.checkSkuMatch();
      
      // 🚀 智能定位第一个有内容的标签
      let firstTab = '';
      if (product.description) firstTab = 'desc';
      else if (product.fabricCare) firstTab = 'fabric';
      else if (product.sizeChartTip) firstTab = 'size';
      else if (product.warmTips) firstTab = 'tips';
      this.setData({ currentAuraTab: firstTab });

      // 获取关联商品（使用手动关联的 ID）
      if (product.relatedProductIds && product.relatedProductIds.length > 0) {
        this.getRelatedProducts(product.relatedProductIds);
      }
    } catch (err) {
      wx.hideLoading();
      console.error('获取详情失败:', err);
      wx.showModal({ title: '提示', content: '找不到该商品', showCancel: false });
    }
  },

  // 改造：获取关联商品
  getRelatedProducts: async function(relatedIds) {
    try {
      if (relatedIds && relatedIds.length > 0) {
        // 先获取手动关联的商品，ids 使用逗号分隔格式
        const res = await api.get('/products/related', {
          ids: relatedIds.join(','),
          limit: 4
        });

        // 字段映射：将后端返回的 id/name 映射为前端期望的 _id/title
        const mappedProducts = (res || []).map(item => ({
          ...item,
          _id: item.id,
          title: item.name,
          displayPrice: item.displayPrice || (item.retailPrice ? String(item.retailPrice) : null),
          price: item.retailPrice ? String(item.retailPrice) : null,
          image: item.coverUrl || item.image
        }));

        this.setData({ relatedProducts: mappedProducts });
      }
    } catch (err) {
      console.error('获取关联商品失败:', err);
    }
  },

  // 界面交互事件
  goBack: function() {
    if (getCurrentPages().length === 1) {
      wx.reLaunch({ url: '/pages/index/index' });
    } else {
      wx.navigateBack();
    }
  },

  goToCart: function() {
    wx.navigateTo({ url: '/pages/cart/cart' });
  },

  switchTab: function(e) {
    this.setData({ currentTab: Number(e.currentTarget.dataset.index) });
  },

  onDetailSwiperChange: function(e) {
    this.setData({ currentDetailIndex: e.detail.current + 1 });
  },

  goToRelatedDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  // 弹窗与分流引擎
  openSkuPanel(e) {
    const action = e.currentTarget.dataset.action || 'cart';
    const { product, uniqueColors, uniqueSizes } = this.data;

    // Build bundle groups from API or from skuMatrix
    var bundleGroups = product.bundleGroups;
    if (!bundleGroups || bundleGroups.length === 0) {
      // Reconstruct from skuMatrix (for list pages where ProductSummaryResponse has no bundleGroups field)
      var matrix = product.skuMatrix || [];
      if (matrix.length > 0 && matrix[0].bundleGroupName) {
        var groupMap = {};
        matrix.forEach(function(s) {
          var key = s.bundleGroupId || s.bundleGroupName;
          if (!groupMap[key]) groupMap[key] = { name: s.bundleGroupName, skus: [] };
          groupMap[key].skus.push({ skuId: s.skuId, color: s.color, size: s.size, price: s.price, stock: s.stock, unlimitedStock: s.unlimitedStock, imageUrl: s.imageUrl });
        });
        bundleGroups = Object.values(groupMap);
      }
    }

    // 套装商品：初始化子项选择
    if (bundleGroups && bundleGroups.length > 0) {
      var rawSel = bundleGroups.map(function(bg) {
        var skus = bg.skus || [];
        var colors = [...new Set(skus.map(function(s) { return s.color || s.spec; }))];
        var sizes = [...new Set(skus.map(function(s) { return s.size; }))];
        return {
          bundleGroupName: bg.name, skus: skus, uniqueColors: colors, uniqueSizes: sizes,
          selectedColor: colors.length === 1 ? colors[0] : '',
          selectedSize: sizes.length === 1 ? sizes[0] : '',
          selectedSku: null
        };
      });
      var result = this._computeBundleSelections(rawSel, -1, null, null);
      this.setData({
        showSku: true, skuAction: action,
        bundleSelections: result.bundleSelections,
        bundleAllSelected: result.bundleAllSelected,
        currentSkuPrice: result.currentSkuPrice
      });
      return;
    }

    // 普通商品
    const initialColor = uniqueColors.length === 1 ? uniqueColors[0] : '';
    const initialSize = uniqueSizes.length === 1 ? uniqueSizes[0] : '';
    this.setData({
      showSku: true, skuAction: action,
      selectedColor: initialColor, selectedSize: initialSize,
      currentSkuImage: product.coverUrl
    });
    if (uniqueColors.length === 1 && uniqueSizes.length === 1) {
      this.checkSkuMatch();
    } else {
      this.setData({ currentSkuPrice: null, currentSkuStock: null });
    }
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
    const { product, selectedColor, selectedSize } = this.data;
    if (selectedColor && selectedSize && product.skuMatrix) {
      const match = product.skuMatrix.find(s =>
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
          currentSkuImage: match.imageUrl || product.coverUrl
        });
      } else {
        // 没有匹配的 SKU 信息，库存为 0，价格使用商品展示价格
        this.setData({
          currentSkuPrice: product.retailPrice || product.displayPrice,
          currentSkuStock: 0,
          currentSkuUnlimited: false,
          currentSkuStockText: '0',
          currentSkuId: null,
          currentSkuImage: product.coverUrl
        });
      }
    }
  },

  // 套装子项选择处理
  selectBundleColor(e) {
    var idx = e.currentTarget.dataset.index;
    var color = e.currentTarget.dataset.color;
    var result = this._computeBundleSelections(this.data.bundleSelections, idx, 'selectedColor', color);
    this.setData(result);
  },

  selectBundleSize(e) {
    var idx = e.currentTarget.dataset.index;
    var size = e.currentTarget.dataset.size;
    var result = this._computeBundleSelections(this.data.bundleSelections, idx, 'selectedSize', size);
    this.setData(result);
  },

  // 一次性计算 bundleSelections: 应用变更 + SKU匹配 + allSelected判断
  _computeBundleSelections: function(sel, changeIdx, changeField, changeValue) {
    var allOk = true;
    var totalPrice = 0;
    var newSel = sel.map(function(s, i) {
      var ns = Object.assign({}, s);
      if (i === changeIdx && changeField) ns[changeField] = changeValue;
      ns.selectedSku = null;
      if (ns.selectedColor && ns.selectedSize && ns.skus && ns.skus.length > 0) {
        var match = ns.skus.find(function(sku) { return (sku.color || sku.spec) === ns.selectedColor && sku.size === ns.selectedSize; });
        if (match) {
          ns.selectedSku = { skuId: match.skuId || match.id, color: match.color || match.spec, size: match.size, price: match.price || match.retailPrice, stock: match.stock, unlimitedStock: match.unlimitedStock, imageUrl: match.imageUrl };
          totalPrice += Number(ns.selectedSku.price) || 0;
        } else { allOk = false; }
      } else { allOk = false; }
      return ns;
    });
    return { bundleSelections: newSel, bundleAllSelected: allOk, currentSkuPrice: totalPrice > 0 ? totalPrice : null };
  },

  confirmSkuAction(e) {
    const action = e.currentTarget.dataset.action || this.data.skuAction;
    const { product, bundleSelections, bundleAllSelected } = this.data;

    // 套装商品：收集所有子项 SKU 一起提交
    if (bundleSelections && bundleSelections.length > 0) {
      if (!bundleAllSelected) return wx.showToast({ title: '请选择所有子项的规格', icon: 'none' });
      var bundleConfig = bundleSelections.map(function(s) {
        return { bundleGroupName: s.bundleGroupName, skuId: s.selectedSku.skuId, color: s.selectedSku.color, size: s.selectedSku.size, price: s.selectedSku.price, imageUrl: s.selectedSku.imageUrl || '' };
      });
      var totalPrice = 0;
      bundleConfig.forEach(function(b) { totalPrice += Number(b.price) || 0; });

      this.setData({ showSku: false });
      if (action === 'buy') {
        var item = {
          productId: product.id, skuId: bundleConfig[0].skuId,
          name: product.name, image: product.coverUrl,
          selectedColor: bundleConfig[0].color, selectedSize: bundleConfig[0].size,
          price: totalPrice, finalPrice: totalPrice,
          count: 1, bundleConfig: bundleConfig
        };
        wx.setStorageSync('checkoutItems', [item]);
        wx.navigateTo({ url: '/pages/checkout/checkout' });
      } else {
        this.addToCartWithBundle(bundleConfig, totalPrice);
      }
      return;
    }

    // 普通商品流程
    const { selectedColor, selectedSize, currentSkuPrice, currentSkuStock, currentSkuUnlimited, currentSkuId, currentSkuImage, uniqueColors, uniqueSizes } = this.data;

    // 检查是否选择了颜色和尺码
    if (uniqueColors.length > 0 && !selectedColor) {
      return wx.showToast({ title: '请选择颜色', icon: 'none' });
    }
    if (uniqueSizes.length > 0 && !selectedSize) {
      return wx.showToast({ title: '请选择尺码', icon: 'none' });
    }
    // 检查库存
    if (!hasStock(currentSkuStock, currentSkuUnlimited)) {
      return wx.showToast({ title: '该规格已售罄', icon: 'none' });
    }

    // 直播商品特殊处理
    if (product.productType === 'live') {
      // 如果直播商品已转换为正常商品，跳转到正常商品详情
      if (product.convertedToProductId) {
        wx.navigateTo({ url: '/pages/detail/detail?id=' + product.convertedToProductId });
        return;
      }
      // 如果直播已结束，禁止购买
      if (product.sessionStatus !== 'live') {
        wx.showToast({ title: '直播已结束，无法购买', icon: 'none' });
        return;
      }
    }

    const productId = product.id || product._id;

    // 如果没有选中颜色或尺码，使用默认值
    const finalColor = selectedColor || (uniqueColors.length === 1 ? uniqueColors[0] : '默认');
    const finalSize = selectedSize || (uniqueSizes.length === 1 ? uniqueSizes[0] : '均码');

    if (action === 'buy') {
      this.setData({ showSku: false });
      // 立即购买模式，使用本地存储传递数据
      const finalItem = {
        productId: productId,
        skuId: currentSkuId,
        name: product.name,
        image: product.coverUrl,
        coverUrl: currentSkuImage || product.coverUrl,  // 优先使用 SKU 图片
        selectedColor: finalColor,
        selectedSize: finalSize,
        finalPrice: currentSkuPrice || product.retailPrice || product.displayPrice,
        price: Number(currentSkuPrice || product.retailPrice || product.displayPrice),
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
        color: finalColor,
        size: finalSize,
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

  // 套装商品加入购物车
  addToCartWithBundle(bundleConfig, totalPrice) {
    var self = this;
    var product = this.data.product;
    wx.showLoading({ title: '添加中...' });
    var cartData = {
      productId: product.id,
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
        self.setData({ showSku: false });
      })
      .catch(function(err) {
        wx.hideLoading();
        if (err.error === 'UNAUTHORIZED') {
          wx.showToast({ title: '请先登录', icon: 'none' });
        } else {
          wx.showToast({ title: '添加失败', icon: 'none' });
        }
      });
  },

  // 视频悬浮窗控制系统
  openVideoOverlay: function() {
    this.setData({ showVideo: true });
    setTimeout(() => {
      const videoContext = wx.createVideoContext('mainFullscreenVideo');
      videoContext.play();
    }, 100);
  },

  closeVideoOverlay: function() {
    this.setData({ showVideo: false });
    const videoContext = wx.createVideoContext('mainFullscreenVideo');
    if (videoContext) videoContext.pause();
  },

// ====== 高级横向标签切换引擎 ======
switchAuraTab(e) {
  this.setData({
    currentAuraTab: e.currentTarget.dataset.tab
  });
},

  doNothing: function() {
    // 阻止视频点击事件冒泡
  },

  consultService: function() {
    const product = this.data.product;
    if (!product || !product.id) return;
    const sellerId = product.sellerId || require('../../utils/config').SELLER_USER_ID;
    wx.navigateTo({
      url: '/pages/chat/chat?sellerId=' + sellerId + '&productId=' + product.id
    });
  }
});
