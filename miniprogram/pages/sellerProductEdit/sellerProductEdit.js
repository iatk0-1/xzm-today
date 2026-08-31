const api = require('../../utils/api');

Page({
  data: { merchantId: null, productId: null, detail: null, saving: false },

  onLoad(options) {
    this.setData({ merchantId: options.merchantId, productId: options.productId });
    this.loadDetail();
  },

  async loadDetail() {
    try {
      const detail = await api.get('/seller/merchants/' + this.data.merchantId
        + '/products/' + this.data.productId);
      detail.skus = (detail.skus || []).map(item => Object.assign({}, item, {
        salePriceInput: String(item.salePrice == null ? '' : item.salePrice),
        availableStock: item.unlimitedStock ? '不限库存' : String(item.stockMain)
      }));
      this.setData({ detail });
    } catch (err) {
      wx.showToast({ title: err.message || '商品详情加载失败', icon: 'none' });
    }
  },

  updateMarketingField(e) {
    this.setData({ ['detail.marketing.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  updateSkuPrice(e) {
    this.setData({ ['detail.skus[' + e.currentTarget.dataset.index + '].salePriceInput']: e.detail.value });
  },

  async saveMarketing() {
    const marketing = this.data.detail.marketing;
    if (!String(marketing.name || '').trim()) {
      wx.showToast({ title: '商品名称不能为空', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      await api.put('/seller/merchants/' + this.data.merchantId + '/products/' + this.data.productId,
        Object.assign({}, marketing, { name: marketing.name.trim() }));
      wx.showToast({ title: '商品信息已保存', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async saveSkuPrices() {
    const items = [];
    for (const sku of this.data.detail.skus) {
      const salePrice = Number(sku.salePriceInput);
      if (!Number.isFinite(salePrice) || salePrice < Number(sku.sourcePrice)) {
        wx.showToast({ title: sku.spec + ' 售价不能低于源价', icon: 'none' });
        return;
      }
      items.push({ sourceSkuId: sku.sourceSkuId, salePrice });
    }
    this.setData({ saving: true });
    try {
      await api.put('/seller/merchants/' + this.data.merchantId + '/products/'
        + this.data.productId + '/sku-prices', { items });
      wx.showToast({ title: 'SKU 售价已保存', icon: 'success' });
      await this.loadDetail();
    } catch (err) {
      wx.showToast({ title: err.message || '售价保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async toggleStatus() {
    const status = this.data.detail.status === 'on' ? 'off' : 'on';
    this.setData({ saving: true });
    try {
      await api.patch('/seller/merchants/' + this.data.merchantId + '/products/'
        + this.data.productId + '/status', { status });
      wx.showToast({ title: status === 'on' ? '商品已上架' : '商品已下架', icon: 'success' });
      await this.loadDetail();
    } catch (err) {
      wx.showToast({ title: err.message || '状态更新失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
