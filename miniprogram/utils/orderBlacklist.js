const api = require('./api');
const auth = require('./auth');
const { getErrorMessage } = require('./error');

async function refresh(page) {
  if (!auth.canAccessMenu('orderManage')) return;
  const ids = (page.data.orders || (page.data.order ? [page.data.order] : [])).map(order => String(order.id));
  const version = (page._blacklistReadVersion || 0) + 1;
  page._blacklistReadVersion = version;
  if (!ids.length) return;
  try {
    const users = {};
    // 订单列表可累积多页，每次请求最多100个编号。
    for (let i = 0; i < ids.length; i += 100) {
      const result = await api.get('/admin/blacklist/order-users', { orderIds: ids.slice(i, i + 100).join(',') });
      result.forEach(entry => { users[String(entry.orderId)] = entry.user; });
    }
    if (page._blacklistReadVersion === version) page.setData({ blacklistUsers: users, blacklistLoadError: false });
  } catch (error) {
    if (page._blacklistReadVersion === version) page.setData({ blacklistUsers: {}, blacklistLoadError: true });
    wx.showToast({ title: getErrorMessage(error, '黑名单状态加载失败，请重试'), icon: 'none' });
  }
}

async function toggle(page, orderId) {
  const user = (page.data.blacklistUsers || {})[String(orderId)];
  if (!user || page.data.blacklistSaving || !auth.canAccessMenu('orderManage')) return;
  page.setData({ blacklistSaving: true });
  try {
    const changed = await require('./userBlacklist').confirmChange(user,
      '/admin/blacklist/order-users/' + encodeURIComponent(String(orderId)));
    if (!changed) return;
    // 更新同一下单账号的所有订单，不误用收件人的手机号。
    page._blacklistReadVersion = (page._blacklistReadVersion || 0) + 1;
    const users = { ...page.data.blacklistUsers };
    Object.keys(users).forEach(id => {
      if (String(users[id].id) === String(changed.id)) users[id] = changed;
    });
    page.setData({ blacklistUsers: users });
    require('./pageSync').publish('blacklist-users', changed.id);
  } catch (error) {
    wx.showToast({ title: getErrorMessage(error, '黑名单操作失败，请重试'), icon: 'none' });
  } finally { page.setData({ blacklistSaving: false }); }
}

module.exports = { refresh, toggle };
