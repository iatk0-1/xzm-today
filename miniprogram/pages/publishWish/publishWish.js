const { getErrorMessage } = require('../../utils/error');
// miniprogram/pages/publishWish/publishWish.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { extractVideoCover } = require('../../utils/videoCover');
const { getLinkedProductIds, productPlaceholder, loadLinkedProducts } = require('../../utils/wishProducts');

const MAX_WISH_IMAGES = 99;
const MAX_PICK_COUNT = 20;
const UPLOAD_CONCURRENCY = 3;
const IMAGE_COLUMNS = 3;

Page({
  data: {
    wishId: '',
    videoUrl: '',
    videoThumbPath: '',
    useVideoCover: false,
    videoCoverLoading: false,
    loading: false,
    loadFailed: false,
    canLinkProduct: false,
    isStallManager: false,
    linkedProducts: [],
    expectedPrice: null,
    showProductPicker: false,
    pickerProducts: [],
    productKeyword: '',
    productList: [],
    productLoading: false,
    productHasMore: true,
    productPage: 1,
    productError: '',
    stallOptions: [],
    tagOptions: [],
    productStall: '',
    productTag: '',
    imageList: [],
    imageItems: [],
    dragIndex: -1,
    imageItemSize: 105,
    imageStep: 114,
    imageAreaHeight: 105,
    uploadImageX: 0,
    uploadImageY: 0,
    maxImages: MAX_WISH_IMAGES,
    splitByImage: false,
    title: '',
    content: '',
    submitting: false
  },

  onLoad: async function(options) {
    this.initImageGrid();
    this.setData({ wishId: options.id || '', loading: true });
    wx.setNavigationBarTitle({ title: options.id ? '编辑心愿' : '发布心愿' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      this.setData({ canLinkProduct: !!(auth.isAdmin() || auth.isStallManager()), isStallManager: auth.isStallManager() });
      if (options.id) {
        var wish = await api.get('/wishes/' + options.id + '/edit');
        var images = wish.images && wish.images.length ? wish.images : (wish.image ? [wish.image] : []);
        this._existingImages = new Set(images);
        this._existingVideoUrl = wish.videoUrl || '';
        var useVideoCover = !!(wish.videoUrl && wish.useVideoCover);
        this.setData({ videoUrl: wish.videoUrl || '', useVideoCover: useVideoCover,
          videoThumbPath: useVideoCover ? images[0] || '' : '' });
        if (useVideoCover) images = images.slice(1);
        this.setData({ imageList: images, title: wish.title || wish.content || '', content: wish.content || '',
          expectedPrice: wish.expectedPrice == null ? null : wish.expectedPrice,
          linkedProducts: getLinkedProductIds(wish).map(productPlaceholder) });
        this.refreshImageGrid(images);
        this.setData({ linkedProducts: await loadLinkedProducts(wish, id => api.get('/products/' + id)) });
      }
    } catch (err) {
      this.setData({ loadFailed: true });
      wx.showToast({ title: getErrorMessage(err, '加载心愿失败，请返回后重试'), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onUnload: function() {
    this._videoCoverDisposed = true;
    this._imageDrag = null;
    this.closeProductPicker();
  },

  onHide: function() {
    this.cancelImageDrag();
  },

  onReady: function() {
    if (!wx.createSelectorQuery) return;
    wx.createSelectorQuery().in(this).select('.image-drag-area').boundingClientRect(rect => {
      if (rect && rect.width > 0) this.initImageGrid(rect.width);
    }).exec();
  },

  onResize: function() {
    this.cancelImageDrag();
    this.initImageGrid();
  },

  initImageGrid: function(width) {
    var info = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375 };
    var ratio = (info.windowWidth || 375) / 750;
    var gap = 18 * ratio;
    var gridWidth = width || (info.windowWidth || 375) - 80 * ratio;
    var step = (gridWidth + gap) / IMAGE_COLUMNS;
    this.setData({ imageStep: step, imageItemSize: step - gap });
    this.refreshImageGrid();
  },

  refreshImageGrid: function(images = this.data.imageList, orderedItems) {
    // 图片地址可能重复，给每个格子保留独立 ID，拖动时不复用错误的节点。
    var available = this.data.imageItems.slice();
    var items = orderedItems || images.map(url => {
      var index = available.findIndex(item => item.url === url);
      if (index >= 0) return available.splice(index, 1)[0];
      this._imageItemId = (this._imageItemId || 0) + 1;
      return { id: 'wish_image_' + this._imageItemId, url: url };
    });
    var step = this.data.imageStep;
    var offset = this.data.useVideoCover ? 1 : 0;
    var positioned = items.map((item, index) => ({ ...item,
      x: ((index + offset) % IMAGE_COLUMNS) * step,
      y: Math.floor((index + offset) / IMAGE_COLUMNS) * step }));
    var mediaCount = images.length + offset;
    var count = mediaCount + (mediaCount < MAX_WISH_IMAGES ? 1 : 0);
    var rows = Math.max(1, Math.ceil(count / IMAGE_COLUMNS));
    this.setData({ imageList: images.slice(), imageItems: positioned, dragIndex: -1,
      imageAreaHeight: (rows - 1) * step + this.data.imageItemSize,
      uploadImageX: (mediaCount % IMAGE_COLUMNS) * step,
      uploadImageY: Math.floor(mediaCount / IMAGE_COLUMNS) * step });
    this._imageDrag = null;
  },

  onImageDragStart: function(e) {
    if (this.data.submitting || this.data.loading || this._imageDrag) return;
    var index = Number(e.currentTarget.dataset.index);
    var item = this.data.imageItems[index];
    if (!item) return;
    this._imageDrag = { id: item.id, index: index, x: item.x, y: item.y };
    this._suppressImageTapUntil = Date.now() + 350;
    this.setData({ dragIndex: index });
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
  },

  onImageDragMove: function(e) {
    var drag = this._imageDrag;
    if (!drag || e.currentTarget.dataset.id !== drag.id
        || !['touch', 'touch-out-of-bounds'].includes(e.detail.source)) return;
    if (Number.isFinite(e.detail.x) && Number.isFinite(e.detail.y)) {
      drag.x = e.detail.x;
      drag.y = e.detail.y;
      // 只同步当前格子的坐标，松手或取消时能准确回到网格位置。
      this.setData({ ['imageItems[' + drag.index + '].x']: drag.x,
        ['imageItems[' + drag.index + '].y']: drag.y });
    }
  },

  onImageDragEnd: function() {
    var drag = this._imageDrag;
    if (!drag) return;
    var items = this.data.imageItems.slice();
    var step = this.data.imageStep;
    var column = Math.max(0, Math.min(IMAGE_COLUMNS - 1, Math.round(drag.x / step)));
    var row = Math.max(0, Math.round(drag.y / step));
    var target = Math.max(0, Math.min(items.length - 1, row * IMAGE_COLUMNS + column - (this.data.useVideoCover ? 1 : 0)));
    if (target !== drag.index) {
      var moving = items.splice(drag.index, 1)[0];
      items.splice(target, 0, moving);
    }
    this._suppressImageTapUntil = Date.now() + 350;
    this.refreshImageGrid(items.map(item => item.url), items);
  },

  cancelImageDrag: function() {
    if (!this._imageDrag) return;
    this._suppressImageTapUntil = Date.now() + 350;
    this.refreshImageGrid();
  },

  openProductPicker: async function() {
    if (!this.data.canLinkProduct || this.data.loading || this.data.submitting) return;
    if (this.data.showProductPicker) return;
    this.setData({ showProductPicker: true, pickerProducts: this.data.linkedProducts.slice() });
    var optionsVersion = this._productOptionsVersion = (this._productOptionsVersion || 0) + 1;
    this.loadProducts(true);
    try {
      var results = await Promise.all([
        api.get(this.data.isStallManager ? '/stall-managers/stalls/mine' : '/stalls/all'),
        api.get('/tags/all')
      ]);
      if (optionsVersion !== this._productOptionsVersion) return;
      this.setData({ stallOptions: Array.isArray(results[0]) ? results[0] : [],
        tagOptions: Array.isArray(results[1]) ? results[1] : [] });
    } catch (err) {
      if (optionsVersion === this._productOptionsVersion) {
        wx.showToast({ title: getErrorMessage(err, '加载筛选项失败，请重新打开选择窗口'), icon: 'none' });
      }
    }
  },

  closeProductPicker: function() {
    clearTimeout(this._productSearchTimer);
    this._productSearchTimer = null;
    this._productQueryVersion = (this._productQueryVersion || 0) + 1;
    this._productOptionsVersion = (this._productOptionsVersion || 0) + 1;
    this.setData({ showProductPicker: false, productLoading: false });
  },

  stopPickerTap: function() {},

  inputProductKeyword: function(e) {
    this.setData({ productKeyword: e.detail.value || '' });
    clearTimeout(this._productSearchTimer);
    // 输入一变就废弃旧请求，避免旧结果覆盖新关键词。
    this._productQueryVersion = (this._productQueryVersion || 0) + 1;
    this.setData({ productLoading: false, productList: [] });
    this._productSearchTimer = setTimeout(() => this.searchProducts(), 350);
  },

  searchProducts: function() {
    clearTimeout(this._productSearchTimer);
    this._productSearchTimer = null;
    return this.loadProducts(true);
  },

  changeProductStall: function(e) {
    this.setData({ productStall: e.currentTarget.dataset.stall === 'all' ? '' : String(e.currentTarget.dataset.stall) });
    return this.searchProducts();
  },

  changeProductTag: function(e) {
    this.setData({ productTag: e.currentTarget.dataset.tag === 'all' ? '' : String(e.currentTarget.dataset.tag) });
    return this.searchProducts();
  },

  loadMoreProducts: function() {
    if (this._productSearchTimer) return;
    return this.loadProducts(false);
  },

  loadProducts: async function(reset) {
    if (!this.data.showProductPicker) return;
    if (!reset && (this.data.productLoading || !this.data.productHasMore)) return;
    var version = this._productQueryVersion = (this._productQueryVersion || 0) + 1;
    var page = reset ? 1 : this.data.productPage;
    var params = { page: page, size: 20 };
    var keyword = this.data.productKeyword.trim();
    if (keyword) params.keyword = keyword;
    if (this.data.productStall) params.stallId = this.data.productStall;
    if (this.data.productTag) params.tagId = this.data.productTag;
    this.setData({ productLoading: true, productError: '', ...(reset ? { productList: [], productHasMore: true } : {}) });
    try {
      var res = await api.get('/wishes/linkable-products', params);
      if (version !== this._productQueryVersion) return;
      var selected = new Set(this.data.pickerProducts.map(item => String(item.id)));
      var list = (res.content || []).map(item => ({ ...item, selected: selected.has(String(item.id)) }));
      this.setData({ productList: reset ? list : this.data.productList.concat(list), productPage: page + 1,
        productHasMore: res.hasNext !== undefined ? res.hasNext : list.length === 20 });
    } catch (err) {
      if (version === this._productQueryVersion) this.setData({ productError: getErrorMessage(err, '商品加载失败，点击重试') });
    } finally {
      if (version === this._productQueryVersion) this.setData({ productLoading: false });
    }
  },

  selectProduct: function(e) {
    var id = String(e.currentTarget.dataset.id);
    var product = this.data.productList.find(item => String(item.id) === id);
    if (!product) return;
    var selected = this.data.pickerProducts.slice();
    var index = selected.findIndex(item => String(item.id) === id);
    if (index >= 0) selected.splice(index, 1);
    else selected.push(product);
    var ids = new Set(selected.map(item => String(item.id)));
    this.setData({ pickerProducts: selected,
      productList: this.data.productList.map(item => ({ ...item, selected: ids.has(String(item.id)) })) });
  },

  confirmProduct: function() {
    if (!this.data.canLinkProduct || this.data.submitting) return;
    this.setData({ linkedProducts: this.data.pickerProducts.slice(),
      ...(this.data.pickerProducts.length ? { splitByImage: false } : {}) });
    this.closeProductPicker();
  },

  removeLinkedProduct: function(e) {
    if (!this.data.canLinkProduct || this.data.submitting || this.data.loading) return;
    var id = String(e.currentTarget.dataset.id);
    this.setData({ linkedProducts: this.data.linkedProducts.filter(item => String(item.id) !== id) });
  },

  previewEditorVideo: function() {
    if (!this.data.videoUrl) return;
    wx.previewMedia({
      sources: [{ url: this.data.videoUrl, type: 'video', poster: this.data.videoThumbPath || '' }],
      current: 0,
      fail: () => wx.showToast({ title: '视频预览失败，请稍后重试', icon: 'none' })
    });
  },

  uploadVideo: function() {
    if (this.data.submitting || this.data.loading || this.data.videoCoverLoading) return;
    if (this.data.useVideoCover) return wx.showToast({ title: '请先取消视频封面勾选，再更换视频', icon: 'none' });
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['camera', 'album'], compressed: true,
      success: res => {
        if (this._videoCoverDisposed) return;
        var file = (res.tempFiles || [])[0];
        if (!file || !file.tempFilePath) return;
        if (file.duration > 60) return wx.showToast({ title: '视频最长1分钟，请重新选择', icon: 'none' });
        this._videoChanged = true;
        this.setData({ videoUrl: file.tempFilePath, videoThumbPath: '', useVideoCover: false, splitByImage: false });
      },
      fail: err => {
        if (!/cancel/.test(err.errMsg || '')) wx.showToast({ title: '选择视频失败，请重试', icon: 'none' });
      }
    });
  },

  removeVideo: function() {
    if (this.data.submitting || this.data.loading) return;
    this._videoChanged = true;
    this._videoCoverTask = null;
    this._videoCoverSource = null;
    this.setData({ videoUrl: '', videoThumbPath: '', useVideoCover: false, videoCoverLoading: false });
    this.refreshImageGrid();
  },

  toggleVideoCover: function() {
    if (this.data.submitting || this.data.loading || !this.data.videoUrl) return;
    if (!this.data.useVideoCover && this.data.imageList.length >= MAX_WISH_IMAGES) {
      return wx.showToast({ title: '请先移除一张图片，为视频封面留出位置', icon: 'none' });
    }
    var selected = !this.data.useVideoCover;
    this.setData({ useVideoCover: selected });
    this.refreshImageGrid();
    if (selected) this.ensureVideoCover().catch(() => {});
  },

  previewVideoCover: function() {
    if (this.data.videoThumbPath) wx.previewImage({ current: this.data.videoThumbPath, urls: [this.data.videoThumbPath] });
  },

  retryVideoCover: function() {
    if (!this.data.submitting && this.data.useVideoCover) this.ensureVideoCover().catch(() => {});
  },

  ensureVideoCover: function() {
    if (this.data.videoThumbPath) return Promise.resolve(this.data.videoThumbPath);
    const source = this.data.videoUrl;
    if (!source) return Promise.reject(new Error('请先选择心愿视频'));
    if (this._videoCoverTask && this._videoCoverSource === source) return this._videoCoverTask;
    this._videoCoverSource = source;
    this.setData({ videoCoverLoading: true });
    const task = extractVideoCover(source).then(path => {
      if (!this._videoCoverDisposed && this._videoCoverTask === task && this.data.videoUrl === source) this.setData({ videoThumbPath: path });
      return path;
    }).catch(error => {
      if (!this._videoCoverDisposed && this._videoCoverTask === task && this.data.useVideoCover && this.data.videoUrl === source) {
        wx.showToast({ title: getErrorMessage(error, '视频封面生成失败，请重试'), icon: 'none' });
      }
      throw error;
    }).finally(() => {
      if (this._videoCoverTask === task) {
        this._videoCoverTask = null;
        if (!this._videoCoverDisposed) this.setData({ videoCoverLoading: false });
      }
    });
    this._videoCoverTask = task;
    return task;
  },

  chooseImage: function() {
    if (this.data.submitting || this.data.loading || this._imageDrag) return;
    var remaining = MAX_WISH_IMAGES - this.data.imageList.length - (this.data.useVideoCover ? 1 : 0);
    if (remaining <= 0) {
      return wx.showToast({ title: '最多上传99张图片', icon: 'none' });
    }

    wx.chooseMedia({
      count: Math.min(MAX_PICK_COUNT, remaining),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        var selected = (res.tempFiles || [])
          .map(function(file) { return file.tempFilePath; })
          .filter(Boolean);
        var imageList = this.data.imageList.concat(selected).slice(0, MAX_WISH_IMAGES - (this.data.useVideoCover ? 1 : 0));
        this.refreshImageGrid(imageList);
      }
    });
  },

  removeImage: function(e) {
    if (this.data.submitting || this.data.loading || this._imageDrag) return;
    var index = Number(e.currentTarget.dataset.index);
    var imageList = this.data.imageList.slice();
    if (!Number.isInteger(index) || index < 0 || index >= imageList.length) return;
    imageList.splice(index, 1);
    this.refreshImageGrid(imageList);
  },

  previewImage: function(e) {
    if (this._imageDrag || Date.now() < (this._suppressImageTapUntil || 0)) return;
    var index = Number(e.currentTarget.dataset.index || 0);
    var urls = this.data.imageList;
    if (urls.length > 0) {
      wx.previewImage({ current: urls[index] || urls[0], urls: urls });
    }
  },

  toggleSplitByImage: function(e) {
    if (this.data.linkedProducts.length || this.data.wishId || this.data.videoUrl) {
      this.setData({ splitByImage: false });
      return;
    }
    this.setData({ splitByImage: !!e.detail.value });
  },

  inputTitle: function(e) { this.setData({ title: e.detail.value }); },
  inputDesc: function(e) { this.setData({ content: e.detail.value }); },

  submitWish: async function() {
    if (this.data.submitting || this.data.loading || this.data.loadFailed) return;
    if (this._imageDrag) this.onImageDragEnd();
    if (this.data.linkedProducts.length || this.data.wishId || this.data.videoUrl) this.setData({ splitByImage: false });

    var imageList = this.data.imageList;
    var title = (this.data.title || '').trim();
    var content = (this.data.content || '').trim();

    if (imageList.length === 0 && !(this.data.videoUrl && this.data.useVideoCover)) {
      return wx.showToast({ title: '请上传商品图片', icon: 'none' });
    }
    if (!title) {
      return wx.showToast({ title: '请输入商品名称', icon: 'none' });
    }
    if (!content) {
      return wx.showToast({ title: '请输入心愿正文', icon: 'none' });
    }
    if (this.data.splitByImage && imageList.length > 1) {
      var confirmed = await this.confirmSplitCreation(imageList.length);
      if (!confirmed) return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '准备上传...', mask: true });

    try {
      await auth.ensureAuthenticated({ silent: true });
      var coverPath = this.data.useVideoCover ? await this.ensureVideoCover() : '';
      if (this.data.useVideoCover && imageList.length >= MAX_WISH_IMAGES) {
        throw new Error('使用视频封面时最多上传98张其他图片');
      }
      var imageUrls = await this.uploadImages(coverPath ? [coverPath].concat(imageList) : imageList);
      var videoUrl = this.data.videoUrl;
      if (videoUrl && videoUrl !== this._existingVideoUrl) {
        wx.showLoading({ title: '上传视频...', mask: true });
        const { compressVideo } = require('../../utils/media');
        const cosUpload = require('../../utils/cos-upload');
        var compressed = await compressVideo(videoUrl);
        videoUrl = await cosUpload.uploadFile(compressed.path, 'wishes');
        if (!videoUrl) throw new Error('视频上传失败，请重试');
        this._existingVideoUrl = videoUrl;
        this.setData({ videoUrl: videoUrl });
      }
      var payload = {
        images: imageUrls,
        title: title,
        content: content,
        expectedPrice: this.data.expectedPrice
      };
      if (videoUrl || this._existingVideoUrl || this._videoChanged) {
        payload.videoUrl = videoUrl || '';
        payload.useVideoCover = !!this.data.useVideoCover;
      }
      if (this.data.canLinkProduct) {
        payload.linkedProductIds = this.data.linkedProducts.map(item => item.id);
        if (this.data.wishId) payload.updateLinkedProduct = true;
      }

      wx.showLoading({ title: this.data.wishId ? '保存心愿...' : '创建心愿...', mask: true });
      if (this.data.wishId) {
        await api.put('/wishes/' + this.data.wishId, payload);
      } else if (this.data.splitByImage) {
        await api.post('/wishes/batch', payload);
      } else {
        await api.post('/wishes', Object.assign({ image: imageUrls[0] }, payload));
      }

      wx.hideLoading();
      wx.showToast({
        title: this.data.wishId ? '保存成功' : (this.data.splitByImage ? '批量发布成功' : '发布成功'),
        icon: 'success'
      });
      setTimeout(function() { wx.navigateBack({ delta: 1 }); }, 1000);
    } catch (err) {
      wx.hideLoading();
      console.error('保存心愿失败:', err);
      wx.showToast({ title: getErrorMessage(err, this.data.wishId ? '保存失败' : '发布失败'), icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  confirmSplitCreation: function(count) {
    return new Promise(function(resolve) {
      wx.showModal({
        title: '确认分别创建',
        content: '当前选择了' + count + '张图片，将创建' + count + '条心愿。确定继续吗？',
        confirmText: '确认创建',
        success: function(res) { resolve(!!res.confirm); },
        fail: function() { resolve(false); }
      });
    });
  },

  uploadImages: async function(imageList) {
    var existingImages = this._existingImages || new Set();
    var urls = new Array(imageList.length);
    var nextIndex = 0;
    var completed = 0;
    var failure = null;

    async function worker() {
      while (!failure) {
        var index = nextIndex++;
        if (index >= imageList.length) return;
        try {
          if (existingImages.has(imageList[index])) {
            urls[index] = imageList[index];
            completed += 1;
            continue;
          }
          var uploadRes = await api.uploadFile('/files/upload-wish', imageList[index]);
          if (!uploadRes || !uploadRes.url) {
            throw new Error('第' + (index + 1) + '张图片上传失败');
          }
          urls[index] = uploadRes.url;
          completed += 1;
          wx.showLoading({ title: '上传 ' + completed + '/' + imageList.length, mask: true });
        } catch (err) {
          failure = err instanceof Error
            ? err
            : new Error(getErrorMessage(err, '第' + (index + 1) + '张图片上传失败'));
        }
      }
    }

    var workerCount = Math.min(UPLOAD_CONCURRENCY, imageList.length);
    var workers = [];
    for (var i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);
    if (failure) throw failure;
    return urls;
  }
});
