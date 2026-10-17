const { getErrorMessage, isUnauthorized } = require('../../utils/error');
const api = require('../../utils/api');
const { normalizeProductImages } = require('../../utils/productImage');
const { getBannerImageMode, getDetailImageMode } = require('../../utils/productGallery');
const { getPurchaseNotice } = require('../../utils/purchaseNotice');
const { resolveDirection } = require('../../utils/productSheetGesture');
const auth = require('../../utils/auth');
const { formatStock, hasStock, isSkuSoldOut, isProductSoldOut } = require('../../utils/stock');
const { findSelectedSku, getSkuOptions, getDefaultSkuSelection, getSkuOptionSelection } = require('../../utils/skuSelection');
const { createShareImage } = require('../../utils/shareImage');
const customerServiceNavigation = require('../../utils/customerServiceNavigation');
const skuQuantityEditor = require('../../utils/skuQuantityEditor');

function createProductDetailConfig() {
  return {
  ...skuQuantityEditor,
  data: {
    embedded: false,
    loading: false,
    loadError: '',
    gestureLockedVertical: false,
    purchasePending: false,
    bannerIndex: 0,
    statusBarHeight: 20,
    navHeight: 64,
    product: {},
    currentTab: 0,
    bannerImgs: [],
    bannerImageModes: [],
    bannerVideoFit: 'contain',
    bannerVideoStyle: 'width: 100%; height: 100%;',
    bannerBaseWidth: 375,
    bannerBaseHeight: 468.75,
    bannerTranslateX: 0,
    bannerDragging: false,
    pageBannerScrollLocked: false,
    lookbookImgs: [],
    detailImgs: [],
    detailImageModes: [],
    currentDetailIndex: 1,
    relatedProducts: [],
    isAdmin: false,
    isStallManager: false,
    showSku: false,
    skuAction: 'cart',
    uniqueColors: [],
    uniqueSizes: [],
    colorOptions: [],
    sizeOptions: [],
    selectedColor: '',
    selectedSize: '',
    currentSkuPrice: null,
    currentSkuStock: null,
    currentSkuImage: null,
    currentSkuId: null,
    currentSkuUnlimited: false,
    currentSkuSoldOut: false,
    quantity: 1,
    showVideo: false,
    currentAuraTab: '',
    shareImages: {
      single: '',
      double: '',
      triple: ''
    },
    shareImageCount: 0,
    shareTemplatesReady: false,
    showShareTemplates: false,
    canShowShareFloat: false,
    shareFloatLeft: 0,
    shareFloatTop: 0,
    editFloatLeft: 0,
    editFloatTop: 0,
    videoFloatStyle: '',
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
    this.initShareFloatPosition(sysInfo);
    this.refreshShareFloatVisibility();

    const productId = options.id;
    this._productId = productId;
    if (productId) {
      this.loadProductSafe(productId);
    } else {
      wx.showToast({ title: '商品数据丢失', icon: 'none', duration: 2000 });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  onShow: function() {
    this.refreshShareFloatVisibility();
    if (this._refreshAfterEdit && this._productId) {
      this._refreshAfterEdit = false;
      this.loadProductSafe(this._productId);
    }
  },

  onHide: function() {
    if (!this.data.embedded) this.onPageBannerTouchCancel();
    this._videoFloatDrag = null;
    this.pauseProductVideos();
  },

  onUnload: function() {
    this._videoFloatDrag = null;
    this._productVersion = (this._productVersion || 0) + 1;
    clearTimeout(this._videoTimer);
    this.pauseProductVideos();
  },

  pauseProductVideos: function() {
    if (!wx.createVideoContext) return;
    ['productBannerVideo', 'mainFullscreenVideo'].forEach(id => {
      const video = wx.createVideoContext(id, this);
      if (video) video.pause();
    });
  },

  retryProduct: function() {
    return this.loadProductSafe(this._productId);
  },

  onDocumentImageLoad: function() {
    if (this.measureDocument) this.measureDocument();
  },

  onBannerChange: function(e) {
    this.setData({ bannerIndex: e.detail.current });
  },

  onPageBannerTouchStart: function(e) {
    if (this.data.embedded || !e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0];
    this._pageBannerTouch = { x: touch.clientX, y: touch.clientY, dx: 0, direction: '' };
    // 与全屏弹窗一致：起手保持原生纵滚可用，只在确认横滑后锁定。
    // 起手禁用 scroll-y 会使原生滚动容器错过整次纵向手势。
    this.setData({ bannerDragging: true, pageBannerScrollLocked: false });
  },

  onPageBannerTouchMove: function(e) {
    const swipe = this._pageBannerTouch;
    if (this.data.embedded || !swipe) return;
    if (!e.touches || e.touches.length !== 1) return this.onPageBannerTouchCancel();
    const touch = e.touches[0];
    swipe.dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (!swipe.direction) swipe.direction = resolveDirection(swipe.dx, dy, true);
    if (swipe.direction === 'vertical' && this.data.pageBannerScrollLocked) {
      this.setData({ pageBannerScrollLocked: false });
    }
    if (swipe.direction !== 'horizontal') return;
    if (!this.data.pageBannerScrollLocked) this.setData({ pageBannerScrollLocked: true });
    this._suppressTapUntil = Date.now() + 350;
    const count = this.data.bannerImgs.length + (this.data.product.videoUrl ? 1 : 0);
    const width = this.data.bannerBaseWidth || 375;
    const min = -Math.max(0, (count - 1) * width);
    const base = -(this.data.bannerIndex || 0) * width;
    const raw = base + swipe.dx;
    const resistance = value => width * 0.18 * value / (width + value);
    const offset = raw > 0 ? resistance(raw) : raw < min ? min - resistance(min - raw) : raw;
    this.setData({ bannerTranslateX: offset });
  },

  onPageBannerTouchEnd: function() {
    const swipe = this._pageBannerTouch;
    if (this.data.embedded || !swipe) return;
    this._pageBannerTouch = null;
    const count = this.data.bannerImgs.length + (this.data.product.videoUrl ? 1 : 0);
    let next = this.data.bannerIndex || 0;
    if (swipe.direction === 'horizontal' && Math.abs(swipe.dx) >= 40) {
      next = Math.max(0, Math.min(count - 1, next + (swipe.dx < 0 ? 1 : -1)));
    }
    this.setData({ bannerIndex: next, bannerDragging: false, pageBannerScrollLocked: false, bannerTranslateX: -next * (this.data.bannerBaseWidth || 375) });
  },

  onPageBannerTouchCancel: function() {
    const swipe = this._pageBannerTouch;
    if (this.data.embedded || !swipe) return;
    this._pageBannerTouch = null;
    const index = this.data.bannerIndex || 0;
    this.setData({ bannerDragging: false, pageBannerScrollLocked: false, bannerTranslateX: -index * (this.data.bannerBaseWidth || 375) });
  },

  onBannerVideoMetadata: function(e) {
    const src = e.currentTarget.dataset.src;
    if (!src || src !== this.data.product.videoUrl) return;
    const { width, height } = e.detail;
    const fit = getBannerImageMode(width, height) === 'aspectFill' ? 'cover' : 'contain';
    if (!this._bannerVideoFitCache) this._bannerVideoFitCache = new Map();
    this._bannerVideoFitCache.set(src, fit);
    // 缩小原生播放区域到实际画面比例，白边由外层容器提供。
    let videoWidth = 100;
    let videoHeight = 100;
    if (fit === 'contain' && width > 0 && height > 0) {
      const ratio = width / height;
      if (ratio < 4 / 5) videoWidth = ratio / (4 / 5) * 100;
      else videoHeight = (4 / 5) / ratio * 100;
    }
    const style = `width: ${videoWidth}%; height: ${videoHeight}%;`;
    if (!this._bannerVideoStyleCache) this._bannerVideoStyleCache = new Map();
    this._bannerVideoStyleCache.set(src, style);
    this.setData({ bannerVideoFit: fit, bannerVideoStyle: style });
  },

  onBannerImageLoad: function(e) {
    const { index, src } = e.currentTarget.dataset;
    // 切换商品后的旧加载回调不能修改新商品同一位置的图片模式。
    if (this.data.bannerImgs[index] !== src) return;
    const { width, height } = e.detail;
    if (!(width > 0 && height > 0)) return;
    const mode = getBannerImageMode(width, height);
    if (!this._bannerModeCache) this._bannerModeCache = new Map();
    this._bannerModeCache.set(src, mode);
    if (this.data.bannerImageModes[index] === mode) return;
    const modes = this.data.bannerImageModes.slice();
    modes[index] = mode;
    this.setData({ bannerImageModes: modes });
  },

  onDetailImageLoad: function(e) {
    const { index, src } = e.currentTarget.dataset;
    if (this.data.detailImgs[index] !== src) return;
    const { width, height } = e.detail;
    if (!(width > 0 && height > 0)) return;
    if (!this._detailImageSizes) this._detailImageSizes = new Map();
    this._detailImageSizes.set(src, { width, height });
    this.refreshDetailImageModes();
  },

  refreshDetailImageModes: function() {
    const modes = this.data.detailImgs.map(src => {
      const size = this._detailImageSizes && this._detailImageSizes.get(src);
      if (!size) return 'aspectFit';
      return getDetailImageMode(size.width, size.height);
    });
    if (modes.some((mode, index) => mode !== this.data.detailImageModes[index]) ||
        modes.length !== this.data.detailImageModes.length) this.setData({ detailImageModes: modes });
  },

  onResize: function() {
    this.refreshDetailImageModes();
  },

  // 安全加载：等待认证就绪 + 带重试（解决分享链接冷启动 401 问题）
  loadProductSafe: async function(productId) {
    const version = this._productVersion = (this._productVersion || 0) + 1;
    this.setData({ loading: true, loadError: '' });
    await this.waitForAuth(5000);
    if (version !== this._productVersion) return;
    this.refreshShareFloatVisibility();
    await this.getProductDetailWithRetry(productId, 2, version);
  },

  refreshShareFloatVisibility: function() {
    this.setData({ canShowShareFloat: auth.isAdmin() === true });
  },

  // 等待认证初始化完成（分享链接冷启动时 auth 可能尚未完成）
  waitForAuth: function(timeout) {
    var app = getApp();
    if (app && typeof app.ensureAuthenticated === 'function') {
      return app.ensureAuthenticated({ silent: true }).catch(function(err) {
        console.warn('[detail] 认证恢复失败，继续加载公共商品信息:', err);
      });
    }

    return auth.ensureAuthenticated({ silent: true }).catch(function(err) {
      console.warn('[detail] 认证恢复失败，继续加载公共商品信息:', err);
    });

  },

  // 带重试的加载
  getProductDetailWithRetry: async function(id, retries, version = this._productVersion) {
    for (var i = 0; i <= retries; i++) {
      try {
        await this.getProductDetail(id, version);
        return; // 成功
      } catch (err) {
        if (version !== this._productVersion) return;
        if (err && isUnauthorized(err) && i < retries) {
          console.log('[detail] 未授权，等待认证后重试... 第' + (i + 1) + '次');
          await this.waitForAuth(3000);
          continue;
        }
        // 最终失败
        wx.hideLoading();
        console.error('获取详情失败:', err);
        const message = getErrorMessage(err, err && err.statusCode === 404 ? '找不到该商品' : '商品加载失败，请稍后重试');
        this.setData({ loading: false, loadError: message });
        if (!this.data.embedded) wx.showModal({ title: '加载失败', content: message, showCancel: false });
        return;
      }
    }
  },

  // 从后端 API 获取商品详情
  getProductDetail: async function(id, version = this._productVersion) {
    if (!this.data.embedded) wx.showLoading({ title: '加载中...' });

    try {
      const res = await api.get(`/products/${id}`);
      if (version !== this._productVersion) return;
      if (!this.data.embedded) wx.hideLoading();

      // 后端返回格式：{ product: {...}, skus: [...] }
      // product.skuMatrix: { skuId, color, size, price, stock }
      const product = normalizeProductImages(res.product || {});
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

      const bannerWidth = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth || 375;
      const bannerHeight = bannerWidth * 1.25;

      this.setData({
        loading: false, loadError: '',
        product: {
          ...product,
          purchaseNotice: getPurchaseNotice(product.purchaseNotice),
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
          soldOut: isProductSoldOut({ skuMatrix: skuMatrix }),
          offSale: String(product.status || '').toLowerCase() === 'off',
          bundleGroups: res.bundleGroups || null  // 套装子项（ProductDetailResponse顶层字段）
        },
        bannerImgs: banners,
        bannerImageModes: banners.map(url => this._bannerModeCache && this._bannerModeCache.get(url) || 'aspectFit'),
        bannerVideoFit: this._bannerVideoFitCache && this._bannerVideoFitCache.get(product.videoUrl) || 'contain',
        bannerVideoStyle: this._bannerVideoStyleCache && this._bannerVideoStyleCache.get(product.videoUrl) || 'width: 100%; height: 100%;',
        bannerBaseWidth: bannerWidth,
        bannerBaseHeight: bannerHeight,
        bannerTranslateX: 0,
        bannerDragging: false,
        lookbookImgs: product.lookbookImages || [],
        detailImgs: product.detailImages || [],
        detailImageModes: (product.detailImages || []).map(() => 'aspectFit'),
        uniqueColors: colors,
        uniqueSizes: sizes,
        ...getDefaultSkuSelection(skuMatrix),
        bundleSelections: [],
        bundleAllSelected: false
      });

      this.refreshDetailImageModes();
      this.prepareShareImages(banners.length > 0 ? banners : [product.image]);

      this.checkSkuMatch();

      // 定位第一个有内容的标签
      let firstTab = '';
      if (product.description) firstTab = 'desc';
      else if (product.fabricCare) firstTab = 'fabric';
      else if (product.sizeChartTip) firstTab = 'size';
      else if (product.warmTips) firstTab = 'tips';
      this.setData({ currentAuraTab: firstTab });

      // 获取关联商品（使用手动关联的 ID）
      if (product.relatedProductIds && product.relatedProductIds.length > 0) {
        this.getRelatedProducts(product.relatedProductIds, version);
      }
    } catch (err) {
      if (version !== this._productVersion) return;
      if (!this.data.embedded) wx.hideLoading();
      console.error('获取详情失败:', err);
      throw err;
    }
  },

  // 预生成所有可选分享模板，分享回调里直接返回本地临时文件路径
  prepareShareImages: function(images) {
    const version = this._productVersion;
    var shareSources = (images || []).filter(function(image) { return image; }).slice(0, 3);
    var tasks = [{ key: 'single', sources: shareSources.slice(0, 1), canvasId: 'detailShareCanvasSingle' }];
    if (shareSources.length >= 2) {
      tasks.push({ key: 'double', sources: shareSources.slice(0, 2), canvasId: 'detailShareCanvasDouble' });
    }
    if (shareSources.length >= 3) {
      tasks.push({ key: 'triple', sources: shareSources.slice(0, 3), canvasId: 'detailShareCanvasTriple' });
    }

    this.setData({
      shareImageCount: shareSources.length,
      shareTemplatesReady: false,
      shareImages: { single: '', double: '', triple: '' }
    });

    var page = this;
    tasks.reduce(function(sequence, task) {
      return sequence.then(function() {
        return createShareImage(page, task.sources, task.canvasId).then(function(filePath) {
          if (filePath && version === page._productVersion) {
            var update = {};
            update['shareImages.' + task.key] = filePath;
            page.setData(update);
          }
        });
      });
    }, Promise.resolve()).then(function() {
      if (version === page._productVersion) page.setData({ shareTemplatesReady: true });
    });
  },

  initShareFloatPosition: function(sysInfo) {
    var windowWidth = sysInfo.windowWidth || 375;
    var windowHeight = sysInfo.windowHeight || 667;
    var menuRect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    var floatSize = this.data.embedded ? 42 : 58;
    var top = menuRect ? menuRect.bottom + 12 : (sysInfo.statusBarHeight || 20) + 44 + 12;
    var left = Math.max(0, windowWidth - floatSize - 18);
    var shareTop = Math.max(0, Math.min(windowHeight - floatSize, top));
    this._shareWindow = { width: windowWidth, height: windowHeight };
    this.setData({
      shareFloatLeft: left,
      shareFloatTop: shareTop,
      editFloatLeft: left,
      editFloatTop: Math.max(0, Math.min(windowHeight - floatSize, shareTop + floatSize + 8))
    });
  },

  cancelFloatTouch: function() {
    this._editFloatDrag = null;
    this._shareFloatDrag = null;
  },

  startFloatDrag: function(e, key, left, top) {
    const touch = e.touches && e.touches[0];
    if (!touch || e.touches.length !== 1) return;
    this[key] = { startX: touch.clientX, startY: touch.clientY, left, top, moved: false };
  },

  moveFloatDrag: function(e, key, size, apply) {
    const drag = this[key];
    const touch = e.touches && e.touches[0];
    if (!drag || !touch) return;
    if (e.touches.length !== 1) { this[key] = null; return; }
    const dx = touch.clientX - drag.startX;
    const dy = touch.clientY - drag.startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) drag.moved = true;
    // 轻点时的细小抖动不移动按钮，避免视图位置改变打断点击。
    if (!drag.moved) return;
    const info = this._shareWindow || { width: 375, height: 667 };
    apply({
      left: Math.max(0, Math.min(info.width - size, drag.left + dx)),
      top: Math.max(info.minTop || 0, Math.min(info.height - size, drag.top + dy))
    });
  },

  startShareFloatDrag: function(e) {
    this.startFloatDrag(e, '_shareFloatDrag', this.data.shareFloatLeft, this.data.shareFloatTop);
  },

  moveShareFloat: function(e) {
    this.moveFloatDrag(e, '_shareFloatDrag', this.data.embedded ? 42 : 58,
      ({ left, top }) => this.setData({ shareFloatLeft: left, shareFloatTop: top }));
  },

  endShareFloatDrag: function() {
    var drag = this._shareFloatDrag;
    this._shareFloatDrag = null;
    if (drag && !drag.moved) {
      this.openShareTemplateSelector();
    }
  },

  startEditFloatDrag: function(e) {
    this.startFloatDrag(e, '_editFloatDrag', this.data.editFloatLeft, this.data.editFloatTop);
  },

  moveEditFloat: function(e) {
    this.moveFloatDrag(e, '_editFloatDrag', this.data.embedded ? 42 : 58,
      ({ left, top }) => this.setData({ editFloatLeft: left, editFloatTop: top }));
  },

  endEditFloatDrag: function() {
    var drag = this._editFloatDrag;
    this._editFloatDrag = null;
    if (!drag || drag.moved || !auth.isAdmin()) return;
    var id = this.data.product.id;
    if (id) {
      this._refreshAfterEdit = true;
      wx.navigateTo({ url: '/pages/admin/admin?editId=' + encodeURIComponent(id), fail: error => {
        this._refreshAfterEdit = false;
        console.error('打开商品编辑页失败，微信路由错误：', error && error.errMsg);
        wx.showToast({ title: getErrorMessage(error, '打开商品编辑页失败，请重试'), icon: 'none' });
      } });
    }
  },

  openShareTemplateSelector: function() {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    if (!this.data.canShowShareFloat) return;
    if (this.data.shareImageCount === 0) {
      wx.showToast({ title: '分享图片还在加载，请稍后再试', icon: 'none' });
      return;
    }
    if (!this.data.shareTemplatesReady) {
      wx.showToast({ title: '分享模板还在生成，请稍后再试', icon: 'none' });
      return;
    }
    this.setData({ showShareTemplates: true });
  },

  closeShareTemplateSelector: function() {
    this.setData({ showShareTemplates: false });
  },

  stopShareTemplateTap: function() {},

  getShareTemplate: function(res) {
    var template = res && res.target && res.target.dataset && res.target.dataset.template;
    if (template) return template;
    if (this.data.shareImageCount >= 3) return 'triple';
    if (this.data.shareImageCount === 2) return 'double';
    return 'single';
  },

  // 获取关联商品
  getRelatedProducts: async function(relatedIds, version = this._productVersion) {
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

        if (version === this._productVersion) this.setData({ relatedProducts: mappedProducts });
      }
    } catch (err) {
      console.error('获取关联商品失败:', err);
    }
  },

  // 界面交互事件
  goBack: function() {
    if (this.data.embedded) return this.triggerEvent('close');
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
    const index = e.detail.current + 1;
    this.setData({ currentDetailIndex: index });
  },

  changeDetailImage: function(e) {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    const step = Number(e.currentTarget.dataset.step);
    if ((step !== -1 && step !== 1) || !this.data.detailImgs.length) return;
    const next = Math.max(1, Math.min(this.data.detailImgs.length, this.data.currentDetailIndex + step));
    if (next !== this.data.currentDetailIndex) this.setData({ currentDetailIndex: next });
  },

  goToRelatedDetail: function(e) {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    const id = e.currentTarget.dataset.id;
    if (this.data.embedded) this.triggerEvent('productchange', { id });
    else wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  // 弹窗与分流引擎
  openSkuPanel(e) {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    const product = this.data.product;
    if (!product.id || product.offSale || product.soldOut) return;
    this.resetSkuQuantityEditing();

    this.setData({ isAdmin: !!auth.isAdmin(), isStallManager: !!auth.isStallManager() });

    const action = e.currentTarget.dataset.action || 'cart';

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
        var skus = (bg.skus || []).map(function(sku) {
          return Object.assign({}, sku, {
            skuId: sku.skuId || sku.id,
            color: sku.color || sku.spec,
            price: sku.price != null ? sku.price : sku.retailPrice,
            stock: sku.stock != null ? sku.stock : sku.stockMain,
            unlimitedStock: sku.unlimitedStock === true || sku.isUnlimitedStock === true
          });
        });
        return Object.assign({ bundleGroupName: bg.name, skus: skus, selectedSku: null }, getDefaultSkuSelection(skus));
      });
      var result = this._computeBundleSelections(rawSel, -1, null, null);
      this.setData({
        showSku: true, skuAction: action,
        bundleSelections: result.bundleSelections,
        bundleAllSelected: result.bundleAllSelected,
        currentSkuPrice: result.currentSkuPrice,
        quantity: 1
      });
      return;
    }

    // 普通商品
    const selection = getDefaultSkuSelection(product.skuMatrix || []);
    const hasNoSku = !product.skuMatrix || product.skuMatrix.length === 0;
    this.setData({
      showSku: true, skuAction: action,
      bundleSelections: [],
      ...selection,
      currentSkuImage: product.coverUrl,
      currentSkuId: null,
      currentSkuStock: hasNoSku ? 0 : null,
      currentSkuUnlimited: false,
      currentSkuStockText: hasNoSku ? '0' : null,
      currentSkuSoldOut: hasNoSku,
      quantity: 1
    });
    this.checkSkuMatch();
  },

  closeSkuPanel(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    this.setData({ showSku: false });
  },

  selectColor(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    const selection = getSkuOptionSelection(this.data.product.skuMatrix || [],
      this.data.selectedColor, this.data.selectedSize, 'selectedColor', e.currentTarget.dataset.color);
    if (!selection) return;
    this.setData(selection);
    this.checkSkuMatch();
  },

  selectSize(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    const selection = getSkuOptionSelection(this.data.product.skuMatrix || [],
      this.data.selectedColor, this.data.selectedSize, 'selectedSize', e.currentTarget.dataset.size);
    if (!selection) return;
    this.setData(selection);
    this.checkSkuMatch();
  },

  checkSkuMatch() {
    const product = this.data.product;
    if (!product) return;
    const { selectedColor, selectedSize } = this.data;
    const skus = product.skuMatrix || [];
    const match = findSelectedSku(skus, selectedColor, selectedSize);
    const options = getSkuOptions(skus, selectedColor);
    if (match) {
      this.setData({
        ...options,
        currentSkuPrice: match.price,
        currentSkuStock: match.stock,
        currentSkuUnlimited: match.unlimitedStock || false,
        currentSkuSoldOut: false,
        currentSkuStockText: formatStock(match.stock, match.unlimitedStock),
        currentSkuId: match.skuId,
        currentSkuImage: match.imageUrl || product.coverUrl,
        quantity: this.normalizeSkuQuantity(this.data.quantity, match.stock, match.unlimitedStock)
      });
    } else {
      // 未选完整或没有可售组合时，清掉旧 SKU 的价格、库存和图片。
      const soldOut = skus.length === 0 || skus.every(isSkuSoldOut);
      this.setData({
        ...options,
        currentSkuPrice: product.retailPrice || product.displayPrice || null,
        currentSkuStock: soldOut ? 0 : null,
        currentSkuUnlimited: false,
        currentSkuSoldOut: soldOut,
        currentSkuStockText: soldOut ? '0' : null,
        currentSkuId: null,
        currentSkuImage: product.coverUrl,
        quantity: 1
      });
    }
  },

  skuQuantityMinus(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    if (this.data.quantity <= 1) return;
    this.setData({ quantity: this.data.quantity - 1 });
  },

  skuQuantityPlus(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
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

  // 套装子项选择处理
  selectBundleColor(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    var idx = e.currentTarget.dataset.index;
    var color = e.currentTarget.dataset.color;
    var result = this._computeBundleSelections(this.data.bundleSelections, idx, 'selectedColor', color);
    this.setData(result);
  },

  selectBundleSize(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    var idx = e.currentTarget.dataset.index;
    var size = e.currentTarget.dataset.size;
    var result = this._computeBundleSelections(this.data.bundleSelections, idx, 'selectedSize', size);
    this.setData(result);
  },

  // 一次性计算 bundleSelections: 应用变更 + SKU匹配 + anySelected判断
  _computeBundleSelections: function(sel, changeIdx, changeField, changeValue) {
    var anyOk = false;
    var totalPrice = 0;
    var newSel = sel.map(function(s, i) {
      var ns = Object.assign({}, s);
      if (i === changeIdx && changeField) {
        var selection = getSkuOptionSelection(ns.skus || [], ns.selectedColor, ns.selectedSize, changeField, changeValue);
        if (selection) Object.assign(ns, selection);
      }
      Object.assign(ns, getSkuOptions(ns.skus || [], ns.selectedColor));
      ns.selectedSku = null;
      var match = findSelectedSku(ns.skus || [], ns.selectedColor, ns.selectedSize);
      if (match) {
        ns.selectedSku = { skuId: match.skuId || match.id, color: match.color || match.spec, size: match.size, price: match.price != null ? match.price : match.retailPrice, stock: match.stock, unlimitedStock: match.unlimitedStock, imageUrl: match.imageUrl };
        totalPrice += Number(ns.selectedSku.price) || 0;
        anyOk = true;
      }
      var displaySku = ns.selectedSku || (ns.skus && ns.skus.length > 0 ? ns.skus[0] : null);
      ns.displayImage = displaySku ? displaySku.imageUrl : '';
      ns.imageSoldOut = isSkuSoldOut(displaySku);
      return ns;
    });
    return { bundleSelections: newSel, bundleAllSelected: anyOk, currentSkuPrice: totalPrice > 0 ? totalPrice : null };
  },

  confirmSkuAction(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    const action = e.currentTarget.dataset.action || this.data.skuAction;
    const { product, bundleSelections, bundleAllSelected } = this.data;
    if (this.data.purchasePending) return;
    if (!product.id || product.offSale || product.soldOut) return;

    // 套装商品：仅收集完整选好的子项
    if (bundleSelections && bundleSelections.length > 0) {
      if (!bundleAllSelected) return wx.showToast({ title: '请至少完整选择一个子项', icon: 'none' });
      var selectedSubs = bundleSelections.filter(function(s) { return s.selectedSku != null; });
      var bundleConfig = selectedSubs.map(function(s) {
        return { bundleGroupName: s.bundleGroupName, skuId: s.selectedSku.skuId, color: s.selectedSku.color, size: s.selectedSku.size, price: s.selectedSku.price, imageUrl: s.selectedSku.imageUrl || '', count: s.quantity || 1 };
      });
      var totalPrice = 0;
      bundleConfig.forEach(function(b) { totalPrice += (Number(b.price) || 0) * (b.count || 1); });

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
    const { selectedColor, selectedSize, currentSkuPrice, currentSkuStock, currentSkuUnlimited, currentSkuId, currentSkuImage, uniqueColors, uniqueSizes, quantity } = this.data;

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
        color: finalColor,
        size: finalSize,
        count: quantity
      };

      const version = this._productVersion;
      this.setData({ purchasePending: true });
      api.post('/cart/items', cartData)
        .then(() => {
          wx.hideLoading();
          wx.showToast({ title: '已加入购物车', icon: 'success' });
          if (version === this._productVersion) this.setData({ showSku: false });
        })
        .catch(err => {
          wx.hideLoading();
          console.error('添加购物车失败:', err);
          if (isUnauthorized(err)) {
            wx.showToast({ title: '请先登录', icon: 'none' });
          } else {
            wx.showToast({ title: getErrorMessage(err, '添加失败'), icon: 'none' });
          }
        }).finally(() => {
          if (version === this._productVersion) this.setData({ purchasePending: false });
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
    const version = this._productVersion;
    this.setData({ purchasePending: true });
    api.post('/cart/items', cartData)
      .then(function() {
        wx.hideLoading();
        wx.showToast({ title: '已加入购物车', icon: 'success' });
        if (version === self._productVersion) self.setData({ showSku: false });
      })
      .catch(function(err) {
        wx.hideLoading();
        if (isUnauthorized(err)) {
          wx.showToast({ title: '请先登录', icon: 'none' });
        } else {
          wx.showToast({ title: getErrorMessage(err, '添加失败'), icon: 'none' });
        }
      }).finally(function() {
        if (version === self._productVersion) self.setData({ purchasePending: false });
      });
  },

  // 视频悬浮窗控制系统
  startVideoFloatTouch: function(e) {
    const info = this._shareWindow || { width: 375, height: 667 };
    const position = this._videoFloatPosition || { left: Math.max(0, info.width - 80), top: Math.max(0, info.height - 145) };
    this.startFloatDrag(e, '_videoFloatDrag', position.left, position.top);
    const drag = this._videoFloatDrag;
    this.createSelectorQuery().select('.floating-video-btn').boundingClientRect(rect => {
      if (rect && Number.isFinite(rect.left) && Number.isFinite(rect.top) && this._videoFloatDrag === drag && !drag.moved) {
        drag.left = rect.left;
        drag.top = rect.top;
      }
    }).exec();
  },

  moveVideoFloat: function(e) {
    this.moveFloatDrag(e, '_videoFloatDrag', 60, ({ left, top }) => {
      this._videoFloatPosition = { left, top };
      this.setData({ videoFloatStyle: `left: ${left}px; top: ${top}px; right: auto; bottom: auto;` });
    });
  },

  endVideoFloatTouch: function() {
    const drag = this._videoFloatDrag;
    this._videoFloatDrag = null;
    if (drag && !drag.moved) this.openVideoOverlay();
  },

  cancelVideoFloatTouch: function() {
    this._videoFloatDrag = null;
  },

  openVideoOverlay: function() {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    this.setData({ showVideo: true });
    clearTimeout(this._videoTimer);
    this._videoTimer = setTimeout(() => {
      if (!this.data.showVideo) return;
      const videoContext = wx.createVideoContext('mainFullscreenVideo', this);
      videoContext.play();
    }, 100);
  },

  closeVideoOverlay: function() {
    this.setData({ showVideo: false });
    const videoContext = wx.createVideoContext('mainFullscreenVideo', this);
    if (videoContext) videoContext.pause();
  },

// ====== 高级横向标签切换引擎 ======
switchAuraTab(e) {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
  this.setData({
    currentAuraTab: e.currentTarget.dataset.tab
  });
},

  doNothing: function() {
    // 阻止视频点击事件冒泡
  },

  // ========== 图片全屏预览 ==========

  // 安全预览（过滤无效 URL，对齐管理端 previewImageSafe 模式）
  previewImageSafe: function(current, urls) {
    var validUrls = (urls || []).filter(function(u) { return u && u.trim(); });
    if (validUrls.length === 0) {
      wx.showToast({ title: '暂无图片', icon: 'none' });
      return;
    }
    wx.previewImage({ current: current || validUrls[0], urls: validUrls });
  },

  // A: 轮播图预览（支持左右滑动）
  previewBannerImage: function(e) {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    var index = e.currentTarget.dataset.index;
    var urls = this.data.bannerImgs;
    this.previewImageSafe(urls[index], urls);
  },

  // B: Lookbook 图片预览
  previewLookbookImage: function(e) {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    var index = e.currentTarget.dataset.index;
    var urls = this.data.lookbookImgs;
    this.previewImageSafe(urls[index], urls);
  },

  // C: Detail Views 图片预览
  previewDetailImage: function(e) {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    var index = e.currentTarget.dataset.index;
    var urls = this.data.detailImgs;
    this.previewImageSafe(urls[index], urls);
  },

  // D: 关联商品图片预览
  previewRelatedImage: function(e) {
    if (Date.now() < (this._suppressTapUntil || 0)) return;
    var index = e.currentTarget.dataset.index;
    var urls = (this.data.relatedProducts || []).map(function(r) { return r.image || r.coverUrl; });
    this.previewImageSafe(urls[index], urls);
  },

  // E: SKU 面板商品图预览（单张）
  previewSkuPanelImage: function(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    var current = this.data.currentSkuImage || this.data.product.image || this.data.product.coverUrl;
    if (current) {
      wx.previewImage({ urls: [current], current: current });
    }
  },

  handleCustomerServiceContact: function(e) {
    customerServiceNavigation.openFromContact(e);
  },

  onShareAppMessage: function(res) {
    const { product } = this.data;
    const id = product.id || this._productId;
    const template = this.getShareTemplate(res);
    this.setData({ showShareTemplates: false });
    return {
      title: product.name || product.title || '好物推荐',
      path: id ? `/pages/detail/detail?id=${id}` : '/pages/index/index',
      imageUrl: this.data.shareImages[template] || product.coverUrl || product.image || ''
    };
  },

  onShareTimeline: function() {
    const { product } = this.data;
    const id = product.id || this._productId;
    const template = this.getShareTemplate();
    return {
      title: product.name || product.title || '好物推荐',
      query: id ? `id=${id}` : '',
      imageUrl: this.data.shareImages[template] || product.coverUrl || product.image || ''
    };
  }
  };
}

module.exports = { createProductDetailConfig };
