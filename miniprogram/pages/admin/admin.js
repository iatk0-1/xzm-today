// miniprogram/pages/admin/admin.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const config = require('../../utils/config');
const { compressImage, compressVideo } = require('../../utils/media');
const draft = require('../../utils/draft');


// 拖拽网格配置
const ITEM_SIZE = 105;
const COLUMNS = 3;
const MAX_PRODUCT_IMAGES = 99;
const MAX_MEDIA_PICK_COUNT = 20;

Page({
  data: {
    videoUrl: '',
    videoThumbPath: '',
    useVideoCover: false,
    mediaList: [],
    maxProductImages: MAX_PRODUCT_IMAGES,
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
    colors: ['图片色'],
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

    // 套装模式
    isBundleMode: false,
    bundleGroups: [],           // [{name, colors, sizeOptions, skuList}]
    activeGroupIndex: -1,       // 当前编辑的子项索引，-1表示非套装或未选中

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
    newTagName: '',

    // 子项名称输入框聚焦
    bundleGroupNameFocus: false
  },

  async onLoad(options) {
    try {
      await auth.ensureAuthenticated({ silent: true });
    } catch (err) {
      console.error('管理员页面认证恢复失败:', err);
      wx.showToast({ title: '登录状态恢复失败，请稍后重试', icon: 'none' });
      return;
    }

    let history = wx.getStorageSync('historyTags');
    if (history) this.setData({ historyTags: history });
    this.refreshGrid();
    // 加载历史档口和标签
    this.loadRecentStallsAndTags();
    // 加载尺码类型和尺码
    this.loadSizeCategories();

    // 设置草稿类型（用于保存时标记到后端）
    if (options && options.editId) {
      this._draftType = 'edit';
      this._relatedId = options.editId;
      this.setData({ editId: options.editId });
      this.loadProductForEdit(options.editId);
    } else if (options && options.convertFromLiveProductId) {
      this._draftType = 'convert';
      this._relatedId = options.convertFromLiveProductId;
      this.setData({
        convertFromLiveProductId: options.convertFromLiveProductId,
        sessionId: options.sessionId
      });
      this.loadLiveProductForConvert(options.convertFromLiveProductId);
    } else {
      this._draftType = 'create';
      this._relatedId = null;
      // 创建模式：恢复上次的档口选择（仅当天有效）
      this._loadLastStallSelection();
      // 初始化默认 SKU（图片色 × 均码）
      this.generateSkuMatrix();
      // 检测是否有未完成的草稿
      this.checkDraft();
    }
  },

  onUnload() {
    // 已提交成功 → 无需操作
    if (this._submitted) return;
    // 有未保存变更时自动保存草稿（不做弹窗，系统 alert 已处理确认）
    var currentSnapshot = JSON.stringify(this.collectDraftData());
    if (this.hasFormContent() && currentSnapshot !== this._lastSavedSnapshot) {
      this.saveDraft();
    }
    // 清理
    if (this._alertEnabled) {
      wx.disableAlertBeforeUnload();
      this._alertEnabled = false;
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
      // 无限库存时 stock 留空
      const skuMatrix = skusFromApi.map(sku => ({
        skuId: sku.id,
        color: sku.spec || '默认',
        size: sku.size || '均码',
        price: sku.retailPrice,
        stock: sku.unlimitedStock ? '' : (sku.stockMain + sku.lockedMain),
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
        videoThumbPath: '',
        useVideoCover: false,
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

      // 套装商品：恢复 bundleGroups
      if (res.bundleGroups && res.bundleGroups.length > 0) {
        var bgs = res.bundleGroups.map(function(bg) {
          return {
            name: bg.name,
            colors: [...new Set((bg.skus || []).map(function(s) { return s.spec; }))],
            sizeOptions: sizeOptions.slice(),
            skuList: (bg.skus || []).map(function(sku) {
              return {
                skuId: sku.id,
                sizeId: sku.sizeId,
                color: sku.spec || '默认',
                size: sku.size || '均码',
                price: String(sku.retailPrice || ''),
                stock: sku.unlimitedStock ? '' : String(sku.stockMain || ''),
                image: sku.imageUrl || ''
              };
            })
          };
        });
        this.setData({
          isBundleMode: true,
          bundleGroups: bgs,
          activeGroupIndex: 0
        });
        this.loadGroupState(0);
      }

      this.refreshGrid(mediaList);
      wx.hideLoading();
      this.checkDraft();
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
        stock: sku.unlimitedStock ? '' : sku.stockMain,
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
        videoThumbPath: '',
        useVideoCover: false,
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
      this.checkDraft();

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

  // 检查是否需要启用系统退出拦截（与上次保存快照对比）
  _updateExitGuard: function() {
    if (this._submitted || this._alertEnabled) return;
    if (!this.hasFormContent()) return;
    var currentSnapshot = JSON.stringify(this.collectDraftData());
    if (currentSnapshot !== this._lastSavedSnapshot) {
      this._alertEnabled = true;
      wx.enableAlertBeforeUnload({
        message: '当前内容尚未保存为草稿，确定离开吗？'
      });
    }
  },

  // 标记表单已变更，检查是否需要启用退出拦截
  _markDirty: function() {
    this._lastEditTime = Date.now();
    this._updateExitGuard();
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
    this._markDirty();
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
    this._markDirty();
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

        // 上传图片后，自动取消"使用视频封面"的勾选
        if (this.data.useVideoCover) {
          this.setData({ useVideoCover: false });
        }
      },
      fail: (err) => {
        console.error('选择图片失败:', err);
      }
    });
  },

  removeMedia(e) {
    this._markDirty();
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
    this._markDirty();
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
    this._markDirty();
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['camera', 'album'],
      compressed: true,
      success: (res) => {
        const tempFile = res.tempFiles[0];
        // 时长校验：最长 60 秒
        if (tempFile.duration && tempFile.duration > 60) {
          wx.showToast({ title: '视频最长1分钟，请重新选择', icon: 'none' });
          return;
        }
        console.log('视频选择成功，临时路径:', tempFile.tempFilePath);
        this.setData({
          videoUrl: tempFile.tempFilePath,
          videoThumbPath: tempFile.thumbTempFilePath || '',
          useVideoCover: false
        });
      },
      fail: (err) => {
        console.error('选择视频失败:', err);
        wx.showToast({ title: '选择失败', icon: 'none' });
      }
    });
  },

  removeVideo() {
    this._markDirty();
    this.setData({
      videoUrl: '',
      videoThumbPath: '',
      useVideoCover: false
    });
  },

  toggleVideoCover() {
    this._markDirty();
    this.setData({ useVideoCover: !this.data.useVideoCover });
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

    // 二次确认文件路径有效（macOS 上压缩后的 temp 路径可能已失效）
    try {
      var fs = wx.getFileSystemManager();
      fs.accessSync(filePath);
    } catch (e) {
      throw new Error('图片文件已失效，请重新选择图片');
    }

    const cosUpload = require('../../utils/cos-upload');
    return cosUpload.uploadFile(filePath, 'products');
  },

  // ================= 选填图上传 =================
  chooseExtraImage(e) {
    this._markDirty();
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
    this._markDirty();
    const { type, index } = e.currentTarget.dataset;
    let list = this.data[`${type}Imgs`];
    list.splice(index, 1);
    this.setData({ [`${type}Imgs`]: list });
  },

  // ================= 分类、尺码、颜色、SKU =================
  removeTag(e) {
    this._markDirty();
    let id = e.currentTarget.dataset.id;
    this.setData({ selectedTags: this.data.selectedTags.filter(t => t.id !== id) });
  },

  // ================= 选择历史档口 =================
  selectRecentStall(e) {
    this._markDirty();
    const item = e.currentTarget.dataset.item;
    const exists = this.data.selectedStalls.find(s => s.id === item.id);
    if (!exists) {
      this.setData({
        selectedStalls: [...this.data.selectedStalls, item]
      });
      this._saveLastStallSelection();
    }
  },

  // ================= 选择历史标签 =================
  selectRecentTag(e) {
    this._markDirty();
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
      this._saveLastStallSelection();
    }
  },

  removeStall(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ selectedStalls: this.data.selectedStalls.filter(s => s.id !== id) });
    this._saveLastStallSelection();
  },

  // 保存当前档口选择到本地（记忆功能，当天有效）
  _saveLastStallSelection: function() {
    try {
      var today = new Date();
      var dateStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
      wx.setStorageSync('last_stall_selection', {
        date: dateStr,
        stalls: this.data.selectedStalls
      });
    } catch (e) {
      // ignore
    }
  },

  // 加载上次的档口选择（仅当天有效，仅创建模式使用）
  _loadLastStallSelection: function() {
    try {
      var saved = wx.getStorageSync('last_stall_selection');
      if (!saved || !saved.date || !saved.stalls) return;

      var today = new Date();
      var dateStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');

      if (saved.date !== dateStr) {
        wx.removeStorageSync('last_stall_selection');
        return;
      }

      if (saved.stalls.length > 0) {
        this.setData({ selectedStalls: saved.stalls });
      }
    } catch (e) {
      // ignore
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
      this._saveLastStallSelection();
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
    this._markDirty();
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
    this._markDirty();
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
    this._markDirty();
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
    this._markDirty();
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
    // 不选尺码默认"均码"，不选颜色默认"图片色"
    let sizes = activeSizes.length > 0 ? activeSizes : ['均码'];
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
    this._afterBundleSkuChange();
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
    this._markDirty();
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
    this._markDirty();
  },

  // 上传 SKU 图片
  uploadSkuImage(e) {
    this._markDirty();
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
    this._markDirty();
    const index = e.currentTarget.dataset.index;
    const key = `skuList[${index}].image`;
    this.setData({ [key]: '' });
  },

  // 批量设置弹窗图片选择
  chooseBatchImage() {
    this._markDirty();
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
    this._markDirty();
    let selectedItems = this.data.allProducts.filter(p => p.selected);
    this.setData({ manualRelated: selectedItems, showRelatedModal: false });
  },

  removeRelated(e) {
    this._markDirty();
    let id = e.currentTarget.dataset.id;
    let newList = this.data.manualRelated.filter(item => item.id !== id);
    this.setData({ manualRelated: newList });
  },

  // ================= 提交商品 =================
  submitProduct: async function() {
    const { mediaList, title, selectedStalls, selectedTags, skuList, lookbookImgs, detailImgs, manualRelated,
            videoUrl, videoThumbPath, useVideoCover, shippingInfo, description, fabricCare, sizeChartTip, warmTips, editId } = this.data;

    var isBundle = this.data.isBundleMode && this.data.bundleGroups.length > 0;
    var hasSkus = isBundle
      ? this.data.bundleGroups.some(function(g) { return g.skuList && g.skuList.length > 0; })
      : skuList.length > 0;

    // 校验：如果勾选了"使用视频封面"，可以不上传图片（视频缩略图作为封面）
    // 否则必须至少上传一张图片
    const hasMediaOrVideoCover = mediaList.length > 0 || (useVideoCover && videoUrl && videoThumbPath);
    if (!hasMediaOrVideoCover || !title || !hasSkus) {
      return wx.showToast({ title: '封面/名称/尺码颜色不能为空', icon: 'none' });
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

      // 2.6. 上传视频封面缩略图（如果勾选了"使用视频封面"）
      let uploadedVideoThumbUrl = null;
      if (useVideoCover && videoThumbPath) {
        wx.showLoading({ title: '上传视频封面...', mask: true });
        uploadedVideoThumbUrl = await this.uploadFile(videoThumbPath, 'image/jpeg');
      }

      // 3. 构造封面图和轮播图（视频封面逻辑）
      let coverUrl, bannerImages;
      if (useVideoCover && uploadedVideoThumbUrl) {
        // 勾选了"使用视频封面" → 视频缩略图作封面，所有图片作 banner
        coverUrl = uploadedVideoThumbUrl;
        bannerImages = uploadedMediaUrls;  // 可能为空数组（用户只上传了视频）
      } else if (uploadedMediaUrls.length > 0) {
        // 未勾选 + 有图片 → 首图作封面，其余作 banner
        coverUrl = uploadedMediaUrls[0];
        bannerImages = uploadedMediaUrls.slice(1);
      } else {
        // 没有图片也没有勾选视频封面 → 不应该走到这里（前面已校验）
        throw new Error('封面图片缺失');
      }

      // 3. 构造后端要求的 SKU 格式
      // 过滤掉 _toBeRemoved 标记的 SKU，这些是用户已删除的规格，不应该提交给后端
      console.log('提交前 skuList:', JSON.stringify(skuList));
      console.log('editId:', editId);
      const skus = skuList.filter(sku => !sku._toBeRemoved).map((sku, index) => {
        const stockStr = sku.stock ? String(sku.stock).trim() : '';
        const isUnlimited = stockStr === '';
        const stockNum = isUnlimited ? 0 : (Number(stockStr) || 0);
        if (!isUnlimited && stockNum > 999999999) {
          wx.showToast({ title: '库存不能超过999999999', icon: 'none' });
          throw new Error('库存超出范围');
        }
        const skuData = {
          spec: sku.color || '默认',
          size: sku.size || '均码',
          barcode: '',
          retailPrice: Number(sku.price),
          stockMain: stockNum,
          isUnlimitedStock: isUnlimited,
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

      // 4. 构造商品请求数据
      const productData = {
        name: title,
        coverUrl: coverUrl,
        bannerImages: bannerImages,
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
        skus: skus,
        bundleGroups: null
      };

      // 套装模式：构建 bundleGroups 数据
      if (this.data.isBundleMode && this.data.bundleGroups.length > 0) {
        this.saveActiveGroupState();
        var bundleGroupsData = this.data.bundleGroups.map(function(bg, gi) {
          var bgSkus = (bg.skuList || []).filter(function(s) { return !s._toBeRemoved; }).map(function(sku) {
            var s = String(sku.stock || '').trim();
            return {
              spec: sku.color || '默认',
              size: sku.size || '均码',
              barcode: '',
              retailPrice: Number(sku.price) || 0,
              stockMain: s === '' ? 0 : (Number(s) || 0),
              isUnlimitedStock: s === '',
              sizeId: sku.sizeId || null
            };
          });
          return { name: bg.name || ('子项' + (gi + 1)), sortOrder: gi, skus: bgSkus };
        });
        productData.bundleGroups = bundleGroupsData;
        productData.skus = [];  // 套装模式下顶层 skus 为空
      }

      console.log('提交商品数据:', JSON.stringify(productData));

      if (editId) {
        // 编辑模式：调用更新接口
        wx.showLoading({ title: '保存修改...', mask: true });
        await api.put(`/products/${editId}`, productData);
        wx.hideLoading();
      } else {
        // 创建模式：调用创建接口
        wx.showLoading({ title: '创建商品...', mask: true });
        const createRes = await api.post('/products', productData);
        wx.hideLoading();

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

      // 成功后清除草稿并标记已提交（跳过退出拦截）
      this._submitted = true;
      // 解除退出拦截
      if (this._alertEnabled) {
        wx.disableAlertBeforeUnload();
        this._alertEnabled = false;
      }
      // 清除草稿
      this.clearDraft();

      wx.showToast({ title: editId ? '修改成功!' : '上架成功!', icon: 'success' });
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
    this._markDirty();
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

  removeQuickImage: function() {
    this._markDirty();
    this.setData({ quickImage: '' });
  },

  // 一键填充核心逻辑
  // ====== 核心重构：一键填充 + 状态自动重置 ======
  applyQuickFillAll: function() {
    this._markDirty();
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

  // ================= 套装子项管理 =================

  toggleBundleMode() {
    var isBundle = !this.data.isBundleMode;
    if (isBundle) {
      // 切换到套装模式：保存当前状态为空组，创建第一个子项
      this.setData({
        isBundleMode: true,
        bundleGroups: [],
        activeGroupIndex: 0
      });
      this.addBundleGroup();
    } else {
      // 切回普通模式：保存当前组状态，恢复
      if (this.data.activeGroupIndex >= 0) {
        this.saveActiveGroupState();
      }
      this.setData({
        isBundleMode: false,
        bundleGroups: [],
        activeGroupIndex: -1,
        colors: [], skuList: []
      });
    }
  },

  saveActiveGroupState() {
    var idx = this.data.activeGroupIndex;
    if (idx < 0 || idx >= this.data.bundleGroups.length) return;
    var groups = this.data.bundleGroups;
    groups[idx] = Object.assign({}, groups[idx], {
      colors: this.data.colors.slice(),
      sizeOptions: this.data.sizeOptions.map(function(s) { return { id: s.id, name: s.name, selected: s.selected }; }),
      skuList: this.data.skuList.slice(),
      sizeCategoryId: this.data.currentSizeCategoryId,
      sizeCategoryName: this.data.currentSizeCategoryName
    });
    this.setData({ bundleGroups: groups });
  },

  loadGroupState(idx) {
    var group = this.data.bundleGroups[idx];
    if (!group) return;
    this.setData({
      activeGroupIndex: idx,
      currentSizeCategoryId: group.sizeCategoryId || null,
      currentSizeCategoryName: group.sizeCategoryName || '',
      colors: group.colors || [],
      sizeOptions: group.sizeOptions || [],
      skuList: group.skuList || [],
      colorInput: ''
    });
  },

  selectBundleGroup(e) {
    this.saveActiveGroupState();
    this.loadGroupState(e.currentTarget.dataset.index);
  },

  addBundleGroup() {
    this._markDirty();
    var groups = this.data.bundleGroups.slice();
    // 新建子项继承当前主商品的尺码类型和尺码列表
    var data = this.data;
    groups.push({
      name: '',
      colors: ['图片色'],
      sizeOptions: data.sizeOptions.map(function(s) { return { id: s.id, name: s.name, selected: s.selected }; }),
      sizeCategoryId: data.currentSizeCategoryId,
      sizeCategoryName: data.currentSizeCategoryName,
      skuList: []
    });
    var newIdx = groups.length - 1;
    this.setData({ bundleGroups: groups });
    this.loadGroupState(newIdx);
    // 初始化新子项的默认 SKU（图片色 × 均码）
    this.generateSkuMatrix();
    // 自动滚动到子项名称输入框并聚焦
    wx.pageScrollTo({ selector: '#bundleGroupNameInput', duration: 200 });
    setTimeout(function(self) {
      self.setData({ bundleGroupNameFocus: true });
    }, 250, this);
    wx.showToast({ title: '已添加子项 ' + (newIdx + 1), icon: 'none' });
  },

  onBundleGroupNameBlur: function() {
    this.setData({ bundleGroupNameFocus: false });
  },

  removeBundleGroup(e) {
    this._markDirty();
    var idx = e.currentTarget.dataset.index;
    var groups = this.data.bundleGroups.slice();
    groups.splice(idx, 1);
    var newIdx = groups.length > 0 ? Math.min(idx, groups.length - 1) : -1;
    this.setData({ bundleGroups: groups, activeGroupIndex: newIdx });
    if (newIdx >= 0) {
      this.loadGroupState(newIdx);
    } else {
      this.setData({ colors: ['图片色'], skuList: [], sizeOptions: [] });
    }
  },

  onBundleGroupNameInput(e) {
    this._markDirty();
    var idx = this.data.activeGroupIndex;
    if (idx < 0) return;
    var groups = this.data.bundleGroups;
    groups[idx] = Object.assign({}, groups[idx], { name: e.detail.value });
    this.setData({ bundleGroups: groups });
  },

  // Override: in bundle mode, colors/sizes/SKUs belong to active group. After any change, auto-save.
  _afterBundleSkuChange() {
    if (this.data.isBundleMode && this.data.activeGroupIndex >= 0) {
      this.saveActiveGroupState();
    }
  },

  // ================= 草稿功能（后端数据库存储） =================
  // 向下兼容：恢复时对草稿中缺失的字段使用默认空值，多余的字段自动忽略

  collectDraftData() {
    var data = this.data;
    return {
      title: data.title,
      videoUrl: data.videoUrl || '',
      videoThumbPath: data.videoThumbPath || '',
      useVideoCover: data.useVideoCover || false,
      shippingInfo: data.shippingInfo,
      description: data.description,
      fabricCare: data.fabricCare,
      sizeChartTip: data.sizeChartTip,
      warmTips: data.warmTips,
      mediaList: data.mediaList,
      lookbookImgs: data.lookbookImgs,
      detailImgs: data.detailImgs,
      selectedStalls: data.selectedStalls,
      selectedTags: data.selectedTags,
      currentSizeCategoryId: data.currentSizeCategoryId,
      currentSizeCategoryName: data.currentSizeCategoryName,
      sizeOptions: data.sizeOptions,
      colors: data.colors,
      skuList: data.skuList.map(function(sku) {
        return {
          skuId: sku.skuId, sizeId: sku.sizeId, color: sku.color, size: sku.size,
          price: sku.price, stock: sku.stock, image: sku.image || '', _toBeRemoved: sku._toBeRemoved
        };
      }),
      manualRelated: data.manualRelated,
      displayPrice: data.displayPrice,
      // 套装模式
      isBundleMode: data.isBundleMode,
      activeGroupIndex: data.activeGroupIndex,
      bundleGroups: (data.bundleGroups || []).map(function(bg) {
        return {
          name: bg.name,
          colors: bg.colors,
          sizeOptions: bg.sizeOptions,
          sizeCategoryId: bg.sizeCategoryId,
          sizeCategoryName: bg.sizeCategoryName,
          skuList: (bg.skuList || []).map(function(sku) {
            return { skuId: sku.skuId, sizeId: sku.sizeId, color: sku.color, size: sku.size, price: sku.price, stock: sku.stock, image: sku.image || '', _toBeRemoved: sku._toBeRemoved };
          })
        };
      })
    };
  },

  // 保存草稿到后端：先上传所有临时图片到 CDN，再将 JSON 存入数据库
  saveDraft: async function() {
    // 套装模式：先存档当前子项
    if (this.data.isBundleMode && this.data.activeGroupIndex >= 0) {
      this.saveActiveGroupState();
    }
    var draftData = this.collectDraftData();

    wx.showLoading({ title: '保存草稿...', mask: true });
    try {
      await draft.saveDraft(draftData, this.uploadFile.bind(this), {
        draftType: this._draftType,
        relatedId: this._relatedId
      });
      this._lastDraftSavedAt = Date.now();
      // 保存成功：更新快照 & 关闭退出拦截
      this._lastSavedSnapshot = JSON.stringify(this.collectDraftData());
      if (this._alertEnabled) {
        wx.disableAlertBeforeUnload();
        this._alertEnabled = false;
      }
      wx.hideLoading();
      wx.showToast({ title: '草稿已保存', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      console.error('草稿保存失败:', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  clearDraft: async function() {
    try {
      await draft.removeDraft();
    } catch (e) {
      // ignore
    }
  },

  checkDraft: async function() {
    var self = this;
    var draftRes = await draft.loadDraft();
    if (!draftRes) return;

    var savedAt = draftRes.savedAt ? new Date(draftRes.savedAt).toLocaleString() : '未知时间';

    wx.showModal({
      title: '发现草稿',
      content: '上次编辑时间：' + savedAt + '\n\n是否恢复草稿内容？',
      confirmText: '恢复',
      cancelText: '忽略',
      success: function(res) {
        if (res.confirm) {
          self.restoreDraft(draftRes.draftData);
        } else {
          self.clearDraft();
        }
      }
    });
  },

  // 恢复草稿：向下兼容 — 缺失字段用默认值，多余字段自动忽略
  restoreDraft: function(draftData) {
    var data = this.data;
    // 安全取值辅助：draftData 中取不到时用默认值
    var safeGet = function(obj, key, defaultVal) {
      return (obj && obj[key] !== undefined) ? obj[key] : defaultVal;
    };

    // 图片已是 CDN URL，无需 validatePersistedUrls
    var mediaList = safeGet(draftData, 'mediaList', []);
    // mediaList 中的对象格式向下兼容：确保 {id, url, x, y} 结构
    mediaList = (mediaList || []).map(function(m) {
      if (typeof m === 'string') return { id: 'legacy_' + Date.now(), url: m, x: 0, y: 0 };
      return { id: m.id || ('legacy_' + Date.now()), url: m.url || '', x: m.x || 0, y: m.y || 0 };
    });

    var restored = {
      title: safeGet(draftData, 'title', ''),
      videoUrl: safeGet(draftData, 'videoUrl', ''),
      videoThumbPath: '',  // 临时路径草稿恢复后已失效，置空
      useVideoCover: safeGet(draftData, 'useVideoCover', false),
      shippingInfo: safeGet(draftData, 'shippingInfo', '付款后按排单顺序发货'),
      description: safeGet(draftData, 'description', ''),
      fabricCare: safeGet(draftData, 'fabricCare', ''),
      sizeChartTip: safeGet(draftData, 'sizeChartTip', ''),
      warmTips: safeGet(draftData, 'warmTips', ''),
      mediaList: mediaList,
      lookbookImgs: safeGet(draftData, 'lookbookImgs', []),
      detailImgs: safeGet(draftData, 'detailImgs', []),
      selectedStalls: safeGet(draftData, 'selectedStalls', []),
      selectedTags: safeGet(draftData, 'selectedTags', []),
      currentSizeCategoryId: safeGet(draftData, 'currentSizeCategoryId', data.currentSizeCategoryId),
      currentSizeCategoryName: safeGet(draftData, 'currentSizeCategoryName', data.currentSizeCategoryName),
      sizeOptions: safeGet(draftData, 'sizeOptions', data.sizeOptions),
      colors: safeGet(draftData, 'colors', []),
      skuList: safeGet(draftData, 'skuList', []),
      manualRelated: safeGet(draftData, 'manualRelated', []),
      displayPrice: safeGet(draftData, 'displayPrice', ''),
      isBundleMode: safeGet(draftData, 'isBundleMode', false),
      activeGroupIndex: safeGet(draftData, 'activeGroupIndex', -1),
      bundleGroups: safeGet(draftData, 'bundleGroups', [])
    };

    // 恢复套装子项到主字段
    if (restored.isBundleMode && restored.bundleGroups.length > 0) {
      if (restored.activeGroupIndex >= 0 && restored.activeGroupIndex < restored.bundleGroups.length) {
        var ag = restored.bundleGroups[restored.activeGroupIndex];
        restored.colors = ag.colors || [];
        restored.skuList = ag.skuList || [];
        restored.sizeOptions = ag.sizeOptions || [];
        restored.currentSizeCategoryId = ag.sizeCategoryId || null;
        restored.currentSizeCategoryName = ag.sizeCategoryName || '';
      }
    }

    this.setData(restored);
    this.refreshGrid(restored.mediaList);
    // 恢复后记录快照，关闭退出拦截
    this._lastSavedSnapshot = JSON.stringify(this.collectDraftData());
    if (this._alertEnabled) {
      wx.disableAlertBeforeUnload();
      this._alertEnabled = false;
    }
    wx.showToast({ title: '草稿已恢复', icon: 'success', duration: 1500 });
  },

  hasFormContent() {
    var d = this.data;
    return !!(d.title || (d.mediaList && d.mediaList.length > 0) ||
      (d.skuList && d.skuList.length > 0) ||
      (d.selectedStalls && d.selectedStalls.length > 0) ||
      (d.selectedTags && d.selectedTags.length > 0) ||
      (d.colors && d.colors.length > 0) ||
      d.description || d.fabricCare || d.sizeChartTip || d.warmTips ||
      (d.manualRelated && d.manualRelated.length > 0) ||
      (d.lookbookImgs && d.lookbookImgs.length > 0) ||
      (d.isBundleMode && d.bundleGroups && d.bundleGroups.length > 0) ||
      (d.detailImgs && d.detailImgs.length > 0));
  },

  // ========== 图片全屏预览 ==========

  // 通用安全预览：过滤空 URL，避免黑屏无法退出
  previewImageSafe: function(url, urlList) {
    var validUrls = (urlList || [url]).filter(function(u) { return u && u !== ''; });
    if (validUrls.length === 0) {
      return wx.showToast({ title: '图片已丢失，请重新上传', icon: 'none' });
    }
    // 确保 current 在有效列表中
    var current = (url && url !== '') ? url : validUrls[0];
    wx.previewImage({ current: current, urls: validUrls });
  },

  // A: 商品主图预览（支持左右滑动切换）
  previewMediaImage(e) {
    var index = e.currentTarget.dataset.index;
    var urls = this.data.mediaList.map(function(m) { return m.url; }).filter(function(u) { return u && u !== ''; });
    if (urls.length === 0) return this.previewImageSafe('', []);
    this.previewImageSafe(urls[index], urls);
  },

  // B: SKU 明细图预览
  previewSkuImage(e) {
    var index = e.currentTarget.dataset.index;
    var skuList = this.data.skuList;
    var urls = skuList.filter(function(s) { return s.image && s.image !== ''; }).map(function(s) { return s.image; });
    this.previewImageSafe(skuList[index].image, urls);
  },

  // C: 一键填充预览图（单张）
  previewQuickImage() {
    this.previewImageSafe(this.data.quickImage, [this.data.quickImage]);
  },

  // D: 批量设置预览图（单张）
  previewBatchImage() {
    this.previewImageSafe(this.data.batchImage, [this.data.batchImage]);
  },

  // E+F: Lookbook / Detail 图片预览
  previewExtraImage(e) {
    var type = e.currentTarget.dataset.type;
    var index = e.currentTarget.dataset.index;
    var urls = (type === 'lookbook' ? this.data.lookbookImgs : this.data.detailImgs).filter(function(u) { return u && u !== ''; });
    if (urls.length === 0) return this.previewImageSafe('', []);
    this.previewImageSafe(urls[index], urls);
  },

  // G: 搭配商品图片预览
  previewRelatedImage(e) {
    var index = e.currentTarget.dataset.index;
    var urls = this.data.manualRelated.map(function(r) { return r.coverUrl; }).filter(function(u) { return u && u !== ''; });
    if (urls.length === 0) return this.previewImageSafe('', []);
    this.previewImageSafe(urls[index], urls);
  },
});
