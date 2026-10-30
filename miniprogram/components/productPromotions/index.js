const api = require('../../utils/api');
const { getErrorMessage } = require('../../utils/error');
const { TYPES, LABELS, schemeRequest, summary } = require('../../utils/productPromotions');

Component({
  properties: { value: { type: Object, value: null }, disabled: { type: Boolean, value: false } },
  data: { visible: false, loading: false, saving: false, error: '', schemes: [], firstChoices: [], otherChoices: [],
    firstIndex: 0, otherIndex: 0, otherTypeIndex: 0, typeLabels: ['不使用', '满减优惠', '多件多折', '多件优惠'],
    editing: false, form: {}, createTypes: LABELS, createTypeIndex: 0 },
  observers: { value() { this.syncChoices(); } },
  methods: {
    syncChoices() {
      const value = this.data.value || {};
      const none = { id: '', name: '不使用', label: '不使用' };
      const available = this.data.schemes.filter(s => s.enabled || String(s.id) === String(value.firstSchemeId) || String(s.id) === String(value.otherSchemeId))
        .map(s => ({ ...s, label: s.name + ' · ' + summary(s) }));
      const firstChoices = [none, ...available.filter(s => s.type === 'FIRST')];
      const type = value.otherType || (available.find(s => String(s.id) === String(value.otherSchemeId)) || {}).type || '';
      const otherTypeIndex = Math.max(0, TYPES.indexOf(type));
      const otherChoices = [none, ...available.filter(s => s.type === type && s.type !== 'FIRST')];
      this.setData({ firstChoices, otherChoices, otherTypeIndex,
        firstIndex: Math.max(0, firstChoices.findIndex(s => String(s.id) === String(value.firstSchemeId || ''))),
        otherIndex: Math.max(0, otherChoices.findIndex(s => String(s.id) === String(value.otherSchemeId || ''))) });
    },
    async open() {
      if (this.data.disabled) return;
      this.setData({ visible: true, loading: true, error: '', editing: false });
      try { this.setData({ schemes: await api.get('/promotion-schemes') || [] });this.syncChoices(); }
      catch (error) { this.setData({ error: getErrorMessage(error, '加载优惠方案失败，请重试') }); }
      finally { this.setData({ loading: false }); }
    },
    close() { if (!this.data.saving) this.setData({ visible: false, editing: false }); },
    block() {},
    emit(patch) { this.triggerEvent('change', { value: { ...(this.data.value || {}), ...patch } }); },
    chooseFirst(e) {
      const s = this.data.firstChoices[Number(e.detail.value)];
      if (s && (!s.id || s.enabled || String(s.id) === String((this.data.value || {}).firstSchemeId))) this.emit({ firstSchemeId: s.id || null, firstName: s.id ? s.name : '', firstSummary: s.id ? summary(s) : '' });
    },
    chooseType(e) {
      const index = Number(e.detail.value);
      this.emit({ otherSchemeId: null, otherName: '', otherSummary: '', otherType: index ? TYPES[index] : '', combine: false });
    },
    chooseOther(e) {
      const s = this.data.otherChoices[Number(e.detail.value)];
      if (s && (!s.id || s.enabled || String(s.id) === String((this.data.value || {}).otherSchemeId))) this.emit({ otherSchemeId: s.id || null, otherName: s.id ? s.name : '', otherSummary: s.id ? summary(s) : '' });
    },
    combine(e) { this.emit({ combine: !!e.detail.value }); },
    create() { this.setData({ editing: true, createTypeIndex: 0, form: { type: 'FIRST', mode: 'FIXED' }, error: '' }); },
    cancelCreate() { if (!this.data.saving) this.setData({ editing: false, error: '' }); },
    createType(e) { const i = Number(e.detail.value);this.setData({ createTypeIndex: i, form: { type: TYPES[i], mode: 'FIXED' }, error: '' }); },
    input(e) { this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value }); },
    mode(e) { this.setData({ 'form.mode': Number(e.detail.value) ? 'PROGRESSIVE' : 'FIXED' }); },
    async saveScheme() {
      if (this.data.saving) return;
      let request;
      try { request = schemeRequest(this.data.form); } catch (error) { this.setData({ error: error.message });return; }
      this.setData({ saving: true, error: '' });
      try {
        const s = await api.post('/promotion-schemes', request);
        this.setData({ schemes: [s, ...this.data.schemes], editing: false });
        if (s.type === 'FIRST') this.emit({ firstSchemeId: s.id, firstName: s.name, firstSummary: summary(s) });
        else this.emit({ otherSchemeId: s.id, otherName: s.name, otherSummary: summary(s), otherType: s.type });
        wx.showToast({ title: '方案已保存并选中', icon: 'success' });
      } catch (error) { this.setData({ error: getErrorMessage(error, '保存优惠方案失败') }); }
      finally { this.setData({ saving: false }); }
    }
  }
});
