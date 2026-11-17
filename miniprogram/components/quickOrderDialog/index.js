const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { getErrorMessage } = require('../../utils/error');
const { canManageQuickOrder, validateQuickProduct } = require('../../utils/quickOrder');

function storageKey() {
  const user = auth.getUserInfo();
  return user && user.userId != null ? 'quick_order_last_product:' + String(user.userId) : null;
}

function readLastProduct(key) {
  if (!key) return null;
  try {
    const value = wx.getStorageSync(key);
    if (!value || !value.draft || !Array.isArray(value.images)
      || value.images.some(url => typeof url !== 'string' || !/^https:\/\//.test(url))) return null;
    const draft = {};
    for (const field of ['name', 'articleNo', 'costPrice', 'price']) draft[field] = String(value.draft[field] == null ? '' : value.draft[field]);
    return validateQuickProduct(draft, value.images) ? null : { draft, images: value.images.slice() };
  } catch (_) { return null; }
}

Component({
  data: { visible: false, saving: false, draft: { name: '', articleNo: '', costPrice: '', price: '' }, images: [] },
  methods: {
    open() {
      if (!canManageQuickOrder(auth) || this.data.saving || this.data.visible || this._opening) return;
      const key = storageKey();
      const last = readLastProduct(key);
      const showForm = restore => {
        this._opening = false;
        if (!canManageQuickOrder(auth)) return;
        const saved = restore && key === storageKey() ? last : null;
        // 每次打开都使用新请求号，恢复的内容只用于填表，不复用上次商品。
        this._requestId = 'quick_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        this.setData({ visible: true, saving: false,
          draft: saved ? { ...saved.draft } : { name: '', articleNo: '', costPrice: '', price: '' },
          images: saved ? saved.images.map(url => ({ path: url, url })) : [] });
      };
      if (!last) { showForm(false); return; }
      this._opening = true;
      wx.showModal({ title: '快捷开单', content: '是否恢复上次开单数据？', confirmText: '是', cancelText: '否',
        success: result => showForm(result.confirm), fail: () => showForm(false) });
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
      const draft = { ...this.data.draft };
      const key = storageKey();
      try {
        const uploader = require('../../utils/cos-upload');
        const images = [];
        for (const image of this.data.images) {
          if (!image.url) image.url = await uploader.uploadFile(image.path, 'products');
          images.push(image.url);
        }
        const result = await api.post('/quick-orders', { ...draft, images, requestId: this._requestId });
        // 只记住成功开单的数据和已上传图片，临时文件清理后仍可恢复。
        try { if (key) wx.setStorageSync(key, { draft, images }); }
        catch (_) { console.warn('上次开单数据暂存失败'); }
        this.setData({ visible: false });
        wx.navigateTo({ url: '/pages/detail/detail?id=' + result.productId });
      } catch (error) {
        wx.showModal({ title: '快捷开单未完成', content: getErrorMessage(error, '请稍后重试'), showCancel: false });
      } finally { this.setData({ saving: false }); }
    }
  }
});
