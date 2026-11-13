const api = require('../../utils/api');
const auth = require('../../utils/auth');
const consent = require('../../utils/purchaseConsent');
const { getErrorMessage } = require('../../utils/error');

Page({
  isPurchaseConsentPage: true,
  data: { content: '', ready: false, remaining: 5, reachedBottom: false, submitting: false, error: '', scrollTop: 0 },
  onLoad(options = {}) {
    consent.entered();
    let returnTo = '/pages/index/index';
    try { returnTo = decodeURIComponent(options.returnTo || returnTo); } catch (error) { /* 使用首页 */ }
    this._returnTo = /^\/pages\/[a-zA-Z0-9_/-]+(?:\?.*)?$/.test(returnTo)
      && !returnTo.startsWith('/' + consent.GATE_ROUTE) ? returnTo : '/pages/index/index';
    this._visible = true;
    this.loadNotice();
  },
  onShow() { this._visible = true; this.resumeReading(); },
  onHide() { this._visible = false; this.pauseReading(); },
  onUnload() { this._visible = false; this._disposed = true; this.pauseReading(); },
  async loadNotice() {
    if (this._loading) return;
    this._loading = true;
    this.pauseReading();
    this._elapsed = 0;
    this.setData({ ready: false, remaining: 5, reachedBottom: false, error: '', scrollTop: 0 });
    try {
      await auth.ensureAuthenticated({ silent: true });
      await auth.loadPermissionSnapshot();
      const current = await api.get('/purchase-consent');
      if (this._disposed) return;
      if (current.agreed) { consent.remember(current); this.enterApp(); return; }
      const reading = await api.post('/purchase-consent/reading', {});
      if (this._disposed) return;
      this._reading = reading;
      this.setData({ content: reading.purchaseNotice, ready: true }, () => {
        this.measureContent();
        this.resumeReading();
      });
    } catch (error) {
      if (!this._disposed) this.setData({ error: getErrorMessage(error, '须知加载失败，请点击下方按钮重试') });
    } finally { this._loading = false; }
  },
  measureContent() {
    if (!wx.createSelectorQuery) return;
    const reading = this._reading;
    const query = wx.createSelectorQuery().in(this);
    query.select('.consent-scroll').boundingClientRect();
    query.select('.consent-body').boundingClientRect();
    query.exec(rects => {
      // 短文案一屏已完整展示时，当前位置就是底部；换版后的旧测量不能放开新须知。
      if (!this._disposed && this.data.ready && reading === this._reading && rects[0] && rects[1]
          && rects[1].height <= rects[0].height) this.onReadBottom();
    });
  },
  resumeReading() {
    if (!this._visible || !this.data.ready || this._timer || this.data.remaining === 0) return;
    this._startedAt = Date.now();
    this._timer = setInterval(() => {
      const elapsed = (this._elapsed || 0) + Date.now() - this._startedAt;
      const remaining = Math.max(0, Math.ceil((5000 - elapsed) / 1000));
      if (remaining !== this.data.remaining) this.setData({ remaining });
      if (!remaining) this.pauseReading();
    }, 200);
  },
  pauseReading() {
    if (!this._timer) return;
    this._elapsed = (this._elapsed || 0) + Math.max(0, Date.now() - this._startedAt);
    clearInterval(this._timer); this._timer = null;
  },
  onReadBottom() { if (this.data.ready) this.setData({ reachedBottom: true }); },
  async agree() {
    if (this.data.submitting) return;
    if (!this.data.ready || !this._reading) { await this.loadNotice(); return; }
    if (this.data.remaining > 0 || !this.data.reachedBottom) return;
    this.setData({ submitting: true, error: '' });
    try {
      const result = await api.post('/purchase-consent/agree', {
        readingId: this._reading.readingId, version: this._reading.version, reachedBottom: this.data.reachedBottom
      });
      if (!result.agreed) throw new Error('同意记录保存失败，请重试');
      consent.remember(result);
      this.enterApp();
    } catch (error) {
      if (['NOTICE_UPDATED', 'READING_EXPIRED'].includes(error.code || error.error)) await this.loadNotice();
      else this.setData({ error: getErrorMessage(error, '同意记录保存失败，请点击按钮重试') });
    } finally { this.setData({ submitting: false }); }
  },
  enterApp() {
    wx.reLaunch({ url: this._returnTo, fail: () => this.setData({ error: '进入页面失败，请点击按钮重试' }) });
  }
});
