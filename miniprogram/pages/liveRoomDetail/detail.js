const { getErrorMessage } = require('../../utils/error');
const pageSync = require('../../utils/pageSync');
// miniprogram/pages/liveRoomDetail/detail.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const draft = require('../../utils/draft');
const productSkuPanel = require('../../utils/productSkuPanel');

Page(pageSync.wrap({
  data: {
    draftCount: 0,
    sessionId: null,
    session: {},
    products: [],
    canBuy: false,
    isAdmin: false,
    showStartModal: false,
    titleInput: '',
    filteredProducts: [], // 新增：用于展示搜索过滤后的商品列表
    searchKeyword: '',    // 新增：搜索关键词

    ...productSkuPanel.initialData,

    // 转换商品相关
    showConvertModal: false,
    convertProduct: null
  },

  async refreshDraftCount() {
    if (!auth.isAdmin() || !this.data.sessionId) return;
    try { const value = await draft.summary({ sessionId: this.data.sessionId }); this.setData({ draftCount: Number(value.sessionCount) }); }
    catch (error) { console.warn('加载本场草稿数量失败:', error); }
  },
  goToDraftBox() { wx.navigateTo({ url: '/pages/productDrafts/index?sessionId=' + encodeURIComponent(this.data.sessionId) }); },

  onLoad: function(options) {
    if (options.id) {
      this.setData({ sessionId: options.id });
      this.loadSessionDetail(options.id);
      // 每次进入详情页，观看人数 +1（静默调用，不阻塞页面）
      api.post(`/live-sessions/${options.id}/view`).catch(() => {});
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }

    // 检查是否为管理员
    this.checkAdmin();
  },

  onShow: function() {
    this.refreshDraftCount();
    this.checkAdmin();
  },

  // 检查管理员权限
  checkAdmin: function() {
    const isAdmin = auth.isAdmin();
    this.setData({ isAdmin: isAdmin });
  },

  // 加载场次详情
  loadSessionDetail: async function(sessionId) {
    wx.showLoading({ title: '加载中...' });

    try {
      await auth.ensureAuthenticated({ silent: true });
      const detail = await api.get(`/live-sessions/${sessionId}`);

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
        let hasUnlimited = false;
        if (product.skuMatrix && product.skuMatrix.length > 0) {
          for (const sku of product.skuMatrix) {
            if (sku.unlimitedStock) {
              hasUnlimited = true;
              break;
            }
            totalStock += (sku.stock || 0);
          }
        }
        if (hasUnlimited) {
          totalStock = 1000000000;
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
      wx.showToast({ title: getErrorMessage(err, '加载失败，该场次可能已结束'), icon: 'none' });
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

    // 字符串：用 Date.parse 处理（支持 ISO、空格分隔等格式）
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      if (!Number.isNaN(parsed)) return parsed;
    }

    // 数字：epoch 秒（< 1e12）或毫秒（>= 1e12）
    const raw = Number(ts);
    if (Number.isFinite(raw) && raw > 0) {
      return raw < 1e12 ? raw * 1000 : raw;
    }

    return 0;
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
      wx.showToast({ title: getErrorMessage(err, '开启失败'), icon: 'none' });
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
            await api.post(`/live-sessions/${this.data.sessionId}/end`);

            wx.hideLoading();
            wx.showToast({ title: '直播已结束', icon: 'success' });

            const detail = await api.get(`/live-sessions/${this.data.sessionId}`);
            this.setData({ session: { ...this.data.session, status: detail.status, endedAt: this.formatDateTime(detail.endedAt) }, canBuy: false });
          } catch (err) {
            wx.hideLoading();
            console.error('结束直播失败:', err);
            wx.showToast({ title: getErrorMessage(err, '结束失败'), icon: 'none' });
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

  // 商品购买弹窗统一复用首页布局和多规格已选清单。
  ...productSkuPanel.methods,
  onUnload() { this.disposeSkuPromotions(); },
  openSkuPanel(e) {
    if (!this.data.canBuy) return wx.showToast({ title: '直播已结束，无法购买', icon: 'none' });
    const product = { ...e.currentTarget.dataset.product, productType: 'live', sessionStatus: this.data.session.status };
    this.setData({ isStallManager: !!auth.isStallManager() });
    return productSkuPanel.methods.openSkuPanel.call(this, { ...e,
      currentTarget: { ...e.currentTarget, dataset: { ...e.currentTarget.dataset, product } } });
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
            this.setData({ products: this.data.products.filter(item => String(item.id) !== String(product.id)), filteredProducts: this.data.filteredProducts.filter(item => String(item.id) !== String(product.id)) });
          } catch (err) {
            wx.hideLoading();
            console.error('删除商品失败:', err);
            wx.showToast({ title: getErrorMessage(err, '删除失败'), icon: 'none' });
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

  onShareAppMessage: function() {
    const { session } = this.data;
    return {
      title: session.title || '直播详情',
      path: `/pages/liveRoomDetail/detail?id=${this.data.sessionId}`,
      imageUrl: ''
    };
  },

  onShareTimeline: function() {
    const { session } = this.data;
    return {
      title: session.title || '直播详情',
      query: `id=${this.data.sessionId}`,
      imageUrl: ''
    };
  },
}, async function(changes) {
  changes.filter(item => item.entity === 'live-products' && item.product && String(item.sessionId) === String(this.data.sessionId))
    .forEach(item => {
      if (!this.data.products.some(product => String(product.id) === item.id)) {
        const product = item.product;
        const totalStock = (product.skuMatrix || []).some(sku => sku.unlimitedStock) ? 1000000000
          : (product.skuMatrix || []).reduce((sum, sku) => sum + Number(sku.stock || 0), 0);
        this.setData({ products: this.data.products.concat({ ...product, totalStock }) });
      }
    });
  await pageSync.updateList(this, changes, {
    entity: 'live-products', field: 'products', url: id => '/live-products/' + id,
    normalize: product => ({ ...product, totalStock: (product.skuMatrix || []).some(sku => sku.unlimitedStock) ? 1000000000 : (product.skuMatrix || []).reduce((sum, sku) => sum + Number(sku.stock || 0), 0) })
  });
  const keyword = this.data.searchKeyword.trim().toLowerCase();
  this.setData({ filteredProducts: this.data.products.filter(product => !keyword || String(product.name || '').toLowerCase().includes(keyword)) });
}));
