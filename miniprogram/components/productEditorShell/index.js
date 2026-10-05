Component({
  properties: {
    title: { type: String, value: '商品编辑' },
    showExitConfirm: { type: Boolean, value: false },
    saving: { type: Boolean, value: false }
  },
  data: { statusBarHeight: 20, navigationHeight: 44, sideWidth: 96 },
  lifetimes: {
    attached() {
      try {
        const window = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const capsule = wx.getMenuButtonBoundingClientRect();
        const statusBarHeight = window.statusBarHeight || 20;
        const navigationHeight = capsule.height > 0 && capsule.top >= statusBarHeight
          ? capsule.height + (capsule.top - statusBarHeight) * 2 : 44;
        this.setData({ statusBarHeight, navigationHeight,
          sideWidth: Math.max(96, window.windowWidth - capsule.left + 8) });
      } catch (error) {
        console.warn('获取商品页导航栏尺寸失败，使用默认尺寸:', error);
      }
    }
  },
  methods: {
    back() { if (!this.data.saving) this.triggerEvent('back'); },
    cancel() { if (!this.data.saving) this.triggerEvent('cancel'); },
    save() { if (!this.data.saving) this.triggerEvent('saveexit'); },
    discard() { if (!this.data.saving) this.triggerEvent('discardexit'); },
    blockTouch() {}
  }
});
