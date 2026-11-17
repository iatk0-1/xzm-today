const auth = require('../../utils/auth');
const navigation = require('../../utils/managementNavigation');
const { canManageQuickOrder } = require('../../utils/quickOrder');

Component({
  data: { visible: false, canCreate: false, canDrafts: false, canQuick: false },
  pageLifetimes: { hide() { this.close(); } },
  methods: {
    open() {
      if (!auth.canAccessMenu('productManage') && !auth.canAccessMenu('productDrafts')) {
        wx.showToast({ title: '无权限', icon: 'none' });
        return;
      }
      this.setData({ visible: !this.data.visible, canCreate: auth.canAccessMenu('productManage'), canDrafts: auth.canAccessMenu('productDrafts'), canQuick: canManageQuickOrder(auth) });
    },
    close() { this.setData({ visible: false }); },
    quickOrder() {
      if (!this.data.visible || !canManageQuickOrder(auth)) return;
      this.close();
      this.selectComponent('#quick-order-dialog').open();
    },
    createProduct() {
      if (!this.data.visible) return;
      this.close();
      navigation.openProductCreate();
    },
    openDrafts() {
      if (!this.data.visible) return;
      this.close();
      navigation.openWorkbenchEntry('productDrafts');
    },
    blockTouch() {}
  }
});
