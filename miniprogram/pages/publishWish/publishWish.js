// miniprogram/pages/publishWish/publishWish.js
const api = require('../../utils/api');

Page({
  data: {
    tempImagePath: '',
    title: '',
    content: '',
    expectedPrice: ''
  },

  // 选图
  chooseImage: function() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        this.setData({
          tempImagePath: res.tempFiles[0].tempFilePath
        });
      }
    });
  },

  // 表单双向绑定
  inputTitle: function(e) { this.setData({ title: e.detail.value }); },
  inputDesc: function(e) { this.setData({ content: e.detail.value }); },
  inputPrice: function(e) { this.setData({ expectedPrice: e.detail.value }); },

  // 改造：上传图片并创建心愿
  submitWish: async function() {
    const { tempImagePath, title, content, expectedPrice } = this.data;

    // 基础拦截
    if (!tempImagePath) {
      return wx.showToast({ title: '请上传商品图片', icon: 'none' });
    }
    if (!title.trim()) {
      return wx.showToast({ title: '请输入商品名称', icon: 'none' });
    }

    wx.showLoading({ title: '发布中...', mask: true });

    try {
      // 1. 上传图片到后端
      const uploadRes = await this.uploadImage(tempImagePath);
      const imageUrl = uploadRes.url;

      // 2. 创建心愿
      await api.post('/wishes', {
        image: imageUrl,
        content: title
      });

      wx.hideLoading();
      wx.showToast({ title: '发布成功!', icon: 'success' });

      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 1000);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '发布失败', icon: 'none' });
      console.error(err);
    }
  },

  // 上传图片到后端
  uploadImage: function(filePath) {
    const token = wx.getStorageSync('accessToken') || '';
    return new Promise((resolve, reject) => {
      wx.uploadFile({
        url: 'http://101.34.57.84:8080/api/v1/files/upload-wish',
        filePath: filePath,
        name: 'file',
        header: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Idempotency-Key': 'upload_' + Date.now()
        },
        success: (res) => {
          try {
            const data = JSON.parse(res.data);
            resolve(data);
          } catch (e) {
            reject(e);
          }
        },
        fail: (err) => {
          reject(err);
        }
      });
    });
  }
});
