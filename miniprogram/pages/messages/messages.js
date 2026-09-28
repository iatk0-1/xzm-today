const api = require('../../utils/api');
const auth = require('../../utils/auth');
const customerServiceNavigation = require('../../utils/customerServiceNavigation');
const { displayWechatEmoji } = require('../../utils/wechat-emoji');

Page({
  data: {
    hasContacted: false,
    firstMessageTime: '',
    latestStaffReplyAt: '',
    canServe: false,
    sessions: [],
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
    clearInterval(this._poll);
    this.setData({ isAdmin: auth.isAdmin() });
    this.loadContact();
    this._poll = setInterval(() => this.loadContact(true), 10000);
  },

  onHide() { clearInterval(this._poll); this._poll = null; },
  onUnload() { clearInterval(this._poll); this._poll = null; },

  async loadContact(silent) {
    if (!silent) this.setData({ loading: true, loadError: false });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const permission = await api.get('/wechat/customer-service/me');
      if (permission && permission.canServe) {
        const sessions = await api.get('/wechat/customer-service/sessions');
        this.setData({
          canServe: true,
          sessions: (sessions || []).map(s => ({ ...s,
            displayName: s.nickname || '微信用户',
            preview: displayWechatEmoji(s.lastContent) || '暂无消息',
            displayTime: this.formatTime(s.lastMessageAt).slice(5),
            unreadLabel: s.unreadCount > 99 ? '99+' : String(s.unreadCount || 0)
          })),
          loading: false, refreshing: false
        });
        return;
      }
      const contact = await api.get('/wechat/customer-service/contact');
      this.setData({
        canServe: false,
        hasContacted: !!(contact && contact.hasContacted),
        firstMessageTime: this.formatTime(contact && contact.firstMessageAt),
        latestStaffReplyAt: this.formatTime(contact && contact.latestStaffReplyAt),
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

  goSession(e) {
    wx.navigateTo({ url: '/pages/customerServiceChat/customerServiceChat?id=' + e.currentTarget.dataset.id });
  },

  async claimSession(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await api.post('/wechat/customer-service/sessions/' + id + '/claim', {});
      this.goSession({ currentTarget: { dataset: { id } } });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '接入失败，请刷新', icon: 'none' });
      this.loadContact(true);
    }
  },

  goStaffManage() { wx.navigateTo({ url: '/pages/customerServiceStaff/customerServiceStaff' }); },

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
