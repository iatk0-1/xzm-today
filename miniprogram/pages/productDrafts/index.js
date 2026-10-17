const auth = require('../../utils/auth');
const draft = require('../../utils/draft');
const { getErrorMessage } = require('../../utils/error');
const { publishDraft } = require('../../utils/productDraftPublisher');
const { createDraftPricingEditor } = require('../../utils/productDraftPricing');

const TYPES = [
  { value: '', label: '全部' }, { value: 'create', label: '普通新增' },
  { value: 'edit', label: '普通编辑' }, { value: 'convert', label: '直播转普通' },
  { value: 'live_create', label: '直播新增' }, { value: 'live_edit', label: '直播编辑' }
];

Page({
  data: { types: TYPES, typeIndex: 0, keyword: '', sessionId: '', items: [], total: 0, limit: 100,
    loading: false, refreshing: false, deleting: false, hasMore: false, error: '', moreError: '',
    selecting: false, selectedCount: 0, allSelected: false, selectingAll: false,
    publishing: false, publishProgress: '', authorized: false },

  onLoad(options) {
    this._page = 0; this._generation = 0; this._selected = new Map();
    this._publishErrors = new Map();
    this._pricingEditor = createDraftPricingEditor();
    this._pricingModels = new Map(); this._pricingLoads = new Map(); this._pricingSaves = new Map();
    this.setData({ sessionId: options.sessionId || '' });
  },
  async onShow() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin() && !auth.isStallManager()) throw new Error('请切换到商品管理身份后查看草稿');
      this.setData({ authorized: true });
      await this.reload();
    } catch (error) { this.setData({ authorized: false, error: getErrorMessage(error, '加载草稿失败') }); }
  },
  onUnload() { this._unloaded = true; this._generation++; },
  onKeywordInput(e) { this.setData({ keyword: e.detail.value }); },
  search() { this.reload(); },
  clearSearch() { this.setData({ keyword: '' }); this.reload(); },
  selectType(e) { if (this.isBatchBusy()) return; this.setData({ typeIndex: Number(e.detail.value) }); this.reload(); },
  clearSession() { if (this.isBatchBusy()) return; this.setData({ sessionId: '' }); this.reload(); },
  isBatchBusy() { return this.data.deleting || this.data.publishing || this.data.selectingAll; },

  async reload() {
    if (!this.data.authorized || this.isBatchBusy()) return;
    try { await this.flushPricingChanges(); }
    catch (_) { return; }
    if (this._unloaded) return;
    this._pricingEditor.resetRules();
    this._pricingModels.clear(); this._pricingLoads.clear();
    this._generation++;
    this._page = 0; this._selected.clear(); this._publishErrors.clear();
    this.setData({ items: [], selectedCount: 0, allSelected: false, error: '', moreError: '', refreshing: true });
    const generation = this._generation;
    const count = draft.summary({ sessionId: this.data.sessionId }).then(value => {
      if (!this._unloaded && generation === this._generation) this.setData({ total: Number(value.total), limit: value.limit });
    }).catch(error => {
      if (!this._unloaded && generation === this._generation) this.setData({ error: getErrorMessage(error, '读取草稿数量失败，请重试') });
    });
    await Promise.all([this.fetchPage(1, generation), count]);
    if (!this._unloaded && generation === this._generation) this.setData({ refreshing: false });
  },

  async fetchPage(page, generation) {
    this.setData({ loading: true, moreError: '' });
    try {
      const value = await draft.list({ page, size: 20, keyword: this.data.keyword.trim(),
        draftType: TYPES[this.data.typeIndex].value, sessionId: this.data.sessionId });
      if (this._unloaded || generation !== this._generation) return;
      const rows = (value.content || []).map(item => ({ ...item, id: String(item.id),
        typeLabel: (TYPES.find(type => type.value === item.draftType) || {}).label || '历史草稿',
        savedText: draft.formatTime(item.savedAt), selected: this._selected.has(String(item.id)),
        stallsText: ((item.summary || {}).stalls || []).map(stall => stall.name).join('、'),
        warningText: [this._publishErrors.get(String(item.id)), ...(item.warnings || [])].filter(Boolean).join('；'),
        pricing: { loading: true, ready: false, costInput: '', ruleName: '加载中…', rules: [] } }));
      const merged = page === 1 ? rows : this.data.items.concat(rows);
      this._page = page;
      this.setData({ items: merged.filter((row, i, all) => all.findIndex(item => item.id === row.id) === i),
        hasMore: !!value.hasNext });
      this.syncSelection();
      this.hydratePricing(rows);
    } catch (error) {
      if (!this._unloaded && generation === this._generation) this.setData(page === 1
        ? { error: getErrorMessage(error, '加载草稿失败，请重试') }
        : { moreError: getErrorMessage(error, '加载更多失败，请重试') });
    } finally {
      if (!this._unloaded && generation === this._generation) this.setData({ loading: false });
    }
  },
  async hydratePricing(rows) {
    const generation = this._generation;
    let next = 0;
    const worker = async () => {
      while (next < rows.length && !this._unloaded && generation === this._generation) {
        const row = rows[next++];
        if (row.capabilities && !row.capabilities.edit) continue;
        try { await this.ensurePricing(row); } catch (_) { /* 错误显示在对应草稿卡片。 */ }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  },
  renderPricing(id) {
    if (this._unloaded) return;
    const model = this._pricingModels.get(id);
    if (!model) return;
    const pricing = { ready: true, loading: false, costInput: model.costInput, mixedCosts: model.mixedCosts,
      ruleName: model.ruleName || '未选择', rules: model.rules.map(rule => ({ id: rule.id, name: rule.name })),
      ruleIndex: Math.max(0, model.rules.findIndex(rule => rule.id === model.ruleId)),
      saving: !!model.saving, dirty: model.costChanged || model.ruleChanged,
      saved: model.saved, priceText: (model.record.draftData || {}).displayPrice || '', error: model.error || '' };
    this.setData({ items: this.data.items.map(row => row.id === id ? { ...row, pricing } : row) });
  },
  async ensurePricing(row) {
    const id = String(row.id);
    const generation = this._generation;
    const model = this._pricingModels.get(id);
    if (model && String(model.record.version) === String(row.version)) { this.renderPricing(id); return model; }
    if (this._pricingLoads.has(id)) return this._pricingLoads.get(id);
    const loading = this._pricingEditor.load(row).then(value => {
      if (!this._unloaded && generation === this._generation) { this._pricingModels.set(id, value); this.renderPricing(id); }
      return value;
    }).catch(error => {
      if (!this._unloaded && generation === this._generation) this.setData({ items: this.data.items.map(item => item.id === id
        ? { ...item, pricing: { ready: false, loading: false, error: getErrorMessage(error, '加载成本和规则失败') } } : item) });
      throw error;
    }).finally(() => { if (this._pricingLoads.get(id) === loading) this._pricingLoads.delete(id); });
    this._pricingLoads.set(id, loading);
    return loading;
  },
  retryPricing(e) {
    if (this.isBatchBusy()) return;
    const row = this.data.items.find(item => item.id === String(e.currentTarget.dataset.id));
    if (row) return this.ensurePricing(row).catch(() => {});
  },
  onDraftCostInput(e) {
    if (this.isBatchBusy()) return;
    const id = String(e.currentTarget.dataset.id), model = this._pricingModels.get(id);
    if (!model) return;
    model.costInput = e.detail.value; model.costChanged = true; model.mixedCosts = false;
    model.revision++; model.error = ''; model.saved = false;
    this.renderPricing(id);
  },
  onDraftCostBlur(e) {
    const id = String(e.currentTarget.dataset.id), model = this._pricingModels.get(id);
    if (!model) return;
    if (!this.isBatchBusy() && String(model.costInput) !== e.detail.value) this.onDraftCostInput(e);
    return this.saveCardPricing(id).catch(() => {});
  },
  onDraftRuleChange(e) {
    if (this.isBatchBusy()) return;
    const id = String(e.currentTarget.dataset.id), model = this._pricingModels.get(id);
    const rule = model && model.rules[Number(e.detail.value)];
    if (!rule) return;
    model.ruleId = rule.id; model.ruleName = rule.name; model.ruleChanged = true;
    model.revision++; model.error = ''; model.saved = false;
    this.renderPricing(id);
    return this.saveCardPricing(id).catch(() => {});
  },
  retrySavePricing(e) { return this.saveCardPricing(String(e.currentTarget.dataset.id)).catch(() => {}); },
  async saveCardPricing(id) {
    const model = this._pricingModels.get(id);
    if (!model || (!model.costChanged && !model.ruleChanged && !model.pendingSave)) return;
    if (this._pricingSaves.has(id)) {
      if (model.revision !== model.savingRevision) model.saveRequested = true;
      return this._pricingSaves.get(id);
    }
    model.saveRequested = true;
    const saving = (async () => {
      model.saving = true;
      this.renderPricing(id);
      try {
        while (model.saveRequested) {
          model.saveRequested = false;
          const revision = model.revision;
          model.savingRevision = revision;
          const changes = { costInput: model.costInput, ruleId: model.ruleId,
            costChanged: model.costChanged, ruleChanged: model.ruleChanged };
          const record = await this._pricingEditor.save(model, changes);
          if (model.revision === revision) {
            model.costChanged = false; model.ruleChanged = false; model.saved = true;
            if (changes.costChanged) model.costInput = record.draftData.costPrice;
          }
          model.error = '';
          this._publishErrors.delete(id);
          if (this._selected.has(id)) this._selected.set(id, record.version);
          if (!this._unloaded) this.setData({ items: this.data.items.map(row => row.id === id
            ? { ...row, version: record.version, savedText: draft.formatTime(record.savedAt),
              warningText: (record.warnings || []).join('；') } : row) });
        }
      } catch (error) {
        model.error = getErrorMessage(error, '成本和规则未保存，请重试');
        throw error;
      } finally {
        model.saving = false;
        this.renderPricing(id);
      }
    })();
    this._pricingSaves.set(id, saving);
    try { return await saving; }
    finally { if (this._pricingSaves.get(id) === saving) this._pricingSaves.delete(id); }
  },
  async flushPricingChanges() {
    for (const [id, model] of this._pricingModels) {
      if (model.costChanged || model.ruleChanged || model.pendingSave || model.saving) await this.saveCardPricing(id);
    }
  },
  loadMore() { if (!this.isBatchBusy() && !this.data.loading && this.data.hasMore) return this.fetchPage(this._page + 1, this._generation); },
  syncSelection() {
    const items = this.data.items.map(item => ({ ...item, selected: this._selected.has(item.id) }));
    this.setData({ items, selectedCount: this._selected.size,
      allSelected: !!items.length && !this.data.hasMore && items.every(item => item.selected) });
  },
  toggleSelectMode() {
    if (this.isBatchBusy()) return;
    this._selected.clear();
    this.setData({ selecting: !this.data.selecting });
    this.syncSelection();
  },
  toggleSelect(e) {
    if (this.isBatchBusy()) return;
    const id = String(e.currentTarget.dataset.id), row = this.data.items.find(item => item.id === id);
    if (!row) return;
    if (this._selected.has(id)) this._selected.delete(id); else this._selected.set(id, row.version);
    this.syncSelection();
  },
  async toggleSelectAll() {
    if (this.isBatchBusy() || this.data.loading || !this.data.selecting) return;
    if (this.data.allSelected) { this._selected.clear(); this.syncSelection(); return; }
    this.setData({ selectingAll: true });
    try {
      // 全选覆盖当前筛选的全部分页，避免只选中屏幕上已加载的草稿。
      while (this.data.hasMore && !this._unloaded) {
        await this.fetchPage(this._page + 1, this._generation);
        if (this.data.moreError) throw new Error(this.data.moreError);
      }
      if (this._unloaded) return;
      this.data.items.forEach(item => this._selected.set(item.id, item.version));
      this.syncSelection();
    } catch (error) {
      if (!this._unloaded) wx.showToast({ title: getErrorMessage(error, '全选失败，请重试'), icon: 'none' });
    } finally { if (!this._unloaded) this.setData({ selectingAll: false }); }
  },
  async publishSelected() {
    if (this.isBatchBusy() || this.data.loading || !this.data.authorized || !this._selected.size) return;
    const selected = [...this._selected].map(([id, version]) => ({ id, version,
      title: (this.data.items.find(item => item.id === id) || {}).title || '商品草稿' }));
    return this.publishItems(selected);
  },
  publishOne(e) {
    const row = this.data.items.find(item => item.id === String(e.currentTarget.dataset.id));
    if (row) return this.publishItems([{ id: row.id, version: row.version, title: row.title }]);
  },
  async publishItems(selected) {
    if (this.isBatchBusy() || this.data.loading || !this.data.authorized || !selected.length) return;
    this.setData({ publishing: true, publishProgress: '准备发布…' });
    const failures = [];
    let succeeded = 0;
    try {
      for (let index = 0; index < selected.length && !this._unloaded; index++) {
        const item = selected[index];
        this.setData({ publishProgress: '正在发布 ' + (index + 1) + '/' + selected.length });
        let result;
        try {
          await this.saveCardPricing(item.id);
          if (this._unloaded) break;
          const model = this._pricingModels.get(item.id);
          result = await publishDraft({ ...item, version: model ? model.record.version : item.version });
        }
        catch (error) {
          const message = getErrorMessage(error, '发布失败，请重试');
          failures.push(item.title + '：' + message);
          this._publishErrors.set(item.id, '发布失败：' + message);
          continue;
        }
        succeeded++;
        this._selected.delete(item.id);
        this._publishErrors.delete(item.id);
        this._pricingModels.delete(item.id);
        if (this._unloaded) break;
        this.setData({ items: this.data.items.filter(row => row.id !== item.id), total: Math.max(0, this.data.total - 1) });
        this.syncSelection();
        const opener = this.getOpenerEventChannel && this.getOpenerEventChannel();
        try { if (opener && opener.emit) opener.emit('productUpdated', result.product || result); }
        catch (error) { console.warn('通知商品更新失败:', error); }
      }
      if (this._unloaded) return;
      // 商品发布后列表位置已变化，从第一页刷新，失败项继续保持选中。
      this._generation++;
      this._page = 0;
      await this.fetchPage(1, this._generation);
      try {
        const count = await draft.summary({ sessionId: this.data.sessionId });
        if (!this._unloaded) this.setData({ total: Number(count.total), limit: count.limit });
      } catch (error) { console.warn('刷新草稿数量失败:', error); }
      if (this._unloaded) return;
      if (failures.length) wx.showModal({ title: '已发布 ' + succeeded + ' 份，失败 ' + failures.length + ' 份',
        content: failures.slice(0, 5).join('\n') + (failures.length > 5 ? '\n其余失败原因可在草稿列表查看。' : '')
          + '\n失败草稿已保留，可继续编辑或重试。', showCancel: false });
      else wx.showToast({ title: '已发布 ' + succeeded + ' 份商品', icon: 'success' });
    } finally { if (!this._unloaded) this.setData({ publishing: false, publishProgress: '' }); }
  },
  async openDraft(e) {
    if (this.data.selecting) return this.toggleSelect(e);
    if (this.isBatchBusy()) return;
    let row = this.data.items.find(item => item.id === String(e.currentTarget.dataset.id));
    if (row && this._pricingModels.has(row.id)) {
      try { await this.saveCardPricing(row.id); } catch (_) { return; }
      if (this._unloaded) return;
      row = this.data.items.find(item => item.id === row.id);
    }
    if (row) wx.navigateTo({ url: draft.editorUrl(row), events: { productUpdated: product => {
      const opener = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (opener && opener.emit) opener.emit('productUpdated', product);
    } } });
  },
  async deleteOne(e) {
    let row = this.data.items.find(item => item.id === String(e.currentTarget.dataset.id));
    if (row && this._pricingModels.has(row.id)) {
      try { await this.saveCardPricing(row.id); } catch (_) { return; }
      if (this._unloaded) return;
      row = this.data.items.find(item => item.id === row.id);
    }
    if (row) this.confirmDelete([{ id: row.id, version: row.version }]);
  },
  async deleteSelected() {
    if (this.isBatchBusy()) return;
    for (const id of this._selected.keys()) {
      const model = this._pricingModels.get(id);
      if (model && (model.costChanged || model.ruleChanged || model.pendingSave || model.saving)) {
        try { await this.saveCardPricing(id); } catch (_) { return; }
      }
    }
    if (!this._unloaded) this.confirmDelete([...this._selected].map(([id, version]) => ({ id, version })));
  },
  confirmDelete(items) {
    if (!items.length || this.isBatchBusy()) return;
    wx.showModal({ title: items.length > 1 ? '删除 ' + items.length + ' 份草稿' : '删除草稿',
      content: '删除后无法恢复，确定删除选中的草稿吗？', confirmText: '删除', confirmColor: '#c53929',
      success: async res => {
        if (!res.confirm || this.isBatchBusy()) return;
        this.setData({ deleting: true });
        try {
          await draft.batchDelete(items);
          wx.showToast({ title: '草稿已删除', icon: 'success' });
          this.setData({ deleting: false });
          await this.reload();
        } catch (error) {
          wx.showModal({ title: '删除失败', content: getErrorMessage(error, '草稿未删除，请刷新后重试'), showCancel: false });
        } finally { if (!this._unloaded) this.setData({ deleting: false }); }
      } });
  },
  async createProduct() {
    if (this.isBatchBusy()) return;
    try { await this.flushPricingChanges(); } catch (_) { return; }
    if (this._unloaded) return;
    const url = this.data.sessionId && auth.isAdmin()
      ? '/pages/liveRoomPublish/publish?sessionId=' + encodeURIComponent(this.data.sessionId) : '/pages/admin/admin';
    wx.navigateTo({ url });
  }
});
