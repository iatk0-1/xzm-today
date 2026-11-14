const api = require('../../utils/api');
const { getErrorMessage } = require('../../utils/error');
const { confirmChange } = require('../../utils/userBlacklist');

Page({
  data: { users: [], keyword: '', blacklistedOnly: true, loading: false, saving: false, page: 0, hasMore: true, error: '', total: 0 },
  onShow() { return this.load(true); },
  onPullDownRefresh() { return this.load(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { return this.load(false); },
  inputSearch(event) { this.setData({ keyword: event.detail.value }); },
  search() { return this.load(true); },
  selectTab(event) {
    this.setData({ blacklistedOnly: event.currentTarget.dataset.mode === 'blacklisted' });
    return this.load(true);
  },
  async load(reset) {
    if (this.data.saving || (!reset && (this.data.loading || !this.data.hasMore))) return;
    const version = (this._loadVersion || 0) + 1;
    this._loadVersion = version;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: '', ...(reset ? { users: [], page: 0, total: 0 } : {}) });
    try {
      const result = await api.get('/admin/blacklist/users', {
        keyword: this.data.keyword.trim(), blacklistedOnly: this.data.blacklistedOnly, page, size: 20
      });
      if (version !== this._loadVersion) return;
      const users = reset ? result.content : this.data.users.concat(result.content);
      this.setData({ users, page, total: Number(result.totalElements), hasMore: users.length < Number(result.totalElements) });
    } catch (error) {
      if (version === this._loadVersion) this.setData({ error: getErrorMessage(error, '加载黑名单失败，请重试') });
    } finally { if (version === this._loadVersion) this.setData({ loading: false }); }
  },
  async toggleUser(event) {
    if (this.data.saving || this.data.loading) return;
    const user = this.data.users.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    if (!user) return;
    this.setData({ saving: true, error: '' });
    let changed;
    try {
      changed = await confirmChange(user);
      if (changed) require('../../utils/pageSync').publish('blacklist-users', changed.id);
    } catch (error) { this.setData({ error: getErrorMessage(error, '黑名单操作失败，请重试') }); }
    finally { this.setData({ saving: false }); }
    if (changed) await this.load(true);
  }
});
