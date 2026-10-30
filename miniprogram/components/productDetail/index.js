const { createProductDetailConfig } = require('./controller');
const { resolveDirection } = require('../../utils/productSheetGesture');
const { getGalleryLayout } = require('../../utils/productGallery');
const config = createProductDetailConfig();
const { data, onLoad, onShow, onHide, onUnload, ...methods } = config;

Component({
  properties: {
    productId: { type: String, value: '' },
    viewportHeight: { type: Number, value: 0 },
    expansionProgress: { type: Number, value: 0 },
    galleryAnimating: { type: Boolean, value: false },
    nativeScroll: { type: Boolean, value: false }
  },
  data: { ...data, embedded: true, requestedScrollTop: 0, sheetDragging: false, galleryItemWidth: 250, galleryHeight: 312.5, galleryOffset: 0, galleryTranslateX: 0,
    galleryBaseWidth: 375, galleryBaseHeight: 468.75, galleryScale: 2 / 3, gallerySettling: false },
  observers: {
    'expansionProgress, bannerImgs, bannerIndex, product.videoUrl'() { if (this._ready) this.updateGallery(); },
    productId(id) { if (this._ready && id && String(id) !== this._productId) this.initializeProduct(id); },
    'viewportHeight, sheetDragging, galleryAnimating'() {
      if (!this._ready) return;
      if (this.data.sheetDragging || this.data.galleryAnimating) { clearTimeout(this._measureTimer); return; }
      this.updateFloatBounds();
      this.measureDocument();
    },
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
      clearTimeout(this._gallerySettleTimer);
      clearTimeout(this._measureTimer);
      onUnload.call(this);
    }
  },
  pageLifetimes: {
    resize() {
      if (!this._ready) return;
      this._galleryWidth = null;
      this.onResize(); this.updateGallery(); this.updateFloatBounds();
    },
    hide() { onHide.call(this); },
    show() { if (this._ready) onShow.call(this); }
  },
  methods: {
    ...methods,
    onNativeScroll(e) {
      // 只记录原生位置，不用 setData 驱动滚动，也不干预系统惯性。
      this._nativeScrollTop = Math.max(0, Number(e.detail.scrollTop) || 0);
      this._lastScrollTop = this._nativeScrollTop;
      // touchstart 可能先于最后一条滚动通知；方向未确定时继续校准起点。
      if (this._forwardingGesture && !this._touchDirection) this._nativeGestureTop = this._nativeScrollTop;
      this.triggerEvent('contentscroll', { offset: this._nativeScrollTop });
    },
    onNativeScrollUpper() {
      // upper-threshold 与顶部容差一致，不能用默认的 50px 提前判定到顶。
      this.onNativeScroll({ detail: { scrollTop: 0 } });
    },
    onNativeDragStart(e) {
      if (!Number.isFinite(e.detail.scrollTop)) return;
      if (!this._forwardingGesture || !this._nativeGesture || this._nativeDragStarted) return;
      this._nativeDragStarted = true;
      if (this.data.gestureLockedVertical || this._touchDirection === 'horizontal') return;
      // 原生 dragstart 给的是本次滑动起点，允许纠正过时的 touchstart 缓存。
      this._nativeGestureTop = Math.max(0, e.detail.scrollTop);
      if (!this._touchDirection) this.onNativeScroll(e);
      if (this._nativeGestureTop <= 1 && this._nativeContentOwned && this._lastTouchMove &&
          this._nativeGestureStartedDown) {
        this._nativeContentOwned = false;
        this.forwardTouchMove(this._lastTouchMove);
      }
    },
    updateFloatBounds() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
      const minTop = (menu && menu.bottom > 0 ? menu.bottom : (info.statusBarHeight || 20) + 44) + 12;
      const width = info.windowWidth || 375;
      const height = this.data.viewportHeight || info.windowHeight || 667;
      this._shareWindow = { width, height, minTop };
      const clampTop = top => Math.max(minTop, Math.min(height - 42, top));
      const values = {
        shareFloatTop: clampTop(this.data.shareFloatTop),
        editFloatTop: clampTop(this.data.editFloatTop),
        shareFloatLeft: Math.max(0, Math.min(width - 42, this.data.shareFloatLeft)),
        editFloatLeft: Math.max(0, Math.min(width - 42, this.data.editFloatLeft))
      };
      const patch = {};
      Object.keys(values).forEach(key => { if (values[key] !== this.data[key]) patch[key] = values[key]; });
      if (Object.keys(patch).length) this.setData(patch);
    },
    settleGallery() {
      clearTimeout(this._gallerySettleTimer);
      this.setData({ gallerySettling: true });
      this.updateGallery();
      this._gallerySettleTimer = setTimeout(() => {
        if (this._ready) this.setData({ gallerySettling: false });
      }, 280);
    },
    updateGallery(drag = 0) {
      if (!this._galleryWidth) {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        this._galleryWidth = info.windowWidth || 375;
      }
      const count = this.data.bannerImgs.length + (this.data.product.videoUrl ? 1 : 0);
      const layout = getGalleryLayout(this._galleryWidth, this.data.expansionProgress, count, this.data.bannerIndex, drag);
      const heightChanged = layout.galleryHeight !== this.data.galleryHeight;
      const patch = {};
      Object.keys(layout).forEach(key => { if (layout[key] !== this.data[key]) patch[key] = layout[key]; });
      if (Object.keys(patch).length) this.setData(patch);
      // 横滑只改变位置，不影响正文高度，无需反复跨线程测量整页。
      if (heightChanged) this.measureDocument();
    },
    notifySheet(name, detail) {
      // 等本轮组件数据更新结束再通知父弹窗，避免父子递归 setData。
      const notify = () => { if (this._ready) this.triggerEvent(name, detail); };
      if (wx.nextTick) wx.nextTick(notify); else setTimeout(notify, 0);
    },
    initializeProduct(id) {
      clearTimeout(this._gallerySettleTimer);
      this.setData({ gallerySettling: false });
      this.pauseProductVideos();
      this._productId = String(id);
      this._lastDocumentHeight = null;
      this._videoFloatPosition = null;
      this._videoFloatDrag = null;
      this._nativeScrollTop = 0;
      this._forwardingGesture = false;
      // 把当前原生位置同步为受控值，再回零，确保连续换商品都能回到顶部。
      this.setData({ requestedScrollTop: this._lastScrollTop || 0, sheetDragging: false }, () => {
        if (this._ready) this.setData({ requestedScrollTop: 0 });
      });
      this._lastScrollTop = 0;
      // 每次切商品使用独立状态，异步旧响应由版本号丢弃。
      this.setData({ ...createProductDetailConfig().data, embedded: true });
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: 0, navHeight: 0 });
      this.updateGallery();
      this.initShareFloatPosition({ ...info, windowHeight: this.data.viewportHeight });
      this.updateFloatBounds();
      return this.loadProductSafe(this._productId);
    },
    measureDocument() {
      clearTimeout(this._measureTimer);
      // 拖动和吸附期间尺寸仍在变化，结束后再统一测量，避免连续触发布局查询。
      if (this.data.sheetDragging || this.data.galleryAnimating) return;
      this._measureTimer = setTimeout(() => {
        if (!this._ready || this.data.sheetDragging || this.data.galleryAnimating) return;
        this.createSelectorQuery().select('.product-document').boundingClientRect(rect => {
          if (this._ready && rect && rect.height !== this._lastDocumentHeight) {
            this._lastDocumentHeight = rect.height;
            this.triggerEvent('documentheight', { height: rect.height });
          }
        }).exec();
      }, 30);
    },
    gestureBlocked() {
      return this.data.showSku || this.data.showVideo || this.data.showShareTemplates || this.data.purchasePending;
    },
    forwardTouchStart(e) {
      if (this.gestureBlocked() || e.touches.length !== 1) return;
      const touch = e.touches[0];
      clearTimeout(this._gallerySettleTimer);
      if (this.data.gallerySettling) this.setData({ gallerySettling: false });
      this._forwardingGesture = true;
      this._nativeGesture = !!this.data.nativeScroll;
      this._nativeGestureTop = this._nativeScrollTop || 0;
      this._touchOrigin = { x: touch.clientX, y: touch.clientY };
      this._touchDirection = '';
      this._nativeContentOwned = false;
      this._nativeDragStarted = false;
      this._nativeGestureStartedDown = false;
      this._lastTouchMove = null;
      const dataset = e.target.dataset || {};
      this._imageSwipe = dataset.gallery ? { gallery: dataset.gallery, x: touch.clientX, y: touch.clientY, dx: 0, direction: '' } : null;
      if (this.data.gestureLockedVertical || this.data.sheetDragging) this.setData({ gestureLockedVertical: false, sheetDragging: false });
      this.triggerEvent('gesturestart', { x: touch.clientX, y: touch.clientY,
        image: !!(e.target.dataset && e.target.dataset.gesture === 'image'),
        nativeContent: this._nativeGesture, offset: this._nativeGestureTop });
    },
    forwardTouchMove(e) {
      if (!this._forwardingGesture) return;
      if (e.touches.length !== 1) return this.forwardTouchCancel();
      this._lastTouchMove = e;
      const touch = e.touches[0];
      const swipe = this._imageSwipe;
      if (swipe) {
        swipe.dx = touch.clientX - swipe.x;
        if (!swipe.direction) swipe.direction = resolveDirection(swipe.dx, touch.clientY - swipe.y, true);
      }
      if (!this._touchDirection) {
        this._touchDirection = resolveDirection(touch.clientX - this._touchOrigin.x, touch.clientY - this._touchOrigin.y, !!swipe);
        if (this._touchDirection === 'vertical') this._nativeGestureStartedDown = touch.clientY > this._touchOrigin.y;
      }
      if (this._nativeGesture && !this.data.gestureLockedVertical && this._touchDirection === 'vertical') {
        // 从正文中间开始，或起手向上，就让原生滚完整次手势；到顶也不突然拖窗。
        if (this._nativeGestureTop > 1 || touch.clientY <= this._touchOrigin.y || this._nativeContentOwned) {
          this._nativeContentOwned = true;
          this.suppressGestureTap();
          return;
        }
      }
      if (this._nativeGesture && this._touchDirection === 'horizontal' && !this.data.sheetDragging) this.setData({ sheetDragging: true });
      if (swipe && swipe.gallery === 'banner' && swipe.direction === 'horizontal') this.updateGallery(swipe.dx);
      this.triggerEvent('gesturemove', { x: touch.clientX, y: touch.clientY, offset: this._nativeGestureTop });
    },
    onImageTouchMove(e) {
      // 由同一套方向判定决定翻图还是拖窗，纵向滚动交给 scroll-view。
      this.forwardTouchMove(e);
    },
    forwardTouchEnd() {
      if (!this._forwardingGesture) return;
      this._forwardingGesture = false;
      const swipe = this._imageSwipe; this._imageSwipe = null;
      if (swipe && swipe.gallery === 'banner' && swipe.direction === 'horizontal') this.setData({ gallerySettling: true });
      if (swipe && swipe.direction === 'horizontal' && Math.abs(swipe.dx) >= 40) {
        const banner = swipe.gallery === 'banner';
        const count = banner ? this.data.bannerImgs.length + (this.data.product.videoUrl ? 1 : 0) : this.data.detailImgs.length;
        const current = banner ? this.data.bannerIndex : this.data.currentDetailIndex - 1;
        const next = Math.max(0, Math.min(count - 1, current + (swipe.dx < 0 ? 1 : -1)));
        this.setData(banner ? { bannerIndex: next } : { currentDetailIndex: next + 1 });
        this.suppressGestureTap();
      }
      if (swipe && swipe.gallery === 'banner' && swipe.direction === 'horizontal') this.settleGallery();
      this.triggerEvent('gestureend');
      if (this.data.gestureLockedVertical || this.data.sheetDragging) this.setData({ gestureLockedVertical: false, sheetDragging: false });
    },
    forwardTouchCancel() {
      if (!this._forwardingGesture) return;
      this._forwardingGesture = false;
      const swipe = this._imageSwipe;
      this._imageSwipe = null;
      if (swipe && swipe.gallery === 'banner' && swipe.direction === 'horizontal') this.settleGallery();
      this.triggerEvent('gesturecancel');
      if (this.data.gestureLockedVertical || this.data.sheetDragging) this.setData({ gestureLockedVertical: false, sheetDragging: false });
    },
    lockVerticalGesture() {
      this._suppressTapUntil = Date.now() + 350;
      if (!this.data.gestureLockedVertical) this.setData({ gestureLockedVertical: true, sheetDragging: true });
    },
    suppressGestureTap() { this._suppressTapUntil = Date.now() + 350; },
    getProductShare(res) { return config.onShareAppMessage.call(this, res); },
    closeTopOverlay(e) {
      if (this.dismissSkuQuantityKeyboard(e)) return true;
      if (this.data.showVideo) this.closeVideoOverlay();
      else if (this.data.showShareTemplates) this.closeShareTemplateSelector();
      else if (this.data.showPickedSkus) this.closePickedSkus();
      else if (this.data.showSku) this.closeSkuPanel();
      else return !!this.data.purchasePending;
      return true;
    }
  }
});
