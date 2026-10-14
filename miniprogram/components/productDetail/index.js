const { createProductDetailConfig } = require('./controller');
const { resolveDirection } = require('../../utils/productSheetGesture');
const { getGalleryLayout } = require('../../utils/productGallery');
const config = createProductDetailConfig();
const { data, onLoad, onShow, onHide, onUnload, ...methods } = config;

Component({
  properties: {
    productId: { type: String, value: '' },
    viewportHeight: { type: Number, value: 0 },
    contentOffset: { type: Number, value: 0 },
    expansionProgress: { type: Number, value: 0 },
    galleryAnimating: { type: Boolean, value: false }
  },
  data: { ...data, embedded: true, galleryItemWidth: 250, galleryHeight: 312.5, galleryOffset: 0, galleryTranslateX: 0 },
  observers: {
    'expansionProgress, bannerImgs, bannerIndex, product.videoUrl'() { if (this._ready) this.updateGallery(); },
    productId(id) { if (this._ready && id && String(id) !== this._productId) this.initializeProduct(id); },
    viewportHeight() { if (this._ready) this.updateGallery(); },
    galleryAnimating(value) { if (this._ready && !value) this.measureDocument(); },
    'product, relatedProducts, currentAuraTab'(product) {
      if (!this._ready) return;
      this.notifySheet('titlechange', { title: this.data.product.name || this.data.product.title || '' });
      this.measureDocument();
    },
    'showSku, showVideo, showShareTemplates, purchasePending'() {
      this.notifySheet('overlaychange', { blocked: !!(this.data.showSku || this.data.showVideo || this.data.showShareTemplates || this.data.purchasePending) });
    }
  },
  lifetimes: {
    attached() {
      this._ready = true;
      if (this.data.productId) this.initializeProduct(this.data.productId);
    },
    detached() {
      this._ready = false;
      clearTimeout(this._measureTimer);
      onUnload.call(this);
    }
  },
  pageLifetimes: {
    hide() { onHide.call(this); },
    show() { if (this._ready) onShow.call(this); }
  },
  methods: {
    ...methods,
    updateGallery(drag = 0) {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const count = this.data.bannerImgs.length + (this.data.product.videoUrl ? 1 : 0);
      this.setData(getGalleryLayout(info.windowWidth || 375, this.data.expansionProgress, count, this.data.bannerIndex, drag));
      this.measureDocument();
    },
    notifySheet(name, detail) {
      // 等本轮组件数据更新结束再通知父弹窗，避免父子递归 setData。
      const notify = () => { if (this._ready) this.triggerEvent(name, detail); };
      if (wx.nextTick) wx.nextTick(notify); else setTimeout(notify, 0);
    },
    initializeProduct(id) {
      this.pauseProductVideos();
      this._productId = String(id);
      // 每次切商品使用独立状态，异步旧响应由版本号丢弃。
      this.setData({ ...createProductDetailConfig().data, embedded: true });
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: 0, navHeight: 0 });
      this.updateGallery();
      this.initShareFloatPosition({ ...info, windowHeight: this.data.viewportHeight });
      this.setData({ shareFloatTop: 16, editFloatTop: 66 });
      return this.loadProductSafe(this._productId);
    },
    measureDocument() {
      clearTimeout(this._measureTimer);
      this._measureTimer = setTimeout(() => {
        if (!this._ready) return;
        this.createSelectorQuery().select('.product-document').boundingClientRect(rect => {
          if (this._ready && rect) this.triggerEvent('documentheight', { height: rect.height });
        }).exec();
      }, 30);
    },
    gestureBlocked() {
      return this.data.showSku || this.data.showVideo || this.data.showShareTemplates || this.data.purchasePending;
    },
    forwardTouchStart(e) {
      if (this.gestureBlocked() || e.touches.length !== 1) return;
      const touch = e.touches[0];
      this._forwardingGesture = true;
      const dataset = e.target.dataset || {};
      this._imageSwipe = dataset.gallery ? { gallery: dataset.gallery, x: touch.clientX, y: touch.clientY, dx: 0, direction: '' } : null;
      this.setData({ gestureLockedVertical: false });
      this.triggerEvent('gesturestart', { x: touch.clientX, y: touch.clientY,
        image: !!(e.target.dataset && e.target.dataset.gesture === 'image') });
    },
    forwardTouchMove(e) {
      if (!this._forwardingGesture) return;
      if (e.touches.length !== 1) return this.forwardTouchCancel();
      const touch = e.touches[0];
      const swipe = this._imageSwipe;
      if (swipe) {
        swipe.dx = touch.clientX - swipe.x;
        if (!swipe.direction) swipe.direction = resolveDirection(swipe.dx, touch.clientY - swipe.y, true);
      }
      if (swipe && swipe.gallery === 'banner' && swipe.direction === 'horizontal') this.updateGallery(swipe.dx);
      this.triggerEvent('gesturemove', { x: touch.clientX, y: touch.clientY });
    },
    onImageTouchMove(e) {
      // 图片区先拦住原生轮播的移动，由同一套方向判定决定翻图还是拖窗。
      this.forwardTouchMove(e);
    },
    forwardTouchEnd() {
      if (!this._forwardingGesture) return;
      this._forwardingGesture = false;
      const swipe = this._imageSwipe; this._imageSwipe = null;
      if (swipe && swipe.direction === 'horizontal' && Math.abs(swipe.dx) >= 40) {
        const banner = swipe.gallery === 'banner';
        const count = banner ? this.data.bannerImgs.length + (this.data.product.videoUrl ? 1 : 0) : this.data.detailImgs.length;
        const current = banner ? this.data.bannerIndex : this.data.currentDetailIndex - 1;
        const next = Math.max(0, Math.min(count - 1, current + (swipe.dx < 0 ? 1 : -1)));
        this.setData(banner ? { bannerIndex: next } : { currentDetailIndex: next + 1 });
        this.suppressGestureTap();
      }
      if (swipe && swipe.gallery === 'banner') this.updateGallery();
      this.triggerEvent('gestureend');
      this.setData({ gestureLockedVertical: false });
    },
    forwardTouchCancel() {
      if (!this._forwardingGesture) return;
      this._forwardingGesture = false;
      this._imageSwipe = null;
      this.updateGallery();
      this.triggerEvent('gesturecancel');
      this.setData({ gestureLockedVertical: false });
    },
    lockVerticalGesture() {
      this._suppressTapUntil = Date.now() + 350;
      this.setData({ gestureLockedVertical: true });
    },
    suppressGestureTap() { this._suppressTapUntil = Date.now() + 350; },
    getProductShare(res) { return config.onShareAppMessage.call(this, res); },
    closeTopOverlay() {
      if (this.data.showVideo) this.closeVideoOverlay();
      else if (this.data.showShareTemplates) this.closeShareTemplateSelector();
      else if (this.data.showSku) this.closeSkuPanel();
      else this.triggerEvent('close');
    }
  }
});
