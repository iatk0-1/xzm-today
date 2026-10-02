const api = require('../../utils/api');
const auth = require('../../utils/auth');
const finance = require('../../utils/managerFinance');

Page({
  data: {
    rules: [], editing: false, id: '', name: '', enabled: true, segments: [],
    activeIndex: 0, keys: ['x', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.'],
    trialCost: '', trialPrice: '', boundary: '', error: '', saving: false,
    stallId: '', stallName: ''
  },

  async onLoad(options) {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) throw new Error('仅管理员可设置规则');
      this._authorized = true;
      this.setData({
        stallId: String(options.stallId || ''), stallName: options.stallName || ''
      });
      await this.load();
    } catch (error) {
      this.fail(error);
    }
  },

  async load() {
    if (!this._authorized) return;
    try {
      const rules = await api.get('/pricing-rules', { includeDisabled: true });
      this.setData({ rules, error: '' });
    } catch (error) {
      this.fail(error);
    }
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  input(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, trialPrice: '' });
  },

  newRule() {
    this.setData({
      editing: true, id: '', name: '', enabled: true, activeIndex: 0, trialPrice: '',
      segments: finance.segmentsWithLabels([{
        lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x'
      }])
    });
  },

  edit(event) {
    const rule = this.data.rules[Number(event.currentTarget.dataset.index)];
    this.setData({
      editing: true, id: String(rule.id), name: rule.name, enabled: rule.enabled,
      segments: finance.segmentsWithLabels(rule.segments), activeIndex: 0, trialPrice: ''
    });
  },

  selectSegment(event) {
    this.setData({ activeIndex: Number(event.currentTarget.dataset.index), trialPrice: '' });
  },

  key(event) {
    const key = event.currentTarget.dataset.key;
    this.changeFormula(formula => formula + (key === '×' ? '*' : key === '÷' ? '/' : key));
  },

  backspace() {
    this.changeFormula(formula => formula.slice(0, -1));
  },

  clear() {
    this.changeFormula(() => '');
  },

  changeFormula(change) {
    const segments = this.data.segments.map(segment => ({ ...segment }));
    const selected = segments[this.data.activeIndex];
    if (!selected) return;
    const value = change(selected.formula);
    if (value.length > 512) return this.fail(new Error('公式不能超过512个字符'));
    selected.formula = value;
    this.setData({ segments, trialPrice: '' });
  },

  toggle(event) {
    const index = Number(event.currentTarget.dataset.index);
    const boundaryIndex = event.currentTarget.dataset.side === 'left' ? index - 1 : index;
    this.setData({
      segments: finance.segmentsWithLabels(finance.toggleBoundary(this.data.segments, boundaryIndex)),
      trialPrice: ''
    });
  },

  boundaryInput(event) {
    this.setData({ boundary: event.detail.value });
  },

  updateBoundary(event) {
    try {
      this.setData({
        segments: finance.segmentsWithLabels(finance.changeBoundary(
          this.data.segments, Number(event.currentTarget.dataset.index), this.data.boundary)),
        trialPrice: ''
      });
    } catch (error) {
      this.fail(error);
    }
  },

  addSegment() {
    try {
      if (this.data.segments.length >= 100) throw new Error('一条规则最多100个区间');
      const boundary = Number(finance.money(this.data.boundary));
      const segments = this.data.segments.map(segment => ({ ...segment }));
      const last = segments[segments.length - 1];
      if (boundary <= Number(last.lower)) throw new Error('新分界点必须大于最后区间下界');
      last.upper = boundary;
      last.upperInclusive = true;
      segments.push({
        lower: boundary, upper: null, lowerInclusive: false, upperInclusive: false,
        formula: last.formula
      });
      this.setData({
        segments: finance.segmentsWithLabels(segments), activeIndex: segments.length - 1,
        trialPrice: ''
      });
    } catch (error) {
      this.fail(error);
    }
  },

  async merge(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (index <= 0) return;
    if (!await finance.confirmAction('合并区间', '合并到上一段并保留上一段公式，请检查合并后的公式再保存。')) return;
    const segments = this.data.segments.map(segment => ({ ...segment }));
    segments[index - 1].upper = segments[index].upper;
    segments[index - 1].upperInclusive = segments[index].upperInclusive;
    segments.splice(index, 1);
    this.setData({
      segments: finance.segmentsWithLabels(segments), activeIndex: index - 1, trialPrice: ''
    });
  },

  enabled(event) {
    this.setData({ enabled: event.detail.value });
  },

  async preview() {
    try {
      const result = await api.post('/pricing-rules/preview', {
        segments: this.cleanSegments(), cost: finance.money(this.data.trialCost)
      });
      this.setData({ trialPrice: result.price, error: '' });
    } catch (error) {
      this.fail(error);
    }
  },

  cleanSegments() {
    return this.data.segments.map(({ label, ...segment }) => segment);
  },

  async save() {
    if (!this._authorized || this.data.saving) return;
    this.setData({ saving: true });
    try {
      const body = {
        name: finance.requireText(this.data.name, '规则名称'),
        enabled: this.data.enabled, segments: this.cleanSegments()
      };
      if (this.data.id) await api.put('/pricing-rules/' + this.data.id, body);
      else await api.post('/pricing-rules', body);
      this.setData({ editing: false });
      await this.load();
    } catch (error) {
      this.fail(error);
    } finally {
      this.setData({ saving: false });
    }
  },

  async assign(event) {
    if (!this._authorized || !this.data.stallId) return;
    try {
      const id = event.currentTarget.dataset.id;
      await api.put('/stalls/' + this.data.stallId + '/pricing-rule', {
        ruleId: id ? String(id) : null
      });
      wx.showToast({ title: '档口规则已更新' });
    } catch (error) {
      this.fail(error);
    }
  },

  close() {
    this.setData({ editing: false });
  },

  fail(error) {
    this.setData({ error: error.message || '规则操作失败' });
  }
});
