const { getErrorMessage } = require('../../utils/error');
const management = require('../../utils/permissionManagement');

Page({
  data: { loading: false, saving: false, error: '', keyword: '', menus: [], filteredMenus: [], editor: null },

  onLoad() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  async load() {
    if (this.data.loading || this.data.saving) return;
    this.setData({ loading: true, error: '' });
    try {
      const snapshot = await management.loadContext('menuConfig');
      if (snapshot.currentRole.kind !== 'SUPER_ADMIN') throw new Error('只有超级管理员能维护菜单配置');
      this._actorCode = snapshot.currentRole.code;
      const menus = await management.request(this, '/iam/menus');
      this.setData({ menus, editor: null });
      this.filter();
    } catch (error) {
      this.setData({ error: getErrorMessage(error, '加载菜单配置失败') });
    } finally { this.setData({ loading: false }); }
  },

  inputSearch(event) { this.setData({ keyword: event.detail.value }); this.filter(); },
  filter() {
    const keyword = this.data.keyword.trim();
    this.setData({ filteredMenus: this.data.menus.filter(menu => !keyword || menu.name.includes(keyword)) });
  },
  edit(event) {
    if (this.data.saving) return;
    const menu = this.data.menus.find(item => item.code === event.currentTarget.dataset.code);
    if (!menu) return;
    this.setData({ editor: { ...menu, sortOrder: String(menu.sortOrder) }, error: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 150 });
  },
  closeEditor() { if (!this.data.saving) this.setData({ editor: null, error: '' }); },
  inputField(event) { this.setData({ ['editor.' + event.currentTarget.dataset.field]: event.detail.value }); },
  toggle(event) { this.setData({ ['editor.' + event.currentTarget.dataset.field]: !!event.detail.value }); },

  async save() {
    if (this.data.saving || !this.data.editor) return;
    const editor = this.data.editor;
    const name = editor.name.trim();
    const sortOrder = Number(editor.sortOrder);
    if (!name || name.length > 80 || !Number.isSafeInteger(sortOrder) || sortOrder < -2147483648 || sortOrder > 2147483647) {
      this.setData({ error: '请输入 1 至 80 字菜单名称，排序需为有效整数' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      await management.request(this, '/iam/menus/' + encodeURIComponent(editor.code), 'PUT', {
        name, sortOrder, enabled: editor.enabled, userAssignable: editor.userAssignable,
        stallAssignable: editor.stallAssignable, version: editor.version
      });
      this.setData({ editor: null });
      wx.showToast({ title: '菜单配置已保存', icon: 'success' });
    } catch (error) {
      this.setData({ error: getErrorMessage(error, '保存失败，请刷新后重试') });
      return;
    } finally { this.setData({ saving: false }); }
    await this.load();
  }
});
