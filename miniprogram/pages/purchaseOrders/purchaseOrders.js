// miniprogram/pages/purchaseOrders/purchaseOrders.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    status: 'ordered',
    batchList: [],
    loading: false,
    refreshing: false,
    keyword: '',
    appliedKeyword: '',
    page: 1,
    pageSize: 20,
    hasMore: true
  },

  onLoad: function() {
    this.loadBatches();
  },

  onListPullDownRefresh: async function() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    try {
      await this.loadBatches();
    } finally {
      this.setData({ refreshing: false });
    }
  },

  // 列表触底加载更多
  onListScrollToLower: function() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadBatches(false);
  },

  // 新一页渲染后若仍接近底部，继续加载，避免触底事件在上次加载期间被漏掉。
  checkLoadMoreAtBottom: function(requestId) {
    if (!this.data.hasMore || this.data.loading || !wx.createSelectorQuery) return;
    const query = wx.createSelectorQuery();
    query.select('.batch-list').boundingClientRect();
    query.select('.batch-scroll').boundingClientRect();
    query.exec(([listRect, scrollRect]) => {
      if (requestId !== this._batchRequestId || !this.data.hasMore || this.data.loading) return;
      if (listRect && scrollRect && listRect.bottom - scrollRect.bottom <= 200) {
        this.loadBatches(false);
      }
    });
  },

  // 切换状态
  setStatus: function(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.status) return;
    this.setData({
      status,
      keyword: '',
      appliedKeyword: ''
    });
    this.loadBatches();
  },

  // 按批次分页，展开时才获取该批次的商品明细。
  loadBatches: async function(reset = true, collapseAll = false) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const requestId = (this._batchRequestId || 0) + 1;
    this._batchRequestId = requestId;
    const expandedIds = reset
      ? (collapseAll ? [] : [...new Set([
          ...(this._preservedExpandedIds || []),
          ...this.data.batchList.filter(batch => batch.expanded).map(batch => String(batch.id))
        ])])
      : (this._preservedExpandedIds || []);
    if (reset) {
      this._preservedExpandedIds = expandedIds;
      this._detailGeneration = (this._detailGeneration || 0) + 1;
      this.setData({
        page: 1, batchList: [], hasMore: true
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
        displayTime: this.formatTime(item.createdAt),
        expanded: expandedIds.includes(String(item.id)),
        detailList: [],
        detailLoading: false,
        selectedCount: 0,
        allSelected: false
      }));
      const batchList = reset ? batches : [...this.data.batchList, ...batches];
      this.setData({
        batchList,
        page: page + 1,
        hasMore: res.hasNext !== undefined ? res.hasNext : batches.length === pageSize,
        loading: false
      }, () => this.checkLoadMoreAtBottom(requestId));
      batches.filter(batch => batch.expanded).forEach(batch => this.loadBatchDetails(batch.id));
    } catch (err) {
      if (requestId !== this._batchRequestId) return;
      console.error('加载报单批次失败:', err);
      wx.showToast({ title: '批次加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  toggleBatch: function(e) {
    const batchId = String(e.currentTarget.dataset.id);
    const batch = this.data.batchList.find(item => String(item.id) === batchId);
    if (!batch) return;
    this._preservedExpandedIds = batch.expanded
      ? (this._preservedExpandedIds || []).filter(id => id !== batchId)
      : [...new Set([...(this._preservedExpandedIds || []), batchId])];
    this.updateBatch(batchId, { expanded: !batch.expanded });
    if (!batch.expanded && !batch.detailList.length && !batch.detailLoading) {
      return this.loadBatchDetails(batchId);
    }
  },

  updateBatch: function(batchId, changes) {
    const batchList = this.data.batchList.map(batch => String(batch.id) === String(batchId)
      ? { ...batch, ...changes }
      : batch);
    this.setData({ batchList });
  },

  loadBatchDetails: async function(batchId) {
    const generation = this._detailGeneration || 0;
    this.updateBatch(batchId, { detailLoading: true });
    try {
      const { status, appliedKeyword } = this.data;
      const query = `status=${encodeURIComponent(status)}`
        + (appliedKeyword ? `&keyword=${encodeURIComponent(appliedKeyword)}` : '');
      const items = await api.get(
        `/picking-list/orders/batches/${encodeURIComponent(batchId)}/items?${query}`
      );
      if (generation !== (this._detailGeneration || 0)) return;
      this.updateBatch(batchId, {
        detailList: (items || []).map(item => ({
          ...item,
          imageUrl: item.imageUrl || '',
          defaultImageUrl: item.defaultImageUrl || '/images/default-goods-image.png',
          displayTime: this.formatTime(item.createdAt),
          selected: false
        })),
        detailLoading: false,
        selectedCount: 0,
        allSelected: false
      });
    } catch (err) {
      if (generation !== (this._detailGeneration || 0)) return;
      console.error('加载报单商品明细失败:', err);
      wx.showToast({ title: '明细加载失败', icon: 'none' });
      this.updateBatch(batchId, { detailLoading: false });
    }
  },

  onKeywordInput: function(e) {
    this.setData({ keyword: e.detail.value });
  },

  search: function() {
    this.setData({ appliedKeyword: this.data.keyword.trim() });
    return this.loadBatches(true, true);
  },

  onImageError: function(e) {
    const batchId = String(e.currentTarget.dataset.batchId);
    const index = e.currentTarget.dataset.index;
    const batch = this.data.batchList.find(item => String(item.id) === batchId);
    if (!batch || !batch.detailList[index]) return;
    const detailList = batch.detailList.map((item, itemIndex) => itemIndex === index
      ? { ...item, imageUrl: '/images/default-goods-image.png' }
      : item);
    this.updateBatch(batchId, { detailList });
  },

  // 全选/取消全选
  toggleSelectAll: function(e) {
    const batchId = String(e.currentTarget.dataset.batchId);
    const batch = this.data.batchList.find(item => String(item.id) === batchId);
    if (!batch) return;
    const newAllSelected = !batch.allSelected;
    const detailList = batch.detailList.map(item => ({
      ...item, selected: item.status === 'ordered' && newAllSelected
    }));
    const selectedCount = detailList.filter(item => item.selected).length;
    this.updateBatch(batchId, {
      allSelected: selectedCount > 0 && selectedCount === detailList.filter(item => item.status === 'ordered').length,
      selectedCount,
      detailList
    });
  },

  // 切换选中状态
  toggleSelect: function(e) {
    const batchId = String(e.currentTarget.dataset.batchId);
    const batch = this.data.batchList.find(item => String(item.id) === batchId);
    if (!batch) return;
    const index = e.currentTarget.dataset.index;
    const detailList = batch.detailList.map((item, itemIndex) => itemIndex === index
      ? { ...item, selected: !item.selected }
      : item);
    const selectedCount = detailList.filter(item => item.selected).length;
    const selectableCount = detailList.filter(item => item.status === 'ordered').length;
    this.updateBatch(batchId, {
      allSelected: selectedCount > 0 && selectedCount === selectableCount,
      selectedCount,
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
            this.loadBatches(true);
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
  batchCancel: function(e) {
    const batchId = String(e.currentTarget.dataset.batchId);
    const batch = this.data.batchList.find(item => String(item.id) === batchId);
    if (!batch || batch.selectedCount === 0) {
      wx.showToast({ title: '请选择要撤销的报单', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认批量撤销',
      content: `确定要撤销选中的 ${batch.selectedCount} 个报单记录吗？`,
      confirmText: '确认',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '撤销中...' });

          try {
            // 批量撤销选中的报单
            const selectedItems = batch.detailList.filter(i => i.selected);
            const promises = selectedItems.map(item =>
              api.delete(`/picking-list/order/${item.id}`)
            );

            await Promise.all(promises);

            wx.hideLoading();
            wx.showToast({ title: '批量撤销成功', icon: 'success' });

            // 重新加载列表
            this.loadBatches(true);
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
