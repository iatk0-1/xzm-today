// miniprogram/utils/config.js
module.exports = {
  // 后端 API 基础 URL - dev 环境（使用域名模式）
  API_BASE_URL: 'http://localhost:8080/api/v1',

  // 小程序 AppID
  MINIAPP_APPID: 'wx7692230ac8ecdaa8',

  // 存储键名
  TOKEN_KEY: 'accessToken',
  REFRESH_TOKEN_KEY: 'refreshToken',
  USER_INFO_KEY: 'userInfo',

  // 管理员 OpenID（第一个登录的用户会自动成为管理员，因为 user-id=1）
  ADMIN_OPENID: 'mock_admin_openid_123456'
};
