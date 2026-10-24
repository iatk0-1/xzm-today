const { getBannerImageMode } = require('../../utils/productGallery');
const { resolveDirection } = require('../../utils/productSheetGesture');

// 商品详情和心愿详情共用的 4:5 图片、视频画廊。
Component({
  properties: {
    images: { type: Array, value: [] },
    imagePaths: { type: Object, value: {} },
    videoUrl: { type: String, value: '' },
    poster: { type: String, value: '' },
    mediaKey: { type: String, value: '' },
    inactive: { type: Boolean, value: false }
  },
  data: {
    bannerImgs: [], bannerIndex: 0, bannerImageModes: [],
    bannerVideoFit: 'contain', bannerVideoStyle: 'width: 100%; height: 100%;',
    bannerBaseWidth: 375, bannerBaseHeight: 468.75,
    bannerTranslateX: 0, bannerDragging: false, scrollLocked: false
  },
  observers: {
    'images, videoUrl, mediaKey'() { this.resetMedia(); },
    inactive(value) { if (value) this.pause(); }
  },
  lifetimes: {
    attached() { this.resetMedia(); this.resizeGallery(); },
    detached() { this.pause(); }
  },
  pageLifetimes: {
    hide() { this.pause(); },
    resize() { this.resizeGallery(); }
  },
  methods: {
    resetMedia() {
      const images = (this.data.images || []).filter(url => typeof url === 'string' && url.trim());
      const signature = JSON.stringify([this.data.mediaKey, images, this.data.videoUrl]);
      if (signature === this._mediaSignature) return;
      this.pause();
      this._mediaSignature = signature;
      this._suppressTapUntil = 0;
      this.setData({ bannerImgs: images, bannerIndex: 0, bannerTranslateX: 0,
        bannerImageModes: images.map(url => this._imageModes && this._imageModes.get(url) || 'aspectFit'),
        bannerVideoFit: 'contain', bannerVideoStyle: 'width: 100%; height: 100%;' });
    },
    resizeGallery() {
      this.onTouchCancel();
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const width = info.windowWidth || 375;
      this.setData({ bannerBaseWidth: width, bannerBaseHeight: width * 1.25,
        bannerTranslateX: -this.data.bannerIndex * width });
    },
    setScrollLocked(locked) {
      if (this.data.scrollLocked === locked) return;
      this.setData({ scrollLocked: locked });
      this.triggerEvent('scrolllockchange', { locked });
    },
    onTouchStart(e) {
      if (this.data.inactive || !e.touches || e.touches.length !== 1) return;
      const touch = e.touches[0];
      this._touch = { x: touch.clientX, y: touch.clientY, dx: 0, direction: '' };
      this.setData({ bannerDragging: true });
      this.setScrollLocked(false);
    },
    onTouchMove(e) {
      const swipe = this._touch;
      if (!swipe) return;
      if (!e.touches || e.touches.length !== 1) return this.onTouchCancel();
      const touch = e.touches[0];
      swipe.dx = touch.clientX - swipe.x;
      if (!swipe.direction) swipe.direction = resolveDirection(swipe.dx, touch.clientY - swipe.y, true);
      if (swipe.direction !== 'horizontal') return;
      this.setScrollLocked(true);
      this._suppressTapUntil = Date.now() + 350;
      const count = this.data.bannerImgs.length + (this.data.videoUrl ? 1 : 0);
      const width = this.data.bannerBaseWidth;
      const min = -Math.max(0, (count - 1) * width);
      const raw = -this.data.bannerIndex * width + swipe.dx;
      const resistance = value => width * 0.18 * value / (width + value);
      this.setData({ bannerTranslateX: raw > 0 ? resistance(raw) : raw < min ? min - resistance(min - raw) : raw });
    },
    onTouchEnd() {
      const swipe = this._touch;
      if (!swipe) return;
      this._touch = null;
      const count = this.data.bannerImgs.length + (this.data.videoUrl ? 1 : 0);
      let next = this.data.bannerIndex;
      if (swipe.direction === 'horizontal' && Math.abs(swipe.dx) >= 40) {
        next = Math.max(0, Math.min(count - 1, next + (swipe.dx < 0 ? 1 : -1)));
      }
      this.setData({ bannerIndex: next, bannerDragging: false, bannerTranslateX: -next * this.data.bannerBaseWidth });
      this.setScrollLocked(false);
      if (next !== 0) this.pauseVideo();
      this.triggerEvent('change', { current: next });
    },
    onTouchCancel() {
      this._touch = null;
      this.setData({ bannerDragging: false, bannerTranslateX: -this.data.bannerIndex * this.data.bannerBaseWidth });
      this.setScrollLocked(false);
    },
    onImageLoad(e) {
      const { index, src } = e.currentTarget.dataset;
      if (this.data.bannerImgs[index] !== src) return;
      const { width, height } = e.detail;
      if (!(width > 0 && height > 0)) return;
      const mode = getBannerImageMode(width, height);
      if (!this._imageModes) this._imageModes = new Map();
      this._imageModes.set(src, mode);
      const modes = this.data.bannerImageModes.slice();
      modes[index] = mode;
      this.setData({ bannerImageModes: modes });
    },
    onImageError(e) {
      const { index, src } = e.currentTarget.dataset;
      if (this.data.bannerImgs[index] === src && this.data.imagePaths[src]) {
        this.triggerEvent('imageerror', { url: src });
      }
    },
    onVideoMetadata(e) {
      if (e.currentTarget.dataset.src !== this.data.videoUrl) return;
      const { width, height } = e.detail;
      const fit = getBannerImageMode(width, height) === 'aspectFill' ? 'cover' : 'contain';
      let videoWidth = 100, videoHeight = 100;
      if (fit === 'contain' && width > 0 && height > 0) {
        const ratio = width / height;
        if (ratio < 4 / 5) videoWidth = ratio / (4 / 5) * 100;
        else videoHeight = (4 / 5) / ratio * 100;
      }
      this.setData({ bannerVideoFit: fit, bannerVideoStyle: `width: ${videoWidth}%; height: ${videoHeight}%;` });
    },
    previewImage(e) {
      if (Date.now() < (this._suppressTapUntil || 0) || this.data.inactive) return;
      const urls = this.data.bannerImgs.map(url => this.data.imagePaths[url] || url);
      if (urls.length) wx.previewImage({ current: urls[e.currentTarget.dataset.index] || urls[0], urls });
    },
    pauseVideo() {
      if (!wx.createVideoContext) return;
      const video = wx.createVideoContext('galleryVideo', this);
      if (video) video.pause();
    },
    pause() { this.onTouchCancel(); this.pauseVideo(); },
    onVideoError() { wx.showToast({ title: '视频加载失败，请稍后重试', icon: 'none' }); }
  }
});
