const api = require('./api');

async function confirmChange(user, url) {
  const remove = user.blacklisted === true;
  const result = await new Promise(resolve => wx.showModal({
    title: remove ? '移出黑名单' : '移入黑名单',
    content: (user.nickname || '微信用户') + '（用户ID：' + user.id + '，绑定手机：' + (user.phone || '未绑定') + '）'
      + (remove ? '移出后将恢复该账号原有的访问权限。' : '移入后仅可使用信息和我页面，无法浏览商品和心愿。'),
    confirmText: remove ? '确认移出' : '确认移入',
    success: resolve, fail: () => resolve({ confirm: false })
  }));
  if (!result.confirm) return null;
  const changed = await api.put(url || '/admin/blacklist/users/' + encodeURIComponent(String(user.id)), { blacklisted: !remove });
  wx.showToast({ title: remove ? '已移出黑名单' : '已移入黑名单', icon: 'success' });
  return changed;
}

module.exports = { confirmChange };
