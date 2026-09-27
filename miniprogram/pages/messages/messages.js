const api = require('../../utils/api');
const auth = require('../../utils/auth');
const customerServiceNavigation = require('../../utils/customerServiceNavigation');

Page({
  data: {
    hasContacted: false,
    firstMessageTime: '',
    loading: true,
    refreshing: false,
    loadError: false,
    isAdmin: auth.isAdmin(),
    statusBarHeight: 20
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onShow() {
    this.setData({ isAdmin: auth.isAdmin() });
    this.loadContact();
  },

  async loadContact() {
    this.setData({ loading: true, loadError: false, hasContacted: false, firstMessageTime: '' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const contact = await api.get('/wechat/customer-service/contact');
      this.setData({
        hasContacted: !!(contact && contact.hasContacted),
        firstMessageTime: this.formatTime(contact && contact.firstMessageAt),
        loading: false,
        refreshing: false
      });
    } catch (err) {
      this.setData({ loading: false, refreshing: false, loadError: true });
    }
  },

  onRefresh() {
    this.setData({ refreshing: true });
    this.loadContact();
  },

  formatTime(raw) {
    if (!raw) return '';
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate())
      + ' ' + pad(value.getHours()) + ':' + pad(value.getMinutes());
  },

  handleCustomerServiceContact(e) {
    customerServiceNavigation.openFromContact(e);
  },

  goToIndex() { wx.reLaunch({ url: '/pages/index/index' }); },
  goToMarket() { wx.reLaunch({ url: '/pages/market/market' }); },
  goToUser() { wx.reLaunch({ url: '/pages/user/user' }); },
  goToAdmin() { wx.reLaunch({ url: '/pages/admin/admin' }); }
});
