// miniprogram/pages/purchaseOrders/purchaseOrders.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    status: 'ordered',
    batchList: [],
    activeBatchId: '',
    detailList: [],
    detailLoading: false,
    loading: false,
    keyword: '',
    appliedKeyword: '',
    allSelected: false,
    selectedCount: 0,
    selectMode: false,
    page: 1,
    pageSize: 20,
    hasMore: true
  },

  onLoad: function() {
    this.loadBatches();
  },

  // 触底加载更多
  onReachBottom: function() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadBatches(false);
  },

  // 切换状态
  setStatus: function(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.status) return;
    this.setData({
      status,
      keyword: '',
      appliedKeyword: '',
      activeBatchId: '',
      detailList: [],
      allSelected: false,
      selectedCount: 0,
      selectMode: false
    });
    this.loadBatches();
  },

  // 按批次分页，展开时才获取该批次的商品明细。
  loadBatches: async function(reset = true, reopenId = '') {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const requestId = (this._batchRequestId || 0) + 1;
    this._batchRequestId = requestId;
    if (reset) {
      this._detailRequestId = (this._detailRequestId || 0) + 1;
      this.setData({
        page: 1, batchList: [], hasMore: true,
        activeBatchId: '', detailList: [], detailLoading: false,
        allSelected: false, selectedCount: 0, selectMode: false
      });
    }

    this.setData({ loading: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const { page, pageSize, status, appliedKeyword } = this.data;
      const query = `status=${encodeURIComponent(status)}&page=${page}&size=${pageSize}`
        + (appliedKeyword ? `&keyword=${encodeURIComponent(appliedKeyword)}` : '');
      const res = await api.get(`/picking-list/orders/batches/query?${query}`);
      if (requestId !== this._batchRequestId) return;

      const batches = (res.content || []).map(item => ({
        ...item,
        displayCode: String(item.id).slice(-6),
        displayTime: this.formatTime(item.createdAt)
      }));
      const batchList = reset ? batches : [...this.data.batchList, ...batches];
      this.setData({
        batchList,
        page: page + 1,
        hasMore: res.hasNext !== undefined ? res.hasNext : batches.length === pageSize,
        loading: false
      });
      if (reopenId && batchList.some(batch => String(batch.id) === String(reopenId))) {
        this.openBatch(reopenId);
      }
    } catch (err) {
      if (requestId !== this._batchRequestId) return;
      console.error('加载报单批次失败:', err);
      wx.showToast({ title: '批次加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  toggleBatch: function(e) {
    const batchId = String(e.currentTarget.dataset.id);
    if (this.data.activeBatchId === batchId) {
      this._detailRequestId = (this._detailRequestId || 0) + 1;
      this.setData({
        activeBatchId: '', detailList: [], detailLoading: false,
        allSelected: false, selectedCount: 0, selectMode: false
      });
      return;
    }
    this.openBatch(batchId);
  },

  openBatch: async function(batchId) {
    const requestId = (this._detailRequestId || 0) + 1;
    this._detailRequestId = requestId;
    this.setData({
      activeBatchId: String(batchId), detailList: [], detailLoading: true,
      allSelected: false, selectedCount: 0, selectMode: false
    });
    try {
      const { status, appliedKeyword } = this.data;
      const query = `status=${encodeURIComponent(status)}`
        + (appliedKeyword ? `&keyword=${encodeURIComponent(appliedKeyword)}` : '');
      const items = await api.get(
        `/picking-list/orders/batches/${encodeURIComponent(batchId)}/items?${query}`
      );
      if (requestId !== this._detailRequestId) return;
      this.setData({
        detailList: (items || []).map(item => ({
          ...item,
          imageUrl: item.imageUrl || '',
          defaultImageUrl: item.defaultImageUrl || '/images/default-goods-image.png',
          displayTime: this.formatTime(item.createdAt),
          selected: false
        })),
        detailLoading: false
      });
    } catch (err) {
      if (requestId !== this._detailRequestId) return;
      console.error('加载报单商品明细失败:', err);
      wx.showToast({ title: '明细加载失败', icon: 'none' });
      this.setData({ detailLoading: false });
    }
  },

  onKeywordInput: function(e) {
    this.setData({ keyword: e.detail.value });
  },

  search: function() {
    this.setData({ appliedKeyword: this.data.keyword.trim() });
    this.loadBatches(true);
  },

  onImageError: function(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ [`detailList[${index}].imageUrl`]: '/images/default-goods-image.png' });
  },

  // 全选/取消全选
  toggleSelectAll: function() {
    const newAllSelected = !this.data.allSelected;
    const detailList = this.data.detailList.map(item => ({
      ...item, selected: item.status === 'ordered' && newAllSelected
    }));
    const selectedCount = detailList.filter(item => item.selected).length;
    this.setData({
      allSelected: selectedCount > 0 && selectedCount === detailList.filter(item => item.status === 'ordered').length,
      selectedCount,
      selectMode: selectedCount > 0,
      detailList
    });
  },

  // 切换选中状态
  toggleSelect: function(e) {
    const index = e.currentTarget.dataset.index;
    const detailList = this.data.detailList.map((item, itemIndex) => itemIndex === index
      ? { ...item, selected: !item.selected }
      : item);
    const selectedCount = detailList.filter(item => item.selected).length;
    const selectableCount = detailList.filter(item => item.status === 'ordered').length;
    this.setData({
      allSelected: selectedCount > 0 && selectedCount === selectableCount,
      selectedCount,
      selectMode: selectedCount > 0,
      detailList
    });
  },

  // 单个撤销
  cancelOrder: function(e) {
    const orderId = e.currentTarget.dataset.id;

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
            this.loadBatches(true, this.data.activeBatchId);
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
            const selectedItems = this.data.detailList.filter(i => i.selected);
            const promises = selectedItems.map(item =>
              api.delete(`/picking-list/order/${item.id}`)
            );

            await Promise.all(promises);

            wx.hideLoading();
            wx.showToast({ title: '批量撤销成功', icon: 'success' });

            // 重新加载列表
            this.loadBatches(true, this.data.activeBatchId);
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
