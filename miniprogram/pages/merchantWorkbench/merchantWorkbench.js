const auth = require('../../utils/auth');
const merchantContext = require('../../utils/merchant-context');

const MENU_DEFINITIONS = [
  { key: 'create', label: '发布原始商品', permission: 'PRODUCT_CREATE', url: '/pages/admin/admin' },
  { key: 'products', label: '商品管理', permission: 'PRODUCT_UPDATE', url: '/pages/adminProduct/adminProduct' },
  { key: 'stock', label: '库存管理', permission: 'STOCK_MANAGE', url: '/pages/skuInventory/skuInventory' },
  { key: 'orders', label: '订单管理', permission: 'ORDER_MANAGE', url: '/pages/adminOrderManage/adminOrderManage' },
  { key: 'shipment', label: '发货管理', permission: 'SHIPMENT_MANAGE', url: '/pages/adminOrder/adminOrder' },
  { key: 'afterSale', label: '售后管理', permission: 'AFTER_SALE_MANAGE', url: '/pages/adminAfterSaleList/adminAfterSaleList' }
];

Page({
  data: { merchant: null, menus: [], canSwitch: false },

  onLoad(options) {
    try {
      if (options.merchantId) merchantContext.setCurrentMerchant(options.merchantId);
      this.refreshContext();
    } catch (err) {
      wx.showToast({ title: err.message || '商户身份已失效', icon: 'none' });
      setTimeout(() => wx.redirectTo({ url: '/pages/merchantSelect/merchantSelect' }), 500);
    }
  },

  onShow() {
    try {
      this.refreshContext();
    } catch (err) {
      merchantContext.clearCurrentMerchant();
    }
  },

  refreshContext() {
    const merchant = merchantContext.requireCurrentMerchant();
    const menus = MENU_DEFINITIONS.filter(item =>
      auth.hasMerchantPermission(merchant.merchantId, item.permission));
    this.setData({
      merchant,
      menus,
      canSwitch: auth.getMerchantMemberships().filter(item =>
        String(item.memberStatus || '').toLowerCase() === 'active'
        && String(item.merchantStatus || 'active').toLowerCase() === 'active').length > 1
    });
  },

  openMenu(e) {
    const item = this.data.menus.find(menu => menu.key === e.currentTarget.dataset.key);
    if (item) wx.navigateTo({ url: item.url });
  },

  switchMerchant() {
    wx.navigateTo({ url: '/pages/merchantSelect/merchantSelect' });
  }
});
