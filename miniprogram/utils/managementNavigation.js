const auth = require('./auth');
const workbench = require('./workbench');

// 四个主页面的加号统一进入商品新增页，按当前所选角色校验权限。
function openProductCreate() {
  if (!auth.isAdmin() && !auth.isStallManager()) {
    wx.showToast({ title: '无权限', icon: 'none' });
    return;
  }
  wx.navigateTo({ url: '/pages/admin/admin' });
}

// 工作台入口使用固定页面映射，防止角色切换后仍能打开旧角色的管理页面。
function openWorkbenchEntry(name) {
  const entry = workbench.findEntry(name);
  if (!entry) {
    wx.showToast({ title: '工作台入口不存在', icon: 'none' });
    return;
  }
  const role = auth.isAdmin() ? 'admin' : auth.isStallManager() ? 'stall_manager' : 'user';
  if (!entry.roles.includes(role)) {
    wx.showToast({ title: '无权限', icon: 'none' });
    return;
  }
  wx.navigateTo({ url: entry.url });
}

module.exports = { openProductCreate, openWorkbenchEntry };
