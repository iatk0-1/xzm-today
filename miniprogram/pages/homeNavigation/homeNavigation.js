const api = require('../../utils/api');
const auth = require('../../utils/auth');
const navigation = require('../../utils/homeNavigation');
const { getErrorMessage } = require('../../utils/error');

Page({
  data: { tabs: [], loading: true, saving: false, error: '' },
  async onLoad() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) throw new Error('仅管理员可调整首页导航');
      this._authorized = true;
      await this.load();
    } catch (error) {
      this.setData({ loading: false, error: getErrorMessage(error, '加载导航配置失败') });
    }
  },
  async load() {
    if (!this._authorized || this.data.saving) return;
    this.setData({ loading: true, error: '' });
    try {
      const tabs = navigation.normalize(await api.get('/home-navigation'));
      this.setData({ tabs });
    } catch (error) {
      this.setData({ error: getErrorMessage(error, '加载导航配置失败，请重试') });
    } finally { this.setData({ loading: false }); }
  },
  move(event) {
    if (!this._authorized || this.data.loading || this.data.saving) return;
    const { key, direction } = event.currentTarget.dataset;
    const tabs = this.data.tabs.slice();
    const from = tabs.findIndex(tab => tab.key === key);
    const to = from + Number(direction);
    if (from < 0 || ![-1, 1].includes(Number(direction)) || to < 0 || to >= tabs.length) return;
    [tabs[from], tabs[to]] = [tabs[to], tabs[from]];
    this.setData({ tabs });
  },
  toggle(event) {
    if (!this._authorized || this.data.loading || this.data.saving) return;
    const key = event.currentTarget.dataset.key;
    this.setData({ tabs: this.data.tabs.map(tab => tab.key === key ? { ...tab, visible: event.detail.value } : tab) });
  },
  async save() {
    if (!this._authorized || this.data.loading || this.data.saving || this.data.tabs.length !== 3) return;
    this.setData({ saving: true, error: '' });
    try {
      const tabs = this.data.tabs.map(({ key, visible }) => ({ key, visible }));
      const saved = navigation.normalize(await api.put('/home-navigation', { tabs }));
      this.setData({ tabs: saved });
      wx.showToast({ title: '导航配置已保存', icon: 'success' });
    } catch (error) {
      this.setData({ error: getErrorMessage(error, '保存失败，请重试') });
    } finally { this.setData({ saving: false }); }
  }
});
