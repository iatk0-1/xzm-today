// miniprogram/pages/admin/admin.js
const api = require('../../utils/api');
const config = require('../../utils/config');
const { compressImage, compressVideo } = require('../../utils/media');

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

    // 尺码相关
    sizeCategoryList: [],  // 所有尺码类型
    currentSizeCategoryId: null,  // 当前选中的尺码类型 ID
    currentSizeCategoryName: '',  // 当前选中的尺码类型名称
    sizeOptions: [],  // 当前尺码类型下的尺码列表

    // 尺码配置弹窗相关
    showSizeModal: false,
    newSizeCategoryName: '',
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

    // 批量设置弹窗相关
    showBatchModal: false,
    batchSelectedColors: [],
    batchSelectedSizes: [],

    lookbookImgs: [],
    detailImgs: [],

    manualRelated: [],
    showRelatedModal: false,
    searchKeyword: '',
    allProducts: [],
    filteredProducts: [],

    // 档口/标签管理弹窗相关
    showStallManageModal: false,
    showTagManageModal: false,
    allStalls: [],  // 所有档口（含已删除）
    allTags: [],    // 所有标签（含已删除）
    filteredStalls: [],  // 过滤后的档口列表（用于搜索）
    filteredTags: [],    // 过滤后的标签列表（用于搜索）
    manageStallSearchKeyword: '',  // 管理弹窗 - 档口搜索关键词
    manageTagSearchKeyword: '',    // 管理弹窗 - 标签搜索关键词
    newStallName: '',
    newTagName: ''
  },

  onLoad(options) {
    let history = wx.getStorageSync('historyTags');
    if (history) this.setData({ historyTags: history });
    this.refreshGrid();
    // 加载历史档口和标签
    this.loadRecentStallsAndTags();
    // 加载尺码类型和尺码
    this.loadSizeCategories();

    // 如果是编辑模式，加载商品详情
    if (options && options.editId) {
      this.setData({ editId: options.editId });
      this.loadProductForEdit(options.editId);
    }

    // 如果是从直播商品转换而来，加载直播商品详情
    if (options && options.convertFromLiveProductId) {
      this.setData({
        convertFromLiveProductId: options.convertFromLiveProductId,
        sessionId: options.sessionId
      });
      this.loadLiveProductForConvert(options.convertFromLiveProductId);
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

      // 从 skus 数组中提取 SKU 数据，保留 skuId 和 sizeId
      // 后台管理需要显示总库存，所以 stock = stockMain(可用) + lockedMain(锁定)
      const skuMatrix = skusFromApi.map(sku => ({
        skuId: sku.id,
        color: sku.spec || '默认',
        size: sku.size || '均码',
        price: sku.retailPrice,
        stock: sku.stockMain + sku.lockedMain,  // 总库存 = 可用库存 + 锁定库存
        image: sku.imageUrl || '',
        sizeId: sku.sizeId || null
      }));

      console.log('商品详情:', product);
      console.log('SKU Matrix:', skuMatrix);

      // 处理尺码类型：优先使用商品的 sizeCategoryId，如果没有则从 SKU 的 sizeId 推断
      let currentSizeCategoryId = product.sizeCategoryId || null;
      let currentSizeCategoryName = '';

      // 如果有 sizeCategoryId，查找对应的类型名称
      if (currentSizeCategoryId && this.data.sizeCategoryList.length > 0) {
        const category = this.data.sizeCategoryList.find(c => c.id === currentSizeCategoryId);
        if (category) {
          currentSizeCategoryName = category.name;
        } else {
          // 类型不存在（可能已被删除），清除 sizeCategoryId
          currentSizeCategoryId = null;
        }
      }

      // 如果没有 sizeCategoryId 但有 SKU 数据，尝试从 SKU 的 sizeId 推断
      if (!currentSizeCategoryId && skuMatrix.length > 0 && skuMatrix.some(s => s.sizeId)) {
        // 收集所有有效的 sizeId
        const sizeIds = skuMatrix.filter(s => s.sizeId).map(s => s.sizeId);
        // 遍历所有尺码类型，找到包含这些 sizeId 的类型
        for (const category of this.data.sizeCategoryList) {
          const categorySizeIds = (category.sizes || []).map(s => s.id);
          const matchCount = sizeIds.filter(id => categorySizeIds.includes(id)).length;
          if (matchCount > 0) {
            currentSizeCategoryId = category.id;
            currentSizeCategoryName = category.name;
            break;
          }
        }
      }

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
      let sizeOptions = [];
      let colors = [];
      let skuList = [];

      if (skuMatrix && skuMatrix.length > 0) {
        // 从 SKU 矩阵中提取尺码和颜色
        const sizes = [...new Set(skuMatrix.map(s => s.size))];
        const colors_set = [...new Set(skuMatrix.map(s => s.color))];

        // 如果有尺码类型，使用该类型下的尺码列表
        if (currentSizeCategoryId) {
          const category = this.data.sizeCategoryList.find(c => c.id === currentSizeCategoryId);
          if (category) {
            sizeOptions = (category.sizes || []).map(size => ({
              id: size.id,
              name: size.name,
              selected: sizes.includes(size.name)
            }));
          }
        }

        // 如果没有尺码类型或尺码类型下没有匹配的尺码，使用 SKU 中的实际尺码值
        if (sizeOptions.length === 0) {
          sizeOptions = sizes.map(sizeName => ({
            name: sizeName,
            selected: true
          }));
        }

        // 设置颜色（过滤掉"图片色"）
        colors = colors_set.filter(c => c && c !== '图片色');

        // 填充 SKU 列表（保留 skuId 和 sizeId 用于更新）
        skuList = skuMatrix.map(sku => ({
          skuId: sku.skuId || null,
          color: sku.color,
          size: sku.size,
          price: String(sku.price),
          stock: String(sku.stock),
          image: sku.image || '',
          sizeId: sku.sizeId || null
        }));
      } else {
        // 如果没有 SKU 数据，保持默认的尺码选项
        sizeOptions = this.data.sizeOptions;
      }

      this.setData({
        ...formData,
        mediaList: mediaList,
        currentSizeCategoryId,
        currentSizeCategoryName,
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

  // 加载直播商品详情用于转换
  loadLiveProductForConvert: async function(liveProductId) {
    wx.showLoading({ title: '加载中...' });
    try {
      // 调用直播商品详情接口
      const res = await api.get(`/live-products/${liveProductId}`);
      console.log('直播商品详情:', res);

      const product = res.product || res;
      const skusFromApi = res.skus || [];

      // 从 skus 数组中提取 SKU 数据，注意：不清除 skuId 和 sizeId，因为需要保留规格信息
      const skuMatrix = skusFromApi.map(sku => ({
        skuId: null, // 新商品的 SKU ID 需要置空，由后端生成
        color: sku.spec || '默认',
        size: sku.size || '均码',
        price: sku.retailPrice,
        stock: sku.stockMain,
        image: sku.imageUrl || '',
        sizeId: sku.sizeId || null // 保留 sizeId，使用相同的规格
      }));

      console.log('商品详情:', product);
      console.log('SKU Matrix:', skuMatrix);

      // 处理尺码类型：优先使用商品的 sizeCategoryId
      let currentSizeCategoryId = product.sizeCategoryId || null;
      let currentSizeCategoryName = '';

      // 如果有 sizeCategoryId，查找对应的类型名称
      if (currentSizeCategoryId && this.data.sizeCategoryList.length > 0) {
        const category = this.data.sizeCategoryList.find(c => c.id === currentSizeCategoryId);
        if (category) {
          currentSizeCategoryName = category.name;
        } else {
          currentSizeCategoryId = null;
        }
      }

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
      let sizeOptions = [];
      let colors = [];
      let skuList = [];

      if (skuMatrix && skuMatrix.length > 0) {
        // 从 SKU 矩阵中提取尺码和颜色
        const sizes = [...new Set(skuMatrix.map(s => s.size))];
        const colors_set = [...new Set(skuMatrix.map(s => s.color))];

        // 如果有尺码类型，使用该类型下的尺码列表
        if (currentSizeCategoryId) {
          const category = this.data.sizeCategoryList.find(c => c.id === currentSizeCategoryId);
          if (category) {
            sizeOptions = (category.sizes || []).map(size => ({
              id: size.id,
              name: size.name,
              selected: sizes.includes(size.name)
            }));
          }
        }

        // 如果没有尺码类型或尺码类型下没有匹配的尺码，使用 SKU 中的实际尺码值
        if (sizeOptions.length === 0) {
          sizeOptions = sizes.map(sizeName => ({
            name: sizeName,
            selected: true
          }));
        }

        // 设置颜色（过滤掉"图片色"）
        colors = colors_set.filter(c => c && c !== '图片色');

        // 填充 SKU 列表（skuId 置空，由后端生成新 ID）
        skuList = skuMatrix.map(sku => ({
          skuId: null, // 新商品 SKU ID 置空
          color: sku.color,
          size: sku.size,
          price: String(sku.price),
          stock: String(sku.stock),
          image: sku.image || '',
          sizeId: sku.sizeId // 保留 sizeId
        }));
      } else {
        // 如果没有 SKU 数据，保持默认的尺码选项
        sizeOptions = this.data.sizeOptions;
      }

      this.setData({
        ...formData,
        mediaList: mediaList,
        currentSizeCategoryId,
        currentSizeCategoryName,
        sizeOptions: sizeOptions,
        colors: colors,
        skuList: skuList,
        colorInput: '',
        tagInput: ''
      });

      this.refreshGrid(mediaList);
      wx.hideLoading();

      // 提示用户
      wx.showToast({
        title: '已加载直播商品数据',
        icon: 'success'
      });
    } catch (err) {
      console.error('加载直播商品失败:', err);
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

  // ================= 视频上传 =================
  uploadVideo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['camera', 'album'],
      compressed: true,
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        console.log('视频选择成功，临时路径:', tempFilePath);
        // 直接保存临时文件路径，等提交时再统一上传
        this.setData({ videoUrl: tempFilePath });
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

  // ================= 选填图上传 =================
  chooseExtraImage(e) {
    const type = e.currentTarget.dataset.type;
    let currentList = this.data[`${type}Imgs`];
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sizeType: ['compressed'],
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
      const filtered = (res.results || []).filter(s => !selectedIds.includes(s.id));
      // 如果没有精确匹配，显示新增按钮
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
      const filtered = (res.results || []).filter(t => !selectedIds.includes(t.id));
      // 如果没有精确匹配，显示新增按钮
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

  // ================= 尺码配置相关 =================
  // 加载尺码类型和尺码
  loadSizeCategories: async function() {
    try {
      const res = await api.get('/sizes/categories');
      console.log('尺码类型和尺码:', res);

      // 默认选择第一个尺码类型
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

  // 打开尺码配置弹窗
  openSizeModal: function() {
    this.setData({
      showSizeModal: true,
      newSizeCategoryName: '',
      newCategoryName: '',
      newSizeName: ''
    });
  },

  // 关闭尺码配置弹窗
  closeSizeModal: function() {
    this.setData({ showSizeModal: false });
  },

  // 切换尺码类型
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

  // 新增尺码类型
  addSizeCategory: async function() {
    const name = this.data.newCategoryName.trim();
    if (!name) {
      wx.showToast({ title: '请输入类型名称', icon: 'none' });
      return;
    }

    try {
      await api.post('/sizes/categories', { name });
      wx.showToast({ title: '添加成功', icon: 'success' });

      // 重新加载尺码类型
      await this.loadSizeCategories();
      this.setData({ newCategoryName: '' });
    } catch (err) {
      console.error('创建尺码类型失败:', err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    }
  },

  // 删除尺码类型
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

            // 重新加载尺码类型
            await this.loadSizeCategories();
          } catch (err) {
            console.error('删除尺码类型失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 新增尺码
  addSize: async function() {
    const name = this.data.newSizeName.trim();
    if (!name) {
      wx.showToast({ title: '请输入尺码名称', icon: 'none' });
      return;
    }

    // 检查是否已存在
    const exists = this.data.sizeOptions.find(s => s.name === name);
    if (exists) {
      wx.showToast({ title: '该尺码已存在', icon: 'none' });
      return;
    }

    try {
      const res = await api.post(`/sizes/categories/${this.data.currentSizeCategoryId}/sizes`, { name });
      wx.showToast({ title: '添加成功', icon: 'success' });

      // 添加新尺码到列表
      const newSize = {
        id: res.size.id,
        name: res.size.name,
        selected: false
      };
      this.setData({
        sizeOptions: [...this.data.sizeOptions, newSize],
        newSizeName: ''
      });

      // 更新当前尺码类型的 sizes 列表
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

  // 删除尺码
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

            // 从列表中移除
            const sizeOptions = this.data.sizeOptions.filter(s => s.id !== sizeId);
            this.setData({ sizeOptions });

            // 同时更新当前尺码类型的 sizes 列表
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

  // ====== 修复：颜色输入为空时，默认赋值“图片色” ======
  addColor() {
    let val = this.data.colorInput.trim();
    
    // 🚀 核心逻辑：如果什么都不填，默认赋予“图片色”
    if (!val) {
      val = '图片色';
    }

    // 防御机制：防止重复添加同一个颜色标签
    if (!this.data.colors.includes(val)) {
      this.setData({ 
        colors: [...this.data.colors, val], 
        colorInput: '' 
      }, () => {
        // 标签加好后，立刻向下触发，渲染出 SKU 列表
        this.generateSkuMatrix();
      });
    } else {
      // 如果已经有这个颜色了，默默清空输入框，不弹报错，保持高级体验
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
        // 根据颜色 + 尺码匹配原有的 SKU（使用 spec+size 组合作为匹配键）
        let existItem = oldSkuList.find(old => old.color === c && old.size === s);
        newSkuList.push({
          skuId: existItem ? existItem.skuId : null,  // 保留 skuId，新增组合为 null
          sizeId: existItem ? existItem.sizeId : null,  // 保留 sizeId
          color: c,
          size: s,
          price: existItem ? existItem.price : '',
          stock: existItem ? existItem.stock : '',
          image: existItem ? (existItem.image || '') : ''
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
          sizeId: oldItem.sizeId || null,
          color: oldItem.color,
          size: oldItem.size,
          price: oldItem.price,
          stock: oldItem.stock,
          image: oldItem.image || '',
          _toBeRemoved: true  // 标记：前端隐藏，提交后端时会被标记为 disabled
        });
      }
    });

    this.setData({ skuList: newSkuList });
  },

  applyBatch() {
    // 打开批量设置弹窗
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

  // 批量设置弹窗相关方法
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

  // 全选/取消全选颜色
  toggleSelectAllColors() {
    const allSelected = this.data.batchSelectedColors.every(c => c.selected);
    const updatedColors = this.data.batchSelectedColors.map(c => ({
      ...c,
      selected: !allSelected
    }));
    this.setData({ batchSelectedColors: updatedColors });
  },

  // 全选/取消全选尺码
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

    // 获取选中的颜色和尺码
    const selectedColors = batchSelectedColors.filter(c => c.selected).map(c => c.name);
    const selectedSizes = batchSelectedSizes.filter(s => s.selected).map(s => s.name);

    if (selectedColors.length === 0 && selectedSizes.length === 0) {
      return wx.showToast({ title: '请选择要批量设置的 SKU', icon: 'none' });
    }

    // 匹配符合条件的 SKU 并更新
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

  // 上传 SKU 图片
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

  // 批量设置弹窗图片选择
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

  // ================= 关联商品 =================
  openRelatedModal() {
    wx.showLoading({ title: '加载中...' });
    api.get('/products', { limit: 20, offset: 0 })
      .then(res => {
        wx.hideLoading();
        const selectedIds = this.data.manualRelated.map(item =>
          typeof item === 'object' ? item.id : item
        );
        // 排除当前正在编辑的商品本身
        const editId = this.data.editId ? String(this.data.editId) : null;

        const productList = Array.isArray(res)
          ? res
          : (res && Array.isArray(res.content) ? res.content : []);

        let validProducts = productList.filter(p =>
          p && p.name && p.coverUrl && (!editId || String(p.id) !== editId)
        );

        let products = validProducts.map(p => ({
          ...p,
          selected: selectedIds.includes(p.id) || selectedIds.includes(String(p.id))
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

      // 2. 上传所有 SKU 图片
      wx.showLoading({ title: '上传 SKU 图片...', mask: true });
      const skuImageMap = await this.uploadSkuImages(skuList);

      // 2.5. 上传视频（如果有）
      let uploadedVideoUrl = null;
      if (videoUrl && this.isTemporaryPath(videoUrl)) {
        wx.showLoading({ title: '上传视频...', mask: true });
        uploadedVideoUrl = await this.uploadFile(videoUrl, 'video/mp4');
      } else {
        uploadedVideoUrl = videoUrl || null;
      }

      // 3. 构造后端要求的 SKU 格式
      // 过滤掉 _toBeRemoved 标记的 SKU，这些是用户已删除的规格，不应该提交给后端
      console.log('提交前 skuList:', JSON.stringify(skuList));
      console.log('editId:', editId);
      const skus = skuList.filter(sku => !sku._toBeRemoved).map((sku, index) => {
        const skuData = {
          spec: sku.color || '默认',
          size: sku.size || '均码',
          barcode: '',
          retailPrice: Number(sku.price),
          stockMain: Number(sku.stock) || 0,
          imageUrl: skuImageMap[index] || null,
          sizeId: sku.sizeId || null
        };
        // 编辑模式下，如果有 skuId，需要传递给后端
        if (editId && sku.skuId) {
          skuData.id = sku.skuId;
          console.log(`SKU ${sku.color}-${sku.size} 有 skuId=${sku.skuId}, sizeId=${sku.sizeId}`);
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
        videoUrl: uploadedVideoUrl,
        shippingInfo: shippingInfo || null,
        description: description || null,
        fabricCare: fabricCare || null,
        sizeChartTip: sizeChartTip || null,
        warmTips: warmTips || null,
        sizeCategoryId: this.data.currentSizeCategoryId || null,
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
        const createRes = await api.post('/products', productData);
        wx.hideLoading();
        wx.showToast({ title: '上架成功!', icon: 'success' });

        // 如果是从直播商品转换而来，调用关联接口
        if (this.data.convertFromLiveProductId) {
          wx.showLoading({ title: '关联商品...', mask: true });
          try {
            // 后端返回格式：{ product: { id: xxx, ... }, skus: [...] }
            const newProductId = createRes.product?.id || createRes.id;
            if (newProductId) {
              await api.post(`/live-products/${this.data.convertFromLiveProductId}/link-normal?normalProductId=${newProductId}`);
              wx.hideLoading();
              console.log('直播商品关联成功，新商品 ID:', newProductId);
            } else {
              wx.hideLoading();
              console.warn('无法获取新商品 ID，跳过关联');
            }
          } catch (linkErr) {
            wx.hideLoading();
            console.error('关联直播商品失败:', linkErr);
            // 关联失败不影响主流程，只显示警告
          }
        }
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
    // 使用 isTemporaryPath 判断，如果不是临时路径则视为远程 URL
    return !this.isTemporaryPath(url);
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

  // 选择填充用的统一图片
  chooseQuickImage: function() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success: (res) => {
        // 建议此处调用你现有的上传接口，获取后端 URL 赋值给 quickImage
        // 这里简化处理，直接展示本地图
        this.setData({ quickImage: res.tempFilePaths[0] });
      }
    });
  },

  // 一键填充核心逻辑
  // ====== 核心重构：一键填充 + 状态自动重置 ======
  applyQuickFillAll: function() {
    const { skuList, quickPrice, quickStock, quickImage } = this.data;

    if (!skuList || skuList.length === 0) {
      wx.showToast({ title: '请先添加规格', icon: 'none' });
      return;
    }

    // 检查是否有任何输入，避免空填充
    if (quickPrice === '' && quickStock === '' && quickImage === '') {
      wx.showToast({ title: '请填写填充内容', icon: 'none' });
      return;
    }

    // 执行填充逻辑
    const newList = skuList.map(sku => {
      return {
        ...sku,
        price: quickPrice !== '' ? quickPrice : sku.price,
        // 如果库存为空，则保持原样（或在提交时处理为无限）
        stock: quickStock !== '' ? quickStock : sku.stock,
        image: quickImage !== '' ? quickImage : sku.image
      };
    });

    // 🚀 关键修改：在 setData 中同步清空控制台输入源
    this.setData({
      skuList: newList,
      quickPrice: '',    // 填充后自动清空价格
      quickStock: '',    // 填充后自动清空库存
      quickImage: ''     // 填充后自动清空图片
    }, () => {
      wx.showToast({ title: '已同步至明细', icon: 'success' });
    });
  },

  // ================= 档口/标签管理弹窗 =================

  // 打开档口管理弹窗
  openStallManageModal: function() {
    this.setData({ 
      showStallManageModal: true,
      manageStallSearchKeyword: '',
      filteredStalls: this.data.allStalls
    });
    this.loadAllStalls();
  },

  // 关闭档口管理弹窗
  closeStallManageModal: function() {
    this.setData({ 
      showStallManageModal: false,
      manageStallSearchKeyword: '',
      newStallName: ''
    });
  },

  // 打开标签管理弹窗
  openTagManageModal: function() {
    this.setData({ 
      showTagManageModal: true,
      manageTagSearchKeyword: '',
      filteredTags: this.data.allTags
    });
    this.loadAllTags();
  },

  // 关闭标签管理弹窗
  closeTagManageModal: function() {
    this.setData({ 
      showTagManageModal: false,
      manageTagSearchKeyword: '',
      newTagName: ''
    });
  },

  // 加载所有档口（含已删除）
  loadAllStalls: async function() {
    try {
      const res = await api.get('/stalls/all?includeDeleted=true');
      const stalls = res || [];
      this.setData({ 
        allStalls: stalls,
        filteredStalls: this.data.manageStallSearchKeyword 
          ? this.filterStallsByKeyword(stalls, this.data.manageStallSearchKeyword)
          : stalls
      });
    } catch (err) {
      console.error('加载档口列表失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 加载所有标签（含已删除）
  loadAllTags: async function() {
    try {
      const res = await api.get('/tags/all?includeDeleted=true');
      const tags = res || [];
      this.setData({ 
        allTags: tags,
        filteredTags: this.data.manageTagSearchKeyword 
          ? this.filterTagsByKeyword(tags, this.data.manageTagSearchKeyword)
          : tags
      });
    } catch (err) {
      console.error('加载标签列表失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 按关键词过滤档口
  filterStallsByKeyword: function(stalls, keyword) {
    if (!keyword) return stalls;
    const lowerKeyword = keyword.toLowerCase();
    return stalls.filter(stall => 
      stall.name.toLowerCase().includes(lowerKeyword)
    );
  },

  // 按关键词过滤标签
  filterTagsByKeyword: function(tags, keyword) {
    if (!keyword) return tags;
    const lowerKeyword = keyword.toLowerCase();
    return tags.filter(tag => 
      tag.name.toLowerCase().includes(lowerKeyword)
    );
  },

  // 从弹窗新增档口
  createStallFromModal: async function() {
    const name = this.data.manageStallSearchKeyword.trim();
    if (!name) {
      wx.showToast({ title: '请输入档口名称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '创建中...' });
    try {
      const res = await api.post('/stalls', { name });
      wx.hideLoading();
      wx.showToast({ title: '添加成功', icon: 'success' });

      // 刷新列表
      await this.loadAllStalls();
      this.setData({ manageStallSearchKeyword: '' });

      // 同时刷新历史档口列表
      this.loadRecentStallsAndTags();
    } catch (err) {
      wx.hideLoading();
      console.error('创建档口失败:', err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    }
  },

  // 从弹窗新增标签
  createTagFromModal: async function() {
    const name = this.data.manageTagSearchKeyword.trim();
    if (!name) {
      wx.showToast({ title: '请输入标签名称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '创建中...' });
    try {
      const res = await api.post('/tags', { name });
      wx.hideLoading();
      wx.showToast({ title: '添加成功', icon: 'success' });

      // 刷新列表
      await this.loadAllTags();
      this.setData({ manageTagSearchKeyword: '' });

      // 同时刷新历史标签列表
      this.loadRecentStallsAndTags();
    } catch (err) {
      wx.hideLoading();
      console.error('创建标签失败:', err);
      wx.showToast({ title: '创建失败', icon: 'none' });
    }
  },

  // 删除档口
  deleteStall: function(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.allStalls.find(s => s.id === id);

    wx.showModal({
      title: '确认删除',
      content: `确定要删除档口"${item.name}"吗？删除后可在已删除列表中恢复。`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.delete(`/stalls/${id}`);
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadAllStalls();
            // 同时刷新历史档口列表
            this.loadRecentStallsAndTags();
          } catch (err) {
            console.error('删除档口失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 恢复档口
  restoreStall: function(e) {
    const id = e.currentTarget.dataset.id;

    wx.showLoading({ title: '恢复中...' });
    try {
      api.post(`/stalls/${id}/restore`).then(() => {
        wx.hideLoading();
        wx.showToast({ title: '恢复成功', icon: 'success' });
        this.loadAllStalls();
        // 同时刷新历史档口列表
        this.loadRecentStallsAndTags();
      });
    } catch (err) {
      wx.hideLoading();
      console.error('恢复档口失败:', err);
      wx.showToast({ title: '恢复失败', icon: 'none' });
    }
  },

  // 删除标签
  deleteTag: function(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.allTags.find(t => t.id === id);

    wx.showModal({
      title: '确认删除',
      content: `确定要删除标签"${item.name}"吗？删除后可在已删除列表中恢复。`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.delete(`/tags/${id}`);
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadAllTags();
            // 同时刷新历史标签列表
            this.loadRecentStallsAndTags();
          } catch (err) {
            console.error('删除标签失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 恢复标签
  restoreTag: function(e) {
    const id = e.currentTarget.dataset.id;

    wx.showLoading({ title: '恢复中...' });
    try {
      api.post(`/tags/${id}/restore`).then(() => {
        wx.hideLoading();
        wx.showToast({ title: '恢复成功', icon: 'success' });
        this.loadAllTags();
        // 同时刷新历史标签列表
        this.loadRecentStallsAndTags();
      });
    } catch (err) {
      wx.hideLoading();
      console.error('恢复标签失败:', err);
      wx.showToast({ title: '恢复失败', icon: 'none' });
    }
  },

  // ================= 管理弹窗滚动处理（防止滚动穿透）=================
  onManageScrollToUpper: function() {
    // 滚动到顶部，阻止默认行为
  },

  onManageScrollToLower: function() {
    // 滚动到底部，阻止默认行为
  },

  // ================= 管理弹窗 - 档口搜索功能 =================
  onManageStallSearchInput: function(e) {
    const keyword = e.detail.value.trim();
    this.setData({ manageStallSearchKeyword: keyword });
    this.filterStalls(keyword);
  },

  filterStalls: function(keyword) {
    let filtered = this.data.allStalls;
    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      filtered = this.data.allStalls.filter(stall => 
        stall.name.toLowerCase().includes(lowerKeyword)
      );
    }
    this.setData({ filteredStalls: filtered });
  },

  // ================= 管理弹窗 - 标签搜索功能 =================
  onManageTagSearchInput: function(e) {
    const keyword = e.detail.value.trim();
    this.setData({ manageTagSearchKeyword: keyword });
    this.filterTags(keyword);
  },

  filterTags: function(keyword) {
    let filtered = this.data.allTags;
    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      filtered = this.data.allTags.filter(tag => 
        tag.name.toLowerCase().includes(lowerKeyword)
      );
    }
    this.setData({ filteredTags: filtered });
  },
});
