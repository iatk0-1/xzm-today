const auth = require('./auth');

// 四个底部导航页面共用管理菜单，避免负责人入口和菜单内容不一致。
function openManagementMenu(options = {}) {
  const isAdmin = auth.isAdmin();
  if (!isAdmin && !auth.isStallManager()) {
    wx.showToast({ title: '无权限', icon: 'none' });
    return;
  }
  const entries = [
    ['发布新商品', '/pages/admin/admin'],
    ['商品上下架管理', '/pages/adminProduct/adminProduct']
  ];
  if (isAdmin) entries.push(['库存管理', '/pages/skuInventory/skuInventory']);
  entries.push(['拣货推荐', '/pages/pickingList/pickingList']);
  if (isAdmin) {
    entries.push(['订单管理', '/pages/adminOrderManage/adminOrderManage']);
    entries.push(options.afterSale
      ? ['售后管理', '/pages/adminAfterSaleList/adminAfterSaleList']
      : ['订单发货管理', '/pages/adminOrder/adminOrder']);
  }
  wx.showActionSheet({
    itemList: entries.map(entry => entry[0]),
    itemColor: '#111111',
    success: res => {
      const entry = entries[res.tapIndex];
      if (entry) wx.navigateTo({ url: entry[1] });
    }
  });
}

module.exports = { openManagementMenu };
