// pages/adminSalesDetail/adminSalesDetail.js
const api = require('../../utils/api');

Page({
  data: {
    productId: null,
    productName: '',
    // 统计概览
    overview: { soldItems: 0, soldQty: 0, totalAmount: 0, afterSaleCount: 0, afterSaleAmount: 0 },
    // SKU 明细
    skus: [],
    skuTotal: 0,
    // 关联订单
    orders: [],
    orderPage: 1,
    orderSize: 20,
    orderTotal: 0,
    // 筛选
    startDate: '',
    endDate: '',
    today: ''
  },

  onLoad(options) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');

    const productId = options.productId;
    const productName = decodeURIComponent(options.productName || '');
    const startDate = options.startDate || '';
    const endDate = options.endDate || '';

    this.setData({ productId, productName, startDate, endDate, today: y + '-' + m + '-' + d });

    wx.setNavigationBarTitle({ title: productName || '商品销售详情' });

    this.loadAll();
  },

  loadAll() {
    this.loadOverview();
    this.loadSkus();
    this.loadOrders(true);
  },

  loadOverview() {
    const params = {};
    if (this.data.startDate) params.startDate = this.data.startDate;
    if (this.data.endDate) params.endDate = this.data.endDate;
    api.get('/admin/sales/products/' + this.data.productId + '/overview', params).then(res => {
      this.setData({ overview: {
        soldItems: res.soldItems || 0,
        soldQty: res.soldQty || 0,
        totalAmount: res.totalAmount || 0,
        afterSaleCount: res.afterSaleCount || 0,
        afterSaleAmount: res.afterSaleAmount || 0
      }});
    }).catch(err => console.error('加载概览失败:', err));
  },

  loadSkus() {
    const params = { page: 1, size: 100 };
    if (this.data.startDate) params.startDate = this.data.startDate;
    if (this.data.endDate) params.endDate = this.data.endDate;
    api.get('/admin/sales/products/' + this.data.productId + '/skus', params).then(res => {
      this.setData({ skus: res.items || [], skuTotal: res.total || 0 });
    }).catch(err => console.error('加载SKU列表失败:', err));
  },

  loadOrders(reset) {
    const page = reset ? 1 : this.data.orderPage;
    const { orderSize, startDate, endDate } = this.data;
    const params = { page, size: orderSize };
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    api.get('/admin/sales/products/' + this.data.productId + '/orders', params).then(res => {
      const items = (res.items || []).map(r => ({
        ...r,
        createdAtDisplay: this.formatTime(r.createdAt),
        statusDisplay: this.statusDisplay(r.status),
        items: (r.items || []).map(oi => ({
          ...oi,
          bundleParsed: this.parseBundle(oi.bundleConfig)
        }))
      }));
      if (reset) {
        this.setData({ orders: items, orderPage: 1, orderTotal: res.total || 0 });
      } else {
        this.setData({
          orders: [...this.data.orders, ...items],
          orderTotal: res.total || 0
        });
      }
    }).catch(err => console.error('加载订单列表失败:', err));
  },

  loadMoreOrders() {
    if (this.data.orders.length >= this.data.orderTotal) return;
    this.setData({ orderPage: this.data.orderPage + 1 }, () => this.loadOrders(false));
  },

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value }, () => this.loadAll());
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value }, () => this.loadAll());
  },

  clearDate() {
    this.setData({ startDate: '', endDate: '' }, () => this.loadAll());
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
    const m = { 'paid': '待发货', 'partial_shipped': '部分发货', 'shipped': '已发货', 'completed': '已完成' };
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