const api = require('../../utils/api');

Page({
  data: { merchantId: null, merchantName: '', products: [], page: 0, size: 20, hasMore: true, loading: false },

  onLoad(options) {
    this.setData({ merchantId: options.merchantId, merchantName: options.merchantName || '' });
  },

  onShow() { this.loadProducts(true); },
  onReachBottom() { this.loadProducts(false); },

  async loadProducts(reset) {
    if (this.data.loading || (!reset && !this.data.hasMore)) return;
    const page = reset ? 0 : this.data.page;
    this.setData({ loading: true });
    try {
      const res = await api.get('/seller/merchants/' + this.data.merchantId + '/products', {
        page, size: this.data.size
      });
      const list = (res.content || []).map(item => Object.assign({}, item, {
        priceText: item.minSalePrice === item.maxSalePrice
          ? item.minSalePrice : item.minSalePrice + ' - ' + item.maxSalePrice,
        statusLabel: item.status === 'on' ? '销售中' : '已下架'
      }));
      this.setData({
        products: reset ? list : this.data.products.concat(list),
        page: page + 1,
        hasMore: res.hasNext !== undefined ? res.hasNext : list.length === this.data.size
      });
    } catch (err) {
      wx.showToast({ title: err.message || '商品加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  editProduct(e) {
    wx.navigateTo({
      url: '/pages/sellerProductEdit/sellerProductEdit?merchantId=' + this.data.merchantId
        + '&productId=' + e.currentTarget.dataset.id
    });
  }
});
