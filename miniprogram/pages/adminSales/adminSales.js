// pages/adminSales/adminSales.js
const api = require('../../utils/api');

Page({
  data: {
    // 商品列表
    products: [],
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
    this.loadProducts();
  },

  loadProducts() {
    const { keyword, startDate, endDate, page, size } = this.data;
    const params = { page, size };
    if (keyword) params.keyword = keyword;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    api.get('/admin/sales/products', params).then(res => {
      this.setData({ products: res.items || [], total: res.total || 0 });
    }).catch(err => console.error('加载商品列表失败:', err));
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value.trim() });
  },

  onSearch() {
    this.setData({ page: 1 });
    this.loadProducts();
  },

  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value, page: 1 }, () => this.loadProducts());
  },

  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value, page: 1 }, () => this.loadProducts());
  },

  clearDate() {
    this.setData({ startDate: '', endDate: '', page: 1 }, () => this.loadProducts());
  },

  loadMore() {
    if (this.data.products.length >= this.data.total) return;
    const nextPage = this.data.page + 1;
    this.setData({ page: nextPage });
    const { keyword, startDate, endDate, size } = this.data;
    const params = { page: nextPage, size };
    if (keyword) params.keyword = keyword;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    api.get('/admin/sales/products', params).then(res => {
      this.setData({ products: [...this.data.products, ...(res.items || [])] });
    }).catch(err => console.error('加载更多失败:', err));
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