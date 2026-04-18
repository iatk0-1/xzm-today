// miniprogram/utils/auth.js
const api = require('./api');
const config = require('./config');

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
      mockOpenid: config.ADMIN_OPENID, // 使用管理员 OpenID 进行测试
      nickname: nickname || undefined,
      avatarUrl: avatarUrl || undefined
    };

    const res = await api.post('/auth/miniapp/login', loginData);

    // 保存 token 和用户信息
    api.saveToken(res.accessToken, res.refreshToken);

    const userInfo = {
      userId: res.userId,
      openid: config.ADMIN_OPENID,
      phone: res.phone,
      isPhoneBound: res.isPhoneBound,
      nickname: res.nickname,
      avatarUrl: res.avatarUrl,
      role: res.role
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
    const refresh_token = getRefreshToken();
    if (!refresh_token) {
      throw new Error('没有 Refresh Token');
    }

    const res = await api.post('/auth/refresh', { refresh_token });

    // 保存新 token
    api.saveToken(res.accessToken, res.refreshToken);

    console.log('Token 刷新成功');
    return res;
  } catch (err) {
    console.error('Token 刷新失败:', err);
    // 刷新失败，清除所有 token
    api.clearToken();
    throw err;
  }
}

/**
 * 确保 Token 有效（核心方法）
 * 流程：
 * 1. 如果有 accessToken，尝试刷新
 * 2. 如果没有 accessToken 但有 refresh_token，尝试刷新
 * 3. 如果都没有，执行登录
 */
async function ensureTokenValid() {
  const accessToken = getAccessToken();
  const refresh_token = getRefreshToken();

  try {
    // 情况 1: 有 accessToken，尝试刷新
    if (accessToken) {
      console.log('检测到 accessToken，尝试刷新...');
      try {
        await refreshToken();
        console.log('Token 刷新成功');
        return true;
      } catch (err) {
        console.log('Token 刷新失败，尝试重新登录');
        // 刷新失败，继续执行登录
      }
    }

    // 情况 2: 有 refresh_token 但没有 accessToken
    if (refresh_token) {
      console.log('检测到 refresh_token，尝试刷新...');
      try {
        await refreshToken();
        console.log('Token 刷新成功');
        return true;
      } catch (err) {
        console.log('Token 刷新失败，尝试重新登录');
      }
    }

    // 情况 3: 没有有效 token，执行登录
    console.log('执行自动登录...');
    await login();
    console.log('登录成功');
    return true;

  } catch (err) {
    console.error('获取有效 Token 失败:', err);
    throw err;
  }
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
  const token = wx.getStorageSync(config.TOKEN_KEY);
  const userInfo = wx.getStorageSync(config.USER_INFO_KEY);
  return !!(token && userInfo);
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

/**
 * 检查是否为管理员
 */
function isAdmin() {
  const userInfo = getUserInfo();
  return userInfo && userInfo.role === 'admin';
}

/**
 * 检查手机号是否已绑定
 */
function isPhoneBound() {
  const userInfo = getUserInfo();
  return userInfo && userInfo.isPhoneBound === true;
}

/**
 * 退出登录
 */
function logout() {
  api.clearToken();
  wx.removeStorageSync(config.USER_INFO_KEY);
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
  login,
  bindPhone,
  refreshToken,
  ensureTokenValid,
  checkLogin,
  getUserInfo,
  getOpenid,
  isAdmin,
  isPhoneBound,
  logout,
  ensureLogin,
  getAccessToken,
  getRefreshToken
};
