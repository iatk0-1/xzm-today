const auth = require('./auth');
const { getErrorMessage } = require('./error');
const blacklist = require('./blacklistAccess');

const requirements = {
  'pages/blacklist/blacklist': ['blacklist'],
  'pages/purchaseConsent/purchaseConsent': [],
  'pages/index/index': ['browse', 'homeProducts'],
  'pages/search/search': ['browse'],
  'pages/detail/detail': ['browse', 'productManage', 'picking', 'productDrafts', 'myOrders', 'orderManage', 'shipping', 'afterSale', 'applications', 'sales', 'shippingSales', 'managers', 'catalog', 'inventory', 'wishManage', 'customerService'],
  'pages/market/market': ['market', 'wishManage'],
  'pages/wishDetail/wishDetail': ['market', 'wishManage'],
  'pages/publishWish/publishWish': ['market', 'wishManage'],
  'pages/messages/messages': ['messages', 'customerService'],
  'pages/customerServiceChat/customerServiceChat': ['messages', 'customerService'],
  'pages/customerServiceStaff/customerServiceStaff': ['customerService'],
  'pages/customerServiceOrderDetail/customerServiceOrderDetail': ['customerService'],
  'pages/cart/cart': ['cart'],
  'pages/checkout/checkout': ['cart'],
  'pages/editProfile/editProfile': ['profile'],
  'pages/orderList/orderList': ['myOrders'],
  'pages/orderDetail/orderDetail': ['myOrders', 'orderManage', 'shipping', 'afterSale', 'applications', 'picking', 'customerService'],
  'pages/shipmentTraceDetail/shipmentTraceDetail': ['myOrders', 'orderManage', 'shipping', 'afterSale'],
  'pages/afterSaleApply/afterSaleApply': ['myOrders'],
  'pages/afterSaleDetail/afterSaleDetail': ['myOrders', 'afterSale'],
  'pages/admin/admin': ['productManage', 'productDrafts'],
  'pages/productDrafts/index': ['productDrafts'],
  'pages/adminProduct/adminProduct': ['productManage'],
  'pages/adminProductRecycleBin/adminProductRecycleBin': ['productManage'],
  'pages/adminOrderManage/adminOrderManage': ['orderManage'],
  'pages/adminOrderDetail/adminOrderDetail': ['orderManage', 'shipping', 'afterSale', 'applications', 'picking'],
  'pages/adminOrder/adminOrder': ['shipping'],
  'pages/shipPartial/shipPartial': ['shipping'],
  'pages/manualShip/manualShip': ['shipping'],
  'pages/unbindOrder/unbindOrder': ['shipping'],
  'pages/mergeGroupDetail/mergeGroupDetail': ['shipping'],
  'pages/logistics/expressBatchManage/expressBatchManage': ['shipping'],
  'pages/bluetoothPrint/bluetoothPrint': ['shipping', 'printers'],
  'pages/logistics/printers/printers': ['printers'],
  'pages/printer-login/authorize': ['printers', 'shipping'],
  'pages/adminAfterSaleList/adminAfterSaleList': ['afterSale'],
  'pages/adminAfterSaleDetail/adminAfterSaleDetail': ['afterSale'],
  'pages/adminShippingSales/adminShippingSales': ['shippingSales'],
  'pages/adminShippingSalesDetail/adminShippingSalesDetail': ['shippingSales'],
  'pages/adminSales/adminSales': ['sales'],
  'pages/adminSalesDetail/adminSalesDetail': ['sales'],
  'pages/adminCatalogManage/adminCatalogManage': ['catalog'],
  'pages/adminCatalogProducts/adminCatalogProducts': ['catalog'],
  'pages/stallManagers/stallManagers': ['managers'],
  'pages/stallManagerDetail/stallManagerDetail': ['managers'],
  'pages/pricingRules/pricingRules': ['pricing'],
  'pages/commissionConfigs/commissionConfigs': ['commission'],
  'pages/homeNavigation/homeNavigation': ['homeNavigation'],
  'pages/managerIncome/managerIncome': ['income'],
  'pages/adminChangeRequestManage/adminChangeRequestManage': ['applications'],
  'pages/shippingTemplates/shippingTemplates': ['shippingTemplates'],
  'pages/skuInventory/skuInventory': ['inventory'],
  'pages/inventoryDetail/inventoryDetail': ['inventory'],
  'pages/inventoryProductSelect/inventoryProductSelect': ['inventory'],
  'pages/pickingList/pickingList': ['picking'],
  'pages/purchaseOrders/purchaseOrders': ['purchase', 'picking'],
  'pages/permissionMenus/index': ['menuConfig'],
  'pages/permissionRoles/index': ['roleManage'],
  'pages/permissionMembers/index': ['memberManage']
};

const actionRequirements = {
  'pages/adminOrderDetail/adminOrderDetail': {
    openPricePanel: ['orderManage'], submitPrice: ['orderManage'], savePrice: ['orderManage'],
    openOrderCostPanel: ['orderManage'], saveOrderCosts: ['orderManage'],
    openRefundPanel: ['orderManage'], submitAdminRefund: ['orderManage'], retryShippingRefund: ['orderManage'],
    openRecipientEditor: ['orderManage', 'shipping'], saveRecipient: ['orderManage', 'shipping'],
    openAdminRemarkEditor: ['orderManage', 'shipping'], saveAdminRemark: ['orderManage', 'shipping'],
    cancelWaybill: ['orderManage', 'shipping'], openPartialUnbindPanel: ['orderManage', 'shipping'],
    submitPartialUnbind: ['orderManage', 'shipping'], confirmFullUnbind: ['orderManage', 'shipping'],
    retryShipmentUnbind: ['orderManage', 'shipping'], reviewShipmentUnbindWaybill: ['orderManage', 'shipping']
  },
  'pages/orderDetail/orderDetail': {
    payOrder: ['myOrders'], cancelOrder: ['myOrders'], confirmReceipt: ['myOrders'],
    requestRefund: ['myOrders'], cancelAfterSale: ['myOrders'], submitChangeRequest: ['myOrders'],
    chooseAddressForChange: ['myOrders'], submitAddressChangeRequest: ['myOrders'], editItemRemark: ['myOrders'],
    openRecipientEditor: ['myOrders'], submitRecipientChange: ['myOrders'], submitRemarkChange: ['myOrders']
  }
};

function canVisit(route) {
  const normalized = String(route || '').replace(/^\//, '').split('?')[0];
  if (auth.isBlacklisted()) return blacklist.allows(normalized);
  if (normalized === 'pages/user/user' || normalized === 'pages/purchaseConsent/purchaseConsent') return true;
  const required = requirements[normalized];
  return !!required && required.some(code => auth.canAccessMenu(code));
}

function applyPagePermissions(page) {
  const access = code => auth.canAccessMenu(code);
  const snapshot = auth.getPermissionSnapshot();
  const scoped = !!(snapshot && snapshot.currentRole.stallScoped);
  page.setData({
    isBlacklisted: auth.isBlacklisted(),
    isStallScoped: scoped,
    canManageGlobalCatalog: !scoped && (access('productManage') || access('catalog')),
    canBrowse: access('browse'), canMarket: access('market') || access('wishManage'),
    canMessages: access('messages') || access('customerService'), canCart: access('cart'),
    canProfile: access('profile'), canMyOrders: access('myOrders'), canAddresses: access('addresses'),
    canCreateProduct: access('productManage'), canManageProducts: access('productManage'),
    canManageWishes: access('wishManage'), canManageHome: access('homeProducts'),
    canCustomerService: access('customerService'),
    canAssignRoles: access('memberManage'),
    canManageOrders: access('orderManage'), canRefundOrder: access('orderManage'),
    canEditOrderRecipient: access('orderManage') || access('shipping'),
    canEditShipping: access('orderManage') || access('shipping'),
    canManageAfterSale: access('afterSale'), canManageApplications: access('applications')
  });
}

function deny() {
  if (auth.isBlacklisted()) return blacklist.redirect();
  wx.showToast({ title: '当前角色无权访问该功能', icon: 'none' });
  wx.reLaunch({ url: '/pages/user/user' });
}

function checkCurrentPage() {
  if (typeof getCurrentPages !== 'function') return;
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (!page) return;
  applyPagePermissions(page);
  if (!canVisit(page.route)) deny();
}

async function authorize(page) {
  await auth.ensureAuthenticated({ silent: true });
  await auth.loadPermissionSnapshot();
  applyPagePermissions(page);
  if (!canVisit(page.route)) {
    const error = new Error('当前角色无权访问该功能');
    error.permissionDenied = true;
    throw error;
  }
  page.setData({ pageAccessReady: true });
  return true;
}

function wrap(config) {
  // 兼容旧须知入口，该页面仅跳转回正常业务页面。
  if (config.isPurchaseConsentPage) return config;
  const guarded = { ...config };
  const actions = new Set(Object.values(actionRequirements).flatMap(rules => Object.keys(rules)));
  for (const name of actions) {
    if (typeof config[name] !== 'function') continue;
    guarded[name] = function(...args) {
      const required = (actionRequirements[this.route] || {})[name];
      if (required && !required.some(code => auth.canAccessMenu(code))) {
        wx.showToast({ title: '当前角色无权执行该操作', icon: 'none' });
        return;
      }
      return config[name].apply(this, args);
    };
  }
  const onLoad = config.onLoad;
  const onShow = config.onShow;
  const onHide = config.onHide;
  const onUnload = config.onUnload;
  const failure = error => {
    if (error.permissionDenied) deny();
    else wx.showToast({ title: getErrorMessage(error, '加载角色权限失败，请重新打开页面'), icon: 'none' });
  };
  return {
    ...guarded,
    data: { ...config.data, pageAccessReady: false },
    onLoad(options) {
      this._permissionLoading = authorize(this);
      return this._permissionLoading.then(allowed => allowed && onLoad && onLoad.call(this, options)).catch(failure);
    },
    onShow() {
      const ready = this._permissionLoading || authorize(this);
      return ready.then(allowed => {
        if (!allowed) return;
        blacklist.watch(this);
        return onShow && onShow.call(this);
      }).catch(failure).finally(() => {
        if (this._permissionLoading === ready) this._permissionLoading = null;
      });
    },
    onHide(...args) {
      blacklist.stopWatching(this);
      this.setData({ pageAccessReady: false });
      return onHide && onHide.apply(this, args);
    },
    onUnload(...args) {
      blacklist.stopWatching(this);
      return onUnload && onUnload.apply(this, args);
    }
  };
}

function install(register) {
  return config => register(wrap(config));
}

module.exports = { canVisit, checkCurrentPage, applyPagePermissions, wrap, install, requirements };
