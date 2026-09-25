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
    // 筛选
    searchInput: '',
    keyword: '',
    stallList: [],
    tagList: [],
    selectedStall: '',
    selectedTag: '',
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
    auth.ensureAuthenticated({ silent: true })
      .then(() => {
        this.loadStallList();
        this.loadTagList();
        return this.loadProducts();
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

  getProductParams(page) {
    const { keyword, selectedStall, selectedTag, startDate, endDate, size } = this.data;
    const params = { page, size };
    if (keyword) params.keyword = keyword;
    if (selectedStall !== '') params.stallId = selectedStall;
    if (selectedTag !== '') params.tagId = selectedTag;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    return params;
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
    this.setData({ keyword: this.data.searchInput.trim() }, () => this.loadProducts());
  },

  selectStall(e) {
    const stallId = e.currentTarget.dataset.stall;
    this.setData({ selectedStall: stallId === 'all' ? '' : stallId }, () => this.loadProducts());
  },

  selectTag(e) {
    const tagId = e.currentTarget.dataset.tag;
    this.setData({ selectedTag: tagId === 'all' ? '' : tagId }, () => this.loadProducts());
  },

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value }, () => this.loadProducts());
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value }, () => this.loadProducts());
  },

  clearDate() {
    this.setData({ startDate: '', endDate: '' }, () => this.loadProducts());
  },

  onListPullDownRefresh() {
    if (this.data.isRefreshing) return;
    this.setData({ isRefreshing: true });
    return Promise.all([this.loadProducts(), this.loadStallList(), this.loadTagList()])
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
