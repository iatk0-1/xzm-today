const api = require('../../utils/api');
const auth = require('../../utils/auth');

const STATUS_NAMES = {
  pending: '待审核', approved: '已同意', received: '已收货',
  refunded: '已退款', rejected: '已拒绝', cancelled: '已取消'
};

Page({
  data: {
    tabs: [
      { key: 'all', name: '全部' },
      { key: 'pending', name: '待发' },
      { key: 'shipped', name: '已发' },
      { key: 'after_sale', name: '有售后' }
    ],
    status: 'all',
    keywordInput: '', keyword: '', startDate: '', endDate: '',
    today: '', overview: { soldQty: 0, pendingQty: 0, shippedQty: 0 },
    items: [], page: 1, size: 20, total: 0, hasMore: false,
    loading: false, loadError: false, overviewLoading: false, overviewError: false
  },

  onLoad() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    this.setData({ today });
    return auth.ensureAuthenticated({ silent: true }).then(() => this.reload()).catch(err => {
      console.error('售出数量统计页认证失败:', err);
      wx.showToast({ title: '登录状态恢复失败，请重试', icon: 'none' });
    });
  },

  params() {
    const { keyword, startDate, endDate } = this.data;
    const params = {};
    if (keyword) params.keyword = keyword;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    return params;
  },

  reload() {
    return Promise.all([this.loadOverview(), this.loadItems(true)]);
  },

  loadOverview() {
    const id = (this.overviewRequestId || 0) + 1;
    this.overviewRequestId = id;
    this.setData({ overviewLoading: true, overviewError: false });
    return api.get('/admin/sales/shipping/overview', this.params()).then(res => {
      if (id !== this.overviewRequestId) return;
      this.setData({ overview: {
        soldQty: Number(res.sold_qty) || 0,
        pendingQty: Number(res.pending_qty) || 0,
        shippedQty: Number(res.shipped_qty) || 0
      } });
    }).catch(err => {
      if (id !== this.overviewRequestId) return;
      console.error('加载售出数量概览失败:', err);
      this.setData({ overviewError: true });
    }).finally(() => {
      if (id === this.overviewRequestId) this.setData({ overviewLoading: false });
    });
  },

  loadItems(reset) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return Promise.resolve();
    const id = reset ? (this.listRequestId || 0) + 1 : this.listRequestId;
    this.listRequestId = id;
    const page = reset ? 1 : this.data.page + 1;
    if (reset) this.setData({ items: [], page: 1, total: 0, hasMore: false, loadError: false });
    this.setData({ loading: true });
    return api.get('/admin/sales/shipping/query', {
      ...this.params(), status: this.data.status, page, size: this.data.size
    }).then(res => {
      if (id !== this.listRequestId) return;
      const rows = (res.content || []).map(row => ({
        ...row,
        afterSaleLabels: [...new Set((row.afterSaleStatuses || '').split(',').filter(Boolean))]
          .map(code => STATUS_NAMES[code] || code)
      }));
      const items = reset ? rows : this.data.items.concat(rows);
      const total = Number(res.totalElements) || 0;
      this.setData({ items, page, total, hasMore: rows.length > 0 && items.length < total, loadError: false });
    }).catch(err => {
      if (id !== this.listRequestId) return;
      console.error('加载售出数量列表失败:', err);
      this.setData({ loadError: true });
      wx.showToast({ title: '加载统计列表失败，请重试', icon: 'none' });
    }).finally(() => {
      if (id === this.listRequestId) this.setData({ loading: false });
    });
  },

  switchTab(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.status) return;
    this.setData({ status }, () => this.loadItems(true));
  },
  onKeywordInput(e) { this.setData({ keywordInput: e.detail.value }); },
  onSearch() {
    this.setData({ keyword: this.data.keywordInput.trim() }, () => this.reload());
  },
  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value }, () => this.reload());
  },
  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value }, () => this.reload());
  },
  clearDates() {
    this.setData({ startDate: '', endDate: '' }, () => this.reload());
  },
  retryItems() { return this.loadItems(true); },
  onReachBottom() { return this.loadItems(false); },
  onPullDownRefresh() {
    return Promise.resolve(this.reload()).finally(() => wx.stopPullDownRefresh());
  }
});
