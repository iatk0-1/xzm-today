// 黑名单只保留信息、个人资料及其必要入口，商品分享链接同样经过全局页面校验。
const allowedRoutes = new Set([
  'pages/messages/messages', 'pages/user/user', 'pages/editProfile/editProfile'
]);
const message = '当前账号已被移入黑名单，仅可使用信息和我页面';
let redirecting = false;

function stopWatching(page) {
  page._blacklistWatchActive = false;
  clearInterval(page._blacklistWatchTimer);
  page._blacklistWatchTimer = null;
}

function watch(page) {
  stopWatching(page);
  if (allows(page.route)) return;
  page._blacklistWatchActive = true;
  page._blacklistWatchTimer = setInterval(async () => {
    if (page._blacklistWatchReading) return;
    page._blacklistWatchReading = true;
    try {
      const result = await require('./api').get('/users/me/blacklist-status');
      if (page._blacklistWatchActive && result.blacklisted) handleDenied();
    } catch (error) {
      // 网络异常不误判为黑名单；后端仍对每次业务请求独立校验。
    } finally { page._blacklistWatchReading = false; }
  }, 10000);
}

function allows(route) {
  return allowedRoutes.has(String(route || '').replace(/^\//, '').split('?')[0]);
}

function redirect() {
  if (redirecting) return;
  redirecting = true;
  wx.showToast({ title: message, icon: 'none' });
  wx.reLaunch({ url: '/pages/user/user', complete: () => { redirecting = false; } });
}

function handleDenied() {
  const auth = require('./auth');
  auth.markBlacklisted();
  if (typeof getCurrentPages !== 'function') return redirect();
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (page) {
    require('./permissions').applyPagePermissions(page);
    if (!allows(page.route)) {
      page.setData({ pageAccessReady: false });
      redirect();
    }
  }
}

module.exports = { allows, redirect, handleDenied, message, watch, stopWatching };
