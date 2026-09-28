const api = require('../../utils/api');
const auth = require('../../utils/auth');
const supportedPages = ['pages/detail/detail', 'pages/orderDetail/orderDetail'];

function formatMessage(m, formatTime) {
  let metadata = {};
  try { metadata = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {}); } catch (err) {}
  return { ...m, metadata, displayTime: formatTime(m.createdAt), displayContent: m.content || '[' + m.messageType + ']' };
}

Page({
  data: {
    id: '', session: null, messages: [], inputText: '',
    quotaText: '', canReply: false, canClaim: false, canClose: false,
    statusBarHeight: 20, scrollToId: '', loading: true, hasMore: true
  },
  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ id: options.id || '', statusBarHeight: info.statusBarHeight || 20 });
  },
  onShow() {
    clearInterval(this._poll);
    this.refresh();
    this._poll = setInterval(() => this.refresh(true), 10000);
  },
  onHide() { clearInterval(this._poll); this._poll = null; },
  onUnload() { clearInterval(this._poll); this._poll = null; },
  async refresh(silent) {
    if (!silent) this.setData({ loading: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const base = '/wechat/customer-service/sessions/' + this.data.id;
      const session = await api.get(base);
      const messages = await api.get(base + '/messages');
      const me = auth.getUserInfo() || {};
      const activeMine = session.status === 'active' && String(session.assignedStaffId) === String(me.userId);
      const expires = session.replyExpiresAt ? new Date(session.replyExpiresAt) : null;
      const over48Hours = session.lastUserAt && Date.now() - new Date(session.lastUserAt).getTime() >= 48 * 60 * 60 * 1000;
      const valid = !over48Hours && expires && expires.getTime() > Date.now();
      const minutesLeft = valid ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 60000)) : 0;
      const quotaText = valid
        ? '预计剩余 ' + session.remainingReplies + ' 条 · 剩余 ' + Math.floor(minutesLeft / 60) + ' 小时 ' + (minutesLeft % 60) + ' 分钟 · 至 ' + this.formatTime(session.replyExpiresAt) + '（可尝试发送，以微信返回为准）'
        : (over48Hours ? '距用户最后一条消息已超过 48 小时，暂时无法发送；会话仍由当前客服接待' : '可回复时间已过，等待用户再次发送消息');
      const formatted = (messages || []).map(m => formatMessage(m, raw => this.formatTime(raw)));
      const preserved = silent ? this.data.messages.filter(old => !formatted.some(next => next.id === old.id)) : [];
      const allMessages = [...preserved, ...formatted].sort((a, b) => Number(a.id) - Number(b.id));
      this.setData({ session, messages: allMessages, quotaText, loading: false,
        hasMore: silent ? this.data.hasMore : formatted.length >= 50,
        canReply: !!(activeMine && valid), canClaim: session.status === 'pending', canClose: activeMine,
        scrollToId: silent ? this.data.scrollToId : (formatted.length ? 'msg-' + formatted[formatted.length - 1].id : '') });
    } catch (err) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    }
  },
  async loadEarlier() {
    if (this._loadingEarlier || !this.data.hasMore || !this.data.messages.length) return;
    this._loadingEarlier = true;
    try {
      const before = this.data.messages[0].id;
      const earlier = await api.get('/wechat/customer-service/sessions/' + this.data.id + '/messages', { before });
      const formatted = (earlier || []).map(m => formatMessage(m, raw => this.formatTime(raw)));
      this.setData({ messages: [...formatted, ...this.data.messages], hasMore: formatted.length >= 50,
        scrollToId: 'msg-' + before });
    } catch (err) { wx.showToast({ title: '加载历史消息失败', icon: 'none' }); }
    finally { this._loadingEarlier = false; }
  },
  formatTime(raw) {
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  },
  onInput(e) { this.setData({ inputText: e.detail.value }); },
  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url], current: url });
  },
  openMiniProgramCard(e) {
    const metadata = e.currentTarget.dataset.metadata || {};
    const account = wx.getAccountInfoSync ? wx.getAccountInfoSync() : {};
    const appid = account.miniProgram && account.miniProgram.appId;
    const raw = metadata.PagePath || '';
    const page = raw.replace(/^\//, '').split('?')[0];
    if ((metadata.AppId && metadata.AppId !== appid) || !supportedPages.includes(page)) {
      wx.showToast({ title: '该页面暂不支持从此处打开', icon: 'none' }); return;
    }
    if (page === 'pages/orderDetail/orderDetail') {
      const match = /(?:\?|&)id=(\d+)/.exec(raw);
      if (!match) { wx.showToast({ title: '订单链接缺少编号', icon: 'none' }); return; }
      wx.navigateTo({ url: '/pages/customerServiceOrderDetail/customerServiceOrderDetail?sessionId='
        + this.data.id + '&orderId=' + match[1] });
      return;
    }
    wx.navigateTo({ url: '/' + raw.replace(/^\//, '') });
  },
  async claim() {
    try {
      await api.post('/wechat/customer-service/sessions/' + this.data.id + '/claim', {});
      await this.refresh();
    } catch (err) { wx.showToast({ title: (err && err.message) || '接入失败', icon: 'none' }); }
  },
  close() {
    wx.showModal({ title: '结束会话', content: '结束后，新消息需由客服重新接入。', success: async res => {
      if (!res.confirm) return;
      try {
        await api.post('/wechat/customer-service/sessions/' + this.data.id + '/close', {});
        await this.refresh();
      } catch (err) { wx.showToast({ title: (err && err.message) || '结束失败', icon: 'none' }); }
    } });
  },
  async send() {
    const content = (this.data.inputText || '').trim();
    if (!this.data.canReply || !content || this._sending) return;
    this._sending = true;
    try {
      await api.post('/wechat/customer-service/sessions/' + this.data.id + '/messages', { content });
      this.setData({ inputText: '' });
      await this.refresh(true);
    } catch (err) { wx.showToast({ title: (err && err.message) || '发送失败', icon: 'none' }); }
    finally { this._sending = false; }
  },
  async retry(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await api.post('/wechat/customer-service/sessions/' + this.data.id + '/messages/' + id + '/retry', {});
      await this.refresh(true);
    } catch (err) { wx.showToast({ title: (err && err.message) || '重试失败', icon: 'none' }); }
  },
  goBack() { wx.navigateBack(); }
});
