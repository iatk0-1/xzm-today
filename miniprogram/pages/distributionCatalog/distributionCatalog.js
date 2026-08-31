const api = require('../../utils/api');

Page({
  data: {
    merchantId: null,
    merchantName: '',
    products: [],
    page: 0,
    size: 20,
    hasMore: true,
    loading: false,
    assistingId: null
  },

  onLoad(options) {
    this.setData({ merchantId: options.merchantId, merchantName: options.merchantName || '' });
    this.loadProducts(true);
  },

  onReachBottom() { this.loadProducts(false); },

  async loadProducts(reset) {
    if (this.data.loading || (!reset && !this.data.hasMore)) return;
    const page = reset ? 0 : this.data.page;
    this.setData({ loading: true });
    try {
      const res = await api.get(
        '/seller/merchants/' + this.data.merchantId + '/distribution/catalog',
        { page, size: this.data.size });
      const list = (res.content || []).map(item => Object.assign({}, item, {
        sourcePriceText: item.minSourcePrice === item.maxSourcePrice
          ? item.minSourcePrice : item.minSourcePrice + ' - ' + item.maxSourcePrice,
        commissionText: item.minFixedCommission === item.maxFixedCommission
          ? item.minFixedCommission : item.minFixedCommission + ' - ' + item.maxFixedCommission,
        assisted: !!item.distributionProductId
      }));
      this.setData({
        products: reset ? list : this.data.products.concat(list),
        page: page + 1,
        hasMore: res.hasNext !== undefined ? res.hasNext : list.length === this.data.size
      });
    } catch (err) {
      wx.showToast({ title: err.message || '选品加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async assistSell(e) {
    const sourceProductId = e.currentTarget.dataset.id;
    if (this.data.assistingId || e.currentTarget.dataset.assisted) return;
    this.setData({ assistingId: sourceProductId });
    try {
      const result = await api.post('/seller/merchants/' + this.data.merchantId
        + '/distribution/products/' + sourceProductId + '/assist-sell');
      wx.showToast({ title: '已加入帮卖', icon: 'success' });
      setTimeout(() => wx.navigateTo({
        url: '/pages/sellerProductEdit/sellerProductEdit?merchantId=' + this.data.merchantId
          + '&productId=' + result.distributionProductId
      }), 500);
    } catch (err) {
      wx.showToast({ title: err.message || '帮卖失败', icon: 'none' });
    } finally {
      this.setData({ assistingId: null });
    }
  }
});
