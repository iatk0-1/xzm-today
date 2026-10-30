const { getErrorMessage } = require('../../utils/error');
// pages/adminSalesDetail/adminSalesDetail.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    productId: null,
    managerId: '',
    productName: '',
    productArticleNo: '',
    // 统计概览
    overview: { soldItems: 0, soldQty: 0, totalAmount: 0, afterSaleCount: 0,
      afterSaleAmount: 0, afterSaleQty: 0, pendingReviewQty: 0 },
    // SKU 明细
    skus: [],
    skuTotal: 0, skuPage: 1, skuSize: 100, skuHasMore: false, skuLoading: false,
    // 关联订单
    orders: [],
    orderPage: 1,
    orderSize: 20,
    orderTotal: 0, orderLoading: false,
    // 筛选
    startDate: '',
    endDate: '',
    quickSelect: '',
    editingDateRange: { startDate: '', endDate: '', quickSelect: '' },
    showDateModal: false,
    today: ''
  },

  formatDate(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  },

  onLoad(options) {
    const productId = options.productId;
    const productName = decodeURIComponent(options.productName || '');
    const startDate = options.startDate || '';
    const endDate = options.endDate || '';

    this.setData({ productId, productName, startDate, endDate, managerId: options.managerId || '', today: this.formatDate(new Date()) });

    wx.setNavigationBarTitle({ title: productName || '商品销售详情' });

    return auth.ensureAuthenticated({ silent: true })
      .then(() => this.loadAll())
      .catch(err => {
        console.error('销售详情页认证恢复失败:', err);
        wx.showToast({ title: getErrorMessage(err, '登录状态恢复失败，请稍后重试'), icon: 'none' });
      });
  },

  loadAll() {
    return Promise.all([this.loadOverview(), this.loadSkus(), this.loadOrders(true)]);
  },

  salesUrl(suffix) {
    return '/admin/sales' + (this.data.managerId ? '/managers/' + encodeURIComponent(this.data.managerId) : '') + suffix;
  },

  loadOverview() {
    const requestId = (this._overviewRequestId || 0) + 1;
    this._overviewRequestId = requestId;
    this.setData({ overviewError: '' });
    const params = {};
    if (this.data.startDate) params.startDate = this.data.startDate;
    if (this.data.endDate) params.endDate = this.data.endDate;
    return api.get(this.salesUrl('/products/' + this.data.productId + '/overview'), params).then(res => {
      if (requestId !== this._overviewRequestId) return;
      this.setData({ productArticleNo: res.articleNo || '', overview: {
        soldItems: res.soldItems || 0,
        soldQty: res.soldQty || 0,
        totalAmount: res.totalAmount || 0,
        afterSaleCount: res.afterSaleQty != null ? res.afterSaleQty : (res.afterSaleCount || 0),
        afterSaleQty: res.afterSaleQty != null ? res.afterSaleQty : (res.afterSaleCount || 0),
        afterSaleAmount: res.afterSaleAmount || 0,
        pendingReviewQty: res.pendingReviewQty || 0,
        ...(this.data.managerId ? { salesCommission: res.salesCommission || 0, refundedCommission: res.refundedCommission || 0 } : {})
      }});
    }).catch(err => { if (requestId !== this._overviewRequestId) return; console.error('加载概览失败:', err); this.setData({ overviewError: getErrorMessage(err, '加载概览失败') }); });
  },

  dateParams() {
    const params = {};
    if (this.data.startDate) params.startDate = this.data.startDate;
    if (this.data.endDate) params.endDate = this.data.endDate;
    return params;
  },

  loadSkus(reset = true) {
    reset = reset !== false;
    if (!reset && (this.data.skuLoading || !this.data.skuHasMore)) return;
    const requestId = reset ? (this._skuRequestId || 0) + 1 : this._skuRequestId;
    this._skuRequestId = requestId;
    const page = reset ? 1 : this.data.skuPage + 1;
    const filters = reset ? this.dateParams() : this._skuFilters;
    this._skuFilters = filters;
    this.setData({ skuError: '', skuLoading: true,
      ...(reset ? { skus: [], skuPage: 1, skuTotal: 0, skuHasMore: false } : {}) });
    return api.get(this.salesUrl('/query/products/' + this.data.productId + '/skus'), {
      ...filters, page, size: this.data.skuSize
    }).then(res => {
      if (requestId !== this._skuRequestId) return;
      const content = (res.content || []).map(item => ({ ...item, skuKey: JSON.stringify([item.skuSpec, item.skuSize]) }));
      const skus = reset ? content : this.data.skus.concat(content);
      const total = Number(res.totalElements) || 0;
      this.setData({ skus, skuPage: page, skuTotal: total, skuHasMore: content.length > 0 && skus.length < total });
    }).catch(err => {
      if (requestId !== this._skuRequestId) return;
      console.error('加载SKU列表失败:', err);
      this.setData({ skuError: getErrorMessage(err, '加载SKU列表失败') });
    }).finally(() => { if (requestId === this._skuRequestId) this.setData({ skuLoading: false }); });
  },

  retrySkus() { return this.loadSkus(this.data.skus.length === 0); },
  loadMoreSkus() { return this.loadSkus(false); },

  loadOrders(reset = true) {
    reset = reset !== false;
    if (!reset && (this.data.orderLoading || this.data.orders.length >= this.data.orderTotal)) return;
    const requestId = reset ? (this._orderRequestId || 0) + 1 : this._orderRequestId;
    this._orderRequestId = requestId;
    const page = reset ? 1 : this.data.orderPage + 1;
    const filters = reset ? this.dateParams() : this._orderFilters;
    this._orderFilters = filters;
    this.setData({ orderError: '', orderLoading: true,
      ...(reset ? { orders: [], orderPage: 1, orderTotal: 0 } : {}) });
    return api.get(this.salesUrl('/query/products/' + this.data.productId + '/orders'), {
      ...filters, page, size: this.data.orderSize
    }).then(res => {
      if (requestId !== this._orderRequestId) return;
      const items = (res.content || []).map(r => ({
        ...r, createdAtDisplay: this.formatTime(r.createdAt), statusDisplay: this.statusDisplay(r.status),
        items: (r.items || []).map(oi => ({ ...oi, bundleParsed: this.parseBundle(oi.bundleConfig) }))
      }));
      this.setData({ orders: reset ? items : this.data.orders.concat(items), orderPage: page, orderTotal: res.totalElements || 0 });
    }).catch(err => {
      if (requestId !== this._orderRequestId) return;
      console.error('加载订单列表失败:', err);
      this.setData({ orderError: getErrorMessage(err, '加载订单列表失败') });
    }).finally(() => { if (requestId === this._orderRequestId) this.setData({ orderLoading: false }); });
  },

  retryOrders() { return this.loadOrders(this.data.orders.length === 0); },
  loadMoreOrders() { return this.loadOrders(false); },

  onUnload() {
    this._overviewRequestId = (this._overviewRequestId || 0) + 1;
    this._skuRequestId = (this._skuRequestId || 0) + 1;
    this._orderRequestId = (this._orderRequestId || 0) + 1;
  },

  showDateRangeSelector() {
    this.setData({
      editingDateRange: {
        startDate: this.data.startDate,
        endDate: this.data.endDate,
        quickSelect: this.data.quickSelect
      },
      today: this.formatDate(new Date()),
      showDateModal: true
    });
  },

  closeDateModal() {
    this.setData({ showDateModal: false });
  },

  selectDateRange(e) {
    const type = e.currentTarget.dataset.type;
    const today = new Date();
    let start = today;
    if (type === '7days') start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    if (type === '30days') start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    if (type === 'month') start = new Date(today.getFullYear(), today.getMonth(), 1);
    this.setData({ editingDateRange: {
      startDate: this.formatDate(start),
      endDate: this.formatDate(today),
      quickSelect: type
    } });
  },

  onStartDateChange(e) {
    this.setData({ editingDateRange: {
      ...this.data.editingDateRange,
      startDate: e.detail.value,
      quickSelect: ''
    } });
  },

  onEndDateChange(e) {
    this.setData({ editingDateRange: {
      ...this.data.editingDateRange,
      endDate: e.detail.value,
      quickSelect: ''
    } });
  },

  confirmDateRange() {
    const range = this.data.editingDateRange;
    if (range.startDate && range.endDate && range.startDate > range.endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.setData({
      startDate: range.startDate,
      endDate: range.endDate,
      quickSelect: range.quickSelect,
      showDateModal: false
    }, () => this.loadAll());
  },

  clearDateRange() {
    this.setData({ startDate: '', endDate: '', quickSelect: '' }, () => this.loadAll());
  },

  formatTime(raw) {
    if (!raw) return '';
    try {
      var d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw);
      var pad = n => n < 10 ? '0' + n : '' + n;
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) { return String(raw); }
  },

  statusDisplay(s) {
    const m = { 'stocking': '备货中', 'paid': '待发货', 'partial_shipped': '部分发货', 'shipped': '已发货', 'completed': '已完成', 'cancelled': '已取消' };
    return m[s] || s;
  },

  parseBundle(json) {
    if (!json) return null;
    if (typeof json !== 'string') return json;
    try {
      return JSON.parse(json);
    } catch (e) { return null; }
  }
});
