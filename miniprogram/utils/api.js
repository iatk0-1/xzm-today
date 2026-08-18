// miniprogram/utils/api.js
const config = require('./config');
const { compressImage } = require('./media');

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
let refreshPromise = null;

function getStorage(key) {
  try {
    return wx.getStorageSync(key) || '';
  } catch (e) {
    console.error('读取本地存储失败:', key, e);
    return '';
  }
}

function setStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {
    console.error('写入本地存储失败:', key, e);
  }
}

function removeStorage(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {
    console.error('删除本地存储失败:', key, e);
  }
}

function getToken() {
  return getStorage(config.TOKEN_KEY);
}

function getRefreshToken() {
  return getStorage(config.REFRESH_TOKEN_KEY);
}

function parseExpireTime(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  var parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resolveAccessExpireTime(session) {
  if (!session) return 0;
  var expiresAt = parseExpireTime(session.expiresAt);
  if (expiresAt) return expiresAt;
  if (session.expiresIn) return Date.now() + Number(session.expiresIn) * 1000;
  return 0;
}

function resolveRefreshExpireTime(session) {
  if (!session) return 0;
  var expiresAt = parseExpireTime(session.refreshExpiresAt);
  if (expiresAt) return expiresAt;
  if (session.refreshExpiresIn) return Date.now() + Number(session.refreshExpiresIn) * 1000;
  return 0;
}

function saveToken(accessToken, refreshToken, session) {
  if (accessToken) {
    setStorage(config.TOKEN_KEY, accessToken);
  }
  if (refreshToken) {
    setStorage(config.REFRESH_TOKEN_KEY, refreshToken);
  }

  var accessExpiresAt = resolveAccessExpireTime(session);
  if (accessExpiresAt) {
    setStorage(config.TOKEN_EXPIRES_AT_KEY, accessExpiresAt);
  }

  var refreshExpiresAt = resolveRefreshExpireTime(session);
  if (refreshExpiresAt) {
    setStorage(config.REFRESH_TOKEN_EXPIRES_AT_KEY, refreshExpiresAt);
  }
}

function clearToken() {
  removeStorage(config.TOKEN_KEY);
  removeStorage(config.REFRESH_TOKEN_KEY);
  removeStorage(config.TOKEN_EXPIRES_AT_KEY);
  removeStorage(config.REFRESH_TOKEN_EXPIRES_AT_KEY);
}

function isAuthEndpoint(url) {
  return url === '/auth/refresh'
    || url === '/auth/miniapp/login'
    || url === '/auth/miniapp/phone-login';
}

function isTokenExpiredOrExpiringSoon() {
  var refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  var token = getToken();
  if (!token) return true;

  var expiresAt = Number(getStorage(config.TOKEN_EXPIRES_AT_KEY) || 0);
  if (!expiresAt) return false;

  return expiresAt - Date.now() <= REFRESH_BUFFER_MS;
}

function isStoredAccessTokenStillUsable() {
  var token = getToken();
  if (!token) return false;
  var expiresAt = Number(getStorage(config.TOKEN_EXPIRES_AT_KEY) || 0);
  return !expiresAt || expiresAt > Date.now();
}

function shouldClearToken(statusCode) {
  return statusCode === 400 || statusCode === 401 || statusCode === 403;
}

function normalizeHttpError(res, fallbackMessage) {
  var data = res && res.data ? res.data : {};
  var error = typeof data === 'object' ? data : { message: data };
  if (!error.message && !error.error) {
    error.message = fallbackMessage || ('请求失败 (' + res.statusCode + ')');
  }
  error.statusCode = res.statusCode;
  return error;
}

function wxRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: options.url,
      method: options.method || 'GET',
      data: options.data || {},
      header: options.header || {},
      success: resolve,
      fail: reject
    });
  });
}

function rawRefreshSession() {
  var refreshToken = getRefreshToken();
  if (!refreshToken) {
    return Promise.reject({ error: 'NO_REFRESH_TOKEN', message: '没有 Refresh Token' });
  }

  return wxRequest({
    url: config.API_BASE_URL + '/auth/refresh',
    method: 'POST',
    data: { refreshToken: refreshToken },
    header: { 'Content-Type': 'application/json' }
  }).then((res) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      saveToken(res.data.accessToken, res.data.refreshToken, res.data);
      return res.data;
    }

    var error = normalizeHttpError(res, 'Token 刷新失败');
    if (shouldClearToken(res.statusCode)) {
      clearToken();
    }
    throw error;
  });
}

function refreshSession() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = rawRefreshSession()
    .then((res) => {
      refreshPromise = null;
      return res;
    })
    .catch((err) => {
      refreshPromise = null;
      throw err;
    });

  return refreshPromise;
}

async function ensureAccessToken() {
  if (!isTokenExpiredOrExpiringSoon()) {
    return true;
  }

  try {
    await refreshSession();
    return true;
  } catch (err) {
    // If the current access token is still valid, keep the request moving.
    // A 401 response will still trigger refresh-and-retry below.
    if (isStoredAccessTokenStillUsable()) {
      console.warn('Token 预刷新失败，继续使用当前未过期 token:', err);
      return true;
    }
    throw err;
  }
}

function generateIdempotencyKey(url, data) {
  const timestamp = Date.now();
  const dataStr = data ? JSON.stringify(data) : '';
  const str = url + dataStr + timestamp;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'ik_' + Math.abs(hash) + '_' + timestamp;
}

function buildRequestOptions(options) {
  const method = (options.method || 'GET').toUpperCase();
  const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const idempotencyKey = options.idempotencyKey
    || (writeMethods.includes(method) ? generateIdempotencyKey(options.url, options.data) : '');

  return {
    url: options.url,
    method,
    data: options.data || {},
    idempotencyKey,
    skipAuthRefresh: options.skipAuthRefresh === true
  };
}

function buildHeaders(options) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };

  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  return headers;
}

async function requestWithRetry(options, hasRetried) {
  const authEndpoint = isAuthEndpoint(options.url);
  if (!authEndpoint && !options.skipAuthRefresh) {
    await ensureAccessToken();
  }

  const fullUrl = config.API_BASE_URL + options.url;
  const res = await wxRequest({
    url: fullUrl,
    method: options.method,
    data: options.data,
    header: buildHeaders(options)
  });

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return res.data;
  }

  if (res.statusCode === 401
      && !hasRetried
      && !authEndpoint
      && !options.skipAuthRefresh
      && getRefreshToken()) {
    await refreshSession();
    return requestWithRetry(options, true);
  }

  if (res.statusCode === 401) {
    clearToken();
    throw { error: 'UNAUTHORIZED', message: '未授权', statusCode: 401 };
  }

  throw normalizeHttpError(res);
}

function request(options) {
  return requestWithRetry(buildRequestOptions(options), false);
}

function mapUrlToCosDir(url) {
  if (url === '/files/upload-wish') return 'wishes';
  if (url === '/files/upload-avatar') return 'avatars';
  return null;
}

function parseUploadResponse(res) {
  if (!res || !res.data) return {};
  if (typeof res.data === 'object') return res.data;
  try {
    return JSON.parse(res.data);
  } catch (e) {
    return { message: res.data };
  }
}

function wxUploadFile(url, filePath, formData, idempotencyKey) {
  const token = getToken();
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: config.API_BASE_URL + url,
      filePath: filePath,
      name: 'file',
      formData: formData,
      header: {
        'Authorization': token ? `Bearer ${token}` : '',
        'Idempotency-Key': idempotencyKey
      },
      success: resolve,
      fail: reject
    });
  });
}

async function uploadToBackend(url, filePath, formData, hasRetried, idempotencyKey) {
  await ensureAccessToken();

  const res = await wxUploadFile(url, filePath, formData, idempotencyKey);
  if (res.statusCode >= 200 && res.statusCode < 300) {
    return parseUploadResponse(res);
  }

  if (res.statusCode === 401 && !hasRetried && getRefreshToken()) {
    await refreshSession();
    return uploadToBackend(url, filePath, formData, true, idempotencyKey);
  }

  if (res.statusCode === 401) {
    clearToken();
    throw { error: 'UNAUTHORIZED', message: '未授权', statusCode: 401 };
  }

  const data = parseUploadResponse(res);
  data.statusCode = res.statusCode;
  if (!data.message && !data.error) {
    data.message = '上传失败 (' + res.statusCode + ')';
  }
  throw data;
}

async function uploadFile(url, filePath, formData = {}, options = {}) {
  var shouldCompress = options.compress !== false;
  var cosDir = options.useCos === false ? null : mapUrlToCosDir(url);

  if (cosDir !== null) {
    try {
      if (shouldCompress) {
        try {
          const compressResult = await compressImage(filePath);
          filePath = compressResult.path;
        } catch (e) {
          console.warn('图片压缩失败，使用原图:', e);
        }
      }

      var cosUpload = require('./cos-upload');
      var cosUrl = await cosUpload.uploadFile(filePath, cosDir);
      return { url: cosUrl, key: '', originalFilename: '', contentType: '', size: 0 };
    } catch (err) {
      console.error('COS 上传失败，回退到服务端上传:', err);
    }
  }

  if (shouldCompress) {
    try {
      const compressResult = await compressImage(filePath);
      filePath = compressResult.path;
    } catch (e) {
      console.warn('图片压缩失败，使用原图:', e);
    }
  }

  return uploadToBackend(
    url,
    filePath,
    formData,
    false,
    'upload_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
  );
}

module.exports = {
  get: (url, data) => request({ url, method: 'GET', data }),
  post: (url, data) => request({ url, method: 'POST', data }),
  put: (url, data) => request({ url, method: 'PUT', data }),
  patch: (url, data) => request({ url, method: 'PATCH', data }),
  delete: (url, data) => request({ url, method: 'DELETE', data }),
  uploadFile,
  saveToken,
  clearToken,
  getToken,
  getRefreshToken,
  refreshSession,
  ensureAccessToken,
  getCosCredentials: async function(dir) {
    var query = dir ? '?dir=' + encodeURIComponent(dir) : '';
    return this.get('/files/cos-credentials' + query);
  }
};
