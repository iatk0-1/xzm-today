const { getErrorMessage } = require('./error');
// miniprogram/utils/auth.js
const api = require('./api');
const config = require('./config');

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
let authRecoveryPromise = null;
let permissionRead = null;

/**
 * 获取存储的 Token
 */
function getAccessToken() {
  try {
    return wx.getStorageSync(config.TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

/**
 * 获取存储的 Refresh Token
 */
function getRefreshToken() {
  try {
    return wx.getStorageSync(config.REFRESH_TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

function getStoredExpireTime(key) {
  try {
    return Number(wx.getStorageSync(key) || 0);
  } catch (e) {
    return 0;
  }
}

function hasUsableAccessToken() {
  const token = getAccessToken();
  if (!token) return false;

  const expiresAt = getStoredExpireTime(config.TOKEN_EXPIRES_AT_KEY);
  return !expiresAt || expiresAt - Date.now() > REFRESH_BUFFER_MS;
}

function isNetworkError(err) {
  if (!err) return false;
  if (err.statusCode >= 500) return false;
  if (err.statusCode) return false;
  if (err.errMsg) return true;

  const message = String(err.errMsg || err.message || err.error || '').toLowerCase();
  return /timeout|network|连接|超时|断网|请求失败/.test(message);
}

function mergeUserInfo(session) {
  if (!session) return getUserInfo();

  const oldUserInfo = getUserInfo() || {};
  const userInfo = Object.assign({}, oldUserInfo, {
    userId: session.userId || session.id || oldUserInfo.userId,
    openid: session.openid || oldUserInfo.openid || '',
    phone: session.phone != null ? session.phone : oldUserInfo.phone,
    isPhoneBound: session.isPhoneBound != null
      ? session.isPhoneBound
      : oldUserInfo.isPhoneBound,
    nickname: session.nickname || oldUserInfo.nickname,
    avatarUrl: session.avatarUrl || oldUserInfo.avatarUrl,
    accountRole: session.role || oldUserInfo.accountRole || oldUserInfo.role,
    role: oldUserInfo.selectedRole || session.role || oldUserInfo.role
  });

  try {
    wx.setStorageSync(config.USER_INFO_KEY, userInfo);
  } catch (e) {
    console.error('保存用户信息失败:', e);
  }
  return userInfo;
}

function shouldSyncUserInfo(session) {
  const cached = getUserInfo();
  if (!cached || !cached.userId || !cached.role) return true;
  if (session && session.openid) return false;
  return !cached.openid;
}

async function syncUserInfoIfNeeded(session) {
  const merged = mergeUserInfo(session);
  if (!shouldSyncUserInfo(session) || !getAccessToken()) {
    return merged;
  }

  // 认证恢复期间不能再走默认认证入口，否则会等待当前 Promise 自身。
  const profile = await api.request({
    url: '/users/me',
    method: 'GET',
    activeRole: 'user',
    skipAuthRefresh: true
  });
  return mergeUserInfo({
    id: profile.id,
    openid: profile.openid,
    phone: profile.phone,
    isPhoneBound: profile.phone != null && profile.phone !== '',
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl
  });
}

function buildSessionResult(source, session) {
  return {
    source: source,
    session: session || null,
    userInfo: mergeUserInfo(session)
  };
}

function clearSession() {
  api.clearToken();
  try {
    wx.removeStorageSync(config.USER_INFO_KEY);
  } catch (e) {
    console.error('清理用户信息失败:', e);
  }
}

/**
 * 小程序登录（支持 mock 模式）
 * @param {string} nickname - 用户昵称（可选）
 * @param {string} avatarUrl - 用户头像 URL（可选）
 */
async function login(nickname = '', avatarUrl = '') {
  try {
    // 先获取微信 code
    const loginRes = await wxLogin();

    // 调用后端登录接口（使用 mockOpenid 模式，方便本地测试）
    const loginData = {
      code: loginRes.code,
      nickname: nickname || undefined,
      avatarUrl: avatarUrl || undefined
    };

    const res = await api.post('/auth/miniapp/login', loginData);

    // 保存 token 和用户信息
    api.saveToken(res.accessToken, res.refreshToken, res);

    const previous = getUserInfo();
    const selectedRole = previous && previous.userId === res.userId ? previous.selectedRole : null;
    const userInfo = {
      selectedRole: selectedRole,
      accountRole: res.role,
      userId: res.userId,
      openid: res.openid || '',
      phone: res.phone,
      isPhoneBound: res.isPhoneBound,
      nickname: res.nickname,
      avatarUrl: res.avatarUrl,
      role: selectedRole || res.role
    };
    wx.setStorageSync(config.USER_INFO_KEY, userInfo);

    return res;
  } catch (err) {
    console.error('登录失败:', err);
    throw err;
  }
}

/**
 * 绑定手机号
 */
async function bindPhone(code, mockPhone = '') {
  try {
    await api.post('/auth/bind-phone', {
      code: code,
      mockPhone: mockPhone
    });

    // 更新本地存储的用户信息
    const userInfo = getUserInfo();
    if (userInfo) {
      userInfo.isPhoneBound = true;
      wx.setStorageSync(config.USER_INFO_KEY, userInfo);
    }

    return true;
  } catch (err) {
    console.error('绑定手机号失败:', err);
    throw err;
  }
}

/**
 * 刷新 Token
 */
async function refreshToken() {
  try {
    const refreshTokenValue = getRefreshToken();
    if (!refreshTokenValue) {
      throw new Error('没有 Refresh Token');
    }

    const res = await api.refreshSession();

    console.log('Token 刷新成功');
    return res;
  } catch (err) {
    console.error('Token 刷新失败:', err);
    throw err;
  }
}

/**
 * 执行一次会话恢复。
 * 网络异常和服务端异常直接抛出，保留本地会话；明确的 Refresh Token
 * 认证失败才清理旧会话，然后走微信自动登录。
 */
async function recoverSession(options = {}) {
  const force = options.force === true;

  if (!force && hasUsableAccessToken() && getUserInfo() && getUserInfo().role) {
    try {
      await syncUserInfoIfNeeded();
      return buildSessionResult('access_token');
    } catch (err) {
      if (err && err.statusCode === 401) {
        clearSession();
      } else {
        throw err;
      }
    }
  }

  if (getRefreshToken()) {
    try {
      const session = await refreshToken();
      await syncUserInfoIfNeeded(session);
      return buildSessionResult('refresh_token', session);
    } catch (err) {
      if (isNetworkError(err) || (err && err.statusCode >= 500)) {
        throw err;
      }
      // 403 表示身份有效但权限不足，不能把会话误判成失效。
      if (err && err.statusCode === 403) {
        throw err;
      }
      clearSession();
    }
  }

  const session = await login();
  await syncUserInfoIfNeeded(session);
  return buildSessionResult('wx_login', session);
}

/**
 * 统一的认证恢复入口。所有页面、API 请求和热启动都共享同一个 Promise，
 * 避免 Refresh Token 轮换期间并发刷新或重复调用 wx.login。
 */
function ensureAuthenticated(options = {}) {
  if (authRecoveryPromise) {
    return authRecoveryPromise;
  }

  authRecoveryPromise = recoverSession(options)
    .finally(() => {
      authRecoveryPromise = null;
    });

  return authRecoveryPromise;
}

// 兼容旧调用方，统一转到新的认证恢复入口。
function ensureTokenValid(options = {}) {
  return ensureAuthenticated(options);
}

/**
 * 获取微信登录 code
 */
function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: 10000,
      success: resolve,
      fail: reject
    });
  });
}

/**
 * 检查登录状态
 */
function checkLogin() {
  return hasUsableAccessToken() || !!getRefreshToken();
}

/**
 * 获取当前用户信息
 */
function getUserInfo() {
  try {
    return wx.getStorageSync(config.USER_INFO_KEY) || null;
  } catch (e) {
    console.error('获取用户信息失败:', e);
    return null;
  }
}

/**
 * 获取用户 OpenID
 */
function getOpenid() {
  const userInfo = getUserInfo();
  return userInfo ? userInfo.openid : null;
}

// 账户可选角色由后端授予，role 表示当前浏览和操作身份。
const ROLE_LABELS = { user: '普通用户', stall_manager: '档口负责人', admin: '管理员' };

function getRoleLabel(code) {
  const info = getUserInfo() || {};
  const role = (info.roleDefinitions || []).find(item => item.code === code);
  return role ? role.name : ROLE_LABELS[code] || '自定义角色';
}

function getPermissionSnapshot() {
  const info = getUserInfo() || {};
  const snapshot = info.permissionSnapshot;
  return snapshot && snapshot.currentRole && snapshot.currentRole.code === info.role ? snapshot : null;
}

function canAccessMenu(code) {
  const snapshot = getPermissionSnapshot();
  return !!(snapshot && snapshot.menus.some(menu => menu.enabled !== false && menu.code === code));
}

async function loadPermissionSnapshot() {
  const info = getUserInfo() || {};
  const userId = info.userId || info.id;
  const role = info.selectedRole || info.role || 'user';
  const key = String(userId) + ':' + role;
  if (permissionRead && permissionRead.key === key) return permissionRead.promise;
  const read = { key };
  read.promise = (async () => {
    let selected = role;
    let snapshot;
    try {
      snapshot = await api.request({ url: '/iam/me', activeRole: selected });
    } catch (err) {
      if (!err || err.statusCode !== 403 || selected === 'user') throw err;
      selected = 'user';
      snapshot = await api.request({ url: '/iam/me', activeRole: selected });
    }
    if (!snapshot || !snapshot.currentRole || !Array.isArray(snapshot.roles) || !Array.isArray(snapshot.menus)) {
      throw new Error('角色权限数据不完整，请重新打开页面');
    }
    const current = getUserInfo() || {};
    if (String(current.userId || current.id) !== String(userId)
        || (current.selectedRole || current.role || 'user') !== role) return snapshot;
    current.role = snapshot.currentRole.code;
    current.selectedRole = snapshot.currentRole.code;
    current.availableRoles = snapshot.roles.map(item => item.code);
    current.roleDefinitions = snapshot.roles;
    current.permissionSnapshot = snapshot;
    current.permissionRevision = (current.permissionRevision || 0) + 1;
    wx.setStorageSync(config.USER_INFO_KEY, current);
    return snapshot;
  })().finally(() => {
    if (permissionRead === read) permissionRead = null;
  });
  permissionRead = read;
  return read.promise;
}

async function requireMenu(code) {
  await ensureAuthenticated({ silent: true });
  const snapshot = await loadPermissionSnapshot();
  if (!canAccessMenu(code)) throw new Error('当前角色无权访问该功能');
  return snapshot;
}

async function refreshAfterDenied() {
  try {
    await loadPermissionSnapshot();
    const navigation = require('./permissions');
    navigation.checkCurrentPage();
  } catch (error) {
    console.warn('刷新角色权限失败:', error);
  }
}

async function loadAvailableRoles() {
  const roles = await api.get('/auth/roles');
  if (!Array.isArray(roles)) throw new Error('可切换角色数据不完整');
  const info = getUserInfo() || {};
  info.availableRoles = roles;
  if (info.role === 'admin' && roles.includes('super_admin')) {
    info.role = 'super_admin';
    info.selectedRole = 'super_admin';
  }
  if (!roles.includes(info.role)) {
    info.role = 'user';
    info.selectedRole = 'user';
  }
  wx.setStorageSync(config.USER_INFO_KEY, info);
  const snapshot = await loadPermissionSnapshot();
  return snapshot.roles.map(role => role.code);
}

function selectRole(role) {
  const info = getUserInfo();
  if (!info || !(info.availableRoles || []).includes(role)) throw new Error('当前账户不具备所选角色');
  info.role = role;
  info.selectedRole = role;
  delete info.permissionSnapshot;
  wx.setStorageSync(config.USER_INFO_KEY, info);
}

function isAdmin() {
  const userInfo = getUserInfo();
  if (!userInfo) return false;
  const snapshot = getPermissionSnapshot();
  if (snapshot) return snapshot.currentRole.kind !== 'USER' && snapshot.currentRole.businessKey !== 'STALL_MANAGER';
  return userInfo.role === 'admin' || userInfo.role === 'super_admin';
}

function isStallManager() {
  const userInfo = getUserInfo();
  const snapshot = getPermissionSnapshot();
  return snapshot ? snapshot.currentRole.businessKey === 'STALL_MANAGER' : !!(userInfo && userInfo.role === 'stall_manager');
}

/**
 * 检查手机号是否已绑定
 */
function isPhoneBound() {
  const userInfo = getUserInfo();
  return userInfo && userInfo.isPhoneBound === true;
}

/**
 * 将手机号绑定错误转换成适合用户阅读的中文提示。
 */
function getPhoneBindErrorMessage(err) {
  const rawMessage = err && typeof err.message === 'string' ? err.message : '';

  if (/another user|其他账户|其他用户/i.test(rawMessage)) {
    return '该手机号已被其他账户绑定，请联系客服协助处理。';
  }
  if (/already bound, use|当前账户已绑定|已经绑定手机号/i.test(rawMessage)) {
    return '当前账户已绑定手机号，如需更换请联系客服处理。';
  }
  if (err && (err.statusCode === 409 || err.code === 'CONFLICT' || err.error === 'CONFLICT')) {
    return '手机号绑定存在冲突，请联系客服协助处理。';
  }
  return getErrorMessage(err, '手机号绑定失败，请稍后重试；如仍无法处理，请联系客服。');
}

/**
 * 退出登录
 */
function logout() {
  clearSession();
}

/**
 * 确保已登录（用于需要登录的页面）
 */
function ensureLogin() {
  if (!checkLogin()) {
    wx.showModal({
      title: '提示',
      content: '请先登录',
      showCancel: false,
      success: () => {
        wx.reLaunch({ url: '/pages/user/user' });
      }
    });
    return false;
  }
  return true;
}

module.exports = {
  getRoleLabel,
  getPermissionSnapshot,
  canAccessMenu,
  loadPermissionSnapshot,
  requireMenu,
  refreshAfterDenied,
  ROLE_LABELS,
  loadAvailableRoles,
  selectRole,
  login,
  bindPhone,
  refreshToken,
  ensureAuthenticated,
  ensureTokenValid,
  checkLogin,
  isNetworkError,
  getUserInfo,
  getOpenid,
  isAdmin,
  isStallManager,
  isPhoneBound,
  getPhoneBindErrorMessage,
  logout,
  ensureLogin,
  getAccessToken,
  getRefreshToken
};
