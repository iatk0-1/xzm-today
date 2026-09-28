const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    productId: '', productName: '',
    overview: { soldQty: 0, pendingQty: 0, shippedQty: 0,
      afterSaleQty: 0, pendingReviewQty: 0, approvedQty: 0, receivedQty: 0, refundedQty: 0 },
    overviewLoading: false, overviewError: false,
    skus: [], skuPage: 1, skuSize: 50, skuTotal: 0,
    skuLoading: false, skuError: false,
    orders: [], orderPage: 1, orderSize: 20, orderTotal: 0,
    orderLoading: false, orderError: false,
    startDate: '', endDate: '', quickSelect: '',
    editingDateRange: { startDate: '', endDate: '', quickSelect: '' },
    showDateModal: false, today: ''
  },

  formatDate(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  },
  onLoad(options) {
    if (!options.productId || !/^\d+$/.test(options.productId)) {
      wx.showToast({ title: '商品参数丢失', icon: 'none' });
      return;
    }
    const productName = decodeURIComponent(options.productName || '');
    this.setData({ productId: options.productId, productName,
      startDate: options.startDate || '', endDate: options.endDate || '',
      today: this.formatDate(new Date()) });
    wx.setNavigationBarTitle({ title: productName || '商品出货详情' });
    return auth.ensureAuthenticated({ silent: true }).then(() => this.loadAll()).catch(err => {
      console.error('商品出货详情页认证失败:', err);
      wx.showToast({ title: '登录状态恢复失败，请重试', icon: 'none' });
    });
  },
  onShow() {
    if (this._hasShown) return this.loadAll(true);
    this._hasShown = true;
  },
  dateParams() {
    const params = {};
    if (this.data.startDate) params.startDate = this.data.startDate;
    if (this.data.endDate) params.endDate = this.data.endDate;
    return params;
  },
  loadAll(preserveItems = false) {
    return Promise.all([this.loadOverview(), this.loadSkus(true, preserveItems),
      this.loadOrders(true, preserveItems)]);
  },
  loadOverview() {
    const id = (this.overviewRequestId || 0) + 1;
    this.overviewRequestId = id;
    this.setData({ overviewLoading: true, overviewError: false });
    return api.get('/admin/sales/shipping/products/' + this.data.productId + '/overview', this.dateParams())
      .then(res => {
        if (id !== this.overviewRequestId) return;
        this.setData({ overview: {
          soldQty: Number(res.sold_qty) || 0,
          pendingQty: Number(res.pending_qty) || 0,
          shippedQty: Number(res.shipped_qty) || 0,
          afterSaleQty: Number(res.after_sale_qty) || 0,
          pendingReviewQty: Number(res.pending_review_qty) || 0,
          approvedQty: Number(res.approved_qty) || 0,
          receivedQty: Number(res.received_qty) || 0,
          refundedQty: Number(res.refunded_qty) || 0
        } });
      }).catch(err => {
        if (id !== this.overviewRequestId) return;
        console.error('加载商品出货概览失败:', err);
        this.setData({ overviewError: true });
      }).finally(() => {
        if (id === this.overviewRequestId) this.setData({ overviewLoading: false });
      });
  },
  loadSkus(reset, preserveItems = false) {
    if (!reset && (this.data.skuLoading || this.data.skus.length >= this.data.skuTotal)) return Promise.resolve();
    const id = reset ? (this.skuRequestId || 0) + 1 : this.skuRequestId;
    this.skuRequestId = id;
    const page = reset ? 1 : this.data.skuPage + 1;
    if (reset && !preserveItems) {
      this.setData({ skus: [], skuPage: 1, skuTotal: 0, skuError: false });
    }
    this.setData({ skuLoading: true });
    return api.get('/admin/sales/shipping/query', {
      ...this.dateParams(), productId: this.data.productId,
      page, size: this.data.skuSize
    }).then(res => {
      if (id !== this.skuRequestId) return;
      const rows = res.content || [];
      this.setData({ skus: reset ? rows : this.data.skus.concat(rows),
        skuPage: page, skuTotal: Number(res.totalElements) || 0, skuError: false });
    }).catch(err => {
      if (id !== this.skuRequestId) return;
      console.error('加载商品 SKU 出货明细失败:', err);
      this.setData({ skuError: true });
    }).finally(() => {
      if (id === this.skuRequestId) this.setData({ skuLoading: false });
    });
  },
  loadMoreSkus() { return this.loadSkus(false); },
  retrySkus() { return this.loadSkus(true); },
  loadOrders(reset, preserveItems = false) {
    if (!reset && (this.data.orderLoading || this.data.orders.length >= this.data.orderTotal)) return Promise.resolve();
    const id = reset ? (this.orderRequestId || 0) + 1 : this.orderRequestId;
    this.orderRequestId = id;
    const page = reset ? 1 : this.data.orderPage + 1;
    if (reset && !preserveItems) {
      this.setData({ orders: [], orderPage: 1, orderTotal: 0, orderError: false });
    }
    this.setData({ orderLoading: true });
    return api.get('/admin/sales/shipping/products/' + this.data.productId + '/orders', {
      ...this.dateParams(), page, size: this.data.orderSize
    }).then(res => {
      if (id !== this.orderRequestId) return;
      const rows = (res.content || []).map(order => ({ ...order,
        createdAtDisplay: this.formatTime(order.createdAt),
        statusDisplay: this.statusDisplay(order.status),
        items: (order.items || []).map(item => ({ ...item,
          bundleParsed: this.parseBundle(item.bundleConfig)
        }))
      }));
      this.setData({ orders: reset ? rows : this.data.orders.concat(rows),
        orderPage: page, orderTotal: Number(res.totalElements) || 0, orderError: false });
    }).catch(err => {
      if (id !== this.orderRequestId) return;
      console.error('加载商品关联订单失败:', err);
      this.setData({ orderError: true });
    }).finally(() => {
      if (id === this.orderRequestId) this.setData({ orderLoading: false });
    });
  },
  loadMoreOrders() { return this.loadOrders(false); },
  retryOrders() { return this.loadOrders(true); },
  formatTime(raw) {
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return String(raw);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },
  statusDisplay(status) {
    const names = { stocking: '备货中', paid: '待发货', partial_shipped: '部分发货',
      shipped: '已发货', completed: '已完成' };
    return names[status] || status;
  },
  parseBundle(value) {
    if (!value) return null;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (err) { return null; }
  },
  goToOrder(e) {
    wx.navigateTo({ url: '/pages/adminOrderDetail/adminOrderDetail?id=' + e.currentTarget.dataset.id });
  },
  showDateRangeSelector() {
    this.setData({ editingDateRange: {
      startDate: this.data.startDate, endDate: this.data.endDate,
      quickSelect: this.data.quickSelect
    }, today: this.formatDate(new Date()), showDateModal: true });
  },
  closeDateModal() { this.setData({ showDateModal: false }); },
  selectDateRange(e) {
    const type = e.currentTarget.dataset.type;
    const today = new Date();
    let start = today;
    if (type === '7days') start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    if (type === '30days') start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    if (type === 'month') start = new Date(today.getFullYear(), today.getMonth(), 1);
    this.setData({ editingDateRange: {
      startDate: this.formatDate(start), endDate: this.formatDate(today), quickSelect: type
    } });
  },
  onStartDateChange(e) {
    this.setData({ editingDateRange: { ...this.data.editingDateRange,
      startDate: e.detail.value, quickSelect: '' } });
  },
  onEndDateChange(e) {
    this.setData({ editingDateRange: { ...this.data.editingDateRange,
      endDate: e.detail.value, quickSelect: '' } });
  },
  confirmDateRange() {
    const range = this.data.editingDateRange;
    if (range.startDate && range.endDate && range.startDate > range.endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.setData({ startDate: range.startDate, endDate: range.endDate,
      quickSelect: range.quickSelect, showDateModal: false }, () => this.loadAll());
  },
  clearDateRange() {
    this.setData({ startDate: '', endDate: '', quickSelect: '' }, () => this.loadAll());
  }
});
