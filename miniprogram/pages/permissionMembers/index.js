const { getErrorMessage } = require('../../utils/error');
const management = require('../../utils/permissionManagement');

Page({
  data: {
    loading: false, searching: false, saving: false, membersLoading: false, error: '', keyword: '', searched: false,
    users: [], roles: [], stalls: [], selectedUser: null, memberships: [], roleOptions: [],
    editor: null, stallChoices: []
  },

  async onLoad(options = {}) {
    await this.load();
    if (options.userId && this._actorCode) {
      this.setData({ keyword: String(options.userId) });
      await this.search();
      const user = this.data.users.find(item => String(item.id) === String(options.userId));
      if (user) await this.selectUser({ currentTarget: { dataset: { id: user.id } } });
    }
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (this.data.loading || this.data.saving) return;
    this.setData({ loading: true, error: '' });
    try {
      const snapshot = await management.loadContext('memberManage');
      this._actorCode = snapshot.currentRole.code;
      const [roles, stalls] = await Promise.all([
        management.request(this, '/iam/roles'), management.request(this, '/iam/stalls')
      ]);
      this._roleMap = new Map(roles.map(role => [role.code, role]));
      this.setData({ roles, stalls, editor: null, stallChoices: [] });
      if (this.data.selectedUser) await this.loadMemberships(this.data.selectedUser);
    } catch (error) { this.setData({ error: getErrorMessage(error, '加载用户授权失败') }); }
    finally { this.setData({ loading: false }); }
  },
  inputSearch(event) { this.setData({ keyword: event.detail.value }); },
  async search() {
    if (this.data.loading || this.data.saving || this.data.searching || !this._actorCode) return;
    const keyword = this.data.keyword.trim();
    if (!keyword) { this.setData({ error: '请输入用户昵称、手机号或编号' }); return; }
    this.setData({ searching: true, error: '' });
    try {
      const users = await management.request(this, '/iam/users', 'GET', { keyword });
      this.setData({ users, searched: true });
    } catch (error) { this.setData({ error: getErrorMessage(error, '搜索用户失败') }); }
    finally { this.setData({ searching: false }); }
  },
  async selectUser(event) {
    if (this.data.saving || this.data.loading) return;
    const user = this.data.users.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    if (!user) return;
    this.setData({ error: '', selectedUser: user, memberships: [], roleOptions: [], editor: null });
    try { await this.loadMemberships(user); }
    catch (error) { this.setData({ error: getErrorMessage(error, '加载用户角色失败') }); }
  },
  async loadMemberships(user) {
    const version = (this._membershipLoadVersion || 0) + 1;
    this._membershipLoadVersion = version;
    this.setData({ membersLoading: true });
    try {
      const memberships = await management.request(this, '/iam/users/' + encodeURIComponent(String(user.id)) + '/roles');
      if (version !== this._membershipLoadVersion || String(this.data.selectedUser.id) !== String(user.id)) return;
      const assigned = new Set(memberships.map(member => member.role.code));
      const stallMap = new Map(this.data.stalls.map(stall => [String(stall.id), stall.name]));
      this.setData({
        memberships: memberships.map(member => ({
          ...member, code: member.role.code, manageable: member.role.kind !== 'USER' && this._roleMap.has(member.role.code),
          stallNames: member.stallIds.map(id => stallMap.get(String(id)) || '已失效档口').join('、'),
          description: management.roleDescription(member.role)
        })),
        roleOptions: this.data.roles.filter(role => role.enabled && role.kind !== 'USER' && !assigned.has(role.code)),
        editor: null, stallChoices: []
      });
    } finally {
      if (version === this._membershipLoadVersion) this.setData({ membersLoading: false });
    }
  },
  selectRole(event) {
    if (this.data.saving || this.data.membersLoading) return;
    const role = this.data.roleOptions[Number(event.detail.value)];
    if (role) this.openAssignment(role, null);
  },
  editMember(event) {
    if (this.data.saving || this.data.membersLoading) return;
    const member = this.data.memberships.find(item => item.role.code === event.currentTarget.dataset.code);
    if (member && member.manageable && member.role.enabled) this.openAssignment(member.role, member);
  },
  openAssignment(role, membership) {
    const selected = new Set((membership ? membership.stallIds : []).map(String));
    this.setData({
      editor: { role, version: membership ? membership.version : null, existing: !!membership },
      stallChoices: this.data.stalls.map(stall => ({ ...stall, checked: selected.has(String(stall.id)) })),
      error: ''
    });
  },
  toggleStall(event) {
    if (this.data.saving) return;
    const id = String(event.currentTarget.dataset.id);
    this.setData({ stallChoices: this.data.stallChoices.map(stall => String(stall.id) === id
      ? { ...stall, checked: !stall.checked } : stall) });
  },
  closeEditor() { if (!this.data.saving) this.setData({ editor: null, stallChoices: [], error: '' }); },
  async save() {
    if (this.data.saving || !this.data.editor || !this.data.selectedUser) return;
    const editor = this.data.editor;
    const stallIds = editor.role.stallScoped ? this.data.stallChoices.filter(stall => stall.checked).map(stall => String(stall.id)) : [];
    if (editor.role.stallScoped && !editor.existing && !stallIds.length) {
      this.setData({ error: '首次分配这个角色，请至少选择一个档口' });
      return;
    }
    const user = this.data.selectedUser;
    this.setData({ saving: true, error: '' });
    try {
      await management.request(this, '/iam/users/' + encodeURIComponent(String(user.id)) + '/roles/'
        + encodeURIComponent(editor.role.code), 'PUT', { stallIds, version: editor.version });
      this.setData({ editor: null, stallChoices: [] });
      wx.showToast({ title: '用户授权已保存', icon: 'success' });
    } catch (error) { this.setData({ error: getErrorMessage(error, '保存授权失败，请刷新后重试') }); }
    finally { this.setData({ saving: false }); }
    if (!this.data.error) {
      try { await this.loadMemberships(user); }
      catch (error) { this.setData({ error: '授权已保存，' + getErrorMessage(error, '刷新列表失败，请刷新后重试') }); }
    }
  },
  async revoke(event) {
    if (this.data.saving || this.data.membersLoading) return;
    const member = this.data.memberships.find(item => item.role.code === event.currentTarget.dataset.code);
    if (!member || !member.manageable) return;
    const user = this.data.selectedUser;
    const confirmed = await management.confirm('解除角色', '解除“' + member.role.name + '”后，该用户将失去这个身份及其菜单权限。', '解除');
    if (!confirmed || this.data.saving || String(this.data.selectedUser.id) !== String(user.id)) return;
    this.setData({ saving: true, error: '' });
    try {
      await management.request(this, '/iam/users/' + encodeURIComponent(String(user.id)) + '/roles/'
        + encodeURIComponent(member.role.code) + '?version=' + encodeURIComponent(String(member.version)), 'DELETE');
      this.setData({ editor: null, stallChoices: [] });
      wx.showToast({ title: '角色已解除', icon: 'success' });
    } catch (error) { this.setData({ error: getErrorMessage(error, '解除角色失败，请刷新后重试') }); }
    finally { this.setData({ saving: false }); }
    if (!this.data.error) {
      try { await this.loadMemberships(user); }
      catch (error) { this.setData({ error: '角色已解除，' + getErrorMessage(error, '刷新列表失败，请切换角色后重试') }); }
    }
  }
});
