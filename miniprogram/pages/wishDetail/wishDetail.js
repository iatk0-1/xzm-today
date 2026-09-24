// miniprogram/pages/wishDetail/wishDetail.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { createShareImage } = require('../../utils/shareImage');

Page({
  data: {
    wish: { images: [] },
    wishId: null,
    canDelete: false,
    createdAtDisplay: '',
    shareImages: {
      single: '',
      double: '',
      triple: ''
    },
    shareImageCount: 0,
    shareTemplatesReady: false,
    showShareTemplates: false,
    canShowShareFloat: false,
    shareFloatLeft: 0,
    shareFloatTop: 0
  },

  onLoad: function(options) {
    var sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.initShareFloatPosition(sysInfo);
    this.refreshShareFloatVisibility();
    if (options.id) {
      this.setData({ wishId: options.id });
      this.loadWishDetail();
    } else {
      wx.showToast({ title: '心愿数据丢失', icon: 'none' });
      setTimeout(function() { wx.navigateBack(); }, 1500);
    }
  },

  onShow: function() {
    this.refreshShareFloatVisibility();
    if (this.data.wishId) {
      this.loadWishDetail();
    }
  },

  // 加载心愿详情
  loadWishDetail: async function() {
    wx.showLoading({ title: '加载中...' });
    try {
      var res = await api.get('/wishes/' + this.data.wishId);
      wx.hideLoading();

      var createdAtDisplay = '';
      if (res.createdAt) {
        createdAtDisplay = this.formatTime(res.createdAt);
      }

      var images = Array.isArray(res.images) && res.images.length > 0
        ? res.images
        : (res.image ? [res.image] : []);
      var wish = Object.assign({}, res, {
        images: images,
        image: res.image || images[0] || '',
        title: res.title || res.content || ''
      });

      this.setData({
        wish: wish,
        createdAtDisplay: createdAtDisplay,
        shareImages: { single: '', double: '', triple: '' },
        shareImageCount: 0,
        shareTemplatesReady: false,
        canShowShareFloat: auth.isAdmin() === true
      });

      this.prepareShareImages(images);

      // 检查删除权限：管理员 或 心愿创建者
      this.checkDeletePermission(wish);
    } catch (err) {
      wx.hideLoading();
      console.error('加载心愿详情失败:', err);
      wx.showModal({
        title: '提示',
        content: '找不到该心愿',
        showCancel: false,
        success: function() { wx.navigateBack(); }
      });
    }
  },

  refreshShareFloatVisibility: function() {
    this.setData({ canShowShareFloat: auth.isAdmin() === true });
  },

  initShareFloatPosition: function(sysInfo) {
    var windowWidth = sysInfo.windowWidth || 375;
    var windowHeight = sysInfo.windowHeight || 667;
    var menuRect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    var floatSize = 58;
    var top = menuRect ? menuRect.bottom + 12 : (sysInfo.statusBarHeight || 20) + 44 + 12;
    this._shareWindow = { width: windowWidth, height: windowHeight };
    this.setData({
      shareFloatLeft: Math.max(0, windowWidth - floatSize - 18),
      shareFloatTop: Math.max(0, Math.min(windowHeight - floatSize, top))
    });
  },

  startShareFloatDrag: function(e) {
    var touch = e.touches && e.touches[0];
    if (!touch) return;
    this._shareFloatDrag = {
      startX: touch.clientX,
      startY: touch.clientY,
      left: this.data.shareFloatLeft,
      top: this.data.shareFloatTop,
      moved: false
    };
  },

  moveShareFloat: function(e) {
    var drag = this._shareFloatDrag;
    var touch = e.touches && e.touches[0];
    if (!drag || !touch) return;

    var deltaX = touch.clientX - drag.startX;
    var deltaY = touch.clientY - drag.startY;
    if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) drag.moved = true;

    var windowInfo = this._shareWindow || { width: 375, height: 667 };
    var size = 58;
    var left = Math.max(0, Math.min(windowInfo.width - size, drag.left + deltaX));
    var top = Math.max(0, Math.min(windowInfo.height - size, drag.top + deltaY));
    this.setData({ shareFloatLeft: left, shareFloatTop: top });
  },

  endShareFloatDrag: function() {
    var drag = this._shareFloatDrag;
    this._shareFloatDrag = null;
    if (drag && !drag.moved) {
      this.openShareTemplateSelector();
    }
  },

  prepareShareImages: function(images) {
    var shareSources = (images || []).filter(function(image) { return image; }).slice(0, 3);
    var tasks = [{ key: 'single', sources: shareSources.slice(0, 1), canvasId: 'wishDetailShareCanvasSingle' }];
    if (shareSources.length >= 2) {
      tasks.push({ key: 'double', sources: shareSources.slice(0, 2), canvasId: 'wishDetailShareCanvasDouble' });
    }
    if (shareSources.length >= 3) {
      tasks.push({ key: 'triple', sources: shareSources.slice(0, 3), canvasId: 'wishDetailShareCanvasTriple' });
    }

    this.setData({
      shareImageCount: shareSources.length,
      shareTemplatesReady: false
    });

    var page = this;
    tasks.reduce(function(sequence, task) {
      return sequence.then(function() {
        return createShareImage(page, task.sources, task.canvasId).then(function(filePath) {
          if (filePath) {
            var update = {};
            update['shareImages.' + task.key] = filePath;
            page.setData(update);
          }
        });
      });
    }, Promise.resolve()).then(function() {
      page.setData({ shareTemplatesReady: true });
    });
  },

  openShareTemplateSelector: function() {
    if (!this.data.canShowShareFloat) return;
    if (this.data.shareImageCount === 0) {
      wx.showToast({ title: '分享图片还在加载，请稍后再试', icon: 'none' });
      return;
    }
    if (!this.data.shareTemplatesReady) {
      wx.showToast({ title: '分享模板还在生成，请稍后再试', icon: 'none' });
      return;
    }
    this.setData({ showShareTemplates: true });
  },

  closeShareTemplateSelector: function() {
    this.setData({ showShareTemplates: false });
  },

  stopShareTemplateTap: function() {},

  getShareTemplate: function(res) {
    var template = res && res.target && res.target.dataset && res.target.dataset.template;
    if (template) return template;
    if (this.data.shareImageCount >= 3) return 'triple';
    if (this.data.shareImageCount === 2) return 'double';
    return 'single';
  },

  // 检查当前用户是否可以删除
  checkDeletePermission: function(wish) {
    var userInfo = auth.getUserInfo();
    if (!userInfo) {
      this.setData({ canDelete: false });
      return;
    }
    var isAdmin = userInfo.role === 'admin';
    // createdBy 存储的是 userId 的字符串形式
    var isCreator = wish.createdBy && String(userInfo.userId) === String(wish.createdBy);
    this.setData({ canDelete: isAdmin || isCreator });
  },

  // 点赞/取消点赞
  handleLike: async function() {
    var wish = this.data.wish;
    var wishId = this.data.wishId;
    if (!wishId) return;

    try {
      await auth.ensureAuthenticated({ silent: true });
    } catch (err) {
      wx.showToast({ title: '登录状态恢复失败，请稍后重试', icon: 'none' });
      return;
    }

    var originalLiked = wish.isLiked;
    var originalLikes = wish.likes || 0;

    // 乐观更新
    wish.isLiked = !wish.isLiked;
    wish.likes = wish.isLiked ? originalLikes + 1 : Math.max(0, originalLikes - 1);
    this.setData({ wish: wish });

    try {
      if (wish.isLiked) {
        await api.post('/wishes/' + wishId + '/like');
      } else {
        await api.post('/wishes/' + wishId + '/unlike');
      }
    } catch (err) {
      // 回滚
      wish.isLiked = originalLiked;
      wish.likes = originalLikes;
      this.setData({ wish: wish });
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 删除心愿
  deleteWish: function() {
    var self = this;
    wx.showModal({
      title: '确认删除',
      content: '这条心愿将被彻底清理，确定删除吗？',
      confirmColor: '#d32f2f',
      success: async function(res) {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            await auth.ensureAuthenticated({ silent: true });
            await api.delete('/wishes/' + self.data.wishId);
            wx.hideLoading();
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(function() { wx.navigateBack(); }, 1200);
          } catch (err) {
            wx.hideLoading();
            var msg = '删除失败';
            if (err && err.message) msg = err.message;
            wx.showToast({ title: msg, icon: 'none' });
          }
        }
      }
    });
  },

  // 跳转到关联商品
  goToProduct: function() {
    var productId = this.data.wish.linkedProductId;
    if (productId) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + productId });
    }
  },

  // 图片全屏预览
  previewImage: function(e) {
    var images = this.data.wish.images || [];
    var index = e && e.currentTarget ? Number(e.currentTarget.dataset.index || 0) : 0;
    if (images.length > 0) {
      wx.previewImage({ urls: images, current: images[index] || images[0] });
    }
  },

  onShareAppMessage: function(res) {
    var wish = this.data.wish || {};
    var id = this.data.wishId;
    var template = this.getShareTemplate(res);
    this.setData({ showShareTemplates: false });
    return {
      title: wish.title || wish.content || '心愿详情',
      path: id ? '/pages/wishDetail/wishDetail?id=' + id : '/pages/market/market',
      imageUrl: this.data.shareImages[template] || wish.image || (wish.images && wish.images[0]) || ''
    };
  },

  onShareTimeline: function() {
    var wish = this.data.wish || {};
    var id = this.data.wishId;
    var template = this.getShareTemplate();
    return {
      title: wish.title || wish.content || '心愿详情',
      query: id ? 'id=' + id : '',
      imageUrl: this.data.shareImages[template] || wish.image || (wish.images && wish.images[0]) || ''
    };
  },

  // 格式化时间
  formatTime: function(raw) {
    if (!raw) return '';
    try {
      var d;
      if (typeof raw === 'number') {
        d = new Date(raw < 1e10 ? raw * 1000 : raw);
      } else if (raw instanceof Array) {
        d = new Date(raw[0], raw[1] - 1, raw[2], raw[3] || 0, raw[4] || 0, raw[5] || 0);
      } else {
        d = new Date(String(raw));
      }
      if (isNaN(d.getTime())) return String(raw);
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    } catch (e) {
      return String(raw);
    }
  },

});
