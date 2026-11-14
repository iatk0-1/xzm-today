// 兼容旧模块引用：购买须知启动拦截已停用，不再请求同意状态。
module.exports = {
  GATE_ROUTE: 'pages/purchaseConsent/purchaseConsent',
  ensure: async () => true,
  isConfirmed: () => true,
  invalidate() {}, remember() {}, entered() {}
};
