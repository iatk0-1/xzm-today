const api = require('../../utils/api');
const auth = require('../../utils/auth');
const managementNavigation = require('../../utils/managementNavigation');
const customerServiceNavigation = require('../../utils/customerServiceNavigation');
const customerServiceUnread = require('../../utils/customerServiceUnread');
const { displayWechatEmoji } = require('../../utils/wechat-emoji');

Page({
  data: {
    hasContacted: false,
    firstMessageTime: '',
    latestStaffReplyAt: '',
    contactUnreadCount: 0,
    contactUnreadLabel: '0',
    messageUnreadCount: 0,
    messageUnreadLabel: '0',
    canServe: false,
    sessions: [],
    loading: true,
    refreshing: false,
    loadError: false,
    isAdmin: auth.isAdmin(),
    isStallManager: auth.isStallManager(),
    statusBarHeight: 20
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onShow() {
    clearInterval(this._poll);
    this.setData({ isAdmin: auth.isAdmin(), isStallManager: auth.isStallManager() });
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
        // 管理员和客服也可能以用户身份咨询；两类会话各自展示。
        const [sessionsResult, contactResult, unreadResult] = await Promise.allSettled([
          api.get('/wechat/customer-service/sessions'),
          api.get('/wechat/customer-service/contact'),
          api.get('/wechat/customer-service/unread')
        ]);
        if (sessionsResult.status === 'rejected') throw sessionsResult.reason;
        const sessions = sessionsResult.value;
        const contact = contactResult.status === 'fulfilled' ? contactResult.value : null;
        const contactUnreadCount = Math.max(0, Number(contact && contact.unreadCount) || 0);
        const staffUnreadCount = (sessions || []).reduce((sum, session) => sum + (Number(session.unreadCount) || 0), 0);
        const summary = unreadResult.status === 'fulfilled' ? unreadResult.value : null;
        const totalUnread = summary && Number.isFinite(Number(summary.totalUnreadCount))
          ? Math.max(0, Number(summary.totalUnreadCount)) : contactUnreadCount + staffUnreadCount;
        this.setData({
          canServe: true,
          hasContacted: !!(contact && contact.hasContacted),
          firstMessageTime: this.formatTime(contact && contact.firstMessageAt),
          latestStaffReplyAt: this.formatTime(contact && contact.latestStaffReplyAt),
          contactUnreadCount,
          contactUnreadLabel: customerServiceUnread.label(contactUnreadCount),
          messageUnreadCount: totalUnread,
          messageUnreadLabel: customerServiceUnread.label(totalUnread),
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
      const contactUnreadCount = Math.max(0, Number(contact && contact.unreadCount) || 0);
      this.setData({
        canServe: false,
        sessions: [],
        hasContacted: !!(contact && contact.hasContacted),
        firstMessageTime: this.formatTime(contact && contact.firstMessageAt),
        latestStaffReplyAt: this.formatTime(contact && contact.latestStaffReplyAt),
        contactUnreadCount,
        contactUnreadLabel: customerServiceUnread.label(contactUnreadCount),
        messageUnreadCount: contactUnreadCount,
        messageUnreadLabel: customerServiceUnread.label(contactUnreadCount),
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
  goToAdmin() {
    if (auth.isAdmin()) {
      wx.reLaunch({ url: '/pages/admin/admin' });
      return;
    }
    managementNavigation.openManagementMenu();
  }
});
