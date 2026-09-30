const api = require('../../utils/api');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    stallId: { type: String, value: '' },
    stallName: { type: String, value: '' }
  },
  data: {
    managers: [], keyword: '', candidates: [],
    loading: false, loadFailed: false, searching: false, saving: false, searched: false
  },
  observers: {
    'visible, stallId': function(visible, stallId) {
      clearTimeout(this._searchTimer);
      if (visible && stallId) {
        if (this._activeStall === stallId) return;
        this._activeStall = stallId;
        this._session = (this._session || 0) + 1;
        this.setData({ managers: [], keyword: '', candidates: [], searched: false, searching: false, saving: false, loading: false });
        this.loadManagers();
      } else {
        this._activeStall = '';
        this._session = (this._session || 0) + 1;
      }
    }
  },
  lifetimes: {
    detached() {
      clearTimeout(this._searchTimer);
      this._session = (this._session || 0) + 1;
    }
  },
  methods: {
    noop() {},
    async loadManagers() {
      if (this.data.loading || this.data.saving) return;
      const session = this._session;
      this.setData({ loading: true, loadFailed: false });
      try {
        const managers = await api.get('/stall-managers/stalls/' + this.properties.stallId);
        if (session !== this._session) return;
        this.setData({ managers: managers || [], candidates: this.markAssigned(this.data.candidates, managers || []) });
      } catch (err) {
        if (session !== this._session) return;
        this.setData({ loadFailed: true });
        wx.showToast({ title: err.message || '加载负责人失败', icon: 'none' });
      } finally {
        if (session === this._session) this.setData({ loading: false });
      }
    },
    close() {
      if (this.data.saving) return;
      this.triggerEvent('close');
    },
    onKeywordInput(e) {
      clearTimeout(this._searchTimer);
      this._search = (this._search || 0) + 1;
      this.setData({ keyword: e.detail.value, candidates: [], searching: false, searched: false });
      if (e.detail.value.trim().length >= 2) {
        this._searchTimer = setTimeout(() => this.searchUsers(), 350);
      }
    },
    markAssigned(users, managers = this.data.managers) {
      return users.map(user => ({ ...user, assigned: managers.some(item => String(item.id) === String(user.id)) }));
    },
    async searchUsers() {
      clearTimeout(this._searchTimer);
      const keyword = this.data.keyword.trim();
      if (keyword.length < 2) return wx.showToast({ title: '至少输入两个字或数字', icon: 'none' });
      const session = this._session;
      const search = this._search = (this._search || 0) + 1;
      this.setData({ searching: true, candidates: [], searched: false });
      try {
        const users = await api.get('/stall-managers/users', { keyword });
        if (session !== this._session || search !== this._search) return;
        this.setData({ candidates: this.markAssigned(users || []), searched: true });
      } catch (err) {
        if (session !== this._session || search !== this._search) return;
        wx.showToast({ title: err.message || '搜索用户失败', icon: 'none' });
      } finally {
        if (session === this._session && search === this._search) this.setData({ searching: false });
      }
    },
    async addManager(e) {
      if (this.data.saving || this.data.loading || this.data.loadFailed) return;
      const user = this.data.candidates.find(item => String(item.id) === String(e.currentTarget.dataset.id));
      if (!user || this.data.managers.some(item => String(item.id) === String(user.id))) return;
      if (this.data.managers.length >= 20) return wx.showToast({ title: '每个档口最多分配 20 位负责人', icon: 'none' });
      await this.saveManagers(this.data.managers.concat(user));
    },
    async removeManager(e) {
      if (this.data.saving || this.data.loading || this.data.loadFailed) return;
      await this.saveManagers(this.data.managers.filter(item => String(item.id) !== String(e.currentTarget.dataset.id)));
    },
    async saveManagers(managers) {
      const session = this._session;
      const stallId = this.properties.stallId;
      this.setData({ saving: true });
      try {
        const saved = await api.put('/stall-managers/stalls/' + stallId, managers.map(item => item.id));
        if (session !== this._session) return;
        this.setData({ managers: saved || [], candidates: this.markAssigned(this.data.candidates, saved || []) });
        this.triggerEvent('changed', { stallId, managers: saved || [] });
        wx.showToast({ title: '负责人已更新', icon: 'success' });
      } catch (err) {
        if (session === this._session) wx.showToast({ title: err.message || '保存负责人失败', icon: 'none' });
      } finally {
        if (session === this._session) this.setData({ saving: false });
      }
    }
  }
});
