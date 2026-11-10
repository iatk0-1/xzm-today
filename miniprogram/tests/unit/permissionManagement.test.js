const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceRoot = path.resolve(__dirname, '../..');
const plain = value => JSON.parse(JSON.stringify(value));
const user = { id: '9007199254740993', nickname: '仓库员工' };
const root = { code: 'super_admin', kind: 'SUPER_ADMIN', manageMembers: false, permissions: [] };
const shipping = { code: 'shipping', name: '订单发货', enabled: true, stallAssignable: false, userAssignable: false };
const product = { code: 'productManage', name: '商品管理', enabled: true, stallAssignable: true, userAssignable: false };

test('从负责人详情跳转用户授权时，按原始雪花编号定位用户并加载角色', async () => {
  const env = harness('permissionMembers');
  await env.page.onLoad({ userId: user.id });
  assert.equal(env.page.data.keyword, user.id);
  assert.equal(env.page.data.selectedUser.id, user.id);
  assert.ok(env.requests.some(request => request.url === '/iam/users/' + user.id + '/roles'));
});

function harness(pageName, options = {}) {
  const requests = [], toasts = [];
  const actor = options.actor || root;
  const role = { code: 'warehouse', name: '仓库岗位', kind: 'CUSTOM', enabled: true,
    permissions: ['productManage.access'], version: '5', stallScoped: true };
  const snapshot = { currentRole: actor, menus: ['menuConfig', 'roleManage', 'memberManage'].map(code => ({ code })) };
  const wx = { showToast: data => toasts.push(data.title), pageScrollTo() {}, stopPullDownRefresh() {},
    showModal: data => data.success({ confirm: true }) };
  const api = {
    async request(request) {
      requests.push(request);
      if (options.request) {
        const result = options.request(request);
        if (result !== undefined) return result;
      }
      if (request.method !== 'GET') return null;
      if (request.url === '/iam/menus') return [shipping, product];
      if (request.url === '/iam/roles') return [role];
      if (request.url === '/iam/stalls') return [{ id: '9007199254740995', name: '甲档口' }];
      if (request.url === '/iam/users') return [user];
      if (request.url.endsWith('/roles')) return [];
      throw new Error('未处理接口 ' + request.url);
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot, 'utils/permissionManagement.js'), 'utf8'), {
    module, require: name => name === './api' ? api : {
      ensureAuthenticated: async () => {}, loadPermissionSnapshot: async () => snapshot
    }, wx
  });
  const management = module.exports;
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(sourceRoot, `pages/${pageName}/index.js`), 'utf8'), {
    Page: config => { definition = config; },
    require: name => name.endsWith('/permissionManagement') ? management : require('../../utils/error'), wx
  });
  const page = { ...definition, data: structuredClone(definition.data) };
  page.setData = patch => {
    for (const [key, value] of Object.entries(patch)) {
      const fields = key.split('.');
      let target = page.data;
      while (fields.length > 1) target = target[fields.shift()];
      target[fields[0]] = value;
    }
  };
  return { page, management, requests, toasts, role, snapshot };
}

test('普通管理员仅能分配超管授予的菜单，切换档口模式后必须解除不兼容菜单', () => {
  const { management } = harness('permissionRoles');
  const admin = { kind: 'CUSTOM', permissions: ['productManage.access'] };
  const editing = { kind: 'CUSTOM', stallScoped: true, manageMembers: false };
  const choices = management.menuChoices([shipping, product], admin, editing, ['shipping', 'productManage']);
  assert.equal(choices[0].allowed, false);
  assert.equal(choices[0].checked, true);
  assert.equal(choices[1].allowed, true);
  assert.throws(() => management.validateRoleForm({ name: '仓库', enabled: true, stallScoped: true }, choices), /请取消/);
  choices[0].checked = false;
  assert.deepEqual(plain(management.validateRoleForm({ name: '仓库', enabled: true, stallScoped: true }, choices).menuCodes), ['productManage']);
});

test('特殊菜单可作为管理员向下授权上限，业务岗位仍需对应特殊身份', () => {
  const { management } = harness('permissionRoles');
  const income = { code: 'income', name: '我的佣金', enabled: true, stallAssignable: true, businessKey: 'STALL_MANAGER' };
  assert.equal(management.menuChoices([income], root, { kind: 'CUSTOM', manageMembers: true }, [])[0].allowed, true);
  assert.equal(management.menuChoices([income], root, { kind: 'CUSTOM', manageMembers: false }, [])[0].allowed, false);
  assert.equal(management.menuChoices([income], root, { kind: 'SPECIAL', businessKey: 'STALL_MANAGER', stallScoped: true }, [])[0].allowed, true);
});

test('缺少管理资格即使伪造入口列表也不能加载管理页', async () => {
  const { page, requests } = harness('permissionRoles', { actor: { code: 'employee', kind: 'CUSTOM', manageMembers: false } });
  await page.load();
  assert.match(page.data.error, /没有这项管理权限/);
  assert.equal(requests.length, 0);
});

test('保存角色携带旧版本并固定操作角色，冲突时保留编辑内容', async () => {
  const { page, requests, role } = harness('permissionRoles', {
    request: request => { if (request.method === 'PUT') throw new Error('角色已被其他管理员修改，请刷新后重试'); }
  });
  await page.load();
  page.openEditor(role);
  page.inputName({ detail: { value: '仓库轮班' } });
  await page.save();
  const saved = requests.find(request => request.method === 'PUT');
  assert.equal(saved.activeRole, 'super_admin');
  assert.equal(saved.data.version, '5');
  assert.equal(saved.data.name, '仓库轮班');
  assert.equal(page.data.editor.name, '仓库轮班');
  assert.match(page.data.error, /请刷新/);
});

test('首次分配指定档口角色要求选择，雪花编号完整传回后端', async () => {
  const { page, requests, role } = harness('permissionMembers');
  await page.load();
  page.setData({ selectedUser: user });
  page.openAssignment(role, null);
  await page.save();
  assert.equal(requests.filter(request => request.method === 'PUT').length, 0);
  assert.match(page.data.error, /至少选择一个档口/);
  page.toggleStall({ currentTarget: { dataset: { id: '9007199254740995' } } });
  await page.save();
  const saved = requests.find(request => request.method === 'PUT');
  assert.equal(saved.url, '/iam/users/9007199254740993/roles/warehouse');
  assert.deepEqual(plain(saved.data), { stallIds: ['9007199254740995'], version: null });
});

test('已有角色可解绑最后一个档口，保存空范围仍保留角色关系', async () => {
  const { page, requests, role } = harness('permissionMembers');
  await page.load();
  page.setData({ selectedUser: user });
  page.openAssignment(role, { version: '8', stallIds: ['9007199254740995'] });
  page.toggleStall({ currentTarget: { dataset: { id: '9007199254740995' } } });
  await page.save();
  const saved = requests.find(request => request.method === 'PUT');
  assert.deepEqual(plain(saved.data), { stallIds: [], version: '8' });
  assert.equal(requests.some(request => request.method === 'DELETE'), false);
});

test('切换用户后迟到的角色列表不会覆盖当前用户', async () => {
  let releaseFirst;
  const { page } = harness('permissionMembers', {
    request: request => {
      if (request.url === '/iam/users/1/roles') return new Promise(resolve => { releaseFirst = resolve; });
      if (request.url === '/iam/users/2/roles') return [{ role: { code: 'user', kind: 'USER', name: '普通用户' }, stallIds: [], version: 0 }];
    }
  });
  await page.load();
  page.setData({ users: [{ id: '1' }, { id: '2' }] });
  const first = page.selectUser({ currentTarget: { dataset: { id: '1' } } });
  await page.selectUser({ currentTarget: { dataset: { id: '2' } } });
  releaseFirst([]);
  await first;
  assert.equal(page.data.selectedUser.id, '2');
  assert.equal(page.data.memberships[0].role.code, 'user');
});

test('解除角色携带成员版本，解除成功后的刷新失败不会误报解除失败', async () => {
  const { page, requests, role } = harness('permissionMembers', {
    request: request => { if (request.url.endsWith('/roles') && request.url.includes('/users/')) throw new Error('当前账户不具备所选角色'); }
  });
  await page.load();
  page.setData({ selectedUser: user, memberships: [{ role, manageable: true, version: '7' }] });
  await page.revoke({ currentTarget: { dataset: { code: 'warehouse' } } });
  assert.equal(requests.find(request => request.method === 'DELETE').url, '/iam/users/9007199254740993/roles/warehouse?version=7');
  assert.match(page.data.error, /角色已解除/);
});
