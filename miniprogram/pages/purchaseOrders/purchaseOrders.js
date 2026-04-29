// miniprogram/pages/purchaseOrders/purchaseOrders.js
const api = require('../../utils/api');

Page({
  data: {
    status: 'ordered',
    orderList: [],
    displayList: [],
    loading: false,
    // 商品筛选
    keyword: '',
    // 全选功能
    allSelected: false,
    selectedCount: 0,
    selectMode: false,
    // 分页参数（本地分页）
    page: 0,
    pageSize: 20,
    hasMore: true
  },

  onLoad: function() {
    this.loadOrders();
  },

  // 触底加载更多
  onReachBottom: function() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadOrders(false);
  },

  // 切换状态
  setStatus: function(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ 
      status,
      keyword: '',  // 重置搜索关键词
      allSelected: false,
      selectedCount: 0,
      selectMode: false
    });
    this.loadOrders();  // 重置并重新加载
  },

  // 加载报单记录（分页）
  loadOrders: async function(reset = true) {
    if (reset) {
      this.setData({ page: 0, orderList: [], hasMore: true });
    }

    if (!this.data.hasMore || this.data.loading) return;

    this.setData({ loading: true });
    try {
      const { page, pageSize, status } = this.data;
      const res = await api.get(`/picking-list/orders?status=${status}&page=${page}&size=${pageSize}`);
      
      const orderList = (res.content || []).map(item => ({
        ...item,
        imageUrl: item.imageUrl || '',
        defaultImageUrl: item.defaultImageUrl || '/images/default-goods-image.png',
        createdAt: this.formatTime(item.createdAt),
        selected: false
      }));

      const hasMore = orderList.length === pageSize;

      this.setData({
        orderList: reset ? orderList : [...this.data.orderList, ...orderList],
        displayList: reset ? orderList : [...this.data.displayList, ...orderList],
        page: this.data.page + 1,
        hasMore: hasMore,
        loading: false
      });
    } catch (err) {
      console.error('加载报单记录失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 商品筛选
  onKeywordInput: function(e) {
    this.setData({ keyword: e.detail.value });
  },

  search: function() {
    const keyword = this.data.keyword.trim().toLowerCase();
    
    if (!keyword) {
      this.setData({ displayList: this.data.orderList });
      return;
    }

    const filtered = this.data.orderList.filter(item => {
      return (item.productName && item.productName.toLowerCase().includes(keyword)) ||
             (item.spec && item.spec.toLowerCase().includes(keyword)) ||
             (item.size && item.size.toLowerCase().includes(keyword));
    });

    this.setData({ displayList: filtered });
  },

  // 图片加载失败处理
  onImageError: function(e) {
    const index = e.currentTarget.dataset.index;
    // 图片加载失败时，使用默认图片
    console.log('图片加载失败，使用默认图片');
  },

  // 全选/取消全选
  toggleSelectAll: function() {
    const newAllSelected = !this.data.allSelected;
    
    this.data.displayList.forEach(item => {
      item.selected = newAllSelected;
    });
    
    const selectedCount = newAllSelected ? this.data.displayList.length : 0;
    
    this.setData({
      allSelected: newAllSelected,
      selectedCount: selectedCount,
      selectMode: selectedCount > 0,
      displayList: this.data.displayList
    });
  },

  // 切换选中状态
  toggleSelect: function(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.displayList[index];
    
    item.selected = !item.selected;
    
    // 重新计算选中数量
    const selectedCount = this.data.displayList.filter(i => i.selected).length;
    const allSelected = selectedCount > 0 && selectedCount === this.data.displayList.length;
    
    this.setData({
      allSelected: allSelected,
      selectedCount: selectedCount,
      selectMode: selectedCount > 0,
      displayList: this.data.displayList
    });
  },

  // 单个撤销
  cancelOrder: function(e) {
    const orderId = e.currentTarget.dataset.id;
    const index = e.currentTarget.dataset.index;

    wx.showModal({
      title: '确认撤销',
      content: '确定要撤销该报单记录吗？',
      confirmText: '确认',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '撤销中...' });

          try {
            await api.delete(`/picking-list/order/${orderId}`);

            wx.hideLoading();
            wx.showToast({ title: '撤销成功', icon: 'success' });

            // 重新加载列表，确保状态正确
            this.loadOrders();
          } catch (err) {
            wx.hideLoading();
            console.error('撤销失败:', err);
            wx.showToast({ title: err?.message || '撤销失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 批量撤销
  batchCancel: function() {
    if (this.data.selectedCount === 0) {
      wx.showToast({ title: '请选择要撤销的报单', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认批量撤销',
      content: `确定要撤销选中的 ${this.data.selectedCount} 个报单记录吗？`,
      confirmText: '确认',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '撤销中...' });

          try {
            // 批量撤销选中的报单
            const selectedItems = this.data.displayList.filter(i => i.selected);
            const promises = selectedItems.map(item =>
              api.delete(`/picking-list/order/${item.id}`)
            );

            await Promise.all(promises);

            wx.hideLoading();
            wx.showToast({ title: '批量撤销成功', icon: 'success' });

            // 重新加载列表
            this.loadOrders();
          } catch (err) {
            wx.hideLoading();
            console.error('批量撤销失败:', err);
            wx.showToast({ title: err?.message || '批量撤销失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 格式化时间
  formatTime: function(timeStr) {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
});
