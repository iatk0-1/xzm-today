const auth = require('./auth');
const workbench = require('./workbench');

// 四个主页面的加号统一打开浮动菜单，打开及选择时都按当前角色校验权限。
function openProductMenu(page) {
  if (!auth.isAdmin() && !auth.isStallManager()) {
    wx.showToast({ title: '无权限', icon: 'none' });
    return;
  }
  const menu = page.selectComponent('#product-entry-menu');
  if (menu) menu.open();
}

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

module.exports = { openProductMenu, openProductCreate, openWorkbenchEntry };
