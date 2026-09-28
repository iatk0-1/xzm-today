const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    keywordInput: '', keyword: '', startDate: '', endDate: '',
    stallList: [], tagList: [], selectedStall: '', selectedTag: '',
    quickSelect: '', editingDateRange: { startDate: '', endDate: '', quickSelect: '' },
    showDateModal: false,
    today: '', overview: { soldQty: 0, pendingQty: 0, shippedQty: 0,
      afterSaleQty: 0, pendingReviewQty: 0 },
    items: [], page: 1, size: 20, total: 0, hasMore: false,
    loading: false, loadError: false, overviewLoading: false, overviewError: false
  },

  onLoad() {
    const today = this.formatDate(new Date());
    this.setData({ today, startDate: today, endDate: today, quickSelect: '1day' });
    return auth.ensureAuthenticated({ silent: true }).then(() => Promise.all([
      this.loadStallList(), this.loadTagList(), this.reload()
    ])).catch(err => {
      console.error('售出数量统计页认证失败:', err);
      wx.showToast({ title: '登录状态恢复失败，请重试', icon: 'none' });
    });
  },

  onShow() {
    if (this._hasShown) return Promise.all([this.loadOverview(), this.loadItems(true, true)]);
    this._hasShown = true;
  },

  formatDate(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  },

  loadStallList() {
    return api.get('/stalls/all').then(stalls => {
      this.setData({ stallList: Array.isArray(stalls) ? stalls : [] });
    }).catch(err => console.error('加载档口列表失败:', err));
  },

  loadTagList() {
    return api.get('/tags/all').then(tags => {
      this.setData({ tagList: Array.isArray(tags) ? tags : [] });
    }).catch(err => console.error('加载标签列表失败:', err));
  },

  params() {
    const { keyword, selectedStall, selectedTag, startDate, endDate } = this.data;
    const params = {};
    if (keyword) params.keyword = keyword;
    if (selectedStall !== '') params.stallId = selectedStall;
    if (selectedTag !== '') params.tagId = selectedTag;
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
        shippedQty: Number(res.shipped_qty) || 0,
        afterSaleQty: Number(res.after_sale_qty) || 0,
        pendingReviewQty: Number(res.pending_review_qty) || 0
      } });
    }).catch(err => {
      if (id !== this.overviewRequestId) return;
      console.error('加载售出数量概览失败:', err);
      this.setData({ overviewError: true });
    }).finally(() => {
      if (id === this.overviewRequestId) this.setData({ overviewLoading: false });
    });
  },

  loadItems(reset, preserveItems = false) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return Promise.resolve();
    const id = reset ? (this.listRequestId || 0) + 1 : this.listRequestId;
    this.listRequestId = id;
    const page = reset ? 1 : this.data.page + 1;
    if (reset && !preserveItems) {
      this.setData({ items: [], page: 1, total: 0, hasMore: false, loadError: false });
    }
    this.setData({ loading: true });
    return api.get('/admin/sales/shipping/products', {
      ...this.params(), page, size: this.data.size
    }).then(res => {
      if (id !== this.listRequestId) return;
      const rows = Array.isArray(res.content) ? res.content : [];
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

  onKeywordInput(e) { this.setData({ keywordInput: e.detail.value }); },
  onSearch() {
    this.setData({ keyword: this.data.keywordInput.trim() }, () => this.reload());
  },
  selectStall(e) {
    const stallId = e.currentTarget.dataset.stall;
    this.setData({ selectedStall: stallId === 'all' ? '' : stallId }, () => this.reload());
  },
  selectTag(e) {
    const tagId = e.currentTarget.dataset.tag;
    this.setData({ selectedTag: tagId === 'all' ? '' : tagId }, () => this.reload());
  },
  showDateRangeSelector() {
    this.setData({
      editingDateRange: {
        startDate: this.data.startDate, endDate: this.data.endDate,
        quickSelect: this.data.quickSelect
      },
      today: this.formatDate(new Date()), showDateModal: true
    });
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
    this.setData({ editingDateRange: {
      ...this.data.editingDateRange, startDate: e.detail.value, quickSelect: ''
    } });
  },
  onEndDateChange(e) {
    this.setData({ editingDateRange: {
      ...this.data.editingDateRange, endDate: e.detail.value, quickSelect: ''
    } });
  },
  confirmDateRange() {
    const range = this.data.editingDateRange;
    if (range.startDate && range.endDate && range.startDate > range.endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.setData({ startDate: range.startDate, endDate: range.endDate,
      quickSelect: range.quickSelect, showDateModal: false }, () => this.reload());
  },
  clearDateRange() {
    this.setData({ startDate: '', endDate: '', quickSelect: '' }, () => this.reload());
  },
  goToDetail(e) {
    const item = e.currentTarget.dataset.item;
    const params = ['productId=' + item.productId,
      'productName=' + encodeURIComponent(item.productName || '')];
    if (this.data.startDate) params.push('startDate=' + this.data.startDate);
    if (this.data.endDate) params.push('endDate=' + this.data.endDate);
    wx.navigateTo({ url: '/pages/adminShippingSalesDetail/adminShippingSalesDetail?' + params.join('&') });
  },
  retryItems() { return this.loadItems(true); },
  onReachBottom() { return this.loadItems(false); },
  onPullDownRefresh() {
    return Promise.all([this.reload(), this.loadStallList(), this.loadTagList()])
      .finally(() => wx.stopPullDownRefresh());
  }
});
