const auth = require('../../utils/auth');
const navigation = require('../../utils/managementNavigation');

Component({
  data: { visible: false, canCreate: false, canDrafts: false },
  pageLifetimes: { hide() { this.close(); } },
  methods: {
    open() {
      if (!auth.canAccessMenu('productManage') && !auth.canAccessMenu('productDrafts')) {
        wx.showToast({ title: '无权限', icon: 'none' });
        return;
      }
      this.setData({ visible: !this.data.visible, canCreate: auth.canAccessMenu('productManage'), canDrafts: auth.canAccessMenu('productDrafts') });
    },
    close() { this.setData({ visible: false }); },
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
