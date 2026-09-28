const api = require('./api');
const auth = require('./auth');

function label(count) {
  return count > 99 ? '99+' : String(count || 0);
}

async function refresh(page) {
  try {
    await auth.ensureAuthenticated({ silent: true });
    const result = await api.get('/wechat/customer-service/unread');
    const count = Math.max(0, Number(result && result.totalUnreadCount) || 0);
    if (page._messageUnreadVisible) {
      page.setData({ messageUnreadCount: count, messageUnreadLabel: label(count) });
    }
  } catch (err) {
    // 角标查询失败不影响当前页面；下次轮询再更新。
  }
}

function start(page) {
  stop(page);
  page._messageUnreadVisible = true;
  refresh(page);
  page._messageUnreadPoll = setInterval(() => refresh(page), 10000);
}

function stop(page) {
  page._messageUnreadVisible = false;
  clearInterval(page._messageUnreadPoll);
  page._messageUnreadPoll = null;
}

module.exports = { label, refresh, start, stop };
