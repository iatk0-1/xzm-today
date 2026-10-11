const { getErrorMessage } = require('../../utils/error');
// miniprogram/pages/publishWish/publishWish.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

const MAX_WISH_IMAGES = 99;
const MAX_PICK_COUNT = 20;
const UPLOAD_CONCURRENCY = 3;

Page({
  data: {
    wishId: '',
    loading: false,
    loadFailed: false,
    canLinkProduct: false,
    isStallManager: false,
    linkedProduct: null,
    expectedPrice: null,
    showProductPicker: false,
    pickerProduct: null,
    productKeyword: '',
    productList: [],
    productLoading: false,
    productHasMore: true,
    productPage: 1,
    productError: '',
    stallOptions: [{ name: '全部档口', id: '' }],
    tagOptions: [{ name: '全部标签', id: '' }],
    stallIndex: 0,
    tagIndex: 0,
    imageList: [],
    maxImages: MAX_WISH_IMAGES,
    splitByImage: false,
    title: '',
    content: '',
    submitting: false
  },

  onLoad: async function(options) {
    this.setData({ wishId: options.id || '', loading: true });
    wx.setNavigationBarTitle({ title: options.id ? '编辑心愿' : '发布心愿' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      this.setData({ canLinkProduct: !!(auth.isAdmin() || auth.isStallManager()), isStallManager: auth.isStallManager() });
      if (options.id) {
        var wish = await api.get('/wishes/' + options.id + '/edit');
        var images = wish.images && wish.images.length ? wish.images : (wish.image ? [wish.image] : []);
        this._existingImages = new Set(images);
        this.setData({ imageList: images, title: wish.title || wish.content || '', content: wish.content || '',
          expectedPrice: wish.expectedPrice == null ? null : wish.expectedPrice,
          linkedProduct: wish.linkedProductId ? { id: wish.linkedProductId, name: '已关联商品（' + wish.linkedProductId + '）' } : null });
        if (wish.linkedProductId) {
          try {
            var product = await api.get('/products/' + wish.linkedProductId);
            this.setData({ linkedProduct: product.product || product });
          } catch (err) {
            // 商品失效时保留原关联，管理员或负责人仍可更换或移除。
          }
        }
      }
    } catch (err) {
      this.setData({ loadFailed: true });
      wx.showToast({ title: getErrorMessage(err, '加载心愿失败，请返回后重试'), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onUnload: function() {
    clearTimeout(this._productSearchTimer);
    this._productQueryVersion = (this._productQueryVersion || 0) + 1;
  },

  openProductPicker: async function() {
    if (!this.data.canLinkProduct || this.data.loading || this.data.submitting) return;
    this.setData({ showProductPicker: true, pickerProduct: this.data.linkedProduct });
    this.loadProducts(true);
    try {
      var results = await Promise.all([
        api.get(this.data.isStallManager ? '/stall-managers/stalls/mine' : '/stalls/all'),
        api.get('/tags/all')
      ]);
      this.setData({ stallOptions: [{ name: '全部档口', id: '' }].concat(results[0] || []),
        tagOptions: [{ name: '全部标签', id: '' }].concat(results[1] || []) });
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '加载筛选项失败，请重新打开选择窗口'), icon: 'none' });
    }
  },

  closeProductPicker: function() {
    clearTimeout(this._productSearchTimer);
    this._productSearchTimer = null;
    this._productQueryVersion = (this._productQueryVersion || 0) + 1;
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
    this.setData({ stallIndex: Number(e.detail.value) });
    return this.searchProducts();
  },

  changeProductTag: function(e) {
    this.setData({ tagIndex: Number(e.detail.value) });
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
    var stall = this.data.stallOptions[this.data.stallIndex];
    var tag = this.data.tagOptions[this.data.tagIndex];
    if (keyword) params.keyword = keyword;
    if (stall && stall.id) params.stallId = stall.id;
    if (tag && tag.id) params.tagId = tag.id;
    this.setData({ productLoading: true, productError: '', ...(reset ? { productList: [], productHasMore: true } : {}) });
    try {
      var res = await api.get('/wishes/linkable-products', params);
      if (version !== this._productQueryVersion) return;
      var list = res.content || [];
      this.setData({ productList: reset ? list : this.data.productList.concat(list), productPage: page + 1,
        productHasMore: res.hasNext !== undefined ? res.hasNext : list.length === 20 });
    } catch (err) {
      if (version === this._productQueryVersion) this.setData({ productError: getErrorMessage(err, '商品加载失败，点击重试') });
    } finally {
      if (version === this._productQueryVersion) this.setData({ productLoading: false });
    }
  },

  selectProduct: function(e) {
    var product = this.data.productList.find(item => String(item.id) === String(e.currentTarget.dataset.id));
    if (product) this.setData({ pickerProduct: product });
  },

  confirmProduct: function() {
    if (!this.data.pickerProduct) return wx.showToast({ title: '请选择商品', icon: 'none' });
    this.setData({ linkedProduct: this.data.pickerProduct, splitByImage: false });
    this.closeProductPicker();
  },

  removeLinkedProduct: function() {
    if (this.data.canLinkProduct && !this.data.submitting) this.setData({ linkedProduct: null });
  },

  chooseImage: function() {
    var remaining = MAX_WISH_IMAGES - this.data.imageList.length;
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
        var imageList = this.data.imageList.concat(selected).slice(0, MAX_WISH_IMAGES);
        this.setData({ imageList: imageList });
      }
    });
  },

  removeImage: function(e) {
    var index = Number(e.currentTarget.dataset.index);
    var imageList = this.data.imageList.slice();
    imageList.splice(index, 1);
    this.setData({ imageList: imageList });
  },

  moveImageLeft: function(e) {
    this.moveImage(Number(e.currentTarget.dataset.index), -1);
  },

  moveImageRight: function(e) {
    this.moveImage(Number(e.currentTarget.dataset.index), 1);
  },

  moveImage: function(index, offset) {
    var target = index + offset;
    var imageList = this.data.imageList.slice();
    if (index < 0 || target < 0 || index >= imageList.length || target >= imageList.length) return;
    var temp = imageList[index];
    imageList[index] = imageList[target];
    imageList[target] = temp;
    this.setData({ imageList: imageList });
  },

  previewImage: function(e) {
    var index = Number(e.currentTarget.dataset.index || 0);
    var urls = this.data.imageList;
    if (urls.length > 0) {
      wx.previewImage({ current: urls[index] || urls[0], urls: urls });
    }
  },

  toggleSplitByImage: function(e) {
    if (this.data.linkedProduct || this.data.wishId) {
      this.setData({ splitByImage: false });
      return;
    }
    this.setData({ splitByImage: !!e.detail.value });
  },

  inputTitle: function(e) { this.setData({ title: e.detail.value }); },
  inputDesc: function(e) { this.setData({ content: e.detail.value }); },

  submitWish: async function() {
    if (this.data.submitting || this.data.loading || this.data.loadFailed) return;
    if (this.data.linkedProduct || this.data.wishId) this.setData({ splitByImage: false });

    var imageList = this.data.imageList;
    var title = (this.data.title || '').trim();
    var content = (this.data.content || '').trim();

    if (imageList.length === 0) {
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
      var imageUrls = await this.uploadImages(imageList);
      var payload = {
        images: imageUrls,
        title: title,
        content: content,
        expectedPrice: this.data.expectedPrice
      };
      if (this.data.canLinkProduct) {
        payload.linkedProductId = this.data.linkedProduct ? this.data.linkedProduct.id : null;
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
