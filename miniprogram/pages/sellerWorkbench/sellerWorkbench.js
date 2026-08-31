const api = require('../../utils/api');

const STATUS_LABELS = {
  pending: '待审核', active: '合作中', disabled: '已停用', rejected: '已驳回'
};

Page({
  data: { merchants: [], loading: false },

  onShow() { this.loadMerchants(); },

  async loadMerchants() {
    this.setData({ loading: true });
    try {
      const result = await api.get('/seller/merchants');
      const merchants = result.map(item => Object.assign({}, item, {
        statusLabel: STATUS_LABELS[item.partnershipStatus] || '未申请',
        canEnter: item.partnershipStatus === 'active',
        canApply: !item.partnershipStatus || item.partnershipStatus === 'rejected'
      }));
      this.setData({ merchants });
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  handleMerchant(e) {
    const merchant = this.data.merchants.find(item =>
      String(item.merchantId) === String(e.currentTarget.dataset.id));
    if (!merchant) return;
    if (merchant.canEnter) {
      wx.navigateTo({
        url: '/pages/distributionCatalog/distributionCatalog?merchantId=' + merchant.merchantId
          + '&merchantName=' + encodeURIComponent(merchant.merchantName)
      });
      return;
    }
    if (merchant.canApply) {
      wx.navigateTo({
        url: '/pages/sellerApply/sellerApply?merchantId=' + merchant.merchantId
          + '&merchantName=' + encodeURIComponent(merchant.merchantName)
      });
      return;
    }
    wx.showToast({ title: merchant.statusLabel, icon: 'none' });
  }
});
