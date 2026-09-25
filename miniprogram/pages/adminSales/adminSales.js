// pages/adminSales/adminSales.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    // 商品列表
    products: [],
    page: 1,
    size: 20,
    total: 0,
    hasMore: false,
    loading: false,
    loadError: false,
    isRefreshing: false,
    overview: { soldQty: 0, totalAmount: 0, afterSaleCount: 0, afterSaleAmount: 0 },
    overviewLoading: false,
    overviewError: false,
    filteredOverview: { soldQty: 0, totalAmount: 0, afterSaleCount: 0, afterSaleAmount: 0 },
    filteredOverviewLoading: false,
    filteredOverviewError: false,
    // 筛选
    searchInput: '',
    keyword: '',
    stallList: [],
    tagList: [],
    selectedStall: '',
    selectedTag: '',
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

  onLoad() {
    const today = this.formatDate(new Date());
    this.setData({ today, startDate: today, endDate: today, quickSelect: '1day' });
    return auth.ensureAuthenticated({ silent: true })
      .then(() => {
        this.loadStallList();
        this.loadTagList();
        return Promise.all([this.reloadFilteredData(), this.loadOverview()]);
      })
      .catch(err => {
        console.error('销售统计页认证恢复失败:', err);
        wx.showToast({ title: '登录状态恢复失败，请稍后重试', icon: 'none' });
      });
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

  getFilterParams() {
    const { keyword, selectedStall, selectedTag, startDate, endDate } = this.data;
    const params = {};
    if (keyword) params.keyword = keyword;
    if (selectedStall !== '') params.stallId = selectedStall;
    if (selectedTag !== '') params.tagId = selectedTag;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    return params;
  },

  getProductParams(page) {
    return { ...this.getFilterParams(), page, size: this.data.size };
  },

  reloadFilteredData() {
    return Promise.all([this.loadProducts(), this.loadFilteredOverview()]);
  },

  loadOverview() {
    const requestId = (this.overviewRequestId || 0) + 1;
    this.overviewRequestId = requestId;
    const params = {};
    if (this.data.startDate) params.startDate = this.data.startDate;
    if (this.data.endDate) params.endDate = this.data.endDate;
    this.setData({ overviewLoading: true, overviewError: false });
    return api.get('/admin/sales/overview', params).then(res => {
      if (requestId !== this.overviewRequestId) return;
      this.setData({ overview: {
        soldQty: res.soldQty || 0,
        totalAmount: res.totalAmount || 0,
        afterSaleCount: res.afterSaleCount || 0,
        afterSaleAmount: res.afterSaleAmount || 0
      } });
    }).catch(err => {
      if (requestId !== this.overviewRequestId) return;
      console.error('加载销售统计失败:', err);
      this.setData({ overviewError: true });
    }).finally(() => {
      if (requestId === this.overviewRequestId) this.setData({ overviewLoading: false });
    });
  },

  loadFilteredOverview() {
    const requestId = (this.filteredOverviewRequestId || 0) + 1;
    this.filteredOverviewRequestId = requestId;
    this.setData({ filteredOverviewLoading: true, filteredOverviewError: false });
    return api.get('/admin/sales/query/overview', this.getFilterParams()).then(res => {
      if (requestId !== this.filteredOverviewRequestId) return;
      this.setData({ filteredOverview: {
        soldQty: res.soldQty || 0,
        totalAmount: res.totalAmount || 0,
        afterSaleCount: res.afterSaleCount || 0,
        afterSaleAmount: res.afterSaleAmount || 0
      } });
    }).catch(err => {
      if (requestId !== this.filteredOverviewRequestId) return;
      console.error('加载筛选销售统计失败:', err);
      this.setData({ filteredOverviewError: true });
    }).finally(() => {
      if (requestId === this.filteredOverviewRequestId) this.setData({ filteredOverviewLoading: false });
    });
  },

  loadProducts() {
    const requestId = (this.productRequestId || 0) + 1;
    this.productRequestId = requestId;
    this.setData({ products: [], page: 1, total: 0, hasMore: false, loading: true, loadError: false });
    return this.fetchProducts(1, requestId, true);
  },

  fetchProducts(page, requestId, replace) {
    return api.get('/admin/sales/query/products', this.getProductParams(page)).then(res => {
      if (requestId !== this.productRequestId) return;
      const content = Array.isArray(res.content) ? res.content : [];
      const products = replace ? content : this.data.products.concat(content);
      const total = Number(res.totalElements) || 0;
      this.setData({
        products,
        total,
        page,
        loadError: false,
        hasMore: content.length > 0 && products.length < total
      });
    }).catch(err => {
      if (requestId !== this.productRequestId) return;
      console.error('加载商品销售列表失败:', err);
      if (replace) this.setData({ loadError: true });
      wx.showToast({ title: '加载商品销售列表失败，请重试', icon: 'none' });
    }).finally(() => {
      if (requestId === this.productRequestId) this.setData({ loading: false });
    });
  },

  onSearchInput(e) {
    this.setData({ searchInput: e.detail.value });
  },

  onSearch() {
    this.setData({ keyword: this.data.searchInput.trim() }, () => this.reloadFilteredData());
  },

  selectStall(e) {
    const stallId = e.currentTarget.dataset.stall;
    this.setData({ selectedStall: stallId === 'all' ? '' : stallId }, () => this.reloadFilteredData());
  },

  selectTag(e) {
    const tagId = e.currentTarget.dataset.tag;
    this.setData({ selectedTag: tagId === 'all' ? '' : tagId }, () => this.reloadFilteredData());
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
    }, () => {
      this.reloadFilteredData();
      this.loadOverview();
    });
  },

  clearDateRange() {
    this.setData({ startDate: '', endDate: '', quickSelect: '' }, () => {
      this.reloadFilteredData();
      this.loadOverview();
    });
  },

  onListPullDownRefresh() {
    if (this.data.isRefreshing) return;
    this.setData({ isRefreshing: true });
    return Promise.all([this.reloadFilteredData(), this.loadOverview(), this.loadStallList(), this.loadTagList()])
      .finally(() => this.setData({ isRefreshing: false }));
  },

  onPullDownRefresh() {
    return Promise.resolve(this.onListPullDownRefresh()).finally(() => wx.stopPullDownRefresh());
  },

  onListScrollToLower() {
    return this.loadMore();
  },

  loadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    const nextPage = this.data.page + 1;
    this.setData({ loading: true });
    return this.fetchProducts(nextPage, this.productRequestId, false);
  },

  goToDetail(e) {
    const item = e.currentTarget.dataset.item;
    const params = [
      'productId=' + item.productId,
      'productName=' + encodeURIComponent(item.productName)
    ];
    if (this.data.startDate) params.push('startDate=' + this.data.startDate);
    if (this.data.endDate) params.push('endDate=' + this.data.endDate);
    wx.navigateTo({
      url: '/pages/adminSalesDetail/adminSalesDetail?' + params.join('&')
    });
  }
});
