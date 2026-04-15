// miniprogram/pages/detail/detail.js
const api = require('../../utils/api');

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
    currentAuraTab: '', // 记录当前选中的横向标签
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
          title: product.name, // 后端返回 name，前端使用 title
          displayPrice: product.displayPrice || (product.retailPrice ? String(product.retailPrice) : null),
          price: product.retailPrice ? String(product.retailPrice) : null,
          bannerImgs: banners,
          lookbookImgs: product.lookbookImages || [],
          detailImgs: product.detailImages || [],
          manualRelatedIds: product.relatedProductIds || [],
          // 直播相关字段
          productType: product.productType || 'normal',
          liveSessionId: product.liveSessionId,
          sessionStatus: product.sessionStatus,
          convertedToProductId: product.convertedToProductId
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

    // 初始化选中状态（如果只有一个选项则自动选中）
    const initialColor = uniqueColors.length === 1 ? uniqueColors[0] : '';
    const initialSize = uniqueSizes.length === 1 ? uniqueSizes[0] : '';

    this.setData({
      showSku: true,
      skuAction: action,
      selectedColor: initialColor,
      selectedSize: initialSize,
      currentSkuImage: product.coverUrl
    });

    // 如果已自动选中（单颜色 + 单尺码），检查 SKU 匹配
    if (uniqueColors.length === 1 && uniqueSizes.length === 1) {
      this.checkSkuMatch();
    } else {
      // 否则重置库存和价格状态
      this.setData({
        currentSkuPrice: null,
        currentSkuStock: null
      });
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
          currentSkuId: match.skuId,
          currentSkuImage: match.imageUrl || product.coverUrl
        });
      } else {
        // 没有匹配的 SKU 信息，库存为 0，价格使用商品展示价格
        this.setData({
          currentSkuPrice: product.retailPrice || product.displayPrice,
          currentSkuStock: 0,
          currentSkuId: null,
          currentSkuImage: product.coverUrl
        });
      }
    }
  },

  confirmSkuAction(e) {
    // 从点击事件中获取 action 参数，如果没有则使用 data 中的 skuAction
    const action = e.currentTarget.dataset.action || this.data.skuAction;
    const { product, selectedColor, selectedSize, currentSkuPrice, currentSkuStock, currentSkuId, uniqueColors, uniqueSizes } = this.data;

    // 检查是否选择了颜色和尺码
    if (uniqueColors.length > 0 && !selectedColor) {
      return wx.showToast({ title: '请选择颜色', icon: 'none' });
    }
    if (uniqueSizes.length > 0 && !selectedSize) {
      return wx.showToast({ title: '请选择尺码', icon: 'none' });
    }
    // 检查库存
    if (currentSkuStock <= 0) {
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
  }
});
