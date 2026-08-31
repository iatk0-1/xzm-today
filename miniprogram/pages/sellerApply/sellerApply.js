const api = require('../../utils/api');

Page({
  data: {
    merchants: [],
    selectedMerchant: null,
    shopName: '',
    contactPhone: '',
    submitting: false
  },

  onLoad(options) {
    this.loadMerchants(options.merchantId, options.merchantName);
  },

  async loadMerchants(preferredId, preferredName) {
    try {
      const merchants = await api.get('/seller/merchants');
      let selectedMerchant = null;
      if (preferredId) {
        selectedMerchant = merchants.find(item => String(item.merchantId) === String(preferredId))
          || { merchantId: preferredId, merchantName: preferredName || '' };
      } else if (merchants.length === 1) {
        selectedMerchant = merchants[0];
      }
      this.setData({ merchants, selectedMerchant });
    } catch (err) {
      wx.showToast({ title: err.message || '商户加载失败', icon: 'none' });
    }
  },

  selectMerchant(e) {
    const merchant = this.data.merchants.find(item =>
      String(item.merchantId) === String(e.currentTarget.dataset.id));
    if (merchant) this.setData({ selectedMerchant: merchant });
  },

  onShopNameInput(e) { this.setData({ shopName: e.detail.value }); },
  onPhoneInput(e) { this.setData({ contactPhone: e.detail.value }); },

  async submit() {
    const merchant = this.data.selectedMerchant;
    const shopName = this.data.shopName.trim();
    if (!merchant) {
      wx.showToast({ title: '请选择合作商户', icon: 'none' });
      return;
    }
    if (!shopName) {
      wx.showToast({ title: '请填写店铺名称', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.post('/seller/merchants/' + merchant.merchantId + '/apply', {
        shopName,
        contactPhone: this.data.contactPhone.trim() || null
      });
      wx.showToast({ title: '申请已提交', icon: 'success' });
      setTimeout(() => wx.redirectTo({ url: '/pages/sellerWorkbench/sellerWorkbench' }), 600);
    } catch (err) {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
