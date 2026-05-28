const api = require('../../utils/api');
const auth = require('../../utils/auth');
const config = require('../../utils/config');

Page({
  data: {
    conversationId: null,
    otherUserId: null,
    otherUserName: '',
    otherUserAvatar: '',
    myUserId: null,
    myRole: '',
    myPerspective: '',   // "buyer" or "seller" — 当前用户在此会话中的身份
    messages: [],
    inputText: '',
    showProductCard: false,
    productCard: null,
    scrollToId: '',
    loading: false,
    hasMore: true,
    statusBarHeight: 20
  },

  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const userInfo = auth.getUserInfo();
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      myUserId: userInfo ? userInfo.userId : null,
      myRole: userInfo ? userInfo.role : 'user'
    });

    if (options.conversationId) {
      this.setData({ conversationId: options.conversationId, myPerspective: options.perspective || '' });
      this.loadConversation();
    } else if (options.sellerId && options.productId) {
      this.setData({ myPerspective: 'buyer' });
      this.startConversation(options.sellerId, options.productId);
    }
  },

  onShow() {
    this.connectWs();
    this.markRead();
  },

  onHide() {
    this.disconnectWs();
    this.markRead();
  },

  onUnload() {
    this.disconnectWs();
    this.markRead();
  },

  markRead() {
    if (this.data.conversationId && this.data.myPerspective) {
      api.post('/conversations/' + this.data.conversationId + '/read',
        { perspective: this.data.myPerspective }).catch(() => {});
    }
  },

  // ===== WebSocket =====
  connectWs() {
    if (this._socket) return;
    const token = auth.getAccessToken();
    if (!token) return;

    const wsBase = config.API_BASE_URL.replace('/api/v1', '').replace('http://', 'ws://').replace('https://', 'wss://');
    const wsUrl = wsBase + '/ws/chat?token=' + token;
    const socket = wx.connectSocket({ url: wsUrl });

    socket.onOpen(() => { console.log('WS opened'); });
    socket.onMessage((res) => {
      try {
        const msg = JSON.parse(res.data);
        if (msg.conversationId === this.data.conversationId && msg.id) {
          const exists = this.data.messages.some(m => m.id === msg.id);
          if (!exists) {
            this.appendMessage(this.formatMessage(msg));
          }
        }
      } catch (e) {}
    });
    socket.onClose(() => { this._socket = null; });
    socket.onError(() => { this._socket = null; });
    this._socket = socket;
  },

  disconnectWs() {
    if (this._socket) {
      this._socket.close({});
      this._socket = null;
    }
  },

  // ===== 会话 =====
  async startConversation(sellerId, productId) {
    wx.showLoading({ title: '连接中...' });
    try {
      const res = await api.post('/conversations/start', { sellerId: sellerId, productId: productId });
      wx.hideLoading();
      this.setData({
        conversationId: res.conversationId,
        otherUserId: res.otherUserId,
        otherUserName: res.otherUserName || '卖家',
        otherUserAvatar: res.otherUserAvatar
      });
      if (this.data.myRole === 'user') {
        await this.loadProductCard(productId);
      }
      await this.loadMessages();
      this.connectWs();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '发起会话失败', icon: 'none' });
    }
  },

  async loadConversation() {
    try {
      const res = await api.get('/conversations/' + this.data.conversationId);
      this.setData({
        otherUserId: res.otherUserId,
        otherUserName: res.otherUserName || '用户',
        otherUserAvatar: res.otherUserAvatar,
        messages: []  // 清空旧消息
      });
      await this.loadMessages();
    } catch (err) {
      wx.showToast({ title: '加载会话失败', icon: 'none' });
    }
  },

  async loadProductCard(productId) {
    try {
      const res = await api.get('/products/' + productId);
      const p = res.product || {};
      this.setData({
        showProductCard: true,
        productCard: { productId: p.id, name: p.name, coverUrl: p.coverUrl, price: p.displayPrice || p.retailPrice || '0.00' }
      });
    } catch (err) {}
  },

  // ===== 消息 =====
  async loadMessages() {
    if (!this.data.conversationId || this.data.loading) return;
    this.setData({ loading: true });
    try {
      const params = { limit: 20 };
      const before = this.data.messages.length > 0 ? this.data.messages[0].id : null;
      if (before) params.before = before;

      const res = await api.get('/conversations/' + this.data.conversationId + '/messages', params);
      if (res.length < 20) this.setData({ hasMore: false });

      const formatted = (res || []).map(m => this.formatMessage(m));
      if (formatted.length > 0) {
        const isInitial = this.data.messages.length === 0;
        const all = [...formatted, ...this.data.messages];
        this.setData({ messages: all });
        if (isInitial) this.scrollToBottom();
      }
    } catch (err) {
      console.error('加载消息失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  formatMessage(m) {
    if (m.productCard && typeof m.productCard === 'string') {
      try { m.productCard = JSON.parse(m.productCard); } catch (e) {}
    }
    m.createdAt = this.formatMsgTime(m.createdAt);
    // 消息左右：根据 senderRole + myPerspective 判断
    m._isMine = m.senderRole === this.data.myPerspective;
    return m;
  },

  onInput(e) { this.setData({ inputText: e.detail.value }); },

  async sendText() {
    const text = this.data.inputText.trim();
    if (!text || !this.data.conversationId) return;
    this.setData({ inputText: '' });
    try {
      const res = await api.post('/conversations/' + this.data.conversationId + '/messages', { type: 'text', content: text, perspective: this.data.myPerspective });
      this.appendMessage(this.formatMessage(res));
    } catch (err) {
      wx.showToast({ title: '发送失败', icon: 'none' });
      this.setData({ inputText: text });
    }
  },

  async sendProductCard() {
    const card = this.data.productCard;
    if (!card || !this.data.conversationId) return;
    this.setData({ showProductCard: false });
    try {
      const res = await api.post('/conversations/' + this.data.conversationId + '/messages', { type: 'product_card', productCard: JSON.stringify(card), perspective: this.data.myPerspective });
      this.appendMessage(this.formatMessage(res));
    } catch (err) {
      wx.showToast({ title: '发送失败', icon: 'none' });
      this.setData({ showProductCard: true });
    }
  },

  chooseImage() {
    wx.chooseImage({ count: 1, sizeType: ['compressed'], success: (res) => this.uploadAndSendImage(res.tempFilePaths[0]) });
  },

  chooseVideo() {
    wx.chooseVideo({
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      camera: 'back',
      success: (res) => {
        if (res.size > 100 * 1024 * 1024) {
          wx.showToast({ title: '视频不能超过100MB', icon: 'none' });
          return;
        }
        this.uploadAndSendVideo(res.tempFilePath, res.size);
      }
    });
  },

  async uploadAndSendImage(filePath) {
    wx.showLoading({ title: '发送中...' });
    try {
      const { compressImage, toWebp } = require('../../utils/media');

      const compressResult = await compressImage(filePath);
      filePath = compressResult.path;
      console.log('[上传] 图片压缩 ' + (compressResult.ok ? '成功' : '未生效 — ' + (compressResult.reason || '未知原因')));

      const webpResult = await toWebp(filePath);
      filePath = webpResult.path;
      const webpOk = webpResult.ok;
      console.log('[上传] WebP转换 ' + (webpOk ? '成功' : '未生效 — ' + (webpResult.reason || '未知原因')));

      const cosUpload = require('../../utils/cos-upload');
      const imageUrl = await cosUpload.uploadFile(filePath, 'chats', null, webpOk ? 'webp' : null);

      const res = await api.post('/conversations/' + this.data.conversationId + '/messages', {
        type: 'image',
        imageUrl: imageUrl,
        perspective: this.data.myPerspective
      });
      wx.hideLoading();
      this.appendMessage(this.formatMessage(res));
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '图片发送失败', icon: 'none' });
    }
  },

  async uploadAndSendVideo(filePath, fileSize) {
    wx.showLoading({ title: '上传视频中...' });
    try {
      const { compressVideo } = require('../../utils/media');
      const originalSize = (fileSize / (1024 * 1024)).toFixed(1);

      const compressResult = await compressVideo(filePath);
      filePath = compressResult.path;
      console.log('[上传] 视频压缩 ' + (compressResult.ok ? '成功' : '未生效 — ' + (compressResult.reason || '未知原因')) + ' (原' + originalSize + 'MB)');

      const cosUpload = require('../../utils/cos-upload');
      const videoUrl = await cosUpload.uploadFile(filePath, 'chats');

      const res = await api.post('/conversations/' + this.data.conversationId + '/messages', {
        type: 'video',
        imageUrl: videoUrl,
        perspective: this.data.myPerspective
      });
      wx.hideLoading();
      this.appendMessage(this.formatMessage(res));
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '视频发送失败', icon: 'none' });
    }
  },

  appendMessage(msg) {
    // 去重
    if (this.data.messages.some(m => m.id === msg.id)) return;
    this.setData({ messages: [...this.data.messages, msg] });
    this.scrollToBottom();
  },

  scrollToBottom() {
    const msgs = this.data.messages;
    if (msgs.length > 0) this.setData({ scrollToId: 'msg-' + msgs[msgs.length - 1].id });
  },

  closeProductCard() { this.setData({ showProductCard: false }); },

  previewImage(e) { wx.previewImage({ urls: [e.currentTarget.dataset.url] }); },

  goToProduct(e) {
    const card = e.currentTarget.dataset.product;
    if (card) {
      try { const p = typeof card === 'string' ? JSON.parse(card) : card; wx.navigateTo({ url: '/pages/detail/detail?id=' + p.productId }); } catch (e) {}
    }
  },

  formatMsgTime(raw) {
    if (!raw) return '';
    if (raw.length >= 16 && raw.includes('T')) return raw.substring(5, 16).replace('T', ' ');
    return raw.substring(0, 16);
  },

  goBack() { wx.navigateBack(); }
});
