const { getErrorMessage } = require('../../utils/error');
const management = require('../../utils/permissionManagement');

Page({
  data: {
    loading: false, saving: false, error: '', keyword: '', roles: [], filteredRoles: [],
    menus: [], isSuper: false, editor: null, choices: []
  },

  onLoad() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (this.data.loading || this.data.saving) return;
    this.setData({ loading: true, error: '' });
    try {
      const snapshot = await management.loadContext('roleManage');
      this._actor = snapshot.currentRole;
      this._actorCode = this._actor.code;
      const [roles, menus] = await Promise.all([
        management.request(this, '/iam/roles'), management.request(this, '/iam/menus')
      ]);
      this.setData({
        roles: roles.map(role => ({ ...role, description: management.roleDescription(role),
          menuCount: management.roleMenuCodes(role).length })),
        menus, isSuper: this._actor.kind === 'SUPER_ADMIN', editor: null, choices: []
      });
      this.filter();
    } catch (error) { this.setData({ error: getErrorMessage(error, '加载角色失败') }); }
    finally { this.setData({ loading: false }); }
  },
  inputSearch(event) { this.setData({ keyword: event.detail.value }); this.filter(); },
  filter() {
    const keyword = this.data.keyword.trim();
    this.setData({ filteredRoles: this.data.roles.filter(role => !keyword || role.name.includes(keyword)) });
  },
  create() {
    if (this.data.saving || this.data.loading || !this._actor) return;
    this.openEditor({ name: '', kind: 'CUSTOM', businessKey: null, stallScoped: false,
      manageMembers: false, enabled: true, version: 0, permissions: [] });
  },
  edit(event) {
    if (this.data.saving) return;
    const role = this.data.roles.find(item => item.code === event.currentTarget.dataset.code);
    if (role && role.kind !== 'SUPER_ADMIN') this.openEditor(role);
  },
  openEditor(role) {
    const editor = { ...role };
    const choices = management.menuChoices(this.data.menus, this._actor, editor, management.roleMenuCodes(role));
    this.setData({ editor, choices, error: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 150 });
  },
  closeEditor() { if (!this.data.saving) this.setData({ editor: null, choices: [], error: '' }); },
  inputName(event) { this.setData({ 'editor.name': event.detail.value }); },
  toggleSetting(event) {
    const field = event.currentTarget.dataset.field;
    const editor = { ...this.data.editor, [field]: !!event.detail.value };
    const selected = this.data.choices.filter(menu => menu.checked).map(menu => menu.code);
    this.setData({ editor, choices: management.menuChoices(this.data.menus, this._actor, editor, selected) });
  },
  toggleMenu(event) {
    if (this.data.saving) return;
    const code = event.currentTarget.dataset.code;
    this.setData({ choices: this.data.choices.map(menu => menu.code === code && (menu.allowed || menu.checked)
      ? { ...menu, checked: !menu.checked } : menu) });
  },
  async save() {
    if (this.data.saving || !this.data.editor) return;
    let payload;
    try { payload = management.validateRoleForm(this.data.editor, this.data.choices); }
    catch (error) { this.setData({ error: error.message }); return; }
    const code = this.data.editor.code;
    this.setData({ saving: true, error: '' });
    try {
      await management.request(this, code ? '/iam/roles/' + encodeURIComponent(code) : '/iam/roles', code ? 'PUT' : 'POST', payload);
      this.setData({ editor: null });
      wx.showToast({ title: '角色已保存', icon: 'success' });
    } catch (error) {
      this.setData({ error: getErrorMessage(error, '保存角色失败，请刷新后重试') });
      return;
    } finally { this.setData({ saving: false }); }
    await this.load();
  }
});
