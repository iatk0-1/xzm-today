const auth = require('../../utils/auth');
const merchantContext = require('../../utils/merchant-context');

Page({
  data: { memberships: [] },

  onShow() {
    const memberships = auth.getMerchantMemberships().filter(item =>
      String(item.memberStatus || item.status || '').toLowerCase() === 'active'
      && String(item.merchantStatus || 'active').toLowerCase() === 'active')
      .map(item => Object.assign({}, item, {
        roleLabel: Array.isArray(item.memberRoles) ? item.memberRoles.join(' / ') : ''
      }));
    this.setData({ memberships });
  },

  selectMerchant(e) {
    const merchantId = e.currentTarget.dataset.id;
    try {
      merchantContext.setCurrentMerchant(merchantId);
      wx.redirectTo({
        url: '/pages/merchantWorkbench/merchantWorkbench?merchantId=' + merchantId
      });
    } catch (err) {
      wx.showToast({ title: err.message || '商户身份已失效', icon: 'none' });
    }
  }
});
