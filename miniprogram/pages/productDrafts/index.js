const auth = require('../../utils/auth');
const draft = require('../../utils/draft');
const { getErrorMessage } = require('../../utils/error');

const TYPES = [
  { value: '', label: '全部' }, { value: 'create', label: '普通新增' },
  { value: 'edit', label: '普通编辑' }, { value: 'convert', label: '直播转普通' },
  { value: 'live_create', label: '直播新增' }, { value: 'live_edit', label: '直播编辑' }
];

Page({
  data: { types: TYPES, typeIndex: 0, keyword: '', sessionId: '', items: [], total: 0, limit: 100,
    loading: false, refreshing: false, deleting: false, hasMore: false, error: '', moreError: '',
    selecting: false, selectedCount: 0, authorized: false },

  onLoad(options) {
    this._page = 0; this._generation = 0; this._selected = new Map();
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
  selectType(e) { this.setData({ typeIndex: Number(e.detail.value) }); this.reload(); },
  clearSession() { this.setData({ sessionId: '' }); this.reload(); },

  async reload() {
    if (!this.data.authorized || this.data.deleting) return;
    this._generation++;
    this._page = 0; this._selected.clear();
    this.setData({ items: [], selectedCount: 0, error: '', moreError: '', refreshing: true });
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
        warningText: (item.warnings || []).join('；') }));
      const merged = page === 1 ? rows : this.data.items.concat(rows);
      this._page = page;
      this.setData({ items: merged.filter((row, i, all) => all.findIndex(item => item.id === row.id) === i),
        hasMore: !!value.hasNext });
    } catch (error) {
      if (!this._unloaded && generation === this._generation) this.setData(page === 1
        ? { error: getErrorMessage(error, '加载草稿失败，请重试') }
        : { moreError: getErrorMessage(error, '加载更多失败，请重试') });
    } finally {
      if (!this._unloaded && generation === this._generation) this.setData({ loading: false });
    }
  },
  loadMore() { if (!this.data.loading && this.data.hasMore) return this.fetchPage(this._page + 1, this._generation); },
  toggleSelectMode() {
    if (this.data.deleting) return;
    this._selected.clear();
    this.setData({ selecting: !this.data.selecting, selectedCount: 0, items: this.data.items.map(row => ({ ...row, selected: false })) });
  },
  toggleSelect(e) {
    if (this.data.deleting) return;
    const id = String(e.currentTarget.dataset.id), row = this.data.items.find(item => item.id === id);
    if (!row) return;
    if (this._selected.has(id)) this._selected.delete(id); else this._selected.set(id, row.version);
    this.setData({ selectedCount: this._selected.size, items: this.data.items.map(item => ({ ...item, selected: this._selected.has(item.id) })) });
  },
  openDraft(e) {
    if (this.data.selecting) return this.toggleSelect(e);
    if (this.data.deleting) return;
    const row = this.data.items.find(item => item.id === String(e.currentTarget.dataset.id));
    if (row) wx.navigateTo({ url: draft.editorUrl(row), events: { productUpdated: product => {
      const opener = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (opener && opener.emit) opener.emit('productUpdated', product);
    } } });
  },
  deleteOne(e) {
    const row = this.data.items.find(item => item.id === String(e.currentTarget.dataset.id));
    if (row) this.confirmDelete([{ id: row.id, version: row.version }]);
  },
  deleteSelected() { this.confirmDelete([...this._selected].map(([id, version]) => ({ id, version }))); },
  confirmDelete(items) {
    if (!items.length || this.data.deleting) return;
    wx.showModal({ title: items.length > 1 ? '删除 ' + items.length + ' 份草稿' : '删除草稿',
      content: '删除后无法恢复，确定删除选中的草稿吗？', confirmText: '删除', confirmColor: '#c53929',
      success: async res => {
        if (!res.confirm) return;
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
  createProduct() {
    const url = this.data.sessionId && auth.isAdmin()
      ? '/pages/liveRoomPublish/publish?sessionId=' + encodeURIComponent(this.data.sessionId) : '/pages/admin/admin';
    wx.navigateTo({ url });
  }
});
