// miniprogram/pages/liveRoomPublish/publish.js
const api = require('../../utils/api');
const config = require('../../utils/config');

// 拖拽网格配置
const ITEM_SIZE = 105;
const COLUMNS = 3;

Page({
  data: {
    sessionId: null,
    videoUrl: '',
    mediaList: [],
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
    batchSelectedSizes: []
  },

  onLoad(options) {
    if (options.sessionId) {
      this.setData({ sessionId: options.sessionId });
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }

    this.loadRecentStallsAndTags();
    this.loadSizeCategories();
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
    let rows = Math.ceil((btnIndex + 1) / COLUMNS);

    this.setData({
      mediaList: positionedList,
      uploadBtnX: btnX,
      uploadBtnY: btnY,
      dragAreaHeight: rows * ITEM_SIZE
    });
  },

  chooseMedia() {
    wx.chooseMedia({
      count: 9 - this.data.mediaList.length,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
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

  // ================= 通用文件上传 =================
  uploadFile: function(filePath, contentType) {
    console.log('开始上传文件:', filePath, '类型:', contentType);
    const token = wx.getStorageSync('accessToken') || '';
    return new Promise((resolve, reject) => {
      const fileType = filePath.toLowerCase().endsWith('.mp4') ? 'video' : 'image';

      wx.uploadFile({
        url: config.API_BASE_URL + '/admin/files/upload',
        filePath: filePath,
        name: 'file',
        fileType: fileType,
        formData: {
          dir: 'products'
        },
        header: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Idempotency-Key': 'upload_' + Date.now()
        },
        success: (res) => {
          console.log('上传成功响应:', res);
          console.log('statusCode:', res.statusCode);
          try {
            const data = JSON.parse(res.data);
            console.log('解析后的响应:', data);
            console.log('返回的 url:', data.url);
            console.log('返回的 fileUrl:', data.fileUrl);
            console.log('返回的 filePath:', data.filePath);

            // 优先使用正式 URL 字段，临时路径说明后端未正确处理
            const finalUrl = data.fileUrl || data.filePath || data.url;

            // 如果返回的是 __tmp__ 临时路径，说明是开发工具环境，正式环境会返回正式 URL
            if (finalUrl && finalUrl.includes('__tmp__')) {
              console.warn('警告：返回的是临时文件路径，这仅在开发工具中出现');
            }

            resolve(finalUrl);
          } catch (e) {
            console.error('解析响应失败:', e, '原始数据:', res.data);
            reject(e);
          }
        },
        fail: (err) => {
          console.error('上传失败:', err);
          reject(err);
        }
      });
    });
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
      stock: quickStock || item.stock,
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
      const skus = skuList.map((sku, index) => ({
        spec: sku.color || '默认',
        size: sku.size || '均码',
        barcode: '',
        retailPrice: Number(sku.price),
        stockMain: Number(sku.stock) || 0,
        imageUrl: skuImageMap[index] || null,
        sizeId: sku.sizeId || null
      }));

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
        skus: skus
      };

      console.log('提交商品数据:', JSON.stringify(productData));

      wx.showLoading({ title: '创建商品...', mask: true });
      // 调用直播商品上架接口
      await api.post('/live-products?sessionId=' + sessionId, productData);
      wx.hideLoading();
      wx.showToast({ title: '上架成功!', icon: 'success' });

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
  }
});
