const { resolveDirection, moveSheet, settleSheet } = require('../../utils/productSheetGesture');
const ANIMATION_MS = 280;

Component({
  properties: { productId: { type: String, value: '' } },
  data: {
    visible: false, mounted: false, activeProductId: '', state: 'closed',
    expansionProgress: 0, sheetTop: 0, contentOffset: 0, documentHeight: 0, windowHeight: 667,
    statusBarHeight: 20, menuRightPadding: 96, headerHeight: 0, contentHeight: 0,
    fullscreen: false, animating: false, maskOpacity: 0, productTitle: '', overlayBlocked: false
  },
  lifetimes: {
    attached() { this._attached = true; this.measureWindow(); },
    detached() {
      this._attached = false;
      clearTimeout(this._animationTimer);
      clearTimeout(this._openTimer);
      clearTimeout(this._inertiaTimer);
    }
  },
  pageLifetimes: {
    hide() { this.stopInertia(); this._gesture = null; if (this.data.state !== 'closed' && !this._closing) this.snapTo(this.data.state); },
    resize() { this.measureWindow(); if (this.data.visible && !this._closing) this.snapTo(this.data.state); }
  },
  methods: {
    measureWindow() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
      this.setData({ windowHeight: info.windowHeight || 667, statusBarHeight: info.statusBarHeight || 20,
        menuRightPadding: menu ? info.windowWidth - menu.left + 8 : 96 });
    },
    open(id) {
      if (this.data.visible) return;
      this.measureWindow();
      this._closing = false;
      this._closeReported = false;
      this._gesture = null;
      this.setData({ visible: true, mounted: true, activeProductId: String(id || this.data.productId),
        state: 'half', expansionProgress: 0, sheetTop: this.data.windowHeight, contentOffset: 0, documentHeight: 0,
        productTitle: '', overlayBlocked: false, fullscreen: false, animating: false,
        contentHeight: this.data.windowHeight * 2 / 3, headerHeight: 0, maskOpacity: 1 });
      this.triggerEvent('visibilitychange', { visible: true });
      this._openTimer = setTimeout(() => { if (this._attached && !this._closing) this.snapTo('half'); }, 30);
    },
    getProductDetail() { return this.selectComponent('#productDetail'); },
    stopInertia() { clearTimeout(this._inertiaTimer); this._inertiaTimer = null; },
    blockTouch() {},
    onTitleChange(e) { this.setData({ productTitle: e.detail.title }); },
    onDocumentHeight(e) {
      const height = e.detail.height || 0;
      const max = Math.max(0, height - this.data.contentHeight);
      this.setData({ documentHeight: height, contentOffset: Math.min(this.data.contentOffset, max) });
    },
    onOverlayChange(e) { this.setData({ overlayBlocked: !!e.detail.blocked }); this.stopInertia(); },
    onProductChange(e) {
      if (this._closing) return;
      this.stopInertia();
      this.setData({ activeProductId: String(e.detail.id), contentOffset: 0, documentHeight: 0, productTitle: '' });
    },
    onHeaderTouchStart(e) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]; this.onGestureStart({ detail: { x: t.clientX, y: t.clientY, image: false } });
    },
    onHeaderTouchMove(e) {
      if (e.touches.length !== 1) return this.onGestureCancel();
      const t = e.touches[0]; this.onGestureMove({ detail: { x: t.clientX, y: t.clientY } });
    },
    onGestureStart(e) {
      if (!this.data.visible || this._closing || this.data.animating || this.data.overlayBlocked) return;
      this.stopInertia();
      const d = e.detail;
      this._gesture = { x: d.x, y: d.y, top: this.data.sheetTop, offset: this.data.contentOffset,
        origin: this.data.state, image: d.image, direction: '', lastY: d.y, lastTime: Date.now(), velocity: 0 };
    },
    onGestureMove(e) {
      const g = this._gesture;
      if (!g) return;
      const dx = e.detail.x - g.x, dy = e.detail.y - g.y;
      if (!g.direction) g.direction = resolveDirection(dx, dy, g.image);
      if (!g.direction) return;
      if (g.direction !== 'vertical') {
        if (g.direction === 'horizontal') {
          const child = this.getProductDetail(); if (child) child.suppressGestureTap();
        }
        return;
      }
      const child = this.getProductDetail(); if (child) child.lockVerticalGesture();
      const now = Date.now(), elapsed = now - g.lastTime;
      if (elapsed > 0) g.velocity = Math.max(-3, Math.min(3, (e.detail.y - g.lastY) / elapsed));
      g.lastY = e.detail.y; g.lastTime = now;
      const fullHeader = this.data.statusBarHeight + 44;
      const moved = moveSheet(g, dy, this.data.windowHeight, this.data.documentHeight + fullHeader);
      const top = moved.top;
      // 回到全屏也等松手动画结束后才显示导航，拖动过程中始终保持隐藏。
      const full = g.origin === 'full' && top === 0;
      const header = full ? fullHeader : 0;
      this.setData({ expansionProgress: Math.max(0, Math.min(1, 1 - top / (this.data.windowHeight / 3))), sheetTop: top, contentOffset: moved.offset, fullscreen: full,
        headerHeight: header, contentHeight: Math.max(0, this.data.windowHeight - top - header),
        maskOpacity: Math.max(0, 1 - top / this.data.windowHeight) });
    },
    onGestureEnd() {
      const g = this._gesture; this._gesture = null;
      if (!g || g.direction !== 'vertical') return;
      const child = this.getProductDetail(); if (child) child.suppressGestureTap();
      const target = settleSheet(this.data.sheetTop, g.origin, this.data.windowHeight, g.velocity);
      if (target === 'closed') this.requestClose();
      else {
        this.snapTo(target);
        if (target === 'full' && this.data.sheetTop === 0) {
          if (g.velocity < -0.05) this.startInertia(-g.velocity);
          else if (g.origin === 'full' && g.offset > 0 && this.data.contentOffset > 0 && g.velocity > 0.05) this.startInertia(-g.velocity);
        }
      }
    },
    onGestureCancel() {
      const g = this._gesture; this._gesture = null;
      if (g) this.snapTo(g.origin);
    },
    snapTo(state) {
      clearTimeout(this._animationTimer);
      const top = state === 'full' ? 0 : this.data.windowHeight / 3;
      if (state === 'full' && this.data.fullscreen && this.data.sheetTop === 0) {
        this.setData({ state, animating: false });
        return;
      }
      this.setData({ state, expansionProgress: state === 'full' ? 1 : 0, sheetTop: top, fullscreen: false, animating: true,
        headerHeight: 0, contentHeight: this.data.windowHeight - top,
        maskOpacity: 1 });
      this._animationTimer = setTimeout(() => this.completeSnap(), ANIMATION_MS);
    },
    completeSnap() {
      if (!this._attached || this._closing || !this.data.visible) return;
      clearTimeout(this._animationTimer);
      const full = this.data.state === 'full';
      const header = full ? this.data.statusBarHeight + 44 : 0;
      this.setData({ animating: false, fullscreen: full, headerHeight: header,
        contentHeight: this.data.windowHeight - this.data.sheetTop - header });
    },
    onTransitionEnd(e) {
      if (e.target && e.target.id !== 'sheetPanel') return;
      if (this._closing) this.finishClose(); else this.completeSnap();
    },
    startInertia(speed) {
      this.stopInertia();
      const tick = () => {
        if (!this._attached || this._closing || this._gesture || this.data.overlayBlocked) return;
        const max = Math.max(0, this.data.documentHeight - this.data.contentHeight);
        const offset = Math.max(0, Math.min(max, this.data.contentOffset + speed * 16));
        this.setData({ contentOffset: offset });
        speed *= 0.92;
        if (Math.abs(speed) > 0.04 && (speed > 0 ? offset < max : offset > 0)) this._inertiaTimer = setTimeout(tick, 16);
      };
      this._inertiaTimer = setTimeout(tick, this.data.animating ? ANIMATION_MS : 16);
    },
    requestClose() {
      if (!this.data.visible || this._closing) return;
      const child = this.getProductDetail();
      clearTimeout(this._openTimer); clearTimeout(this._animationTimer);
      this.stopInertia(); this._gesture = null; this._closing = true;
      if (child) child.pauseProductVideos();
      this.setData({ expansionProgress: 0, fullscreen: false, animating: true, sheetTop: this.data.windowHeight, maskOpacity: 0 });
      this._animationTimer = setTimeout(() => this.finishClose(), ANIMATION_MS);
    },
    finishClose() {
      if (!this._attached || this._closeReported) return;
      clearTimeout(this._animationTimer);
      this._closeReported = true;
      this.setData({ visible: false, mounted: false, state: 'closed', animating: false, overlayBlocked: false });
      this.triggerEvent('visibilitychange', { visible: false });
      this.triggerEvent('close');
    },
    onContainerLeave() { this.requestClose(); },
    onContainerLeft() { if (this._closing) this.finishClose(); },
    getProductShare(res) {
      const child = this.getProductDetail();
      return child ? child.getProductShare(res) : null;
    }
  }
});
