const api = require('../../utils/api');
const auth = require('../../utils/auth');
const cosUpload = require('../../utils/cos-upload');
const { compressImage } = require('../../utils/media');
const config = require('../../utils/config');
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
    statusBarHeight: 20, scrollToId: '', loading: true, hasMore: true,
    sending: false, showTools: false, composerType: '',
    draftTitle: '', draftDescription: '', draftUrl: '', draftPageKind: 'product',
    draftTargetId: '', draftThumbUrl: '', uploadingCover: false
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
  onHide() { clearInterval(this._poll); this._poll = null; if (this._audio) this._audio.stop(); },
  onUnload() { clearInterval(this._poll); this._poll = null; if (this._audio) this._audio.destroy(); },
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
        showTools: activeMine && valid ? this.data.showTools : false,
        composerType: activeMine && valid ? this.data.composerType : '',
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
  playVoice(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    if (!this._audio) {
      this._audio = wx.createInnerAudioContext();
      this._audio.onError(() => wx.showToast({ title: '语音无法播放', icon: 'none' }));
    }
    this._audio.stop();
    this._audio.src = url;
    this._audio.play();
  },
  copyLink(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.setClipboardData({ data: url });
  },
  toggleTools() {
    if (this.data.canReply && !this._sending) this.setData({ showTools: !this.data.showTools });
  },
  chooseImage() {
    if (!this.data.canReply || this._sending) return;
    wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: res => this.sendImage(res.tempFilePaths[0]),
      fail: err => this.mediaSelectionError(err) });
  },
  async sendImage(path) {
    await this.performSend(async () => {
      const image = await compressImage(path);
      const mediaUrl = await cosUpload.uploadFile(image.path, 'chats');
      return { type: 'image', mediaUrl };
    });
  },
  chooseVideo() {
    if (!this.data.canReply || this._sending) return;
    if (wx.chooseMedia) {
      wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['album', 'camera'],
        maxDuration: 60, sizeType: ['compressed'], success: res => {
          const file = res.tempFiles && res.tempFiles[0];
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            wx.showToast({ title: '视频不能超过 10MB', icon: 'none' }); return;
          }
          this.sendVideo(file);
        }, fail: err => this.mediaSelectionError(err) });
      return;
    }
    wx.chooseVideo({ sourceType: ['album', 'camera'], compressed: true, maxDuration: 60,
      success: res => {
        if (res.size > 10 * 1024 * 1024) {
          wx.showToast({ title: '视频不能超过 10MB', icon: 'none' }); return;
        }
        this.sendVideo(res);
      }, fail: err => this.mediaSelectionError(err) });
  },
  async sendVideo(file) {
    await this.performSend(async () => {
      const mediaUrl = await cosUpload.uploadFile(file.tempFilePath, 'chats', null, 'mp4');
      // 部分微信版本不提供视频封面，此时让客服选择一张封面。
      const cover = file.thumbTempFilePath || await this.selectCover();
      const thumbUrl = await cosUpload.uploadFile(cover, 'chats', null, 'jpg');
      return { type: 'video', mediaUrl, thumbUrl, title: '客服视频' };
    });
  },
  chooseVoice() {
    if (!this.data.canReply || this._sending) return;
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['mp3', 'amr'],
      success: res => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024 || !/\.(mp3|amr)$/i.test(file.name)) {
          wx.showToast({ title: '请选择不超过 2MB 的 MP3/AMR', icon: 'none' }); return;
        }
        this.performSend(async () => ({ type: 'voice', mediaUrl: await cosUpload.uploadFile(
          file.path, 'chats', null, file.name.split('.').pop().toLowerCase()) }));
      }, fail: err => this.mediaSelectionError(err) });
  },
  mediaSelectionError(err) {
    if (!/cancel/i.test((err && (err.errMsg || err.message)) || '')) {
      wx.showToast({ title: '选择文件失败', icon: 'none' });
    }
  },
  selectCover() {
    return new Promise((resolve, reject) => wx.chooseImage({ count: 1, sizeType: ['compressed'],
      success: res => resolve(res.tempFilePaths[0]), fail: reject }));
  },
  openComposer(e) {
    if (!this.data.canReply || this._sending) return;
    this.setData({ composerType: e.currentTarget.dataset.type, showTools: false,
      draftTitle: '', draftDescription: '', draftUrl: '', draftPageKind: 'product',
      draftTargetId: '', draftThumbUrl: '' });
  },
  reuseCard(e) {
    if (!this.data.canReply || this._sending) return;
    const metadata = e.currentTarget.dataset.metadata || {};
    const raw = metadata.PagePath || '';
    const match = /(?:\?|&)id=(\d+)(?:&|$)/.exec(raw);
    const path = raw.replace(/^\//, '').split('?')[0];
    if (!match || !supportedPages.includes(path)) return;
    this.setData({ composerType: 'miniprogrampage', showTools: false,
      draftTitle: (metadata.Title || '详情').slice(0, 100), draftDescription: '', draftUrl: '',
      draftPageKind: path === 'pages/orderDetail/orderDetail' ? 'order' : 'product',
      draftTargetId: match[1], draftThumbUrl: this.usableCover(e.currentTarget.dataset.cover) });
    this.loadCardInfo();
  },
  usableCover(url) {
    return typeof url === 'string' && url.startsWith(config.CDN_BASE_URL + '/xzm/')
      && /\.(jpg|jpeg|png|gif)$/i.test(url) ? url : '';
  },
  async loadCardInfo() {
    const id = this.data.draftTargetId.trim();
    const kind = this.data.draftPageKind;
    if (!/^\d+$/.test(id)) return;
    try {
      const result = await api.get(kind === 'product' ? '/products/' + id
        : '/wechat/customer-service/sessions/' + this.data.id + '/orders/' + id);
      if (this.data.draftTargetId.trim() !== id || this.data.draftPageKind !== kind) return;
      const product = result.product || {};
      const firstItem = (result.items || [])[0] || {};
      const patch = {};
      if (!this.data.draftTitle.trim()) patch.draftTitle = (kind === 'product'
        ? product.name || '商品详情' : '订单详情 #' + id).slice(0, 100);
      if (!this.data.draftThumbUrl) patch.draftThumbUrl = this.usableCover(kind === 'product'
        ? product.coverUrl : firstItem.productImage);
      this.setData(patch);
    } catch (err) { wx.showToast({ title: (err && err.message) || '未找到对应详情', icon: 'none' }); }
  },
  closeComposer() { if (!this._sending && !this.data.uploadingCover) this.setData({ composerType: '' }); },
  stopTap() {},
  onDraftInput(e) {
    const key = e.currentTarget.dataset.field;
    if (['draftTitle', 'draftDescription', 'draftUrl', 'draftTargetId'].includes(key)) {
      this.setData({ [key]: e.detail.value });
    }
  },
  choosePageKind(e) { this.setData({ draftPageKind: e.currentTarget.dataset.kind }); },
  async chooseDraftCover() {
    if (this._sending || this.data.uploadingCover) return;
    try {
      const path = await this.selectCover();
      this.setData({ uploadingCover: true });
      const image = await compressImage(path);
      const url = await cosUpload.uploadFile(image.path, 'chats');
      this.setData({ draftThumbUrl: url });
    } catch (err) { this.mediaSelectionError(err); }
    finally { this.setData({ uploadingCover: false }); }
  },
  async sendCard() {
    const d = this.data;
    if (d.uploadingCover) return;
    if (!d.draftTitle.trim() || !d.draftThumbUrl) {
      wx.showToast({ title: '请填写标题并选择封面', icon: 'none' }); return;
    }
    const payload = { type: d.composerType, title: d.draftTitle.trim(),
      description: d.draftDescription.trim(), thumbUrl: d.draftThumbUrl };
    if (d.composerType === 'link') {
      if (!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(d.draftUrl.trim())) {
        wx.showToast({ title: '请填写 HTTPS 链接', icon: 'none' }); return;
      }
      payload.url = d.draftUrl.trim();
    } else {
      if (!/^\d+$/.test(d.draftTargetId.trim())) {
        wx.showToast({ title: '请填写商品或订单编号', icon: 'none' }); return;
      }
      payload.pagePath = (d.draftPageKind === 'order' ? 'pages/orderDetail/orderDetail' : 'pages/detail/detail')
        + '?id=' + d.draftTargetId.trim();
    }
    await this.performSend(async () => payload, () => this.setData({ composerType: '' }));
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
    if (this._sending) return;
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
    if (!content) return;
    await this.performSend(async () => ({ content }), () => this.setData({ inputText: '' }));
  },
  async performSend(buildPayload, onCreated) {
    if (!this.data.canReply || this._sending) return;
    this._sending = true;
    this.setData({ sending: true, showTools: false });
    try {
      const payload = await buildPayload();
      const message = await api.post('/wechat/customer-service/sessions/' + this.data.id + '/messages', payload);
      if (onCreated) onCreated();
      if (message && message.id) {
        const formatted = formatMessage(message, raw => this.formatTime(raw));
        this.setData({ messages: [...this.data.messages.filter(m => m.id !== message.id), formatted],
          scrollToId: 'msg-' + message.id });
      }
      await this.refresh(true);
    } catch (err) {
      if (!/cancel/i.test((err && err.errMsg) || '')) {
        wx.showToast({ title: (err && err.message) || '发送失败', icon: 'none' });
      }
    }
    finally { this._sending = false; this.setData({ sending: false }); }
  },
  async retry(e) {
    if (!this.data.canReply || this._sending) return;
    const id = e.currentTarget.dataset.id;
    this._sending = true;
    this.setData({ sending: true });
    try {
      const message = await api.post('/wechat/customer-service/sessions/' + this.data.id + '/messages/' + id + '/retry', {});
      if (message && message.id) {
        const formatted = formatMessage(message, raw => this.formatTime(raw));
        this.setData({ messages: this.data.messages.map(m => String(m.id) === String(message.id) ? formatted : m) });
      }
      await this.refresh(true);
    } catch (err) { wx.showToast({ title: (err && err.message) || '重试失败', icon: 'none' }); }
    finally { this._sending = false; this.setData({ sending: false }); }
  },
  goBack() { wx.navigateBack(); }
});
