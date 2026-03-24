// miniprogram/pages/admin/admin.js
const api = require('../../utils/api');

// 拖拽网格配置
const ITEM_SIZE = 105;
const COLUMNS = 3;

Page({
  data: {
    videoUrl: '',
    mediaList: [],
    dragIndex: -1,
    dragAreaHeight: ITEM_SIZE,
    uploadBtnX: 0,
    uploadBtnY: 0,
    tempMoveX: 0,
    tempMoveY: 0,

    shippingInfo: '付款后按排单顺序发货',
    description: '',
    fabricCare: '',
    sizeChartTip: '',
    warmTips: '',

    title: '',
    selectedStalls: [],
    selectedTags: [],
    stallSearchKeyword: '',
    tagSearchKeyword: '',
    stallSearchResults: [],
    tagSearchResults: [],
    showStallSearch: false,
    showTagSearch: false,
    showStallCreate: false,
    showTagCreate: false,
    // 历史档口和标签
    recentStalls: [],
    recentTags: [],
    historyTags: ['春装新款', '半身裙', '外套', '内搭'],

    sizeOptions: [
      { name: '均码', selected: false }, { name: 'XS', selected: false },
      { name: 'S', selected: false }, { name: 'M', selected: false },
      { name: 'L', selected: false }, { name: 'XL', selected: false }, { name: 'XXL', selected: false }
    ],
    colors: [],
    colorInput: '',
    skuList: [],
    batchPrice: '',
    batchStock: '',

    lookbookImgs: [],
    detailImgs: [],

    manualRelated: [],
    showRelatedModal: false,
    searchKeyword: '',
    allProducts: [],
    filteredProducts: []
  },

  onLoad(options) {
    let history = wx.getStorageSync('historyTags');
    if (history) this.setData({ historyTags: history });
    this.refreshGrid();
    // 加载历史档口和标签
    this.loadRecentStallsAndTags();

    // 如果是编辑模式，加载商品详情
    if (options && options.editId) {
      this.setData({ editId: options.editId });
      this.loadProductForEdit(options.editId);
    }
  },

  // 加载历史档口和标签
  loadRecentStallsAndTags: async function() {
    try {
      // 并行加载
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

  // 加载商品详情用于编辑
  loadProductForEdit: async function(productId) {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await api.get(`/products/${productId}`);
      console.log('商品详情响应:', res);

      // 后端返回格式：{ product: {...}, skus: [{id, spec, size, ...}] }
      const product = res.product || res;
      const skusFromApi = res.skus || [];

      // 从 skus 数组中提取 SKU 数据，保留 skuId
      // 注意：历史数据的 spec 字段可能包含组合值（如 "蓝色/S"），需要直接使用
      const skuMatrix = skusFromApi.map(sku => ({
        skuId: sku.id,
        color: sku.spec || '默认',
        size: sku.size || '均码',
        price: sku.retailPrice,
        stock: sku.stockMain
      }));

      console.log('商品详情:', product);
      console.log('SKU Matrix:', skuMatrix);

      // 填充基本信息
      const formData = {
        title: product.name || '',
        videoUrl: product.videoUrl || '',
        shippingInfo: product.shippingInfo || '',
        description: product.description || '',
        fabricCare: product.fabricCare || '',
        sizeChartTip: product.sizeChartTip || '',
        warmTips: product.warmTips || '',
        selectedStalls: [],
        selectedTags: [],
        lookbookImgs: product.lookbookImages || [],
        detailImgs: product.detailImages || [],
        manualRelated: []
      };

      // 加载档口和标签的完整信息
      const stallIds = product.stallIds || [];
      const relateTagIds = product.relateTagIds || [];

      if (stallIds.length > 0) {
        const stallsRes = await api.get('/stalls');
        formData.selectedStalls = stallsRes
          .filter(s => stallIds.includes(s.id))
          .map(s => ({ id: s.id, name: s.name }));
      }

      if (relateTagIds.length > 0) {
        const tagsRes = await api.get('/tags');
        formData.selectedTags = tagsRes
          .filter(t => relateTagIds.includes(t.id))
          .map(t => ({ id: t.id, name: t.name }));
      }

      // 加载关联商品的完整信息
      const relatedIds = product.relatedProductIds || [];
      if (relatedIds.length > 0) {
        const relatedProducts = await Promise.all(
          relatedIds.map(id => api.get(`/products/${id}`).catch(err => null))
        );
        formData.manualRelated = relatedProducts
          .filter(r => r !== null && r.product)
          .map(r => ({
            id: r.product.id,
            name: r.product.name,
            coverUrl: r.product.coverUrl,
            retailPrice: r.product.retailPrice,
            displayPrice: r.product.displayPrice
          }));
      }
      console.log('关联商品:', formData.manualRelated);

      // 处理封面图和轮播图
      let mediaList = [];
      if (product.coverUrl) {
        mediaList.push({
          id: 'cover_' + Date.now(),
          url: product.coverUrl,
          x: 0, y: 0
        });
      }
      if (product.bannerImages && product.bannerImages.length > 0) {
        product.bannerImages.forEach((url, index) => {
          mediaList.push({
            id: 'banner_' + index + '_' + Date.now(),
            url: url,
            x: 0, y: 0
          });
        });
      }

      // 处理尺码和颜色
      let sizeOptions = this.data.sizeOptions.map(s => ({ ...s, selected: false }));
      let colors = [];
      let skuList = [];

      if (skuMatrix && skuMatrix.length > 0) {
        // 从 SKU 矩阵中提取尺码和颜色
        const sizes = [...new Set(skuMatrix.map(s => s.size))];
        const colors_set = [...new Set(skuMatrix.map(s => s.color))];

        // 设置选中的尺码
        sizeOptions = sizeOptions.map(s => ({
          ...s,
          selected: sizes.includes(s.name)
        }));

        // 设置颜色（过滤掉"默认颜色"）
        colors = colors_set.filter(c => c && c !== '默认颜色');

        // 填充 SKU 列表（保留 skuId 用于更新）
        skuList = skuMatrix.map(sku => ({
          skuId: sku.skuId || null,
          color: sku.color,
          size: sku.size,
          price: String(sku.price),
          stock: String(sku.stock)
        }));
      }

      this.setData({
        ...formData,
        mediaList: mediaList,
        sizeOptions: sizeOptions,
        colors: colors,
        skuList: skuList,
        colorInput: '',
        tagInput: ''
      });

      this.refreshGrid(mediaList);
      wx.hideLoading();
    } catch (err) {
      console.error('加载商品失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
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

  // ================= 视频上传 =================
  uploadVideo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        console.log('视频选择成功，临时路径:', tempFilePath);
        console.log('视频信息:', JSON.stringify(res.tempFiles[0]));
        wx.showLoading({ title: '上传视频中...' });

        this.uploadFile(tempFilePath, 'video/mp4')
          .then(url => {
            console.log('视频上传成功，URL:', url);
            wx.hideLoading();
            wx.showToast({ title: '视频上传成功', icon: 'success' });
            this.setData({ videoUrl: url });
          })
          .catch(err => {
            console.error('视频上传失败:', err);
            wx.hideLoading();
            wx.showModal({ title: '上传失败', content: err.errMsg || JSON.stringify(err), showCancel: false });
          });
      },
      fail: (err) => {
        console.error('选择视频失败:', err);
        wx.showToast({ title: '选择失败', icon: 'none' });
      }
    });
  },

  removeVideo() {
    this.setData({ videoUrl: '' });
  },

  // ================= 通用文件上传 =================
  uploadFile: function(filePath, contentType) {
    console.log('开始上传文件:', filePath, '类型:', contentType);
    const token = wx.getStorageSync('accessToken') || '';
    return new Promise((resolve, reject) => {
      // 根据文件路径判断文件类型
      const fileType = filePath.toLowerCase().endsWith('.mp4') ? 'video' : 'image';

      wx.uploadFile({
        url: 'http://localhost:8080/api/v1/admin/files/upload',
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
          try {
            const data = JSON.parse(res.data);
            console.log('解析后的响应:', data);
            resolve(data.url);
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

  // ================= 选填图上传 =================
  chooseExtraImage(e) {
    const type = e.currentTarget.dataset.type;
    let currentList = this.data[`${type}Imgs`];
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      success: (res) => {
        const newPaths = res.tempFiles.map(file => file.tempFilePath);
        this.setData({ [`${type}Imgs`]: currentList.concat(newPaths) });
      }
    });
  },

  removeExtraImage(e) {
    const { type, index } = e.currentTarget.dataset;
    let list = this.data[`${type}Imgs`];
    list.splice(index, 1);
    this.setData({ [`${type}Imgs`]: list });
  },

  // ================= 分类、尺码、颜色、SKU =================
  removeTag(e) {
    let id = e.currentTarget.dataset.id;
    this.setData({ selectedTags: this.data.selectedTags.filter(t => t.id !== id) });
  },

  // ================= 选择历史档口 =================
  selectRecentStall(e) {
    const item = e.currentTarget.dataset.item;
    const exists = this.data.selectedStalls.find(s => s.id === item.id);
    if (!exists) {
      this.setData({
        selectedStalls: [...this.data.selectedStalls, item]
      });
    }
  },

  // ================= 选择历史标签 =================
  selectRecentTag(e) {
    const item = e.currentTarget.dataset.item;
    const exists = this.data.selectedTags.find(t => t.id === item.id);
    if (!exists) {
      this.setData({
        selectedTags: [...this.data.selectedTags, item]
      });
    }
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
      // 过滤掉已选择的档口
      const selectedIds = this.data.selectedStalls.map(s => s.id);
      const filtered = res.filter(s => !selectedIds.includes(s.id));
      this.setData({
        showStallSearch: true,
        stallSearchResults: filtered,
        showStallCreate: filtered.length === 0 && keyword.trim()
      });
    } catch (err) {
      console.error('搜索档口失败:', err);
      this.setData({ showStallCreate: false });
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
      // 过滤掉已选择的标签
      const selectedIds = this.data.selectedTags.map(t => t.id);
      const filtered = res.filter(t => !selectedIds.includes(t.id));
      this.setData({
        showTagSearch: true,
        tagSearchResults: filtered,
        showTagCreate: filtered.length === 0 && keyword.trim()
      });
    } catch (err) {
      console.error('搜索标签失败:', err);
      this.setData({ showTagCreate: false });
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

  // ================= 新增档口/标签 =================
  createStall: async function() {
    const name = this.data.stallSearchKeyword.trim();
    if (!name) return;

    wx.showLoading({ title: '创建中...' });
    try {
      const res = await api.post('/stalls', { name });
      wx.hideLoading();
      wx.showToast({ title: '添加成功', icon: 'success' });

      // 添加到已选择列表
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

      // 添加到已选择列表
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

  // ================= SKU 删除 =================
  removeSku(e) {
    const index = e.currentTarget.dataset.index;
    const skuList = this.data.skuList;
    skuList.splice(index, 1);
    this.setData({ skuList });
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
    if (val && !this.data.colors.includes(val)) {
      this.setData({ colors: [...this.data.colors, val], colorInput: '' }, () => {
        this.generateSkuMatrix();
      });
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
    let colors = activeColors.length > 0 ? activeColors : ['默认颜色'];
    let newSkuList = [];
    let oldSkuList = this.data.skuList;

    colors.forEach(c => {
      sizes.forEach(s => {
        // 根据颜色 + 尺码匹配原有的 SKU（使用 spec+size 组合作为匹配键）
        let existItem = oldSkuList.find(old => old.color === c && old.size === s);
        newSkuList.push({
          skuId: existItem ? existItem.skuId : null,  // 保留 skuId，新增组合为 null
          color: c,
          size: s,
          price: existItem ? existItem.price : '',
          stock: existItem ? existItem.stock : ''
        });
      });
    });

    // 关键修复：收集不在新矩阵中但存在于旧列表中的 SKU（有 skuId 的）
    // 这些 SKU 可能已被业务单据（库存流水、采购单）引用，必须保留
    // 将它们添加到 skuList 末尾，标记为 _toBeRemoved，前端会隐藏但提交时后端会将其标记为 disabled
    const newKeys = new Set(newSkuList.map(item => `${item.color}-${item.size}`));
    oldSkuList.forEach(oldItem => {
      const oldKey = `${oldItem.color}-${oldItem.size}`;
      if (!newKeys.has(oldKey) && oldItem.skuId) {
        // 这个 SKU 不在新矩阵中，但有 skuId（可能已被引用），需要保留
        newSkuList.push({
          skuId: oldItem.skuId,
          color: oldItem.color,
          size: oldItem.size,
          price: oldItem.price,
          stock: oldItem.stock,
          _toBeRemoved: true  // 标记：前端隐藏，提交后端时会被标记为 disabled
        });
      }
    });

    this.setData({ skuList: newSkuList });
  },

  applyBatch() {
    const { batchPrice, batchStock, skuList } = this.data;
    if (!batchPrice && !batchStock) {
      return wx.showToast({ title: '请输入值', icon: 'none' });
    }
    let newList = skuList.map(item => ({
      ...item,
      price: batchPrice || item.price,
      stock: batchStock || item.stock
    }));
    this.setData({ skuList: newList });
  },

  onSkuInput(e) {
    const { index, field } = e.currentTarget.dataset;
    const key = `skuList[${index}].${field}`;
    this.setData({ [key]: e.detail.value });
  },

  // ================= 关联商品 =================
  openRelatedModal() {
    wx.showLoading({ title: '加载中...' });
    api.get('/products', { limit: 100, offset: 0 })
      .then(res => {
        wx.hideLoading();
        let selectedIds = this.data.manualRelated.map(item => item.id);
        // 排除当前正在编辑的商品本身
        const editId = this.data.editId ? Number(this.data.editId) : null;

        let validProducts = res.filter(p => p.name && p.coverUrl && (!editId || p.id !== editId));

        let products = validProducts.map(p => ({
          ...p,
          selected: selectedIds.includes(p.id)
        }));
        this.setData({
          allProducts: products,
          filteredProducts: products,
          showRelatedModal: true,
          searchKeyword: ''
        });
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: '获取失败', icon: 'none' });
      });
  },

  closeRelatedModal() {
    this.setData({ showRelatedModal: false });
  },

  onSearchInput(e) {
    const keyword = e.detail.value.trim().toLowerCase();
    this.setData({ searchKeyword: keyword });
    if (!keyword) {
      this.setData({ filteredProducts: this.data.allProducts });
      return;
    }
    let filtered = this.data.allProducts.filter(p =>
      p.name && p.name.toLowerCase().includes(keyword)
    );
    this.setData({ filteredProducts: filtered });
  },

  toggleRelated(e) {
    let item = e.currentTarget.dataset.item;
    let all = this.data.allProducts;
    let filtered = this.data.filteredProducts;

    let indexInAll = all.findIndex(p => p.id === item.id);
    if (indexInAll > -1) {
      all[indexInAll].selected = !all[indexInAll].selected;
    }

    let indexInFiltered = filtered.findIndex(p => p.id === item.id);
    if (indexInFiltered > -1) {
      filtered[indexInFiltered].selected = all[indexInAll].selected;
    }

    this.setData({ allProducts: all, filteredProducts: filtered });
  },

  confirmRelated() {
    let selectedItems = this.data.allProducts.filter(p => p.selected);
    this.setData({ manualRelated: selectedItems, showRelatedModal: false });
  },

  removeRelated(e) {
    let id = e.currentTarget.dataset.id;
    let newList = this.data.manualRelated.filter(item => item.id !== id);
    this.setData({ manualRelated: newList });
  },

  // ================= 提交商品 =================
  submitProduct: async function() {
    const { mediaList, title, selectedStalls, selectedTags, skuList, lookbookImgs, detailImgs, manualRelated,
            videoUrl, shippingInfo, description, fabricCare, sizeChartTip, warmTips, editId } = this.data;

    if (mediaList.length === 0 || !title || skuList.length === 0) {
      return wx.showToast({ title: '首图/名称/尺码颜色不能为空', icon: 'none' });
    }

    // 计算价格范围
    let prices = skuList.map(item => Number(item.price)).filter(p => !isNaN(p) && p > 0);
    if (prices.length === 0) {
      return wx.showToast({ title: '请填写正确的 SKU 价格', icon: 'none' });
    }
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    let displayPrice = (minPrice === maxPrice) ? String(minPrice) : `${minPrice} - ${maxPrice}`;

    wx.showLoading({ title: '上传中...', mask: true });

    try {
      // 1. 上传所有图片
      const uploadedMediaUrls = await this.uploadMediaList(mediaList);
      const uploadedLookbookUrls = await this.uploadImageList(lookbookImgs);
      const uploadedDetailUrls = await this.uploadImageList(detailImgs);

      // 2. 构造后端要求的 SKU 格式（spec 字段存储颜色，size 字段存储尺码）
      // 过滤掉 _toBeRemoved 标记的 SKU，这些是用户已删除的规格，不应该提交给后端
      console.log('提交前 skuList:', JSON.stringify(skuList));
      console.log('editId:', editId);
      const skus = skuList.filter(sku => !sku._toBeRemoved).map(sku => {
        const skuData = {
          spec: sku.color || '默认',
          size: sku.size || '均码',
          barcode: '',
          retailPrice: Number(sku.price),
          stockMain: Number(sku.stock) || 0
        };
        // 编辑模式下，如果有 skuId，需要传递给后端
        if (editId && sku.skuId) {
          skuData.id = sku.skuId;
          console.log(`SKU ${sku.color}-${sku.size} 有 skuId=${sku.skuId}`);
        } else {
          console.log(`SKU ${sku.color}-${sku.size} 没有 skuId (editId=${editId}, sku.skuId=${sku.skuId})`);
        }
        return skuData;
      });
      console.log('构造后的 skus:', JSON.stringify(skus));

      // 3. 构造商品请求数据
      const productData = {
        name: title,
        coverUrl: uploadedMediaUrls[0],
        bannerImages: uploadedMediaUrls.slice(1),
        stallIds: selectedStalls.map(s => s.id),
        relateTagIds: selectedTags.map(t => t.id),
        status: 'on',
        retailPrice: minPrice,
        displayPrice: displayPrice,
        lookbookImages: uploadedLookbookUrls,
        detailImages: uploadedDetailUrls,
        // relatedProductIds 可能是 ID 列表或对象列表，需要正确处理
        relatedProductIds: manualRelated.map(item => typeof item === 'object' ? item.id : item),
        videoUrl: videoUrl || null,
        shippingInfo: shippingInfo || null,
        description: description || null,
        fabricCare: fabricCare || null,
        sizeChartTip: sizeChartTip || null,
        warmTips: warmTips || null,
        skus: skus
      };

      console.log('提交商品数据:', JSON.stringify(productData));

      if (editId) {
        // 编辑模式：调用更新接口
        wx.showLoading({ title: '保存修改...', mask: true });
        await api.put(`/products/${editId}`, productData);
        wx.hideLoading();
        wx.showToast({ title: '修改成功!', icon: 'success' });
      } else {
        // 创建模式：调用创建接口
        wx.showLoading({ title: '创建商品...', mask: true });
        await api.post('/products', productData);
        wx.hideLoading();
        wx.showToast({ title: '上架成功!', icon: 'success' });
      }

      setTimeout(() => {
        wx.navigateBack();
      }, 1500);

    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: editId ? '保存失败' : '创建失败',
        content: typeof err === 'object' ? JSON.stringify(err) : String(err),
        showCancel: false
      });
    }
  },

  uploadMediaList: async function(list) {
    console.log('uploadMediaList 开始上传，列表:', list);
    const urls = [];
    for (const item of list) {
      console.log('处理图片项:', item.url);
      // 微信临时文件路径（如 http://tmp/... 或 http://127.0.0.1:59208/__tmp__/...）需要上传
      // 只有真正的 http(s) 远程 URL 才直接使用
      if (this.isRemoteUrl(item.url)) {
        console.log('使用远程 URL，跳过上传:', item.url);
        urls.push(item.url);
      } else {
        console.log('调用 uploadFile 上传:', item.url);
        const url = await this.uploadFile(item.url, 'image/jpeg');
        console.log('上传后返回 URL:', url);
        urls.push(url);
      }
    }
    console.log('uploadMediaList 完成，返回 URLs:', urls);
    return urls;
  },

  // 判断是否是远程 URL（http:// 或 https:// 开头，且不是微信临时文件路径）
  isRemoteUrl: function(url) {
    console.log('isRemoteUrl 检查:', url);
    if (!url) return false;
    // 微信临时文件路径特征
    if (url.startsWith('http://tmp/') || url.startsWith('http://127.0.0.1:59208/__tmp__/')) {
      console.log('判断结果：微信临时路径，需要上传');
      return false;
    }
    // 其他 http/https 开头的视为远程 URL
    console.log('判断结果：远程 URL');
    return url.startsWith('http://') || url.startsWith('https://');
  },

  uploadImageList: async function(list) {
    console.log('uploadImageList 开始上传，列表:', list);
    const urls = [];
    for (const url of list) {
      console.log('处理图片项:', url);
      // 微信临时文件路径需要上传到 MinIO
      if (this.isRemoteUrl(url)) {
        console.log('使用远程 URL，跳过上传:', url);
        urls.push(url);
      } else {
        console.log('调用 uploadFile 上传:', url);
        const uploadedUrl = await this.uploadFile(url, 'image/jpeg');
        console.log('上传后返回 URL:', uploadedUrl);
        urls.push(uploadedUrl);
      }
    }
    console.log('uploadImageList 完成，返回 URLs:', urls);
    return urls;
  }
});
