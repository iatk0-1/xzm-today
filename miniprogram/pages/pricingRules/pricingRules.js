const { getErrorMessage } = require('../../utils/error');
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const finance = require('../../utils/managerFinance');

function decodeStallName(value) {
  try {
    return decodeURIComponent(value || '');
  } catch (error) {
    return value || '';
  }
}

function markupBandsForEditing(rule) {
  const bands=rule.markupBands || (rule.profitBands || []).map(({ maximumProfit, ...band }) => ({ ...band, maximumMarkup: maximumProfit }));
  return bands.map(band=>({ ...band, minimumProfit: band.minimumProfit == null ? '10' : String(band.minimumProfit) }));
}

Page({
  data: {
    rules: [], editing: false, id: '', name: '', enabled: true, segments: [],
    activeIndex: 0, keys: ['x', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.'],
    trialCost: '', trialPrice: '', calculatorOpen: false,
    profitRule: false, cappedMarkupRule: false, legacyProfitCap: false, minimumProfit: '10', profitPercent: '10', trialProfit: '', trialMarkup: '',
    formulaCursor: 0, formulaCells: [],
    editingBoundary: '', boundaryValue: '', boundaryError: '', error: '', saving: false,
    ruleBusy: '',
    stallId: '', stallName: '', currentRule: null, currentRules: [], currentRuleIds: [], assignmentLoaded: false, assigning: false
  },

  async onLoad(options) {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) throw new Error('仅管理员可设置规则');
      this._authorized = true;
      this.setData({
        stallId: String(options.stallId || ''), stallName: decodeStallName(options.stallName)
      });
      await this.load();
    } catch (error) {
      this.fail(error);
    }
  },

  async load() {
    if (!this._authorized) return;
    try {
      const [rules, currentRule] = await Promise.all([
        api.get('/pricing-rules', { includeDisabled: true }),
        this.data.stallId ? api.get('/stalls/' + encodeURIComponent(this.data.stallId) + '/pricing-rules') : null
      ]);
      const assigned = Array.isArray(currentRule) ? currentRule : (currentRule ? [currentRule] : []);
      const assignedIds = assigned.map(item => String(item.id));
      this.setData({ rules: this.ruleRows(rules, assignedIds), currentRules: assigned,
        currentRule: assigned[0] || null, currentRuleIds: assignedIds, assignmentLoaded: true, error: '' });
    } catch (error) {
      this.fail(error);
    }
  },

  ruleRows(rules, assignedIds = this.data.currentRuleIds || []) {
    return (rules || []).filter(rule => !rule.deleted).map(rule => {
      const first = finance.segmentsWithLabels(rule.segments)[0];
      const bands = finance.segmentsWithLabels(rule.markupBands || rule.profitBands);
      return { ...rule,
        bandSummaries: bands.map(band => ({ label: band.label + (band.upper == null ? ' 无上限' : ''),
          description: rule.markupBands
            ? '按成本的' + band.profitPercent + '%计算总加价，与' + band.maximumMarkup + '元取较小值（含2%预留）'
              + (band.minimumProfit == null ? '；此版本未设最低利润' : '；最低利润' + band.minimumProfit + '元优先保障')
            : '预期利润取成本的' + band.profitPercent + '%与' + band.maximumProfit + '元中的较小值' })),
        assigned: assignedIds.includes(String(rule.id)),
        firstCondition: bands.length ? (rule.markupBands ? '分段加价封顶' : '旧版利润封顶') + '，共 ' + bands.length + ' 个成本区间'
          : rule.minimumProfit != null ? '预期利润取 ' + rule.minimumProfit + ' 元与成本的'
          + (rule.profitPercent == null ? 10 : rule.profitPercent) + '%中的较大值'
          : first ? first.label + (first.upper == null ? ' 无上限' : '') : '暂无条件公式',
        firstFormula: rule.markupBands ? '成本 + 加价（先按比例封顶，再保障本段最低利润）'
          : bands.length || rule.minimumProfit != null ? '(成本 + 预期利润) ÷ 0.98'
          : first ? first.formula : '暂无价格公式'
      };
    });
  },

  async changeRuleStatus(event) {
    if (!this._authorized || this.data.ruleBusy || this.data.assigning) return;
    const rule = this.data.rules[Number(event.currentTarget.dataset.index)];
    if (!rule) return;
    const id = String(rule.id);
    const enabled = !!event.detail.value;
    this.setData({ ruleBusy: id, error: '',
      rules: this.data.rules.map(item => String(item.id) === id ? { ...item, enabled } : item)
    });
    try {
      const updated = await api.put('/pricing-rules/' + id + '/enabled', { enabled });
      const nextRules = this.data.rules.map(item => String(item.id) === id ? updated : item);
      const nextAssigned = (this.data.currentRules || []).map(item => String(item.id) === id ? updated : item);
      this.setData({ rules: this.ruleRows(nextRules), currentRules: nextAssigned,
        currentRule: this.data.currentRule && String(this.data.currentRule.id) === id ? updated : this.data.currentRule });
    } catch (error) {
      this.setData({ rules: this.data.rules.map(item => String(item.id) === id ? { ...item, enabled: rule.enabled } : item) });
      this.fail(error);
    } finally {
      this.setData({ ruleBusy: '' });
    }
  },

  async deleteRule(event) {
    if (!this._authorized || this.data.ruleBusy || this.data.assigning) return;
    const rule = this.data.rules[Number(event.currentTarget.dataset.index)];
    if (!rule) return;
    const id = String(rule.id);
    this.setData({ ruleBusy: id });
    try {
      if (!await finance.confirmAction('删除计价规则', '删除后不再显示，也不能用于新增商品或新分配档口。已分配的档口和已使用的商品会保留。确定删除“' + rule.name + '”吗？')) return;
      await api.delete('/pricing-rules/' + id);
      this.setData({ rules: this.data.rules.filter(item => String(item.id) !== id), error: '' });
      const deleted = { ...rule, deleted: true, enabled: false };
      const nextAssigned = (this.data.currentRules || []).map(item => String(item.id) === id ? deleted : item);
      this.setData({ currentRules: nextAssigned, currentRule: this.data.currentRule && String(this.data.currentRule.id) === id ? deleted : this.data.currentRule });
      wx.showToast({ title: '计价规则已删除' });
    } catch (error) {
      this.fail(error);
    } finally {
      this.setData({ ruleBusy: '' });
    }
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  input(event) {
    this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, trialPrice: '' });
  },

  newRule() {
    this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({
      editing: true, id: '', name: '', enabled: true, activeIndex: 0, trialPrice: '',
      profitRule: false, cappedMarkupRule: false, legacyProfitCap: false, minimumProfit: '10', profitPercent: '10', trialProfit: '', trialMarkup: '',
      calculatorOpen: false, editingBoundary: '', boundaryValue: '', boundaryError: '', error: '',
      segments: finance.segmentsWithLabels([{
        lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x'
      }])
    });
  },

  newProfitRule() {
    this.newRule();
    this.setData({ profitRule: true, name: '利润保底规则', minimumProfit: '10', profitPercent: '10', segments: [] });
  },

  newCappedMarkupRule() {
    this.newRule();
    this.setData({ cappedMarkupRule: true, name: '分段加价封顶规则',
      segments: finance.segmentsWithLabels([{
        lower: 0, upper: null, lowerInclusive: false, upperInclusive: false,
        maximumMarkup: '30', profitPercent: '10', minimumProfit: '10'
      }]) });
  },

  bandInput(event) {
    const { index, field } = event.currentTarget.dataset;
    if (!this.data.cappedMarkupRule || !['maximumMarkup', 'profitPercent', 'minimumProfit'].includes(field)) return;
    const segments = this.data.segments.map(segment => ({ ...segment }));
    if (!segments[Number(index)]) return;
    segments[Number(index)][field] = event.detail.value;
    this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({ segments, trialPrice: '', trialProfit: '', trialMarkup: '', error: '' });
  },

  chooseProfit(event) {
    this.input({ currentTarget: { dataset: { field: 'minimumProfit' } },
      detail: { value: String(event.currentTarget.dataset.amount) } });
  },

  edit(event) {
    const rule = this.data.rules[Number(event.currentTarget.dataset.index)];
    if (!rule) return;
    this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({
      editing: true, id: String(rule.id), name: rule.name, enabled: rule.enabled,
      profitRule: rule.minimumProfit != null, minimumProfit: String(rule.minimumProfit == null ? '10' : rule.minimumProfit),
      cappedMarkupRule: rule.markupBands != null || rule.profitBands != null, legacyProfitCap: rule.profitBands != null,
      profitPercent: String(rule.profitPercent == null ? '10' : rule.profitPercent),
      segments: finance.segmentsWithLabels(rule.markupBands || rule.profitBands ? markupBandsForEditing(rule) : rule.segments), activeIndex: 0, trialPrice: '', trialProfit: '', trialMarkup: '',
      calculatorOpen: false, editingBoundary: '', boundaryValue: '', boundaryError: '', error: ''
    });
  },

  copy(event) {
    const rule = this.data.rules[Number(event.currentTarget.dataset.index)];
    if (!rule) return;
    this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({
      editing: true, id: '', name: rule.name, enabled: rule.enabled,
      profitRule: rule.minimumProfit != null, minimumProfit: String(rule.minimumProfit == null ? '10' : rule.minimumProfit),
      cappedMarkupRule: rule.markupBands != null || rule.profitBands != null, legacyProfitCap: rule.profitBands != null,
      profitPercent: String(rule.profitPercent == null ? '10' : rule.profitPercent),
      segments: finance.segmentsWithLabels((rule.markupBands || rule.profitBands ? markupBandsForEditing(rule) : rule.segments || []).map(segment => ({ ...segment }))),
      activeIndex: 0, trialPrice: '', trialProfit: '', trialMarkup: '', calculatorOpen: false,
      formulaCursor: 0, formulaCells: [], editingBoundary: '', boundaryValue: '',
      boundaryError: '', error: ''
    });
  },

  openCalculator(event) {
    if (this.data.cappedMarkupRule) return;
    if (!this.finishBoundaryEdit()) return;
    const activeIndex = Number(event.currentTarget.dataset.index);
    const segment = this.data.segments[activeIndex];
    if (!segment) return;
    this._formulaCursorRequest = (this._formulaCursorRequest || 0) + 1;
    this.setData({
      activeIndex, calculatorOpen: true, formulaCursor: segment.formula.length,
      formulaCells: this.formulaCells(segment.formula), error: ''
    });
  },

  closeCalculator() {
    this._formulaCursorRequest = (this._formulaCursorRequest || 0) + 1;
    this.setData({ calculatorOpen: false });
  },

  formulaCells(formula) {
    return formula.split('').map((character, index) => ({ character, index }));
  },

  setFormulaCursor(position) {
    if (!this.data.calculatorOpen) return;
    const formula = this.data.segments[this.data.activeIndex].formula;
    const cursor = Number(position);
    if (!Number.isFinite(cursor)) return;
    this._formulaCursorRequest = (this._formulaCursorRequest || 0) + 1;
    this.setData({ formulaCursor: Math.max(0, Math.min(formula.length, Math.trunc(cursor))) });
  },

  selectFormulaCursor(event) {
    if (!this.data.calculatorOpen) return;
    const index = Number(event.currentTarget.dataset.cursor);
    const x = event.detail && event.detail.x;
    if (!Number.isInteger(index)) return;
    if (!Number.isFinite(x) || typeof wx.createSelectorQuery !== 'function') {
      this.setFormulaCursor(index);
      return;
    }
    // 按点击落在字符左半边或右半边，定位到该字符前后。
    const request = this._formulaCursorRequest = (this._formulaCursorRequest || 0) + 1;
    wx.createSelectorQuery().select('#formula-char-' + index).boundingClientRect(rect => {
      if (request !== this._formulaCursorRequest || !this.data.calculatorOpen) return;
      this.setFormulaCursor(rect && x > rect.left + rect.width / 2 ? index + 1 : index);
    }).exec();
  },

  moveFormulaCursor(event) {
    if (!this.data.calculatorOpen) return;
    const { position, offset } = event.currentTarget.dataset;
    const formula = this.data.segments[this.data.activeIndex].formula;
    this.setFormulaCursor(position === 'start' ? 0 : position === 'end' ? formula.length
      : this.data.formulaCursor + Number(offset));
  },

  formulaEnd() {
    if (!this.data.calculatorOpen) return;
    this.setFormulaCursor(this.data.segments[this.data.activeIndex].formula.length);
  },

  noop() {
  },

  key(event) {
    const key = event.currentTarget.dataset.key;
    const value = key === '×' ? '*' : key === '÷' ? '/' : key;
    this.changeFormula((formula, cursor) => ({
      value: formula.slice(0, cursor) + value + formula.slice(cursor),
      cursor: cursor + value.length
    }));
  },

  backspace() {
    this.changeFormula((formula, cursor) => ({
      value: cursor > 0 ? formula.slice(0, cursor - 1) + formula.slice(cursor) : formula,
      cursor: Math.max(0, cursor - 1)
    }));
  },

  clear() {
    this.changeFormula(() => ({ value: '', cursor: 0 }));
  },

  changeFormula(change) {
    if (!this.data.calculatorOpen) return;
    const segments = this.data.segments.map(segment => ({ ...segment }));
    const selected = segments[this.data.activeIndex];
    if (!selected) return;
    const cursor = Math.max(0, Math.min(selected.formula.length, this.data.formulaCursor));
    const { value, cursor: nextCursor } = change(selected.formula, cursor);
    if (value.length > 512) return this.fail(new Error('公式不能超过512个字符'));
    this._formulaCursorRequest = (this._formulaCursorRequest || 0) + 1;
    selected.formula = value;
    this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({
      segments: finance.segmentsWithLabels(segments), formulaCursor: nextCursor,
      formulaCells: this.formulaCells(value), trialPrice: '', error: ''
    });
  },

  toggle(event) {
    if (!this.finishBoundaryEdit()) return;
    this._previewRequest = (this._previewRequest || 0) + 1;
    const index = Number(event.currentTarget.dataset.index);
    const boundaryIndex = event.currentTarget.dataset.side === 'left' ? index - 1 : index;
    this.setData({
      segments: finance.segmentsWithLabels(finance.toggleBoundary(this.data.segments, boundaryIndex)),
      trialPrice: '', error: ''
    });
  },

  editBoundary(event) {
    const { index, side } = event.currentTarget.dataset;
    const editingBoundary = index + ':' + side;
    if (this.data.editingBoundary === editingBoundary) return;
    if (!this.finishBoundaryEdit()) return;
    const segment = this.data.segments[Number(index)];
    if (!segment || (side === 'left' && Number(index) === 0)) return;
    const value = side === 'left' ? segment.lower : segment.upper;
    this.setData({
      editingBoundary, boundaryValue: value == null ? '' : String(value),
      calculatorOpen: false, boundaryError: '', error: ''
    });
  },

  boundaryInput(event) {
    if (event.currentTarget.dataset.boundary !== this.data.editingBoundary) return;
    this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({ boundaryValue: event.detail.value, boundaryError: '', error: '' });
  },

  updateBoundary(event) {
    if (event.currentTarget.dataset.boundary !== this.data.editingBoundary) return;
    this.finishBoundaryEdit();
  },

  finishBoundaryEdit() {
    if (!this.data.editingBoundary) return true;
    try {
      const [indexText, side] = this.data.editingBoundary.split(':');
      const index = Number(indexText);
      const value = this.data.boundaryValue.trim();
      const segment = this.data.segments[index];
      let segments = this.data.segments;
      if (side === 'right' && segment.upper == null) {
        // 未输入数字时保持无上限；确认有效数字后自动补齐末段。
        if (value) {
          const limit = this.data.cappedMarkupRule ? 50 : 100;
          if (segments.length >= limit) throw new Error('一条规则最多' + limit + '个区间');
          const boundary = Number(finance.money(value));
          if (boundary <= Number(segment.lower)) throw new Error('新分界点必须大于当前区间下界');
          segments = segments.map(item => ({ ...item }));
          segments[index].upper = boundary;
          segments[index].upperInclusive = true;
          segments.push({ ...segment,
            lower: boundary, upper: null, lowerInclusive: false, upperInclusive: false
          });
        }
      } else {
        segments = finance.changeBoundary(segments, side === 'left' ? index - 1 : index, value);
      }
      this._previewRequest = (this._previewRequest || 0) + 1;
      this.setData({
        segments: finance.segmentsWithLabels(segments), editingBoundary: '', boundaryValue: '',
        boundaryError: '', trialPrice: '', error: ''
      });
      return true;
    } catch (error) {
      this.setData({ boundaryError: getErrorMessage(error, '分界点更新失败') });
      return false;
    }
  },

  async merge(event) {
    if (!this.finishBoundaryEdit()) return;
    const index = Number(event.currentTarget.dataset.index);
    if (index <= 0) return;
    if (!await finance.confirmAction('合并区间', this.data.cappedMarkupRule
      ? '合并到上一段并保留上一段的最低利润、利润比例和最高预期加价，请检查后再保存。'
      : '合并到上一段并保留上一段公式，请检查合并后的公式再保存。')) return;
    const segments = this.data.segments.map(segment => ({ ...segment }));
    segments[index - 1].upper = segments[index].upper;
    segments[index - 1].upperInclusive = segments[index].upperInclusive;
    segments.splice(index, 1);
    this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({
      segments: finance.segmentsWithLabels(segments), activeIndex: index - 1, trialPrice: '',
      calculatorOpen: false, error: ''
    });
  },

  enabled(event) {
    this.setData({ enabled: event.detail.value });
  },

  async preview() {
    if (!this.finishBoundaryEdit()) return;
    const request = this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({ trialPrice: '', trialProfit: '', trialMarkup: '' });
    try {
      const result = await api.post('/pricing-rules/preview', {
        ...this.pricingSettings(), cost: finance.money(this.data.trialCost)
      });
      if (request !== this._previewRequest) return;
      this.setData({ trialPrice: result.price,
        trialProfit: result.expectedProfit == null ? '' : String(result.expectedProfit),
        trialMarkup: result.markup == null ? '' : Number(result.markup).toFixed(2), error: '' });
    } catch (error) {
      if (request === this._previewRequest) this.fail(error);
    }
  },

  pricingSettings() {
    if (this.data.cappedMarkupRule) {
      if (!this.data.segments.length || this.data.segments.length > 50) throw new Error('加价封顶规则需要1至50个成本区间');
      return { markupBands: this.data.segments.map((segment, index) => {
        let maximumMarkup, profitPercent, minimumProfit;
        try { minimumProfit = finance.money(segment.minimumProfit); }
        catch (_) { throw new Error('第' + (index + 1) + '段最低预期利润须大于零，最多两位小数且不超过99999999.99元'); }
        try { maximumMarkup = finance.money(segment.maximumMarkup); }
        catch (_) { throw new Error('第' + (index + 1) + '段最高预期加价须大于零，最多两位小数且不超过99999999.99元'); }
        try { profitPercent = finance.money(segment.profitPercent, true); }
        catch (_) { throw new Error('第' + (index + 1) + '段利润比例须填写非负数字，最多两位小数且不超过99999999.99%'); }
        return { lower: segment.lower, upper: segment.upper, lowerInclusive: segment.lowerInclusive,
          upperInclusive: segment.upperInclusive, maximumMarkup, profitPercent, minimumProfit };
      }) };
    }
    if (!this.data.profitRule) return { segments: this.cleanSegments() };
    let minimumProfit;
    try { minimumProfit = finance.money(this.data.minimumProfit); }
    catch (error) { throw new Error('最低预期利润：' + getErrorMessage(error, '输入无效')); }
    let profitPercent;
    try { profitPercent = finance.money(this.data.profitPercent, true); }
    catch (_) { throw new Error('利润比例须填写非负数字，最多两位小数且不超过99999999.99%'); }
    return { minimumProfit, profitPercent };
  },

  cleanSegments() {
    return this.data.segments.map(({ label, ...segment }) => segment);
  },

  async save() {
    if (!this._authorized || this.data.saving) return;
    if (!this.finishBoundaryEdit()) return;
    let name;
    try {
      name = finance.requireText(this.data.name, '规则名称');
    } catch (error) {
      this.fail(error);
      return;
    }
    const duplicate = this.data.rules.some(rule => String(rule.id) !== String(this.data.id)
      && String(rule.name || '').trim() === name);
    if (duplicate) {
      this.setData({ error: '规则名称已存在，请换个名称后再保存' });
      return;
    }
    this.setData({ saving: true });
    try {
      const body = {
        name,
        enabled: this.data.enabled, ...this.pricingSettings()
      };
      if (this.data.id) await api.put('/pricing-rules/' + this.data.id, body);
      else await api.post('/pricing-rules', body);
      this.setData({ editing: false, calculatorOpen: false });
      await this.load();
    } catch (error) {
      this.fail(error);
    } finally {
      this.setData({ saving: false });
    }
  },

  async assign(event) {
    if (!this._authorized || !this.data.stallId || this.data.assigning || this.data.ruleBusy) return;
    this.setData({ assigning: true });
    try {
      const id = event.currentTarget.dataset.id;
      if (id && (this.data.currentRuleIds || []).includes(String(id))) {
        await api.delete('/stalls/' + this.data.stallId + '/pricing-rules/' + encodeURIComponent(String(id)));
        const assigned = (this.data.currentRules || []).filter(item => String(item.id) !== String(id));
        const assignedIds = assigned.map(item => String(item.id));
        this.setData({ currentRules: assigned, currentRuleIds: assignedIds, rules: this.ruleRows(this.data.rules, assignedIds), currentRule: assigned[0] || null, assignmentLoaded: true, error: '' });
        wx.showToast({ title: '已解除档口规则' });
        return;
      }
      const currentRule = await api.put('/stalls/' + this.data.stallId + '/pricing-rule', {
        ruleId: id ? String(id) : null
      });
      const assigned = id ? (this.data.currentRules || []).concat(currentRule ? [currentRule] : []) : [];
      const assignedIds = assigned.map(item => String(item.id));
      this.setData({ currentRules: assigned, currentRuleIds: assignedIds, rules: this.ruleRows(this.data.rules, assignedIds), currentRule: assigned[0] || null, assignmentLoaded: true, error: '' });
      wx.showToast({ title: '档口规则已更新' });
    } catch (error) {
      this.fail(error);
    } finally {
      this.setData({ assigning: false });
    }
  },

  close() {
    this._previewRequest = (this._previewRequest || 0) + 1;
    this.setData({ editing: false, calculatorOpen: false, editingBoundary: '', boundaryValue: '', boundaryError: '' });
  },

  fail(error) {
    this.setData({ error: getErrorMessage(error, '规则操作失败') });
  }
});
