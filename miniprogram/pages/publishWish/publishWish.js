// miniprogram/pages/publishWish/publishWish.js
const api = require('../../utils/api');

const MAX_WISH_IMAGES = 99;
const MAX_PICK_COUNT = 20;
const UPLOAD_CONCURRENCY = 3;

Page({
  data: {
    imageList: [],
    maxImages: MAX_WISH_IMAGES,
    splitByImage: false,
    title: '',
    content: '',
    submitting: false
  },

  chooseImage: function() {
    var remaining = MAX_WISH_IMAGES - this.data.imageList.length;
    if (remaining <= 0) {
      return wx.showToast({ title: '最多上传99张图片', icon: 'none' });
    }

    wx.chooseMedia({
      count: Math.min(MAX_PICK_COUNT, remaining),
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        var selected = (res.tempFiles || [])
          .map(function(file) { return file.tempFilePath; })
          .filter(Boolean);
        var imageList = this.data.imageList.concat(selected).slice(0, MAX_WISH_IMAGES);
        this.setData({ imageList: imageList });
      }
    });
  },

  removeImage: function(e) {
    var index = Number(e.currentTarget.dataset.index);
    var imageList = this.data.imageList.slice();
    imageList.splice(index, 1);
    this.setData({ imageList: imageList });
  },

  moveImageLeft: function(e) {
    this.moveImage(Number(e.currentTarget.dataset.index), -1);
  },

  moveImageRight: function(e) {
    this.moveImage(Number(e.currentTarget.dataset.index), 1);
  },

  moveImage: function(index, offset) {
    var target = index + offset;
    var imageList = this.data.imageList.slice();
    if (index < 0 || target < 0 || index >= imageList.length || target >= imageList.length) return;
    var temp = imageList[index];
    imageList[index] = imageList[target];
    imageList[target] = temp;
    this.setData({ imageList: imageList });
  },

  previewImage: function(e) {
    var index = Number(e.currentTarget.dataset.index || 0);
    var urls = this.data.imageList;
    if (urls.length > 0) {
      wx.previewImage({ current: urls[index] || urls[0], urls: urls });
    }
  },

  toggleSplitByImage: function(e) {
    this.setData({ splitByImage: !!e.detail.value });
  },

  inputTitle: function(e) { this.setData({ title: e.detail.value }); },
  inputDesc: function(e) { this.setData({ content: e.detail.value }); },

  submitWish: async function() {
    if (this.data.submitting) return;

    var imageList = this.data.imageList;
    var title = (this.data.title || '').trim();
    var content = (this.data.content || '').trim();

    if (imageList.length === 0) {
      return wx.showToast({ title: '请上传商品图片', icon: 'none' });
    }
    if (!title) {
      return wx.showToast({ title: '请输入商品名称', icon: 'none' });
    }
    if (!content) {
      return wx.showToast({ title: '请输入心愿正文', icon: 'none' });
    }
    if (this.data.splitByImage && imageList.length > 1) {
      var confirmed = await this.confirmSplitCreation(imageList.length);
      if (!confirmed) return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '准备上传...', mask: true });

    try {
      var imageUrls = await this.uploadImages(imageList);
      var payload = {
        images: imageUrls,
        title: title,
        content: content
      };

      wx.showLoading({ title: '创建心愿...', mask: true });
      if (this.data.splitByImage) {
        await api.post('/wishes/batch', payload);
      } else {
        await api.post('/wishes', Object.assign({ image: imageUrls[0] }, payload));
      }

      wx.hideLoading();
      wx.showToast({
        title: this.data.splitByImage ? '批量发布成功' : '发布成功',
        icon: 'success'
      });
      setTimeout(function() { wx.navigateBack({ delta: 1 }); }, 1000);
    } catch (err) {
      wx.hideLoading();
      console.error('发布心愿失败:', err);
      wx.showToast({ title: (err && err.message) || '发布失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  confirmSplitCreation: function(count) {
    return new Promise(function(resolve) {
      wx.showModal({
        title: '确认分别创建',
        content: '当前选择了' + count + '张图片，将创建' + count + '条心愿。确定继续吗？',
        confirmText: '确认创建',
        success: function(res) { resolve(!!res.confirm); },
        fail: function() { resolve(false); }
      });
    });
  },

  uploadImages: async function(imageList) {
    var urls = new Array(imageList.length);
    var nextIndex = 0;
    var completed = 0;
    var failure = null;

    async function worker() {
      while (!failure) {
        var index = nextIndex++;
        if (index >= imageList.length) return;
        try {
          var uploadRes = await api.uploadFile('/files/upload-wish', imageList[index]);
          if (!uploadRes || !uploadRes.url) {
            throw new Error('第' + (index + 1) + '张图片上传失败');
          }
          urls[index] = uploadRes.url;
          completed += 1;
          wx.showLoading({ title: '上传 ' + completed + '/' + imageList.length, mask: true });
        } catch (err) {
          failure = err instanceof Error
            ? err
            : new Error((err && err.message) || ('第' + (index + 1) + '张图片上传失败'));
        }
      }
    }

    var workerCount = Math.min(UPLOAD_CONCURRENCY, imageList.length);
    var workers = [];
    for (var i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);
    if (failure) throw failure;
    return urls;
  }
});
