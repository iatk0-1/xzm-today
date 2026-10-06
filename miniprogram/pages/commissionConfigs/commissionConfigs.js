const { getErrorMessage } = require('../../utils/error');
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const finance = require('../../utils/managerFinance');

Page({
  data: { configs: [], loading: false, busy: false, error: '', editing: false,
    id: '', name: '', mode: 'fixed', value: '', editingEnabled: false },
  async onLoad() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) throw new Error('仅管理员可管理佣金配置');
      this._authorized = true;
      await this.load();
    } catch (error) { this.fail(error); }
  },
  async onShow() {
    if (this._authorized && !this.data.editing && !this.data.busy) await this.load();
  },
  async onPullDownRefresh() {
    try { if (!this.data.busy) await this.load(); } finally { wx.stopPullDownRefresh(); }
  },
  async load() {
    if (!this._authorized || this.data.loading) return;
    this.setData({ loading: true });
    try {
      const configs = await api.get('/commission-configs');
      this.setData({ configs: (configs || []).map(config => ({ ...config, id: String(config.id),
        valueLabel: config.profitPercent != null ? '利润的 ' + config.profitPercent + '%' : '每件 / 每套 ¥' + config.unitCommission })), error: '' });
    } catch (error) { this.fail(error); } finally { this.setData({ loading: false }); }
  },
  newConfig() {
    if (!this._authorized || this.data.busy) return;
    this.setData({ editing: true, id: '', name: '', mode: 'fixed', value: '', editingEnabled: false, error: '' });
  },
  editConfig(event) {
    if (!this._authorized || this.data.busy) return;
    const config = this.data.configs.find(item => item.id === String(event.currentTarget.dataset.id));
    if (!config) return;
    this.setData({ editing: true, id: config.id, name: config.name, editingEnabled: config.enabled,
      mode: config.profitPercent != null ? 'percent' : 'fixed',
      value: String(config.profitPercent != null ? config.profitPercent : config.unitCommission), error: '' });
  },
  cancelEdit() { if (!this.data.busy) this.setData({ editing: false, error: '' }); },
  input(event) {
    if (this.data.busy) return;
    const field = event.currentTarget.dataset.field;
    if (field === 'name' || field === 'value') this.setData({ [field]: event.detail.value });
  },
  changeMode(event) {
    if (this.data.busy) return;
    const mode = event.detail.value;
    if (['fixed', 'percent'].includes(mode) && mode !== this.data.mode) this.setData({ mode, value: '', error: '' });
  },
  async save(event) {
    if (!this._authorized || this.data.busy) return;
    const activate = event.currentTarget.dataset.activate === true || event.currentTarget.dataset.activate === 'true';
    this.setData({ busy: true, error: '' });
    try {
      const name = finance.requireText(this.data.name, '配置名称');
      if (name.length > 100) throw new Error('配置名称最多100字');
      const value = finance.money(this.data.value, true);
      if (this.data.mode === 'percent' && Number(value) > 100) throw new Error('利润比例必须在0到100之间');
      if (this.data.editingEnabled && !activate) throw new Error('生效中的配置修改后，请保存并生效');
      if (activate && !await this.confirmActivation()) return;
      const body = { name, unitCommission: this.data.mode === 'fixed' ? value : null,
        profitPercent: this.data.mode === 'percent' ? value : null, activate };
      const result = this.data.id ? await api.put('/commission-configs/' + this.data.id, body)
        : await api.post('/commission-configs', body);
      this.setData({ editing: false });
      wx.showToast({ title: activate ? '已生效，更新' + result.affectedProducts + '件' : '配置已保存', icon: 'none' });
      await this.load();
    } catch (error) { this.fail(error); } finally { this.setData({ busy: false }); }
  },
  confirmActivation() {
    return finance.confirmAction('确认佣金配置生效',
      '将覆盖所有档口负责人已有商品的佣金，包括回收站商品和单独修改的佣金。其他配置自动失效，新商品继承本配置；已有订单佣金保持原值。');
  },
  async activateConfig(event) {
    if (!this._authorized || this.data.busy) return;
    const id = String(event.currentTarget.dataset.id);
    if (!this.data.configs.some(item => item.id === id)) return;
    this.setData({ busy: true, error: '' });
    try {
      if (!await this.confirmActivation()) return;
      const result = await api.post('/commission-configs/' + id + '/activate', {});
      wx.showToast({ title: '已生效，更新' + result.affectedProducts + '件', icon: 'none' });
      await this.load();
    } catch (error) { this.fail(error); } finally { this.setData({ busy: false }); }
  },
  fail(error) { this.setData({ error: getErrorMessage(error, '佣金配置操作失败') }); }
});
