const api = require('../../utils/api');
const merchantContext = require('../../utils/merchant-context');
const { buildDistributionSetting } = require('../../utils/distribution-setting');

const SELLER_STATUS = {
  pending: '待审核', active: '合作中', disabled: '已停用', rejected: '已驳回'
};

Page({
  data: {
    merchant: null,
    tab: 'sellers',
    sellers: [],
    products: [],
    sellerPage: 0,
    productPage: 0,
    sellerHasMore: true,
    productHasMore: true,
    loading: false,
    editingProductId: null,
    saving: false
  },

  onLoad() {
    try {
      this.setData({ merchant: merchantContext.requireCurrentMerchant() });
      this.loadSellers(true);
    } catch (err) {
      wx.showToast({ title: err.message || '商户上下文已失效', icon: 'none' });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
    if (tab === 'sellers' && !this.data.sellers.length) this.loadSellers(true);
    if (tab === 'products' && !this.data.products.length) this.loadProducts(true);
  },

  async loadSellers(reset) {
    if (this.data.loading || (!reset && !this.data.sellerHasMore)) return;
    const page = reset ? 0 : this.data.sellerPage;
    this.setData({ loading: true });
    try {
      const result = await api.get('/merchants/' + this.data.merchant.merchantId
        + '/distribution/sellers', { page, size: 20 });
      const list = (result.content || []).map(item => Object.assign({}, item, {
        statusLabel: SELLER_STATUS[item.partnershipStatus] || item.partnershipStatus
      }));
      this.setData({
        sellers: reset ? list : this.data.sellers.concat(list),
        sellerPage: page + 1,
        sellerHasMore: !!result.hasNext
      });
    } catch (err) {
      wx.showToast({ title: err.message || '卖家列表加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async reviewSeller(e) {
    const sellerId = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    const label = { approve: '通过', reject: '驳回', disable: '停用' }[action];
    const confirm = await new Promise(resolve => wx.showModal({
      title: label + '卖家', content: '确认' + label + '该卖家的合作申请？',
      success: result => resolve(result.confirm), fail: () => resolve(false)
    }));
    if (!confirm) return;
    try {
      await api.post('/merchants/' + this.data.merchant.merchantId
        + '/distribution/sellers/' + sellerId + '/' + action);
      wx.showToast({ title: '操作成功', icon: 'success' });
      this.loadSellers(true);
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  async loadProducts(reset) {
    if (this.data.loading || (!reset && !this.data.productHasMore)) return;
    const page = reset ? 0 : this.data.productPage;
    this.setData({ loading: true });
    try {
      const result = await api.get('/merchants/' + this.data.merchant.merchantId
        + '/products/distribution-settings', { page, size: 20 });
      const list = (result.content || []).map(item => Object.assign({}, item, {
        commissionMode: item.commissionMode || 'PRODUCT',
        productCommissionAmount: item.productCommissionAmount || '0.00',
        skus: (item.skus || []).map(sku => Object.assign({}, sku, {
          fixedCommissionAmount: sku.fixedCommissionAmount || '0.00'
        }))
      }));
      this.setData({
        products: reset ? list : this.data.products.concat(list),
        productPage: page + 1,
        productHasMore: !!result.hasNext
      });
    } catch (err) {
      wx.showToast({ title: err.message || '商品配置加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  editProduct(e) { this.setData({ editingProductId: e.currentTarget.dataset.id }); },
  cancelEdit() { this.setData({ editingProductId: null }); },

  updateProductField(productId, updater) {
    this.setData({ products: this.data.products.map(product =>
      String(product.productId) === String(productId) ? updater(Object.assign({}, product)) : product) });
  },

  toggleEnabled(e) {
    this.updateProductField(e.currentTarget.dataset.id, product => {
      product.distributionEnabled = e.detail.value;
      return product;
    });
  },

  changeMode(e) {
    this.updateProductField(e.currentTarget.dataset.id, product => {
      product.commissionMode = e.detail.value;
      return product;
    });
  },

  changeProductCommission(e) {
    this.updateProductField(e.currentTarget.dataset.id, product => {
      product.productCommissionAmount = e.detail.value;
      return product;
    });
  },

  changeSkuCommission(e) {
    const productId = e.currentTarget.dataset.productId;
    const skuId = e.currentTarget.dataset.skuId;
    this.updateProductField(productId, product => {
      product.skus = product.skus.map(sku => String(sku.skuId) === String(skuId)
        ? Object.assign({}, sku, { fixedCommissionAmount: e.detail.value }) : sku);
      return product;
    });
  },

  async saveProduct(e) {
    const product = this.data.products.find(item =>
      String(item.productId) === String(e.currentTarget.dataset.id));
    if (!product || this.data.saving) return;
    try {
      const request = buildDistributionSetting(product);
      this.setData({ saving: true });
      await api.put('/merchants/' + this.data.merchant.merchantId + '/products/'
        + product.productId + '/distribution-setting', request);
      wx.showToast({ title: '配置已保存', icon: 'success' });
      this.setData({ editingProductId: null });
      this.loadProducts(true);
    } catch (err) {
      wx.showToast({ title: err.message || '配置保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  onReachBottom() {
    if (this.data.tab === 'sellers') this.loadSellers(false);
    else this.loadProducts(false);
  }
});
