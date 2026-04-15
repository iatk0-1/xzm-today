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

  // 管理员 OpenID（需在后端白名单中：application.yml 中的 app.auth.admin.openids）
  ADMIN_OPENID: 'owehQ3cwUf_RQ0TQ0SPpkBs0-BCU'
};
