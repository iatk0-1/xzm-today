// miniprogram/utils/config.js
module.exports = {
  // 本地运行
  // API_BASE_URL: 'http://localhost:8080/api/v1',
  // 后端 API 开发环境 URL
  API_BASE_URL: 'https://api-dev.xianzaimai.com/api/v1',

  // 小程序 AppID
  MINIAPP_APPID: 'wx7692230ac8ecdaa8',

  // 存储键名
  TOKEN_KEY: 'accessToken',
  REFRESH_TOKEN_KEY: 'refreshToken',
  TOKEN_EXPIRES_AT_KEY: 'accessTokenExpiresAt',
  REFRESH_TOKEN_EXPIRES_AT_KEY: 'refreshTokenExpiresAt',
  USER_INFO_KEY: 'userInfo',

  // 管理员 OpenID（需在后端白名单中：application.yml 中的 app.auth.admin.openids）
  ADMIN_OPENID: 'owehQ3T4rBMR1ont7FHuuj2POXQY',

  // 默认卖家用户ID（用于客服咨询）
  SELLER_USER_ID: 1,

  // 腾讯云 COS / CDN 配置
  CDN_BASE_URL: 'https://upload-dev.xianzaimai.com'
};
