const auth = require('../../utils/auth');
const navigation = require('../../utils/managementNavigation');

Component({
  data: { visible: false },
  pageLifetimes: { hide() { this.close(); } },
  methods: {
    open() {
      if (!auth.isAdmin() && !auth.isStallManager()) {
        wx.showToast({ title: '无权限', icon: 'none' });
        return;
      }
      this.setData({ visible: !this.data.visible });
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
