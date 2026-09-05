// miniprogram/pages/liveRoomPublish/publish.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const config = require('../../utils/config');
const { compressImage, compressVideo } = require('../../utils/media');
const { saveDraft, loadDraft, removeDraft, hasDraft, persistMediaFiles, cleanupDraftFiles, validatePersistedUrls } = require('../../utils/draft');


// 拖拽网格配置
const ITEM_SIZE = 105;
const COLUMNS = 3;
const MAX_PRODUCT_IMAGES = 99;
const MAX_MEDIA_PICK_COUNT = 20;

Page({
  data: {
    sessionId: null,
    productId: null,   // 编辑模式：已有商品 ID
    editMode: false,   // 是否为编辑模式
    videoUrl: '',
    mediaList: [],
    maxProductImages: MAX_PRODUCT_IMAGES,
    dragIndex: -1,
    dragAreaHeight: ITEM_SIZE,
    uploadBtnX: 0,
    uploadBtnY: 0,
    tempMoveX: 0,
    tempMoveY: 0,

    title: '',
    selectedStalls: [],
    selectedTags: [],
    stallSearchKeyword: '',
    tagSearchKeyword: '',
    stallSearchResults: [],
    tagSearchResults: [],
    showStallSearch: false,
    showStallCreate: false,
    showTagSearch: false,
    showTagCreate: false,
    recentStalls: [],
    recentTags: [],

    sizeCategoryList: [],
    currentSizeCategoryId: null,
    currentSizeCategoryName: '',
    sizeOptions: [],

    showSizeModal: false,
    newCategoryName: '',
    newSizeName: '',
    colors: [],
    colorInput: '',
    skuList: [],
    batchPrice: '',
    batchStock: '',
    batchImage: '',
    quickPrice: '',
    quickStock: '',
    quickImage: '',

    showBatchModal: false,
    batchSelectedColors: [],
    batchSelectedSizes: [],

    // 套装模式
    isBundleMode: false,
    bundleGroups: [],
    activeGroupIndex: -1
  },

  async onLoad(options) {
    await auth.ensureAuthenticated({ silent: true });
    if (options.sessionId) {
      this.setData({ sessionId: options.sessionId });
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }

    if (options.productId) {
      this.setData({ productId: options.productId, editMode: true });
      this.loadProductForEdit(options.productId);
    } else {
      // 创建模式：检测是否有未完成的草稿
      this.checkDraft();
    }

    this.loadRecentStallsAndTags();
    this.loadSizeCategories();
  },

  onUnload() {
    if (this.hasFormContent()) {
      this.saveDraft();
    }
  },

  // 加载已有商品数据用于编辑
  loadProductForEdit: async function(productId) {
    wx.showLoading({ title: '加载商品...' });
    try {
      const res = await api.get(`/live-products/${productId}`);
      const product = res.product || res;
      const skus = res.skus || [];

      // 解析颜色
      const colors = [...new Set(skus.map(s => s.spec || s.color || '').filter(Boolean))];
      const finalColors = colors.length > 0 ? colors : ['图片色'];

      // 如果尺码分类还没加载，等待一下再获取
      const skuSizeNames = [...new Set(skus.map(s => s.size || '').filter(Boolean))];
      const sizeOptions = (this.data.sizeOptions || []).map(opt => ({
        ...opt,
        selected: skuSizeNames.includes(opt.name)
      }));

      // 切换尺码分类
      if (product.sizeCategoryId && this.data.sizeCategoryList.length > 0) {
        const category = this.data.sizeCategoryList.find(c => c.id === product.sizeCategoryId);
        if (category) {
          const catSizes = (category.sizes || []).map(s => ({
            id: s.id, name: s.name,
            selected: skuSizeNames.includes(s.name)
          }));
          this.setData({
            currentSizeCategoryId: product.sizeCategoryId,
            currentSizeCategoryName: category.name,
            sizeOptions: catSizes
          });
        }
      }

      // 构建 SKU 列表
      const skuList = skus.map(sku => ({
        skuId: sku.id || null,
        sizeId: sku.sizeId || null,
        color: sku.spec || sku.color || '图片色',
        size: sku.size || '均码',
        price: String(sku.retailPrice || ''),
        stock: sku.unlimitedStock ? '' : String(sku.stockMain || ''),
        image: sku.imageUrl || ''
      }));

      // 构建媒体列表（封面 + banner 图片）
      const mediaList = [];
      if (product.coverUrl) {
        mediaList.push({ id: 'cover_' + Date.now(), url: product.coverUrl, x: 0, y: 0 });
      }
      (product.bannerImages || []).forEach((url, i) => {
        mediaList.push({ id: 'banner_' + Date.now() + i, url: url, x: 0, y: 0 });
      });

      // 加载档口和标签信息
      const stallIds = product.stallIds || [];
      const tagIds = product.relateTagIds || [];
      let selectedStalls = product.stalls || [];
      let selectedTags = product.tags || [];

      // 如果后端没返回详情，从 ID 推测（用最近使用的记录做默认）
      if (selectedStalls.length === 0 && stallIds.length > 0) {
        selectedStalls = stallIds.map(id => this.data.recentStalls.find(s => s.id === id)).filter(Boolean);
      }
      if (selectedTags.length === 0 && tagIds.length > 0) {
        selectedTags = tagIds.map(id => this.data.recentTags.find(t => t.id === id)).filter(Boolean);
      }

      this.setData({
        title: product.name || '',
        mediaList: mediaList,
        colors: finalColors,
        colorInput: '',
        skuList: skuList,
        selectedStalls: selectedStalls,
        selectedTags: selectedTags,
      });

      this.refreshGrid(mediaList);
      wx.hideLoading();
      this.checkDraft();
    } catch (err) {
      wx.hideLoading();
      console.error('加载商品失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 加载历史档口和标签
  loadRecentStallsAndTags: async function() {
    try {
      const [stallsRes, tagsRes] = await Promise.all([
        api.get('/stalls/recent?limit=10'),
        api.get('/tags/recent?limit=10')
      ]);

      this.setData({
        recentStalls: stallsRes || [],
        recentTags: tagsRes || []
      });
    } catch (err) {
      console.error('加载历史记录失败:', err);
    }
  },

  // 加载尺码类型和尺码
  loadSizeCategories: async function() {
    try {
      const res = await api.get('/sizes/categories');
      console.log('尺码类型和尺码:', res);

      let currentSizeCategoryId = null;
      let currentSizeCategoryName = '';
      let sizeOptions = [];

      if (res && res.length > 0) {
        currentSizeCategoryId = res[0].id;
        currentSizeCategoryName = res[0].name;
        sizeOptions = (res[0].sizes || []).map(size => ({
          id: size.id,
          name: size.name,
          selected: false
        }));
      }

      this.setData({
        sizeCategoryList: res || [],
        currentSizeCategoryId,
        currentSizeCategoryName,
        sizeOptions
      });
    } catch (err) {
      console.error('加载尺码类型失败:', err);
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
    this.enableExitConfirm();
  },

  // ================= 拖拽媒体池 =================
  refreshGrid(list = this.data.mediaList) {
    let positionedList = list.map((item, index) => {
      if (index !== this.data.dragIndex) {
        item.x = (index % COLUMNS) * ITEM_SIZE;
        item.y = Math.floor(index / COLUMNS) * ITEM_SIZE;
      }
      return item;
    });

    let btnIndex = list.length;
    let btnX = (btnIndex % COLUMNS) * ITEM_SIZE;
    let btnY = Math.floor(btnIndex / COLUMNS) * ITEM_SIZE;
    let rows = Math.ceil((btnIndex + (list.length < MAX_PRODUCT_IMAGES ? 1 : 0)) / COLUMNS);
    rows = Math.max(rows, 1);

    this.setData({
      mediaList: positionedList,
      uploadBtnX: btnX,
      uploadBtnY: btnY,
      dragAreaHeight: rows * ITEM_SIZE
    });
  },

  chooseMedia() {
    const remaining = MAX_PRODUCT_IMAGES - this.data.mediaList.length;
    if (remaining <= 0) {
      return wx.showToast({ title: '商品图片最多99张', icon: 'none' });
    }
    wx.chooseMedia({
      count: Math.min(MAX_MEDIA_PICK_COUNT, remaining),
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        console.log('图片选择成功:', res.tempFiles);
        let newItems = res.tempFiles.map((file, i) => ({
          id: 'img_' + Date.now() + i,
          url: file.tempFilePath,
          x: 0, y: 0
        }));
        let list = this.data.mediaList.concat(newItems);
        this.refreshGrid(list);
      },
      fail: (err) => {
        console.error('选择图片失败:', err);
      }
    });
  },

  removeMedia(e) {
    const index = e.currentTarget.dataset.index;
    let list = this.data.mediaList;
    list.splice(index, 1);
    this.refreshGrid(list);
  },

  onDragStart(e) {
    wx.vibrateShort();
    this.setData({ dragIndex: e.currentTarget.dataset.index });
  },

  onDragMove(e) {
    if (this.data.dragIndex === -1) return;
    this.data.tempMoveX = e.detail.x;
    this.data.tempMoveY = e.detail.y;
  },

  onDragEnd() {
    if (this.data.dragIndex === -1) return;
    let dragIdx = this.data.dragIndex;
    let list = [...this.data.mediaList];

    let dropCol = Math.round(this.data.tempMoveX / ITEM_SIZE);
    let dropRow = Math.round(this.data.tempMoveY / ITEM_SIZE);

    if (dropCol < 0) dropCol = 0;
    if (dropCol >= COLUMNS) dropCol = COLUMNS - 1;
    if (dropRow < 0) dropRow = 0;

    let targetIdx = dropRow * COLUMNS + dropCol;
    if (targetIdx >= list.length) targetIdx = list.length - 1;

    if (targetIdx !== dragIdx) {
      let movingItem = list.splice(dragIdx, 1)[0];
      list.splice(targetIdx, 0, movingItem);
    }

    this.setData({ dragIndex: -1 }, () => {
      this.refreshGrid(list);
    });
  },

  // ================= 通用文件上传（COS 直传） =================
  uploadFile: async function(filePath, contentType) {
    console.log('开始上传文件:', filePath, '类型:', contentType);

    const isVideo = filePath.toLowerCase().endsWith('.mp4');
    const isImage = contentType && contentType.startsWith('image/');
    try {
      if (isVideo) {
        const compressResult = await compressVideo(filePath);
        filePath = compressResult.path;
      } else if (isImage || !isVideo) {
        const compressResult = await compressImage(filePath);
        filePath = compressResult.path;
      }
    } catch (e) {
      console.warn('压缩异常，使用原文件:', e);
    }

    const cosUpload = require('../../utils/cos-upload');
    return cosUpload.uploadFile(filePath, 'products');
  },

  // ================= 档口搜索与选择 =================
  onStallSearchInput(e) {
    const keyword = e.detail.value.trim();
    this.setData({ stallSearchKeyword: keyword });
    if (keyword.length > 0) {
      this.searchStalls(keyword);
    } else {
      this.setData({ showStallSearch: false, showStallCreate: false, stallSearchResults: [] });
    }
  },

  searchStalls: async function(keyword) {
    try {
      const res = await api.get(`/stalls/search?keyword=${encodeURIComponent(keyword)}`);
      const selectedIds = this.data.selectedStalls.map(s => s.id);
      const filtered = (res.results || []).filter(s => !selectedIds.includes(s.id));
      const hasExactMatch = res.exactMatch || false;
      this.setData({
        showStallSearch: filtered.length > 0,
        stallSearchResults: filtered,
        showStallCreate: !hasExactMatch && keyword.trim()
      });
    } catch (err) {
      console.error('搜索档口失败:', err);
      this.setData({ showStallSearch: false, showStallCreate: false });
    }
  },

  selectStall(e) {
    const item = e.currentTarget.dataset.item;
    const exists = this.data.selectedStalls.find(s => s.id === item.id);
    if (!exists) {
      this.setData({
        selectedStalls: [...this.data.selectedStalls, item],
        showStallSearch: false,
        showStallCreate: false,
        stallSearchKeyword: '',
        stallSearchResults: []
      });
    }
  },

  removeStall(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ selectedStalls: this.data.selectedStalls.filter(s => s.id !== id) });
  },

  selectRecentStall(e) {
    const item = e.currentTarget.dataset.item;
    const exists = this.data.selectedStalls.find(s => s.id === item.id);
    if (!exists) {
      this.setData({
        selectedStalls: [...this.data.selectedStalls, item]
      });
    }
  },

  // ================= 标签搜索与选择 =================
  onTagSearchInput(e) {
    const keyword = e.detail.value.trim();
    this.setData({ tagSearchKeyword: keyword });
    if (keyword.length > 0) {
      this.searchTags(keyword);
    } else {
      this.setData({ showTagSearch: false, showTagCreate: false, tagSearchResults: [] });
    }
  },

  searchTags: async function(keyword) {
    try {
      const res = await api.get(`/tags/search?keyword=${encodeURIComponent(keyword)}`);
      const selectedIds = this.data.selectedTags.map(t => t.id);
      const filtered = (res.results || []).filter(t => !selectedIds.includes(t.id));
      const hasExactMatch = res.exactMatch || false;
      this.setData({
        showTagSearch: filtered.length > 0,
        tagSearchResults: filtered,
        showTagCreate: !hasExactMatch && keyword.trim()
      });
    } catch (err) {
      console.error('搜索标签失败:', err);
      this.setData({ showTagSearch: false, showTagCreate: false });
    }
  },

  selectTag(e) {
    const item = e.currentTarget.dataset.item;
    const exists = this.data.selectedTags.find(t => t.id === item.id);
    if (!exists) {
      this.setData({
        selectedTags: [...this.data.selectedTags, item],
        showTagSearch: false,
        showTagCreate: false,
        tagSearchKeyword: '',
        tagSearchResults: []
      });
    }
  },

  removeTag(e) {
    let id = e.currentTarget.dataset.id;
    this.setData({ selectedTags: this.data.selectedTags.filter(t => t.id !== id) });
  },

  selectRecentTag(e) {
    const item = e.currentTarget.dataset.item;
    const exists = this.data.selectedTags.find(t => t.id === item.id);
    if (!exists) {
      this.setData({
        selectedTags: [...this.data.selectedTags, item]
      });
    }
  },

  createStall: async function() {
    const name = this.data.stallSearchKeyword.trim();
    if (!name) return;

    wx.showLoading({ title: '创建中...' });
    try {
      const res = await api.post('/stalls', { name });
      wx.hideLoading();
      wx.showToast({ title: '添加成功', icon: 'success' });

      const newItem = { id: res.stall.id, name: res.stall.name };
      this.setData({
        selectedStalls: [...this.data.selectedStalls, newItem],
        showStallSearch: false,
        showStallCreate: false,
        stallSearchKeyword: '',
        stallSearchResults: []
      });
    } catch (err) {
      wx.hideLoading();
      console.error('创建档口失败:', err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    }
  },

  createTag: async function() {
    const name = this.data.tagSearchKeyword.trim();
    if (!name) return;

    wx.showLoading({ title: '创建中...' });
    try {
      const res = await api.post('/tags', { name });
      wx.hideLoading();
      wx.showToast({ title: '添加成功', icon: 'success' });

      const newItem = { id: res.tag.id, name: res.tag.name };
      this.setData({
        selectedTags: [...this.data.selectedTags, newItem],
        showTagSearch: false,
        showTagCreate: false,
        tagSearchKeyword: '',
        tagSearchResults: []
      });
    } catch (err) {
      wx.hideLoading();
      console.error('创建标签失败:', err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    }
  },

  // ================= 尺码配置相关 =================
  openSizeModal: function() {
    this.setData({
      showSizeModal: true,
      newCategoryName: '',
      newSizeName: ''
    });
  },

  closeSizeModal: function() {
    this.setData({ showSizeModal: false });
  },

  switchSizeCategory: function(e) {
    const categoryId = e.currentTarget.dataset.id;
    const category = this.data.sizeCategoryList.find(c => c.id === categoryId);

    if (category) {
      const sizeOptions = (category.sizes || []).map(size => ({
        id: size.id,
        name: size.name,
        selected: this.data.sizeOptions.find(s => s.name === size.name)?.selected || false
      }));

      this.setData({
        currentSizeCategoryId: categoryId,
        currentSizeCategoryName: category.name,
        sizeOptions
      });
    }
  },

  addSizeCategory: async function() {
    const name = this.data.newCategoryName.trim();
    if (!name) {
      wx.showToast({ title: '请输入类型名称', icon: 'none' });
      return;
    }

    try {
      await api.post('/sizes/categories', { name });
      wx.showToast({ title: '添加成功', icon: 'success' });
      await this.loadSizeCategories();
      this.setData({ newCategoryName: '' });
    } catch (err) {
      console.error('创建尺码类型失败:', err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    }
  },

  deleteSizeCategory: async function(e) {
    const categoryId = e.currentTarget.dataset.id;

    wx.showModal({
      title: '确认删除',
      content: '删除后将同时删除该类型下的所有尺码，确定吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.delete(`/sizes/categories/${categoryId}`);
            wx.showToast({ title: '删除成功', icon: 'success' });
            await this.loadSizeCategories();
          } catch (err) {
            console.error('删除尺码类型失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  addSize: async function() {
    const name = this.data.newSizeName.trim();
    if (!name) {
      wx.showToast({ title: '请输入尺码名称', icon: 'none' });
      return;
    }

    const exists = this.data.sizeOptions.find(s => s.name === name);
    if (exists) {
      wx.showToast({ title: '该尺码已存在', icon: 'none' });
      return;
    }

    try {
      const res = await api.post(`/sizes/categories/${this.data.currentSizeCategoryId}/sizes`, { name });
      wx.showToast({ title: '添加成功', icon: 'success' });

      const newSize = {
        id: res.size.id,
        name: res.size.name,
        selected: false
      };
      this.setData({
        sizeOptions: [...this.data.sizeOptions, newSize],
        newSizeName: ''
      });

      const categoryIndex = this.data.sizeCategoryList.findIndex(c => c.id === this.data.currentSizeCategoryId);
      if (categoryIndex !== -1) {
        const category = this.data.sizeCategoryList[categoryIndex];
        category.sizes = [...(category.sizes || []), res.size];
        const sizeCategoryList = [...this.data.sizeCategoryList];
        sizeCategoryList[categoryIndex] = category;
        this.setData({ sizeCategoryList });
      }
    } catch (err) {
      console.error('创建尺码失败:', err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    }
  },

  deleteSize: async function(e) {
    const sizeId = e.currentTarget.dataset.id;
    const sizeName = e.currentTarget.dataset.name;

    wx.showModal({
      title: '确认删除',
      content: `确定要删除尺码"${sizeName}"吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.delete(`/sizes/sizes/${sizeId}`);
            wx.showToast({ title: '删除成功', icon: 'success' });

            const sizeOptions = this.data.sizeOptions.filter(s => s.id !== sizeId);
            this.setData({ sizeOptions });

            const categoryIndex = this.data.sizeCategoryList.findIndex(c => c.id === this.data.currentSizeCategoryId);
            if (categoryIndex !== -1) {
              const category = this.data.sizeCategoryList[categoryIndex];
              category.sizes = (category.sizes || []).filter(s => s.id !== sizeId);
              const sizeCategoryList = [...this.data.sizeCategoryList];
              sizeCategoryList[categoryIndex] = category;
              this.setData({ sizeCategoryList });
            }
          } catch (err) {
            console.error('删除尺码失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  toggleSize(e) {
    const index = e.currentTarget.dataset.index;
    const key = `sizeOptions[${index}].selected`;
    this.setData({ [key]: !this.data.sizeOptions[index].selected }, () => {
      this.generateSkuMatrix();
    });
  },

  addColor() {
    let val = this.data.colorInput.trim();
    if (!val) {
      val = '图片色';
    }

    if (!this.data.colors.includes(val)) {
      this.setData({
        colors: [...this.data.colors, val],
        colorInput: ''
      }, () => {
        this.generateSkuMatrix();
      });
    } else {
      this.setData({ colorInput: '' });
    }
  },

  removeColor(e) {
    const index = e.currentTarget.dataset.index;
    let colors = this.data.colors;
    colors.splice(index, 1);
    this.setData({ colors }, () => {
      this.generateSkuMatrix();
    });
  },

  generateSkuMatrix() {
    let activeSizes = this.data.sizeOptions.filter(s => s.selected).map(s => s.name);
    let activeColors = this.data.colors;
    if (activeSizes.length === 0 && activeColors.length === 0) {
      this.setData({ skuList: [] });
      return;
    }
    let sizes = activeSizes.length > 0 ? activeSizes : ['默认尺码'];
    let colors = activeColors.length > 0 ? activeColors : ['图片色'];
    let newSkuList = [];
    let oldSkuList = this.data.skuList;

    colors.forEach(c => {
      sizes.forEach(s => {
        let existItem = oldSkuList.find(old => old.color === c && old.size === s);
        newSkuList.push({
          skuId: existItem ? existItem.skuId : null,
          sizeId: existItem ? existItem.sizeId : null,
          color: c,
          size: s,
          price: existItem ? existItem.price : '',
          stock: existItem ? existItem.stock : '',
          image: existItem ? (existItem.image || '') : ''
        });
      });
    });

    this.setData({ skuList: newSkuList });
    this._afterBundleSkuChange();
  },

  applyBatch() {
    const { skuList, colors, sizeOptions } = this.data;
    const selectedSizes = sizeOptions.filter(s => s.selected).map(s => s.name);

    this.setData({
      batchPrice: '',
      batchStock: '',
      batchImage: '',
      batchSelectedColors: colors.map(c => ({ name: c, selected: false })),
      batchSelectedSizes: selectedSizes.map(s => ({ name: s, selected: false })),
      showBatchModal: true
    });
  },

  toggleBatchColor(e) {
    const index = e.currentTarget.dataset.index;
    const key = `batchSelectedColors[${index}].selected`;
    this.setData({ [key]: !this.data.batchSelectedColors[index].selected });
  },

  toggleBatchSize(e) {
    const index = e.currentTarget.dataset.index;
    const key = `batchSelectedSizes[${index}].selected`;
    this.setData({ [key]: !this.data.batchSelectedSizes[index].selected });
  },

  toggleSelectAllColors() {
    const allSelected = this.data.batchSelectedColors.every(c => c.selected);
    const updatedColors = this.data.batchSelectedColors.map(c => ({
      ...c,
      selected: !allSelected
    }));
    this.setData({ batchSelectedColors: updatedColors });
  },

  toggleSelectAllSizes() {
    const allSelected = this.data.batchSelectedSizes.every(s => s.selected);
    const updatedSizes = this.data.batchSelectedSizes.map(s => ({
      ...s,
      selected: !allSelected
    }));
    this.setData({ batchSelectedSizes: updatedSizes });
  },

  closeBatchModal() {
    this.setData({ showBatchModal: false });
  },

  confirmBatch() {
    const { batchPrice, batchStock, batchImage, batchSelectedColors, batchSelectedSizes, skuList } = this.data;

    if (!batchPrice && !batchStock && !batchImage) {
      return wx.showToast({ title: '请输入值', icon: 'none' });
    }

    const selectedColors = batchSelectedColors.filter(c => c.selected).map(c => c.name);
    const selectedSizes = batchSelectedSizes.filter(s => s.selected).map(s => s.name);

    if (selectedColors.length === 0 && selectedSizes.length === 0) {
      return wx.showToast({ title: '请选择要批量设置的 SKU', icon: 'none' });
    }

    let newList = skuList.map(item => {
      const colorMatch = selectedColors.length === 0 || selectedColors.includes(item.color);
      const sizeMatch = selectedSizes.length === 0 || selectedSizes.includes(item.size);

      if (colorMatch && sizeMatch) {
        return {
          ...item,
          price: batchPrice || item.price,
          stock: batchStock || item.stock,
          image: batchImage || item.image
        };
      }
      return item;
    });

    this.setData({ skuList: newList, showBatchModal: false });
    wx.showToast({ title: '批量设置成功', icon: 'success' });
  },

  onSkuInput(e) {
    const { index, field } = e.currentTarget.dataset;
    const key = `skuList[${index}].${field}`;
    this.setData({ [key]: e.detail.value });
  },




  uploadSkuImage(e) {
    const index = e.currentTarget.dataset.index;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        // 直接保存临时文件路径，等提交时再统一上传
        const key = `skuList[${index}].image`;
        this.setData({ [key]: tempFilePath });
      },
      fail: (err) => {
        console.error('选择图片失败:', err);
      }
    });
  },

  removeSkuImage(e) {
    const index = e.currentTarget.dataset.index;
    const key = `skuList[${index}].image`;
    this.setData({ [key]: '' });
  },

  chooseBatchImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        // 直接保存临时文件路径，等提交时再统一上传
        this.setData({ batchImage: tempFilePath });
      },
      fail: (err) => {
        console.error('选择图片失败:', err);
      }
    });
  },

  chooseQuickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        // 直接保存临时文件路径，等提交时再统一上传
        this.setData({ quickImage: tempFilePath });
      },
      fail: (err) => {
        console.error('选择图片失败:', err);
      }
    });
  },

  applyQuickFillAll() {
    const { quickPrice, quickStock, quickImage, skuList } = this.data;

    if (!quickPrice && !quickStock && !quickImage) {
      return wx.showToast({ title: '请输入价格、库存或选择图片', icon: 'none' });
    }

    const newList = skuList.map(item => ({
      ...item,
      price: quickPrice || item.price,
      stock: quickStock !== '' ? quickStock : item.stock,
      image: quickImage || item.image
    }));

    this.setData({ skuList: newList });
    wx.showToast({ title: '一键填充成功', icon: 'success' });
  },

  removeSku(e) {
    const index = e.currentTarget.dataset.index;
    const skuList = this.data.skuList;
    skuList.splice(index, 1);
    this.setData({ skuList });
  },

  // ================= 提交商品 =================
  submitProduct: async function() {
    const { sessionId, mediaList, title, selectedStalls, selectedTags, skuList, currentSizeCategoryId } = this.data;

    if (mediaList.length === 0 || !title || skuList.length === 0) {
      return wx.showToast({ title: '首图/名称/尺码颜色不能为空', icon: 'none' });
    }

    let prices = skuList.map(item => Number(item.price)).filter(p => !isNaN(p) && p > 0);
    if (prices.length === 0) {
      return wx.showToast({ title: '请填写正确的 SKU 价格', icon: 'none' });
    }
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    let displayPrice = (minPrice === maxPrice) ? String(minPrice) : `${minPrice} - ${maxPrice}`;

    wx.showLoading({ title: '上传中...', mask: true });

    try {
      // 1. 上传商品主图
      const uploadedMediaUrls = await this.uploadMediaList(mediaList);

      // 2. 上传所有 SKU 图片（先收集需要上传的图片）
      wx.showLoading({ title: '上传 SKU 图片...', mask: true });
      const skuImageMap = await this.uploadSkuImages(skuList);

      // 3. 构建 SKU 数据（使用已上传的 URL）
      const skus = skuList.map((sku, index) => {
        const stockStr = sku.stock ? String(sku.stock).trim() : '';
        const isUnlimited = stockStr === '';
        const stockNum = isUnlimited ? 0 : (Number(stockStr) || 0);
        if (!isUnlimited && stockNum > 999999999) {
          wx.showToast({ title: '库存不能超过999999999', icon: 'none' });
          throw new Error('库存超出范围');
        }
        return {
          spec: sku.color || '默认',
          size: sku.size || '均码',
          barcode: '',
          retailPrice: Number(sku.price),
          stockMain: stockNum,
          isUnlimitedStock: isUnlimited,
          imageUrl: skuImageMap[index] || null,
          sizeId: sku.sizeId || null
        };
      });

      const productData = {
        name: title,
        coverUrl: uploadedMediaUrls[0],
        bannerImages: uploadedMediaUrls.slice(1),
        stallIds: selectedStalls.map(s => s.id),
        relateTagIds: selectedTags.map(t => t.id),
        status: 'on',
        retailPrice: minPrice,
        displayPrice: displayPrice,
        sizeCategoryId: currentSizeCategoryId || null,
        skus: skus,
        bundleGroups: null
      };

      if (this.data.isBundleMode && this.data.bundleGroups.length > 0) {
        this.saveActiveGroupState();
        productData.bundleGroups = this.data.bundleGroups.map(function(bg, gi) {
          return { name: bg.name || ('子项' + (gi + 1)), sortOrder: gi, skus: (bg.skuList || []).filter(function(s) { return !s._toBeRemoved; }).map(function(sku) { var s = String(sku.stock || '').trim(); return { spec: sku.color || '默认', size: sku.size || '均码', barcode: '', retailPrice: Number(sku.price) || 0, stockMain: s === '' ? 0 : (Number(s) || 0), isUnlimitedStock: s === '', sizeId: sku.sizeId || null }; }) };
        });
        productData.skus = [];
      }

      console.log('提交商品数据:', JSON.stringify(productData));

      const { editMode, productId } = this.data;

      if (editMode && productId) {
        // 编辑模式：更新已有商品
        wx.showLoading({ title: '更新商品...', mask: true });
        await api.put('/live-products/' + productId, productData);
        wx.hideLoading();
        wx.showToast({ title: '更新成功!', icon: 'success' });
      } else {
        // 创建模式：新增直播商品
        wx.showLoading({ title: '创建商品...', mask: true });
        await api.post('/live-products?sessionId=' + sessionId, productData);
        wx.hideLoading();
        wx.showToast({ title: '上架成功!', icon: 'success' });
      }

      // 成功后清除草稿并关闭退出确认
      this.clearDraft();
      wx.disableAlertBeforeUnload();

      setTimeout(() => {
        wx.navigateBack();
      }, 1500);

    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '创建失败',
        content: typeof err === 'object' ? JSON.stringify(err) : String(err),
        showCancel: false
      });
    }
  },

  uploadMediaList: async function(mediaList) {
    const uploadedUrls = [];
    for (const media of mediaList) {
      if (media.url && this.isTemporaryPath(media.url)) {
        const url = await this.uploadFile(media.url, 'image/jpeg');
        uploadedUrls.push(url);
      } else {
        uploadedUrls.push(media.url);
      }
    }
    return uploadedUrls;
  },

  uploadImageList: async function(imageList) {
    const uploadedUrls = [];
    for (const imagePath of imageList) {
      if (imagePath && this.isTemporaryPath(imagePath)) {
        const url = await this.uploadFile(imagePath, 'image/jpeg');
        uploadedUrls.push(url);
      } else {
        uploadedUrls.push(imagePath);
      }
    }
    return uploadedUrls;
  },

  // 上传所有 SKU 图片，返回按索引对应的 URL 数组（没有图片的 SKU 对应 null）
  uploadSkuImages: async function(skuList) {
    const uploadedUrls = [];
    for (const sku of skuList) {
      if (sku.image && this.isTemporaryPath(sku.image)) {
        // 需要上传的临时图片
        const url = await this.uploadFile(sku.image, 'image/jpeg');
        uploadedUrls.push(url);
      } else {
        // 已经是正式 URL 或没有图片
        uploadedUrls.push(sku.image || null);
      }
    }
    return uploadedUrls;
  },

  // 判断是否是临时文件路径
  isTemporaryPath: function(path) {
    if (!path) return false;
    // 微信临时文件路径特征
    if (path.startsWith('wx://')) return true;
    if (path.includes('__tmp__')) return true;
    if (path.includes('/_tmp/')) return true;
    // http://tmp/ 格式的临时文件
    if (path.startsWith('http://tmp/')) return true;
    if (path.startsWith('https://tmp/')) return true;
    // 本地文件路径（不以 http 或 https 开头）
    if (!path.startsWith('http://') && !path.startsWith('https://')) return true;
    // 检查是否是 127.0.0.1 或 localhost 的临时文件服务
    if (path.includes('127.0.0.1') && path.includes('__tmp__')) return true;
    if (path.includes('localhost') && path.includes('__tmp__')) return true;
    return false;
  },

  goBack: function() {
    wx.navigateBack();
  },

  // ================= 套装子项管理 =================

  toggleBundleMode() {
    var isBundle = !this.data.isBundleMode;
    if (isBundle) {
      this.setData({ isBundleMode: true, bundleGroups: [], activeGroupIndex: 0 });
      this.addBundleGroup();
    } else {
      if (this.data.activeGroupIndex >= 0) this.saveActiveGroupState();
      this.setData({ isBundleMode: false, bundleGroups: [], activeGroupIndex: -1, colors: [], skuList: [] });
    }
  },

  saveActiveGroupState() {
    var idx = this.data.activeGroupIndex;
    if (idx < 0 || idx >= this.data.bundleGroups.length) return;
    var groups = this.data.bundleGroups;
    groups[idx] = Object.assign({}, groups[idx], {
      colors: this.data.colors.slice(),
      sizeOptions: this.data.sizeOptions.map(function(s) { return { id: s.id, name: s.name, selected: s.selected }; }),
      skuList: this.data.skuList.slice()
    });
    this.setData({ bundleGroups: groups });
  },

  loadGroupState(idx) {
    var group = this.data.bundleGroups[idx];
    if (!group) return;
    this.setData({ activeGroupIndex: idx, colors: group.colors || [], sizeOptions: group.sizeOptions || [], skuList: group.skuList || [], colorInput: '' });
  },

  selectBundleGroup(e) { this.saveActiveGroupState(); this.loadGroupState(e.currentTarget.dataset.index); },

  addBundleGroup() {
    var groups = this.data.bundleGroups.slice();
    groups.push({ name: '', colors: [], sizeOptions: [], skuList: [] });
    var newIdx = groups.length - 1;
    this.setData({ bundleGroups: groups });
    this.loadGroupState(newIdx);
    wx.showToast({ title: '已添加子项 ' + (newIdx + 1), icon: 'none' });
  },

  removeBundleGroup(e) {
    var idx = e.currentTarget.dataset.index;
    var groups = this.data.bundleGroups.slice();
    groups.splice(idx, 1);
    var newIdx = groups.length > 0 ? Math.min(idx, groups.length - 1) : -1;
    this.setData({ bundleGroups: groups, activeGroupIndex: newIdx });
    if (newIdx >= 0) { this.loadGroupState(newIdx); } else { this.setData({ colors: [], skuList: [], sizeOptions: [] }); }
  },

  onBundleGroupNameInput(e) {
    var idx = this.data.activeGroupIndex;
    if (idx < 0) return;
    var groups = this.data.bundleGroups;
    groups[idx] = Object.assign({}, groups[idx], { name: e.detail.value });
    this.setData({ bundleGroups: groups });
  },

  _afterBundleSkuChange() {
    if (this.data.isBundleMode && this.data.activeGroupIndex >= 0) this.saveActiveGroupState();
  },

  // ================= 草稿功能 =================

  getDraftKey() {
    var data = this.data;
    if (data.editMode && data.productId) return 'publish_edit_' + data.productId;
    return 'publish_create_' + (data.sessionId || '0');
  },

  collectDraftData() {
    var data = this.data;
    return {
      title: data.title,
      mediaList: data.mediaList,
      selectedStalls: data.selectedStalls,
      selectedTags: data.selectedTags,
      currentSizeCategoryId: data.currentSizeCategoryId,
      currentSizeCategoryName: data.currentSizeCategoryName,
      sizeOptions: data.sizeOptions,
      colors: data.colors,
      skuList: data.skuList.map(function(sku) {
        return { skuId: sku.skuId, sizeId: sku.sizeId, color: sku.color, size: sku.size, price: sku.price, stock: sku.stock, image: sku.image || '', _toBeRemoved: sku._toBeRemoved };
      }),
      displayPrice: data.displayPrice,
      isBundleMode: data.isBundleMode,
      activeGroupIndex: data.activeGroupIndex,
      bundleGroups: data.bundleGroups.map(function(bg) {
        return {
          name: bg.name, colors: bg.colors, sizeOptions: bg.sizeOptions,
          skuList: (bg.skuList || []).map(function(sku) {
            return { skuId: sku.skuId, sizeId: sku.sizeId, color: sku.color, size: sku.size, price: sku.price, stock: sku.stock, image: sku.image || '', _toBeRemoved: sku._toBeRemoved };
          })
        };
      })
    };
  },

  saveDraft() {
    var key = this.getDraftKey();
    cleanupDraftFiles(key);
    var draftData = this.collectDraftData();
    var mediaLists = {
      mediaList: draftData.mediaList,
      skuImages: draftData.skuList.map(function(s) { return s.image; })
    };
    if (draftData.isBundleMode && draftData.bundleGroups) {
      for (var gi = 0; gi < draftData.bundleGroups.length; gi++) {
        mediaLists['bg_sku_' + gi] = (draftData.bundleGroups[gi].skuList || []).map(function(s) { return s.image; });
      }
    }
    var persisted = persistMediaFiles(key, mediaLists);
    draftData.mediaList = persisted.mediaList;
    var skuImages = persisted.skuImages || [];
    draftData.skuList = draftData.skuList.map(function(sku, i) { sku.image = skuImages[i] || ''; return sku; });
    if (draftData.isBundleMode && draftData.bundleGroups) {
      for (var gi2 = 0; gi2 < draftData.bundleGroups.length; gi2++) {
        var bgImgs = persisted['bg_sku_' + gi2] || [];
        draftData.bundleGroups[gi2].skuList = draftData.bundleGroups[gi2].skuList.map(function(sku, i) { sku.image = bgImgs[i] || ''; return sku; });
      }
    }
    var ok = saveDraft(key, draftData);
    if (ok) { wx.showToast({ title: '草稿已保存', icon: 'success' }); }
    else { wx.showToast({ title: '保存失败', icon: 'none' }); }
  },

  clearDraft() {
    var key = this.getDraftKey();
    removeDraft(key);
    cleanupDraftFiles(key);
  },

  checkDraft() {
    var self = this;
    var key = this.getDraftKey();
    if (!hasDraft(key)) return;

    var draft = loadDraft(key);
    var savedAt = draft._savedAt ? new Date(draft._savedAt).toLocaleString() : '未知时间';

    wx.showModal({
      title: '发现草稿',
      content: '上次编辑时间：' + savedAt + '\n\n是否恢复草稿内容？',
      confirmText: '恢复',
      cancelText: '忽略',
      success: function(res) {
        if (res.confirm) {
          self.restoreDraft(draft);
        } else {
          removeDraft(key);
          cleanupDraftFiles(key);
        }
        self.enableExitConfirm();
      }
    });
  },

  restoreDraft(draft) {
    var data = this.data;
    var mediaLists = {
      mediaList: draft.mediaList || [],
      skuImages: (draft.skuList || []).map(function(s) { return s.image || ''; })
    };
    if (draft.isBundleMode && draft.bundleGroups) {
      for (var gi = 0; gi < draft.bundleGroups.length; gi++) {
        mediaLists['bg_sku_' + gi] = (draft.bundleGroups[gi].skuList || []).map(function(s) { return s.image || ''; });
      }
    }
    var validated = validatePersistedUrls(mediaLists);
    var skuImages = validated.skuImages || [];

    var restored = {
      title: draft.title || '',
      mediaList: validated.mediaList,
      selectedStalls: draft.selectedStalls || [],
      selectedTags: draft.selectedTags || [],
      currentSizeCategoryId: draft.currentSizeCategoryId || data.currentSizeCategoryId,
      currentSizeCategoryName: draft.currentSizeCategoryName || data.currentSizeCategoryName,
      sizeOptions: draft.sizeOptions || data.sizeOptions,
      colors: draft.colors || [],
      skuList: (draft.skuList || []).map(function(sku, i) { sku.image = skuImages[i] || ''; return sku; }),
      displayPrice: draft.displayPrice || '',
      isBundleMode: draft.isBundleMode || false,
      activeGroupIndex: draft.activeGroupIndex != null ? draft.activeGroupIndex : -1
    };
    if (draft.isBundleMode && draft.bundleGroups) {
      restored.bundleGroups = draft.bundleGroups.map(function(bg, gi) {
        var bgImgs = validated['bg_sku_' + gi] || [];
        return { name: bg.name, colors: bg.colors || [], sizeOptions: bg.sizeOptions || [], skuList: (bg.skuList || []).map(function(sku, i) { sku.image = bgImgs[i] || ''; return sku; }) };
      });
      if (restored.activeGroupIndex >= 0 && restored.activeGroupIndex < restored.bundleGroups.length) {
        var ag = restored.bundleGroups[restored.activeGroupIndex];
        restored.colors = ag.colors || [];
        restored.skuList = ag.skuList || [];
      }
    }

    this.setData(restored);
    this.refreshGrid(restored.mediaList);

    var hasImages = restored.mediaList.some(function(m) { return m.url; });
    if (!hasImages) {
      wx.showToast({ title: '草稿已恢复，请重新选择图片', icon: 'none', duration: 2000 });
    } else {
      wx.showToast({ title: '草稿已恢复', icon: 'success', duration: 1500 });
    }
  },

  hasFormContent() {
    var d = this.data;
    return !!(d.title || (d.mediaList && d.mediaList.length > 0) ||
      (d.skuList && d.skuList.length > 0) ||
      (d.selectedStalls && d.selectedStalls.length > 0) ||
      (d.selectedTags && d.selectedTags.length > 0) ||
      (d.colors && d.colors.length > 0) ||
      (d.isBundleMode && d.bundleGroups && d.bundleGroups.length > 0));
  },

  enableExitConfirm() {
    if (this._alertEnabled) return;
    this._alertEnabled = true;
    wx.enableAlertBeforeUnload({
      message: '表单内容未保存，确定离开吗？'
    });
  },
});
