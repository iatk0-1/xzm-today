const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { getErrorMessage } = require('../../utils/error');
const provinces = require('../../utils/provinces');

Page({
  data: { templates: [], provinces: [{ code: '', name: '请选择省份' }].concat(provinces), provinceIndex: 0,
    loading: false, busy: false, error: '', editing: false,
    id: '', name: '', enabled: false, rules: [] },
  async onLoad() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) throw new Error('仅管理员可管理快递运费模板');
      this._authorized = true;
      await this.load();
    } catch (error) { this.fail(error); }
  },
  async onPullDownRefresh() {
    try { if (!this.data.busy && !this.data.editing) await this.load(); } finally { wx.stopPullDownRefresh(); }
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
          quantityLabel: rule.maxQuantity == null ? '不限件数' : '最多 ' + rule.maxQuantity + ' 件' })) })) });
    } catch (error) { this.fail(error); } finally { this.setData({ loading: false }); }
  },
  newTemplate() {
    if (!this._authorized || this.data.busy) return;
    this.setData({ editing: true, id: '', name: '', enabled: false, rules: [], error: '' });
  },
  editTemplate(event) {
    if (!this._authorized || this.data.busy) return;
    const template = this.data.templates.find(t => t.id === String(event.currentTarget.dataset.id));
    if (!template) return;
    this.setData({ editing: true, id: template.id, name: template.name, enabled: template.enabled, error: '',
      rules: template.rules.map(rule => ({ provinceCode: rule.provinceCode, provinceName: rule.provinceName,
        shippingFee: rule.shippingFee == null ? '' : String(rule.shippingFee),
        maxQuantity: rule.maxQuantity == null ? '' : String(rule.maxQuantity) })) });
  },
  cancelEdit() { if (!this.data.busy) this.setData({ editing: false, error: '' }); },
  inputName(event) { if (!this.data.busy) this.setData({ name: event.detail.value }); },
  addProvince(event) {
    if (this.data.busy) return;
    const p = this.data.provinces[Number(event.detail.value)];
    this.setData({ provinceIndex: 0 });
    if (!p || !p.code) return;
    if (this.data.rules.some(r => r.provinceCode === p.code)) {
      this.setData({ error: '同一模板不能重复配置省份' }); return;
    }
    this.setData({ rules: this.data.rules.concat({ provinceCode: p.code, provinceName: p.name, shippingFee: '', maxQuantity: '' }), error: '' });
  },
  inputRule(event) {
    if (this.data.busy) return;
    const { index, field } = event.currentTarget.dataset;
    if (!['shippingFee', 'maxQuantity'].includes(field)) return;
    const rules = this.data.rules.map((rule, i) => i === Number(index) ? { ...rule, [field]: event.detail.value } : rule);
    this.setData({ rules });
  },
  removeProvince(event) {
    if (!this.data.busy) this.setData({ rules: this.data.rules.filter((_, i) => i !== Number(event.currentTarget.dataset.index)) });
  },
  async save() {
    if (!this._authorized || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const name = this.data.name.trim();
      if (!name || name.length > 100) throw new Error('模板名称必填，最多100字');
      const rules = this.data.rules.map(rule => {
        const fee = rule.shippingFee.trim(), max = rule.maxQuantity.trim();
        if (fee && (!/^\d+(\.\d{1,2})?$/.test(fee) || Number(fee) > 99999999.99))
          throw new Error(rule.provinceName + '运费须为非负金额，最多两位小数');
        if (max && (!/^[1-9]\d*$/.test(max) || Number(max) > 2147483647))
          throw new Error(rule.provinceName + '最多购买件数须为有效正整数');
        return { provinceCode: rule.provinceCode, shippingFee: fee ? fee : null, maxQuantity: max ? Number(max) : null };
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
  fail(error) { this.setData({ error: getErrorMessage(error, '快递运费模板操作失败') }); }
});
