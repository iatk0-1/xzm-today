// miniprogram/pages/liveRoomDetail/detail.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    sessionId: null,
    session: {},
    products: [],
    canBuy: false,
    isAdmin: false,
    showStartModal: false,
    titleInput: '',
    filteredProducts: [], // 新增：用于展示搜索过滤后的商品列表
    searchKeyword: '',    // 新增：搜索关键词

    // SKU 选择面板相关
    showSku: false,
    currentProduct: null,
    currentAction: '',
    uniqueColors: [],
    uniqueSizes: [],
    selectedColor: '',
    selectedSize: '',
    currentSkuPrice: null,
    currentSkuStock: null,
    currentSkuId: null,
    currentSkuImage: '',

    // 转换商品相关
    showConvertModal: false,
    convertProduct: null
  },

  onLoad: function(options) {
    if (options.id) {
      this.setData({ sessionId: options.id });
      this.loadSessionDetail(options.id);
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }

    // 检查是否为管理员
    this.checkAdmin();
  },

  onShow: function() {
    // 页面显示时重新加载session 详情（包含商品列表）
    if (this.data.sessionId) {
      this.loadSessionDetail(this.data.sessionId);
    }
  },

  // 检查管理员权限
  checkAdmin: function() {
    const isAdmin = auth.isAdmin();
    console.log('checkAdmin: auth.isAdmin() =', isAdmin);
    this.setData({ isAdmin: isAdmin });
  },

  // 加载场次详情
  loadSessionDetail: async function(sessionId) {
    wx.showLoading({ title: '加载中...' });

    try {
      const detail = await api.get(`/live-sessions/${sessionId}`);
      console.log('session detail:', detail, 'status:', detail?.status);

      // 如果后端返回 null 或 undefined，说明场次已被删除或不存在
      if (!detail || !detail.id) {
        console.warn('场次详情不存在，返回上一页');
        wx.hideLoading();
        wx.showToast({ title: '该直播场次不存在或已结束', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      // 为每个商品计算总库存
      const products = (detail?.products || []).map(product => {
        let totalStock = 0;
        if (product.skuMatrix && product.skuMatrix.length > 0) {
          totalStock = product.skuMatrix.reduce((sum, sku) => sum + (sku.stock || 0), 0);
        }
        return { ...product, totalStock };
      });

      // 动态计算已直播的时长
      let durationStr = '';
      if (detail && detail.startedAt) {
        const startTs = this.normalizeTimestamp(detail.startedAt);
        const endTs = detail.status === 'live' ? Date.now() : this.normalizeTimestamp(detail.endedAt);
        if (startTs > 0 && endTs >= startTs) {
          const diffTotalMins = Math.floor((endTs - startTs) / 60000);
          const hours = Math.floor(diffTotalMins / 60);
          const mins = diffTotalMins % 60;
          durationStr = hours > 0 ? `${hours}小时${mins}分钟` : `${mins}分钟`;
        }
      }

      const formattedSession = detail ? {
        ...detail,
        startedAt: this.formatDateTime(detail.startedAt),
        endedAt: this.formatDateTime(detail.endedAt),
        durationStr: durationStr
      } : {};

      this.setData({
        session: formattedSession,
        products: products,
        filteredProducts: products, // 初始化时，展示列表就是全部商品
        canBuy: detail?.status === 'live'
      });

      wx.hideLoading();
    } catch (err) {
      console.error('加载场次详情失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '加载失败，该场次可能已结束', icon: 'none' });
      // 如果是 404 错误，说明场次已被删除，返回上一页
      if (err.statusCode === 404) {
        setTimeout(() => wx.navigateBack(), 1500);
      }
    }
  },

  // 返回
  goBack: function() {
    wx.navigateBack();
  },

  // 后端可能返回秒级(10位)或毫秒级(13位)时间戳，这里统一转毫秒
  normalizeTimestamp: function(ts) {
    if (ts === null || ts === undefined || ts === '') return 0;
    // 处理 ISO 日期字符串 (如 "2026-05-28T15:30:00+08:00")
    if (typeof ts === 'string' && ts.includes('T')) {
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    }
    const raw = Number(ts);
    if (!Number.isFinite(raw)) return 0;
    return raw < 1e12 ? raw * 1000 : raw;
  },

  formatDateTime: function(ts) {
    if (ts === null || ts === undefined || ts === '') return '';
    const date = new Date(this.normalizeTimestamp(ts));
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = this.padZero(date.getMonth() + 1);
    const day = this.padZero(date.getDate());
    const hour = this.padZero(date.getHours());
    const minute = this.padZero(date.getMinutes());
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },

  padZero: function(num) {
    return num < 10 ? `0${num}` : `${num}`;
  },

  // 输入标题
  onTitleInput: function(e) {
    this.setData({ titleInput: e.detail.value });
  },

  // 隐藏弹窗
  hideStartModal: function() {
    this.setData({
      showStartModal: false,
      titleInput: ''
    });
  },

  // 确认开启直播
  confirmStartSession: async function() {
    const { titleInput } = this.data;

    if (!titleInput || !titleInput.trim()) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '开启中...' });

    try {
      await api.post('/live-sessions', { title: titleInput.trim() });
      wx.hideLoading();
      this.hideStartModal();
      wx.showToast({ title: '直播已开启', icon: 'success' });
      // 重新加载详情
      this.loadSessionDetail(this.data.sessionId);
    } catch (err) {
      wx.hideLoading();
      console.error('开启直播失败:', err);
      wx.showToast({ title: err.message || '开启失败', icon: 'none' });
    }
  },

  // 结束直播
  endSession: async function() {
    wx.showModal({
      title: '结束直播',
      content: '确定要结束本场直播吗？结束后将无法直接购买直播商品。',
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '结束中...' });
          try {
            const endResult = await api.post(`/live-sessions/${this.data.sessionId}/end`);
            console.log('结束直播接口返回:', endResult);

            wx.hideLoading();
            wx.showToast({ title: '直播已结束', icon: 'success' });

            // 等待后端数据同步
            setTimeout(() => {
              this.loadSessionDetail(this.data.sessionId);
            }, 500);
          } catch (err) {
            wx.hideLoading();
            console.error('结束直播失败:', err);
            wx.showToast({ title: err.message || '结束失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 显示商品上架页面
  showProductPublish: function() {
    wx.navigateTo({
      url: `/pages/liveRoomPublish/publish?sessionId=${this.data.sessionId}`
    });
  },

  // ================= SKU 选择面板相关 =================
  openSkuPanel(e) {
    const product = e.currentTarget.dataset.product;
    const action = e.currentTarget.dataset.action;
    let colors = [];
    let sizes = [];

    if (product.skuMatrix && product.skuMatrix.length > 0) {
      // 后端返回：color (颜色), size (尺码)
      colors = [...new Set(product.skuMatrix.map(s => s.color || ''))];
      sizes = [...new Set(product.skuMatrix.map(s => s.size || ''))];
      // 过滤空值
      colors = colors.filter(c => c);
      sizes = sizes.filter(s => s);
    }

    this.setData({
      currentProduct: product,
      currentAction: action,
      uniqueColors: colors,
      uniqueSizes: sizes,
      selectedColor: colors.length === 1 ? colors[0] : '',
      selectedSize: sizes.length === 1 ? sizes[0] : '',
      currentSkuPrice: null,
      currentSkuStock: null,
      currentSkuId: null,
      currentSkuImage: product.coverUrl,
      showSku: true
    });
    this.checkSkuMatch();
  },

  closeSkuPanel() {
    this.setData({ showSku: false });
  },

  selectColor(e) {
    this.setData({ selectedColor: e.currentTarget.dataset.color });
    this.checkSkuMatch();
  },

  selectSize(e) {
    this.setData({ selectedSize: e.currentTarget.dataset.size });
    this.checkSkuMatch();
  },

  checkSkuMatch() {
    const { currentProduct, selectedColor, selectedSize } = this.data;
    if (selectedColor && selectedSize && currentProduct.skuMatrix) {
      const match = currentProduct.skuMatrix.find(s =>
        s.color === selectedColor && s.size === selectedSize
      );
      if (match) {
        // 有 SKU 信息，使用 SKU 的价格、库存和图片
        this.setData({
          currentSkuPrice: match.retailPrice || match.price,
          currentSkuStock: match.stockMain || match.stock,
          currentSkuId: match.skuId,
          currentSkuImage: match.imageUrl || currentProduct.coverUrl
        });
      } else {
        // 没有匹配的 SKU 信息，库存为 0，使用商品封面图
        this.setData({
          currentSkuPrice: null,
          currentSkuStock: 0,
          currentSkuId: null,
          currentSkuImage: currentProduct.coverUrl
        });
      }
    }
  },

  confirmAddToCart(e) {
    const actionType = e.currentTarget.dataset.action;

    const { currentProduct, selectedColor, selectedSize, currentSkuPrice, currentSkuStock, currentSkuId, uniqueColors, uniqueSizes } = this.data;
    if (!currentProduct) return;

    if (uniqueColors.length > 0 && !selectedColor) {
      return wx.showToast({ title: '请选择颜色', icon: 'none' });
    }
    if (uniqueSizes.length > 0 && !selectedSize) {
      return wx.showToast({ title: '请选择尺码', icon: 'none' });
    }

    // 找到匹配的 SKU
    const sku = currentProduct.skuMatrix.find(s =>
      s.color === selectedColor && s.size === selectedSize
    );

    if (!sku) {
      return wx.showToast({ title: '无此规格商品', icon: 'none' });
    }

    if (actionType === 'cart') {
      // 加入购物车
      this.addToCartWithSku(sku);
    } else {
      // 立即购买
      this.buyNowWithSku(sku);
    }

    this.setData({ showSku: false });
  },

  addToCartWithSku: async function(sku) {
    const { currentProduct, selectedColor, selectedSize } = this.data;

    wx.showLoading({ title: '添加中...' });

    try {
      await api.post('/cart/items', {
        productId: currentProduct.id,
        skuId: sku.skuId || 0,
        color: selectedColor || sku.color || '默认',
        size: selectedSize || sku.size || '均码',
        count: 1
      });

      wx.hideLoading();
      wx.showToast({ title: '已加入购物车', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('添加购物车失败:', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  buyNowWithSku: function(sku) {
    const { currentProduct, selectedColor, selectedSize } = this.data;

    // 构造购买数据
    const checkoutItem = {
      productId: currentProduct.id,
      skuId: sku.skuId || 0,
      name: currentProduct.name,
      image: sku.imageUrl || currentProduct.coverUrl,
      selectedColor: selectedColor || sku.color || '默认',
      selectedSize: selectedSize || sku.size || '均码',
      price: sku.retailPrice || sku.price || currentProduct.retailPrice,
      count: 1,
      selected: true
    };

    // 保存到本地存储并跳转结算页
    wx.setStorageSync('checkoutItems', [checkoutItem]);
    wx.navigateTo({
      url: '/pages/checkout/checkout'
    });
  },

  // 跳转到正常商品详情
  goToNormalProduct: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    });
  },

  // 编辑商品
  editProduct: function(e) {
    const product = e.currentTarget.dataset.product;
    wx.navigateTo({
      url: `/pages/liveRoomPublish/publish?sessionId=${this.data.sessionId}&productId=${product.id}`
    });
  },

  // 删除商品
  deleteProduct: function(e) {
    const product = e.currentTarget.dataset.product;
    wx.showModal({
      title: '删除商品',
      content: `确定要从本场直播中删除"${product.name}"吗？此操作不可撤销。`,
      confirmColor: '#e04040',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            await api.delete(`/live-products/${product.id}`);
            wx.hideLoading();
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadSessionDetail(this.data.sessionId);
          } catch (err) {
            wx.hideLoading();
            console.error('删除商品失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 点击商品卡片事件（管理员编辑修改，普通用户只能看）
  onProductClick: function(e) {
    const product = e.currentTarget.dataset.product;
    if (this.data.isAdmin) {
      // 如果是管理员点击进去，直接跳转去修改/发布商品的页面
      wx.navigateTo({
        url: `/pages/liveRoomPublish/publish?sessionId=${this.data.sessionId}&productId=${product.id}`
      });
    } else {
      // 如果是普通用户点击进去，没有修改权限，只能看常规商品详情
      if (product.convertedToProductId) {
        wx.navigateTo({
          url: `/pages/detail/detail?id=${product.convertedToProductId}`
        });
      } else {
        wx.showToast({ title: '当前为直播商品，请直接在右下角下单', icon: 'none' });
      }
    }
  },

  // ================= 转换商品相关 =================
  // 显示转换弹窗
  showConvertModal: function(e) {
    const product = e.currentTarget.dataset.product;
    this.setData({
      convertProduct: product,
      showConvertModal: true
    });
  },

  // 隐藏转换弹窗
  hideConvertModal: function() {
    this.setData({
      showConvertModal: false,
      convertProduct: null
    });
  },

  // 确认转换
  confirmConvert: async function() {
    const { convertProduct, sessionId } = this.data;
    if (!convertProduct || !convertProduct.id) {
      wx.showToast({ title: '商品数据异常', icon: 'none' });
      return;
    }

    // 关闭弹窗
    this.hideConvertModal();

    // 跳转到 admin 页面，带入直播商品数据
    wx.navigateTo({
      url: `/pages/admin/admin?convertFromLiveProductId=${convertProduct.id}&sessionId=${sessionId}`
    });
  },
  // ================= 搜索功能相关 =================
  // 监听搜索输入（纯前端秒搜）
  onSearchInput: function(e) {
    const keyword = e.detail.value.trim().toLowerCase();
    const { products } = this.data;

    // 如果没有输入，展示全部
    if (!keyword) {
      this.setData({
        searchKeyword: e.detail.value,
        filteredProducts: products
      });
      return;
    }

    // 模糊匹配商品名称
    const filtered = products.filter(p => p.name.toLowerCase().includes(keyword));
    this.setData({
      searchKeyword: e.detail.value,
      filteredProducts: filtered
    });
  },

  // 清空搜索框
  clearSearch: function() {
    this.setData({
      searchKeyword: '',
      filteredProducts: this.data.products
    });
  },
});