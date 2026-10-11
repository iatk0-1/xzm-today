const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { getErrorMessage } = require('../../utils/error');
const provinces = require('../../utils/provinces');
// 与样式中的省份行高度一致，沿用目录管理页的单一位置写入方式。
const RULE_HEIGHT = 48;
function pickDragTouch(event, identifier) {
  const touches = event.touches && event.touches.length ? event.touches : event.changedTouches || [];
  return identifier == null ? touches[0] : touches.find(touch => touch.identifier === identifier);
}

Page({
  data: { templates: [], provinces: [{ code: '', name: '请选择省份' }].concat(provinces), provinceIndex: 0,
    loading: false, refreshing: false, busy: false, error: '', editing: false,
    id: '', name: '', enabled: false, rules: [], dragIndex: -1, dragY: 0, ruleScrollTop: 0, ruleViewportHeight: 320 },
  async onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : null;
    if (windowInfo && windowInfo.windowHeight) this.setData({ ruleViewportHeight: Math.max(96, Math.floor(windowInfo.windowHeight * 0.45)) });
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) throw new Error('仅管理员可管理快递运费模板');
      this._authorized = true;
      await this.load();
    } catch (error) { this.fail(error); }
  },
  async onRefresh() {
    if (this.data.refreshing) return;
    if (this.data.busy || this.data.editing || this.data.dragIndex >= 0) {
      this.setData({ refreshing: false }); return;
    }
    this.setData({ refreshing: true });
    try { await this.load(); } finally { this.setData({ refreshing: false }); }
  },
  async onShow() { if (this._authorized && !this.data.editing && !this.data.busy) await this.load(); },
  async load() {
    if (!this._authorized || this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const templates = await api.get('/admin/shipping-templates');
      this.setData({ templates: (templates || []).map(template => ({ ...template, id: String(template.id),
        rules: (template.rules || []).map(rule => ({ ...rule,
          provinceName: (provinces.find(p => p.code === rule.provinceCode) || {}).name || rule.provinceCode,
          feeLabel: rule.shippingFee == null || Number(rule.shippingFee) === 0 ? '免运费' : '运费 ¥' + Number(rule.shippingFee).toFixed(2),
          quantityLabel: rule.firstQuantity == null ? '整单计费' : '首单 ' + rule.firstQuantity + ' 件' })) })) });
    } catch (error) { this.fail(error); } finally { this.setData({ loading: false }); }
  },
  newTemplate() {
    if (!this._authorized || this.data.busy) return;
    this.resetRuleDrag();
    this.setData({ editing: true, id: '', name: '', enabled: false, rules: [], error: '', ruleScrollTop: 0 });
    this._ruleScrollTop = 0;
  },
  editTemplate(event) {
    if (!this._authorized || this.data.busy) return;
    const template = this.data.templates.find(t => t.id === String(event.currentTarget.dataset.id));
    if (!template) return;
    this.resetRuleDrag();
    this._ruleScrollTop = 0;
    this.setData({ editing: true, id: template.id, name: template.name, enabled: template.enabled, error: '',
      ruleScrollTop: 0,
      rules: this.positionRules(template.rules.map(rule => ({ provinceCode: rule.provinceCode, provinceName: rule.provinceName,
        provinceIndex: this.data.provinces.findIndex(p => p.code === rule.provinceCode),
        shippingFee: rule.shippingFee == null ? '' : String(rule.shippingFee),
        firstQuantity: rule.firstQuantity == null ? '' : String(rule.firstQuantity) }))) });
  },
  cancelEdit() {
    if (!this.data.busy) { this.resetRuleDrag(); this.setData({ editing: false, error: '' }); }
  },
  inputName(event) { if (!this.data.busy) this.setData({ name: event.detail.value }); },
  addProvince(event) {
    if (this.data.busy || this.data.dragIndex >= 0) return;
    const p = this.data.provinces[Number(event.detail.value)];
    this.setData({ provinceIndex: 0 });
    if (!p || !p.code) return;
    if (this.data.rules.some(r => r.provinceCode === p.code)) {
      this.fail(new Error('同一模板不能重复配置省份')); return;
    }
    this.setData({ rules: this.positionRules(this.data.rules.concat({ provinceCode: p.code, provinceName: p.name,
      provinceIndex: Number(event.detail.value), shippingFee: '', firstQuantity: '' })), error: '' });
  },
  changeProvince(event) {
    if (this.data.busy || this.data.dragIndex >= 0) return;
    const index = Number(event.currentTarget.dataset.index);
    const provinceIndex = Number(event.detail.value);
    const p = this.data.provinces[provinceIndex];
    if (!this.data.rules[index] || !p || !p.code) return;
    if (this.data.rules.some((rule, i) => i !== index && rule.provinceCode === p.code)) {
      this.fail(new Error('同一模板不能重复配置省份')); return;
    }
    this.setData({ rules: this.data.rules.map((rule, i) => i === index ? { ...rule,
      provinceCode: p.code, provinceName: p.name, provinceIndex } : rule), error: '' });
  },
  completeProvinces() {
    if (!this._authorized || !this.data.editing || this.data.busy || this.data.dragIndex >= 0) return;
    const existing = new Set(this.data.rules.map(rule => rule.provinceCode));
    const missing = this.data.provinces.reduce((rules, province, provinceIndex) => {
      if (province.code && !existing.has(province.code)) rules.push({
        provinceCode: province.code, provinceName: province.name, provinceIndex,
        shippingFee: '', firstQuantity: ''
      });
      return rules;
    }, []);
    if (missing.length) this.setData({ rules: this.positionRules(this.data.rules.concat(missing)), error: '' });
    wx.showToast({ title: missing.length ? '已补全省份' : '省份已齐全', icon: 'none' });
  },
  inputRule(event) {
    if (this.data.busy || this.data.dragIndex >= 0) return;
    const { index, field } = event.currentTarget.dataset;
    if (!['shippingFee', 'firstQuantity'].includes(field)) return;
    const rules = this.data.rules.map((rule, i) => i === Number(index) ? { ...rule, [field]: event.detail.value } : rule);
    this.setData({ rules });
  },
  removeProvince(event) {
    if (!this.data.busy && this.data.dragIndex < 0) this.setData({
      rules: this.positionRules(this.data.rules.filter((_, i) => i !== Number(event.currentTarget.dataset.index))) });
  },
  positionRules(rules) { return rules.map((rule, index) => ({ ...rule, y: index * RULE_HEIGHT })); },
  noop() {},
  clearPendingDrag() {
    if (this._longPressTimer != null) clearTimeout(this._longPressTimer);
    this._longPressTimer = null;
    this._pendingDrag = null;
  },
  onDragHandleTouchStart(event) {
    if (!this._authorized || !this.data.editing || this.data.busy || this.data.dragIndex >= 0) return;
    this.clearPendingDrag();
    const index = Number(event.currentTarget.dataset.index);
    const touch = pickDragTouch(event, null);
    if (!this.data.rules[index] || this.data.rules.length < 2 || !touch) return;
    // 从 touchstart 记下触点，避免 longpress 没带 touches 时直接退出。
    const pending = { index, touch: { identifier: touch.identifier, clientX: touch.clientX, clientY: touch.clientY } };
    this._pendingDrag = pending;
    // 手柄会拦截触摸冒泡，自己计时识别长按，不依赖父级合成的 longpress。
    this._longPressTimer = setTimeout(() => {
      if (this._pendingDrag !== pending) return;
      this.onDragStart({ currentTarget: { dataset: { index } }, touches: [pending.touch] });
    }, 350);
  },
  onDragStart(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this._authorized || !this.data.editing || this.data.busy || this.data.dragIndex >= 0
        || !this.data.rules[index] || this.data.rules.length < 2) return;
    const pending = this._pendingDrag;
    const touch = pickDragTouch(event, null) || (pending && pending.index === index ? pending.touch : null);
    if (!touch) return;
    this.clearPendingDrag();
    this._dragTouchId = touch.identifier;
    this._dragFingerStartY = this._dragFingerY = touch.clientY;
    this._dragOriginY = index * RULE_HEIGHT;
    this._dragScrollStart = this._ruleScrollTop || 0;
    const generation = this._dragGeneration = (this._dragGeneration || 0) + 1;
    this.setData({ dragIndex: index, dragY: this._dragOriginY });
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
    wx.createSelectorQuery().in(this)
      .select('.rule-scroll').boundingClientRect()
      .select('.rule-scroll').scrollOffset()
      .exec(result => {
        if (this._dragGeneration !== generation || this.data.dragIndex !== index) return;
        const bounds = result && result[0], offset = result && result[1];
        if (!bounds || !bounds.height) return;
        this._dragBounds = bounds;
        this._ruleScrollTop = offset && typeof offset.scrollTop === 'number' ? offset.scrollTop : this._ruleScrollTop || 0;
        this._dragScrollStart = this._ruleScrollTop;
        this.syncDragRow();
        this._dragTimer = setInterval(() => this.autoScrollRules(), 32);
      });
  },
  onDragTouchMove(event) {
    if (this.data.dragIndex < 0) {
      const pending = this._pendingDrag;
      const touch = pending && pickDragTouch(event, pending.touch.identifier);
      if (touch && (Math.abs(touch.clientY - pending.touch.clientY) > 8
          || Math.abs(touch.clientX - pending.touch.clientX) > 8)) this.clearPendingDrag();
      return;
    }
    const touch = pickDragTouch(event, this._dragTouchId);
    if (!touch) return;
    this._dragFingerY = touch.clientY;
    this.syncDragRow();
  },
  syncDragRow() {
    const index = this.data.dragIndex;
    if (index < 0) return;
    const target = this._dragOriginY + this._dragFingerY - this._dragFingerStartY
      + (this._ruleScrollTop || 0) - this._dragScrollStart;
    const y = Math.max(0, Math.min((this.data.rules.length - 1) * RULE_HEIGHT, target));
    this.setData({ ['rules[' + index + '].y']: y, dragY: y });
  },
  autoScrollRules() {
    const bounds = this._dragBounds;
    if (!bounds || this.data.dragIndex < 0) return;
    const edge = Math.min(72, bounds.height / 3);
    const top = bounds.top, bottom = bounds.top + bounds.height;
    let step = 0;
    if (this._dragFingerY < top + edge) step = -Math.min(18, 4 + 14 * (top + edge - this._dragFingerY) / edge);
    else if (this._dragFingerY > bottom - edge) step = Math.min(18, 4 + 14 * (this._dragFingerY - bottom + edge) / edge);
    const maxScroll = Math.max(0, this.data.rules.length * RULE_HEIGHT - bounds.height);
    const current = this._ruleScrollTop || 0;
    const next = Math.max(0, Math.min(maxScroll, current + step));
    if (next === current) return;
    // 与目录管理一致，滚动量和行位置一起记账，避免异步 scroll 回传把行带偏。
    this._ruleScrollTop = next;
    this.setData({ ruleScrollTop: next });
    this.syncDragRow();
  },
  onRuleScroll(event) {
    if (this.data.dragIndex >= 0) return;
    this._ruleScrollTop = event.detail.scrollTop;
  },
  onDragEnd() {
    this.clearPendingDrag();
    const index = this.data.dragIndex;
    if (index < 0) return;
    const target = Math.max(0, Math.min(this.data.rules.length - 1, Math.round(this.data.dragY / RULE_HEIGHT)));
    const rules = this.data.rules.slice();
    rules.splice(target, 0, rules.splice(index, 1)[0]);
    const bounds = this._dragBounds;
    if (bounds) {
      const rowTop = target * RULE_HEIGHT, rowBottom = rowTop + RULE_HEIGHT;
      let scrollTop = Math.min(this._ruleScrollTop || 0, rowTop);
      if (scrollTop + bounds.height < rowBottom) scrollTop = rowBottom - bounds.height;
      this._ruleScrollTop = Math.max(0, scrollTop);
      this.setData({ ruleScrollTop: this._ruleScrollTop });
    }
    this.resetRuleDrag();
    this.setData({ rules: this.positionRules(rules) });
  },
  onDragCancel() {
    this.resetRuleDrag();
    this.setData({ rules: this.positionRules(this.data.rules) });
  },
  resetRuleDrag() {
    this.clearPendingDrag();
    if (this._dragTimer) clearInterval(this._dragTimer);
    this._dragTimer = null;
    this._dragBounds = null;
    this._dragGeneration = (this._dragGeneration || 0) + 1;
    this.setData({ dragIndex: -1 });
  },
  onHide() { this.onDragCancel(); },
  onUnload() { this.resetRuleDrag(); },
  async save() {
    if (!this._authorized || this.data.busy || this.data.dragIndex >= 0) return;
    this.setData({ busy: true, error: '' });
    try {
      const name = this.data.name.trim();
      if (!name || name.length > 100) throw new Error('模板名称必填，最多100字');
      const rules = this.data.rules.map(rule => {
        const fee = rule.shippingFee.trim(), first = rule.firstQuantity.trim();
        if (fee && (!/^\d+(\.\d{1,2})?$/.test(fee) || Number(fee) > 99999999.99))
          throw new Error(rule.provinceName + '运费须为非负金额，最多两位小数');
        if (first && (!/^[1-9]\d*$/.test(first) || Number(first) > 2147483647))
          throw new Error(rule.provinceName + '首单件数须为有效正整数');
        return { provinceCode: rule.provinceCode, shippingFee: fee ? fee : null, firstQuantity: first ? Number(first) : null };
      });
      const template = this.data.id ? await api.put('/admin/shipping-templates/' + this.data.id, { name, rules })
        : await api.post('/admin/shipping-templates', { name, rules });
      this.setData({ editing: false });
      wx.showToast({ title: template.enabled ? '已保存并立即生效' : '已保存，尚未生效', icon: 'none' });
      await this.load();
    } catch (error) { this.fail(error); } finally { this.setData({ busy: false }); }
  },
  async changeEnabled(event) {
    if (!this._authorized || this.data.busy) return;
    const template = this.data.templates.find(t => t.id === String(event.currentTarget.dataset.id));
    if (!template) return;
    this.setData({ busy: true, error: '' });
    try {
      await api.post('/admin/shipping-templates/' + template.id + (template.enabled ? '/deactivate' : '/activate'), {});
      wx.showToast({ title: template.enabled ? '模板已停用' : '模板已生效', icon: 'none' });
      await this.load();
    } catch (error) { this.fail(error); } finally { this.setData({ busy: false }); }
  },
  fail(error) {
    const message = getErrorMessage(error, '快递运费模板操作失败');
    if (this.data.editing) {
      this.setData({ error: '' });
      wx.showModal({ title: '操作提示', content: message, showCancel: false });
      return;
    }
    this.setData({ error: message });
  }
});
