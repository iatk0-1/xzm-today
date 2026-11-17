const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { getErrorMessage } = require('../../utils/error');
const { canManageQuickOrder, validateQuickProduct } = require('../../utils/quickOrder');

Component({
  data: { visible: false, saving: false, draft: { name: '', articleNo: '', costPrice: '', price: '' }, images: [] },
  methods: {
    open() {
      if (!canManageQuickOrder(auth)) return;
      this._requestId = 'quick_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      this.setData({ visible: true, saving: false, draft: { name: '', articleNo: '', costPrice: '', price: '' }, images: [] });
    },
    close() { if (!this.data.saving) this.setData({ visible: false }); },
    block() {},
    input(e) { this.setData({ ['draft.' + e.currentTarget.dataset.field]: e.detail.value }); },
    chooseImages() {
      if (this.data.saving || this.data.images.length >= 9) return;
      wx.chooseMedia({ count: 9 - this.data.images.length, mediaType: ['image'],
        success: res => this.setData({ images: this.data.images.concat(res.tempFiles.map(file => ({ path: file.tempFilePath }))).slice(0, 9) }) });
    },
    removeImage(e) {
      if (this.data.saving) return;
      this.setData({ images: this.data.images.filter((_, i) => i !== Number(e.currentTarget.dataset.index)) });
    },
    async save() {
      if (this.data.saving) return;
      const error = validateQuickProduct(this.data.draft, this.data.images);
      if (error) { wx.showToast({ title: error, icon: 'none' }); return; }
      this.setData({ saving: true });
      try {
        const uploader = require('../../utils/cos-upload');
        const images = [];
        for (const image of this.data.images) {
          if (!image.url) image.url = await uploader.uploadFile(image.path, 'products');
          images.push(image.url);
        }
        const result = await api.post('/quick-orders', { ...this.data.draft, images, requestId: this._requestId });
        this.setData({ visible: false });
        wx.navigateTo({ url: '/pages/detail/detail?id=' + result.productId });
      } catch (error) {
        wx.showModal({ title: '快捷开单未完成', content: getErrorMessage(error, '请稍后重试'), showCancel: false });
      } finally { this.setData({ saving: false }); }
    }
  }
});
