const api = require('./api');
const auth = require('./auth');
const GATE_ROUTE = 'pages/purchaseConsent/purchaseConsent';
let checked = null;
let pending = null;
let generation = 0;
let redirecting = false;

function invalidate() { generation += 1; checked = null; pending = null; }
function userKey() {
  const user = auth.getUserInfo() || {};
  return String(user.userId || user.id || '');
}
function remember(status) { checked = { user: userKey(), status }; }
function isConfirmed() { return !!(checked && checked.user === userKey() && checked.status.agreed); }
async function status() {
  const user = userKey();
  if (checked && checked.user === user) return checked.status;
  if (!pending || pending.user !== user || pending.generation !== generation) {
    const requestGeneration = generation;
    const entry = { user, generation: requestGeneration };
    const request = api.get('/purchase-consent').then(result => {
      if (requestGeneration === generation && user === userKey()) remember(result);
      return result;
    }).finally(() => { if (pending === entry) pending = null; });
    entry.request = request;
    pending = entry;
  }
  return pending.request;
}
function pageUrl(page, options) {
  const query = Object.keys(options || {}).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(options[key])).join('&');
  return '/' + page.route + (query ? '?' + query : '');
}
async function ensure(page, options) {
  if (page.route === GATE_ROUTE) return true;
  const user = userKey(), requestGeneration = generation;
  let result;
  try { result = await status(); }
  catch (error) { console.warn('读取购买须知状态失败，将进入须知页重试:', error); }
  if (user !== userKey() || requestGeneration !== generation) return ensure(page, options);
  if (result && result.agreed) return true;
  if (!redirecting) {
    redirecting = true;
    wx.reLaunch({ url: '/' + GATE_ROUTE + '?returnTo=' + encodeURIComponent(pageUrl(page, options)),
      fail() { redirecting = false; wx.showToast({ title: '购买须知打开失败，请重新进入', icon: 'none' }); } });
  }
  return false;
}
function entered() { redirecting = false; }
module.exports = { GATE_ROUTE, ensure, invalidate, remember, entered, isConfirmed };
