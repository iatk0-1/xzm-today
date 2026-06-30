// miniprogram/pages/adminProduct/adminProduct.js
const api = require('../../utils/api');

Page({
  data: {
    products: [],
    isLoading: false,  // 初始为 false，允许首次加载
    // 分页参数
    page: 0,
    pageSize: 20,
    hasMore: true,
    selectMode: false,
    selectedProductIds: [],
    selectedCount: 0,
    allSelected: false,
    batchOperating: false
  },

  onLoad: function() {
    this.loadProducts();
  },

  onShow: function() {
    // 页面显示时不自动刷新，避免重复加载
  },

  // 滚动到底部加载更多（scroll-view 使用）
  loadMore: function() {
    if (!this.data.hasMore || this.data.isLoading) return;
    this.loadProducts(false);
  },

  // 改造：从后端 API 加载商品列表（支持分页）
  loadProducts: async function(reset = true) {
    if (reset) {
      this.setData({
        page: 0,
        products: [],
        hasMore: true,
        selectMode: false,
        selectedProductIds: [],
        selectedCount: 0,
        allSelected: false
      });
    }

    if (!this.data.hasMore || this.data.isLoading) return;

    this.setData({ isLoading: true });

    if (reset) {
      wx.showLoading({ title: '拉取商品中...' });
    }

    try {
      const { page, pageSize } = this.data;

      const res = await api.get('/products', {
        page: page,
        size: pageSize
      });

      let list = (res.content || []).map(item => this.normalizeProduct(item));

      const hasMore = res.hasNext !== undefined ? res.hasNext : list.length === pageSize;
      const products = reset ? list : [...this.data.products, ...list];

      this.setData({
        products: this.applySelectionToProducts(products, this.data.selectedProductIds),
        page: this.data.page + 1,
        hasMore: hasMore,
        isLoading: false
      });

      if (reset) {
        wx.hideLoading();
      }
    } catch (err) {
      if (reset) {
        wx.hideLoading();
      }
      wx.showToast({ title: '获取失败', icon: 'none' });
      this.setData({ isLoading: false });
    }
  },

  normalizeProduct: function(item) {
    if (item.createdAt) {
      const date = new Date(item.createdAt);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      item.createTimeStr = `${month}-${day} ${hour}:${minute}`;
    }
    item.selected = false;
    return item;
  },

  normalizeId: function(id) {
    return String(id);
  },

  applySelectionToProducts: function(products, selectedProductIds) {
    const selectedMap = {};
    selectedProductIds.forEach(id => {
      selectedMap[this.normalizeId(id)] = true;
    });
    return products.map(item => ({
      ...item,
      selected: !!selectedMap[this.normalizeId(item.id)]
    }));
  },

  refreshSelectionState: function(products = this.data.products, selectedProductIds = this.data.selectedProductIds) {
    const selectedMap = {};
    selectedProductIds.forEach(id => {
      selectedMap[this.normalizeId(id)] = true;
    });
    const selectedInCurrentList = products.filter(item => selectedMap[this.normalizeId(item.id)]).length;
    this.setData({
      products: this.applySelectionToProducts(products, selectedProductIds),
      selectedProductIds,
      selectedCount: selectedProductIds.length,
      allSelected: products.length > 0 && selectedInCurrentList === products.length
    });
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

  toggleSelectMode: function() {
    if (this.data.selectMode) {
      this.clearSelection();
      this.setData({ selectMode: false });
      return;
    }
    this.setData({ selectMode: true });
  },

  clearSelection: function() {
    this.refreshSelectionState(this.data.products, []);
  },

  handleProductTap: function(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.selectMode) {
      this.toggleProductId(id);
      return;
    }
    this.openProductEditor(id);
  },

  toggleProductSelect: function(e) {
    const id = e.currentTarget.dataset.id;
    this.toggleProductId(id);
  },

  toggleProductId: function(id) {
    const normalizedId = this.normalizeId(id);
    const selectedProductIds = this.data.selectedProductIds.slice();
    const currentIndex = selectedProductIds.indexOf(normalizedId);
    if (currentIndex >= 0) {
      selectedProductIds.splice(currentIndex, 1);
    } else {
      selectedProductIds.push(normalizedId);
    }
    this.refreshSelectionState(this.data.products, selectedProductIds);
  },

  toggleSelectAllLoaded: function() {
    if (this.data.products.length === 0) {
      wx.showToast({ title: '暂无商品可选择', icon: 'none' });
      return;
    }

    const visibleIds = this.data.products.map(item => this.normalizeId(item.id));
    let selectedProductIds;
    if (this.data.allSelected) {
      selectedProductIds = this.data.selectedProductIds.filter(id => !visibleIds.includes(this.normalizeId(id)));
    } else {
      selectedProductIds = this.data.selectedProductIds.slice();
      visibleIds.forEach(id => {
        if (!selectedProductIds.includes(id)) {
          selectedProductIds.push(id);
        }
      });
    }
    this.refreshSelectionState(this.data.products, selectedProductIds);
  },

  batchSetStatus: function(e) {
    const status = e.currentTarget.dataset.status;
    const selectedCount = this.data.selectedCount;
    if (selectedCount === 0) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }
    if (this.data.batchOperating) return;

    const actionText = status === 'on' ? '上架' : '下架';
    wx.showModal({
      title: `批量${actionText}`,
      content: `确认将选中的 ${selectedCount} 个商品${actionText}？`,
      confirmText: actionText,
      confirmColor: status === 'on' ? '#1f2933' : '#d32f2f',
      success: async (res) => {
        if (!res.confirm) return;

        this.setData({ batchOperating: true });
        wx.showLoading({ title: '处理中...' });

        try {
          const productIds = this.data.selectedProductIds.slice();
          const result = await api.patch('/products/status/batch', {
            productIds,
            status
          });

          const selectedMap = {};
          productIds.forEach(id => {
            selectedMap[this.normalizeId(id)] = true;
          });
          const products = this.data.products.map(item => ({
            ...item,
            status: selectedMap[this.normalizeId(item.id)] ? status : item.status,
            selected: false
          }));

          wx.hideLoading();
          this.setData({
            products,
            selectMode: false,
            selectedProductIds: [],
            selectedCount: 0,
            allSelected: false,
            batchOperating: false
          });

          const updatedCount = result && result.updatedCount !== undefined ? result.updatedCount : selectedCount;
          const skippedCount = result && result.skippedCount ? result.skippedCount : 0;
          wx.showToast({
            title: skippedCount > 0 ? `成功${updatedCount} 跳过${skippedCount}` : `已${actionText}${updatedCount}个`,
            icon: 'success'
          });
        } catch (err) {
          wx.hideLoading();
          this.setData({ batchOperating: false });
          wx.showToast({ title: err?.message || '批量操作失败', icon: 'none' });
        }
      }
    });
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
    this.openProductEditor(id);
  },

  openProductEditor: function(id) {
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
