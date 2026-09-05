// miniprogram/pages/wishDetail/wishDetail.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    wish: { images: [] },
    wishId: null,
    canDelete: false,
    createdAtDisplay: ''
  },

  onLoad: function(options) {
    if (options.id) {
      this.setData({ wishId: options.id });
      this.loadWishDetail();
    } else {
      wx.showToast({ title: '心愿数据丢失', icon: 'none' });
      setTimeout(function() { wx.navigateBack(); }, 1500);
    }
  },

  onShow: function() {
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
        createdAtDisplay: createdAtDisplay
      });

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
