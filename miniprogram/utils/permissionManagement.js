const api = require('./api');
const auth = require('./auth');

async function loadContext(menuCode) {
  await auth.ensureAuthenticated({ silent: true });
  const snapshot = await auth.loadPermissionSnapshot({ force: true });
  const role = snapshot && snapshot.currentRole;
  if (!role || !snapshot.menus.some(menu => menu.code === menuCode)
      || (role.kind !== 'SUPER_ADMIN' && !role.manageMembers)) {
    throw new Error('当前角色没有这项管理权限，请切换角色后重试');
  }
  return snapshot;
}

function request(page, url, method = 'GET', data) {
  return api.request({ url, method, data, activeRole: page._actorCode });
}

function roleMenuCodes(role) {
  return Array.from(new Set((role.permissions || []).map(permission => permission.split('.')[0])));
}

function menuChoices(menus, actor, editingRole, selectedCodes) {
  const assigned = new Set(selectedCodes || []);
  const ceiling = new Set(roleMenuCodes(actor));
  return menus.map(menu => {
    let reason = '';
    if (!menu.enabled) reason = '菜单已停用';
    else if (actor.kind !== 'SUPER_ADMIN' && !ceiling.has(menu.code)) reason = '超出当前管理员可分配范围';
    else if (editingRole.kind === 'USER' && !menu.userAssignable) reason = '只能分配用户侧入口';
    else if (editingRole.stallScoped && !menu.stallAssignable) reason = '该菜单不支持指定档口';
    else if (menu.businessKey && menu.businessKey !== editingRole.businessKey && !editingRole.manageMembers) reason = '仅对应特殊业务角色可用';
    return { ...menu, checked: assigned.has(menu.code), allowed: !reason, reason };
  });
}

function roleDescription(role) {
  if (role.kind === 'SUPER_ADMIN') return '超级管理员';
  if (role.kind === 'USER') return '所有用户默认拥有';
  if (role.businessKey === 'STALL_MANAGER') return '档口负责人 · 特殊业务角色';
  return role.manageMembers ? '可管理角色和成员' : '业务角色';
}

function validateRoleForm(form, choices) {
  const name = String(form.name || '').trim();
  if (!name || name.length > 80) throw new Error('角色名称不能为空，最多 80 字');
  const invalid = choices.find(menu => menu.checked && !menu.allowed);
  if (invalid) throw new Error('请取消“' + invalid.name + '”——' + invalid.reason);
  if (form.stallScoped && form.manageMembers) throw new Error('管理角色和成员的岗位需使用全部档口范围');
  return {
    name, stallScoped: !!form.stallScoped, manageMembers: !!form.manageMembers,
    enabled: !!form.enabled, version: form.version || 0,
    menuCodes: choices.filter(menu => menu.checked).map(menu => menu.code)
  };
}

function confirm(title, content, confirmText) {
  return new Promise(resolve => wx.showModal({
    title, content, confirmText: confirmText || '确定', success: result => resolve(!!result.confirm),
    fail: () => resolve(false)
  }));
}

module.exports = { loadContext, request, roleMenuCodes, menuChoices, roleDescription, validateRoleForm, confirm };
