const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    keyword: '', managers: [], users: [], page: 1,
    hasNext: false, loading: false, adding: false, error: ''
  },
  async onLoad() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) throw new Error('仅管理员可管理负责人');
      this._authorized = true;
      await this.load(true);
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
  onShow() {
    if (this._authorized) this.load(true);
  },
  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    if (this.data.hasNext) this.load(false);
  },
  input(event) {
    this.setData({ keyword: event.detail.value });
  },
  search() {
    this.load(true);
  },
  async load(reset) {
    if (!this._authorized || this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const page = reset ? 1 : this.data.page + 1;
      const result = await api.get('/stall-managers', {
        keyword: this.data.keyword, page, size: 20
      });
      const rows = result.content || [];
      this.setData({
        managers: reset ? rows : this.data.managers.concat(rows),
        page, hasNext: page < result.totalPages
      });
    } catch (error) {
      this.setData({ error: error.message || '加载负责人失败' });
    } finally {
      this.setData({ loading: false });
    }
  },
  open(event) {
    wx.navigateTo({
      url: '/pages/stallManagerDetail/stallManagerDetail?id='
        + encodeURIComponent(String(event.currentTarget.dataset.id))
    });
  },
  async searchUsers() {
    if (!this._authorized) return;
    try {
      const users = await api.get('/stall-managers/users', { keyword: this.data.keyword });
      this.setData({ users: users.content || users || [], adding: true });
    } catch (error) {
      wx.showToast({ title: error.message || '搜索用户失败', icon: 'none' });
    }
  },
  async add(event) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      await api.post('/stall-managers', { userId: String(event.currentTarget.dataset.id) });
      this.setData({ adding: false, users: [] });
    } catch (error) {
      wx.showToast({ title: error.message || '新增负责人失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
    await this.load(true);
  }
});
