// pages/adminSales/adminSales.js
const api = require('../../utils/api');

Page({
  data: {
    // 汇总
    overview: { soldItems: 0, soldQty: 0, totalAmount: 0, afterSaleCount: 0, afterSaleAmount: 0 },
    // 列表
    records: [],
    page: 1,
    size: 20,
    total: 0,
    // 筛选
    keyword: '',
    startDate: '',
    endDate: '',
    today: ''
  },

  onLoad() {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    this.setData({ today: y + '-' + m + '-' + d });
    this.loadData();
  },

  loadData() {
    this.loadOverview();
    this.loadRecords();
  },

  loadOverview() {
    const params = {};
    if (this.data.startDate) params.startDate = this.data.startDate;
    if (this.data.endDate) params.endDate = this.data.endDate;
    api.get('/admin/sales/overview', params).then(res => {
      this.setData({ overview: res });
    }).catch(err => console.error('加载汇总失败:', err));
  },

  loadRecords() {
    const { keyword, startDate, endDate, page, size } = this.data;
    const params = { page, size };
    if (keyword) params.keyword = keyword;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    api.get('/admin/sales/records', params).then(res => {
      const records = (res.items || []).map(r => ({
        ...r,
        createdAtDisplay: this.formatTime(r.createdAt),
        statusDisplay: this.statusDisplay(r.orderStatus),
        hasBundle: r.bundleConfig && r.bundleConfig.length > 2,
        bundleItems: this.parseBundle(r.bundleConfig)
      }));
      this.setData({ records, total: res.total || 0 });
    }).catch(err => console.error('加载记录失败:', err));
  },

  parseBundle(json) {
    if (!json) return null;
    try {
      return typeof json === 'string' ? JSON.parse(json) : json;
    } catch (e) { return null; }
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value.trim() });
  },

  onSearch() {
    this.setData({ page: 1 });
    this.loadData();
  },

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value, page: 1 }, () => this.loadData());
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value, page: 1 }, () => this.loadData());
  },

  clearDate() {
    this.setData({ startDate: '', endDate: '', page: 1 }, () => this.loadData());
  },

  loadMore() {
    if (this.data.records.length >= this.data.total) return;
    this.setData({ page: this.data.page + 1 }, () => {
      const { keyword, startDate, endDate, page, size } = this.data;
      const params = { page, size };
      if (keyword) params.keyword = keyword;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      api.get('/admin/sales/records', params).then(res => {
        const more = (res.items || []).map(r => ({
          ...r,
          createdAtDisplay: this.formatTime(r.createdAt),
          statusDisplay: this.statusDisplay(r.orderStatus),
          hasBundle: r.bundleConfig && r.bundleConfig.length > 2,
          bundleItems: this.parseBundle(r.bundleConfig)
        }));
        this.setData({ records: [...this.data.records, ...more] });
      });
    });
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
  }
});
