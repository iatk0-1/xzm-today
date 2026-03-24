// miniprogram/utils/api.js
const config = require('./config');

/**
 * 获取存储的 Token
 */
function getToken() {
  try {
    return wx.getStorageSync(config.TOKEN_KEY) || '';
  } catch (e) {
    console.error('获取 Token 失败:', e);
    return '';
  }
}

/**
 * 保存 Token
 */
function saveToken(accessToken, refreshToken) {
  try {
    wx.setStorageSync(config.TOKEN_KEY, accessToken);
    if (refreshToken) {
      wx.setStorageSync(config.REFRESH_TOKEN_KEY, refreshToken);
    }
  } catch (e) {
    console.error('保存 Token 失败:', e);
  }
}

/**
 * 清除 Token
 */
function clearToken() {
  try {
    wx.removeStorageSync(config.TOKEN_KEY);
    wx.removeStorageSync(config.REFRESH_TOKEN_KEY);
  } catch (e) {
    console.error('清除 Token 失败:', e);
  }
}

/**
 * 通用请求封装
 */
function request(options) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const url = config.API_BASE_URL + options.url;

    // 为写操作生成幂等性 Key
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };

    // 对 POST/PUT/PATCH/DELETE 请求添加幂等性 Key
    const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (writeMethods.includes((options.method || 'GET').toUpperCase())) {
      const idempotencyKey = generateIdempotencyKey(options.url, options.data);
      headers['Idempotency-Key'] = idempotencyKey;
    }

    wx.request({
      url: url,
      method: options.method || 'GET',
      data: options.data || {},
      header: headers,
      success: (res) => {
        // 处理不同的成功状态码
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          // Token 过期或无效
          clearToken();
          // 不立即弹窗，允许访客浏览，只在需要登录的操作时提示
          console.log('未授权访问，将使用访客模式');
          reject({ error: 'UNAUTHORIZED', message: '未授权' });
        } else {
          // 其他错误
          const errorMsg = res.data?.message || res.data?.error || `请求失败 (${res.statusCode})`;
          // 不弹窗，让调用者决定是否提示
          reject(res.data);
        }
      },
      fail: (err) => {
        console.error('网络请求失败:', err);
        reject(err);
      }
    });
  });
}

/**
 * 生成幂等性 Key（基于 URL + 数据 + 时间戳）
 */
function generateIdempotencyKey(url, data) {
  const timestamp = Date.now();
  const dataStr = data ? JSON.stringify(data) : '';
  const str = url + dataStr + timestamp;
  // 简单 hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'ik_' + Math.abs(hash) + '_' + timestamp;
}

module.exports = {
  /**
   * GET 请求
   */
  get: (url, data) => request({ url, method: 'GET', data }),

  /**
   * POST 请求
   */
  post: (url, data) => request({ url, method: 'POST', data }),

  /**
   * PUT 请求
   */
  put: (url, data) => request({ url, method: 'PUT', data }),

  /**
   * PATCH 请求
   */
  patch: (url, data) => request({ url, method: 'PATCH', data }),

  /**
   * DELETE 请求
   */
  delete: (url, data) => request({ url, method: 'DELETE', data }),

  /**
   * 上传文件
   */
  uploadFile: (url, filePath, formData = {}) => {
    return new Promise((resolve, reject) => {
      const token = getToken();
      const idempotencyKey = 'upload_' + Date.now();
      wx.uploadFile({
        url: config.API_BASE_URL + url,
        filePath: filePath,
        name: 'file',
        formData: formData,
        header: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Idempotency-Key': idempotencyKey
        },
        success: (res) => {
          try {
            const data = JSON.parse(res.data);
            resolve(data);
          } catch (e) {
            reject({ error: '解析失败', message: res.data });
          }
        },
        fail: (err) => {
          reject(err);
        }
      });
    });
  },

  /**
   * 保存 Token（供 auth 模块使用）
   */
  saveToken: saveToken,

  /**
   * 清除 Token（供 auth 模块使用）
   */
  clearToken: clearToken
};
