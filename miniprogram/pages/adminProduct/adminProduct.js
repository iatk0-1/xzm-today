// miniprogram/pages/adminProduct/adminProduct.js
const api = require('../../utils/api');

Page({
  data: {
    products: [],
    isLoading: false,  // 初始为 false，允许首次加载
    // 分页参数
    page: 0,
    pageSize: 20,
    hasMore: true
  },

  onLoad: function() {
    this.loadProducts();
  },

  onShow: function() {
    // 页面显示时不自动刷新，避免重复加载
  },

  // 滚动到底部加载更多（scroll-view 使用）
  loadMore: function() {
    console.log('[分页] scrolltolower triggered');
    if (!this.data.hasMore || this.data.isLoading) return;
    this.loadProducts(false);
  },

  // 改造：从后端 API 加载商品列表（支持分页）
  loadProducts: async function(reset = true) {
    console.log('[分页] loadProducts called, reset:', reset, 'page:', this.data.page, 'hasMore:', this.data.hasMore, 'isLoading:', this.data.isLoading);
    
    if (reset) {
      this.setData({ page: 0, products: [], hasMore: true });
    }

    if (!this.data.hasMore || this.data.isLoading) {
      console.log('[分页] 跳过加载：hasMore=', this.data.hasMore, 'isLoading=', this.data.isLoading);
      return;
    }

    this.setData({ isLoading: true });
    
    if (reset) {
      wx.showLoading({ title: '拉取商品中...' });
    }

    try {
      const { page, pageSize } = this.data;
      console.log('[分页] 请求参数：page=', page, 'pageSize=', pageSize, 'offset=', page * pageSize);
      
      const res = await api.get('/products', {
        page: page,
        size: pageSize
      });

      let list = (res.content || []).map(item => {
        if (item.createdAt) {
          const date = new Date(item.createdAt);
          item.createTimeStr = `${date.getMonth()+1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
        }
        return item;
      });
      
      console.log('[分页] 返回数据数量：', list.length);

      const hasMore = res.hasNext !== undefined ? res.hasNext : list.length === pageSize;
      console.log('[分页] hasMore:', hasMore, 'res.hasNext:', res.hasNext);

      this.setData({
        products: reset ? list : [...this.data.products, ...list],
        page: this.data.page + 1,
        hasMore: hasMore,
        isLoading: false
      });
      
      if (reset) {
        wx.hideLoading();
      }
      
      console.log('[分页] 加载完成，当前 page:', this.data.page, 'products 长度:', this.data.products.length);
    } catch (err) {
      if (reset) {
        wx.hideLoading();
      }
      console.error('[分页] 获取失败:', err);
      wx.showToast({ title: '获取失败', icon: 'none' });
      this.setData({ isLoading: false });
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
  },

  // 跳转到回收站
  goToRecycleBin: function() {
    wx.navigateTo({
      url: '/pages/adminProductRecycleBin/adminProductRecycleBin'
    });
  }
});
