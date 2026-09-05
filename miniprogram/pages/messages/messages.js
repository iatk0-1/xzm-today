const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    conversations: [],
    loading: false,
    refreshing: false,
    isAdmin: require('../../utils/auth').isAdmin(),
    statusBarHeight: 20
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
  },

  onShow() {
    this.loadConversations();
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  async loadConversations() {
    this.setData({ loading: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const res = await api.get('/conversations');
      const list = (res || []).map(c => ({
        ...c,
        latestMessageTime: this.formatTime(c.latestMessageAt),
        latestMessage: c.latestMessage || ''
      }));
      this.setData({ conversations: list, loading: false });
    } catch (err) {
      this.setData({ loading: false });
    }
  },

  async onRefresh() {
    this.setData({ refreshing: true });
    await this.loadConversations();
    this.setData({ refreshing: false });
  },

  goToChat(e) {
    // 滑开状态下点击，先关闭再跳转
    const idx = e.currentTarget.dataset.index;
    if (this.data.conversations[idx] && this.data.conversations[idx]._swiped) {
      this.closeSwipe();
      return;
    }
    const id = e.currentTarget.dataset.id;
    const perspective = e.currentTarget.dataset.perspective || '';
    wx.navigateTo({ url: '/pages/chat/chat?conversationId=' + id + '&perspective=' + perspective });
  },

  // ===== 左滑删除 =====
  onTouchStart(e) {
    this._touchX = e.touches[0].pageX;
    this._touchY = e.touches[0].pageY;
    // 关闭其他已滑开的
    const idx = e.currentTarget.dataset.index;
    const list = this.data.conversations;
    let changed = false;
    list.forEach((item, i) => {
      if (i !== idx && item._swiped) { item._swiped = false; changed = true; }
    });
    if (changed) this.setData({ conversations: list });
  },
  onTouchMove(e) {
    if (this._touchX == null) return;
    const dx = e.touches[0].pageX - this._touchX;
    const dy = e.touches[0].pageY - this._touchY;
    // 只处理水平滑动
    if (Math.abs(dx) > Math.abs(dy) && dx < -10) {
      const idx = e.currentTarget.dataset.index;
      const list = this.data.conversations;
      if (!list[idx]._swiped) {
        list[idx]._swiped = true;
        this.setData({ conversations: list });
      }
    }
  },
  onTouchEnd(e) {
    this._touchX = null; this._touchY = null;
  },

  closeSwipe() {
    const list = this.data.conversations;
    let changed = false;
    list.forEach(item => { if (item._swiped) { item._swiped = false; changed = true; } });
    if (changed) this.setData({ conversations: list });
  },

  async deleteConversation(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除会话',
      content: '确定删除该会话？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.delete('/conversations/' + id);
            // 乐观移除：先从本地列表中去掉该会话
            const list = this.data.conversations.filter(c => c.conversationId !== id);
            this.setData({ conversations: list });
            wx.showToast({ title: '已删除', icon: 'success', duration: 1500 });
            // 再从服务端拉一次确保同步
            setTimeout(() => this.loadConversations(), 500);
          } catch (err) {
            console.error('删除失败', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        } else {
          this.closeSwipe();
        }
      }
    });
  },

  goBack() {
    wx.navigateBack();
  },
  goToIndex() { wx.reLaunch({ url: '/pages/index/index' }); },
  goToMarket() { wx.reLaunch({ url: '/pages/market/market' }); },
  goToUser() { wx.reLaunch({ url: '/pages/user/user' }); },
  goToAdmin() { wx.reLaunch({ url: '/pages/admin/admin' }); },

  formatTime(raw) {
    if (!raw) return '';
    if (raw.length >= 16 && raw.includes('T')) {
      return raw.substring(5, 16).replace('T', ' ');
    }
    return raw.substring(0, 16);
  },

  // 每 5 秒轮询一次更新未读数和最新消息
  startPolling() {
    this._pollTimer = setInterval(() => {
      this.loadConversations();
    }, 5000);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
});
