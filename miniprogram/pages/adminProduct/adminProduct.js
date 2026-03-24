// miniprogram/pages/adminProduct/adminProduct.js
const api = require('../../utils/api');

Page({
  data: {
    products: [],
    isLoading: true
  },

  onShow: function() {
    this.loadProducts();
  },

  // 改造：从后端 API 加载商品列表
  loadProducts: async function() {
    this.setData({ isLoading: true });
    wx.showLoading({ title: '拉取商品中...' });

    try {
      const res = await api.get('/products', {
        limit: 100,
        offset: 0
      });

      let list = res.map(item => {
        if (item.createdAt) {
          const date = new Date(item.createdAt);
          item.createTimeStr = `${date.getMonth()+1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
        }
        return item;
      });

      this.setData({ products: list, isLoading: false });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '获取失败', icon: 'none' });
    }
  },

  // 改造：切换上下架状态
  toggleStatus: async function(e) {
    const id = e.currentTarget.dataset.id;
    const currentStatus = e.currentTarget.dataset.status;
    // 后端使用 on/off，前端状态需要转换
    const newStatus = currentStatus === 'off' ? 'on' : 'off';

    wx.showLoading({ title: '处理中...' });

    try {
      await api.patch(`/products/${id}/status`, { status: newStatus });
      wx.hideLoading();
      wx.showToast({
        title: newStatus === 'off' ? '已下架' : '已重新上架',
        icon: 'success'
      });
      this.loadProducts();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 改造：删除商品
  deleteProduct: async function(e) {
    const id = e.currentTarget.dataset.id;

    wx.showModal({
      title: '高危操作',
      content: '确定要彻底删除这件商品吗？删除后不可恢复！',
      confirmColor: '#f5222d',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            await api.delete(`/products/${id}`);
            wx.hideLoading();
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadProducts();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 编辑商品：跳转到 admin 页面并传入商品 ID
  editProduct: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/admin?editId=${id}`
    });
  }
});
