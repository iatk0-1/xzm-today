// miniprogram/pages/pickingList/pickingList.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    filterStatus: 'pending', // 'pending', 'ordered', 'all'
    recommendList: [],
    loading: false,
    selectedCount: 0,
    totalQty: 0,
    allSelected: false,
    // SKU 筛选
    skuKeyword: '',
    stallList: [],
    tagList: [],
    selectedStall: '',
    selectedTag: '',
    filteredList: [],
    // 分页
    page: 1,
    size: 20,
    hasMore: true,
    // 报单详情弹窗
    showOrderModal: false,
    orderPreviewList: [],
    showRefundModal: false,
    refundSku: null,
    refundOrders: [],
    refundLoading: false,
    refundBusy: false
  },

  onLoad: function() {
    this.loadFilterOptions();
    this.loadRecommendations();
  },

  onShow: function() {
    if (this.hasLoaded && !this.data.showRefundModal) this.loadRecommendations();
    this.hasLoaded = true;
  },

  goToRelatedOrders: function(e) {
    const item = this.data.recommendList[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    wx.navigateTo({
      url: `/pages/adminOrderManage/adminOrderManage?skuId=${item.skuId}&pickingStatus=${this.data.filterStatus}&productName=${encodeURIComponent(item.productName || '')}`
    });
  },

  previewProductImage: function(e) {
    const item = this.data.recommendList[Number(e.currentTarget.dataset.index)];
    const url = item && (item.imageUrl || item.defaultImageUrl);
    if (!url || url.startsWith('/images/')) {
      wx.showToast({ title: '暂无可预览图片', icon: 'none' });
      return;
    }
    wx.previewImage({ current: url, urls: [url] });
  },

  async openRefundModal(e) {
    const item = this.data.recommendList[Number(e.currentTarget.dataset.index)];
    if (!item || Number(item.recommendQty) <= 0) return;
    this.setData({ showRefundModal: true, refundSku: item, refundOrders: [], refundLoading: true });
    try {
      const orders = await this.fetchAllRelatedOrders(item.skuId);
      this.setData({ refundOrders: orders, refundLoading: false });
    } catch (err) {
      this.setData({ refundLoading: false, showRefundModal: false });
      wx.showModal({ title: '加载失败', content: err.message || '关联订单加载失败', showCancel: false });
    }
  },

  async fetchAllRelatedOrders(skuId) {
    const orders = [];
    let page = 1;
    while (true) {
      const res = await api.get(`/picking-list/skus/${skuId}/orders/query`, {
        status: 'pending', page, size: 100
      });
      orders.push(...(res.content || []).map(entry => ({
        ...entry,
        id: entry.order.id,
        relatedGoods: (entry.relatedItems || []).map(related => {
          const goods = (entry.order.items || []).find(item => String(item.id) === String(related.orderItemId));
          return { ...goods, orderItemId: related.orderItemId, pendingQty: related.pendingQty };
        })
      })));
      if (!res.hasNext) break;
      page += 1;
    }
    return orders;
  },

  closeRefundModal: function() {
    if (this.data.refundBusy) return;
    this.setData({ showRefundModal: false, refundSku: null, refundOrders: [] });
  },

  confirmRefund: function(title, content) {
    return new Promise(resolve => wx.showModal({
      title, content, confirmText: '确认退款', confirmColor: '#d93026',
      success: res => resolve(Boolean(res.confirm)), fail: () => resolve(false)
    }));
  },

  async refundOneOrder(entry) {
    const orderId = entry.order.id;
    const preview = await api.get(`/admin/orders-manage/orders/${orderId}/refund-preview`);
    const availableById = new Map((preview.items || []).map(item => [String(item.orderItemId), item]));
    let remainingAmount = Math.round(Number(preview.availableRefundAmount || 0) * 100);
    const items = [];
    for (const related of entry.relatedItems || []) {
      if (related.pendingQty <= 0) continue;
      const available = availableById.get(String(related.orderItemId));
      if (!available || Number(available.availableQty) < related.pendingQty) {
        throw new Error(`订单 ${entry.order.outTradeNo || orderId} 可退数量不足，请刷新后重试`);
      }
      const amount = Math.min(
        Math.round(Number(available.salePrice) * related.pendingQty * 100),
        Math.round(Number(available.availableRefundAmount) * 100),
        remainingAmount
      );
      if (amount <= 0) throw new Error(`订单 ${entry.order.outTradeNo || orderId} 可退金额不足`);
      items.push({ orderItemId: related.orderItemId, qty: related.pendingQty,
        refundAmount: (amount / 100).toFixed(2) });
      remainingAmount -= amount;
    }
    if (!items.length) throw new Error('当前订单没有可退的待报商品');
    return api.post(`/admin/orders-manage/orders/${orderId}/refunds`, {
      reason: '拣货单待报商品退款',
      note: `SKU ${this.data.refundSku.skuId} 待报数量退款`,
      items
    });
  },

  async refundRelatedOrder(e) {
    if (this.data.refundBusy) return;
    const entry = this.data.refundOrders[Number(e.currentTarget.dataset.index)];
    if (!entry) return;
    const confirmed = await this.confirmRefund('确认退款',
      `订单 ${entry.order.outTradeNo || entry.order.id} 的待报商品共 ${entry.pendingQty} 件，确认退款？`);
    if (!confirmed) return;
    this.setData({ refundBusy: true });
    try {
      const freshOrders = await this.fetchAllRelatedOrders(this.data.refundSku.skuId);
      const freshEntry = freshOrders.find(item => String(item.id) === String(entry.id));
      if (!freshEntry) throw new Error('这笔订单已无待报数量，请刷新后再看');
      await this.executeRefunds(this.limitRefundEntries([freshEntry], Number(this.data.refundSku.recommendQty)), true);
    } catch (err) {
      wx.showModal({ title: '退款未完成', content: err.message || '刷新关联订单失败', showCancel: false });
    } finally {
      this.setData({ refundBusy: false });
    }
  },

  limitRefundEntries: function(entries, maxQty) {
    let remaining = Math.max(0, Math.floor(maxQty));
    return entries.map(entry => {
      const relatedItems = (entry.relatedItems || []).map(item => {
        const pendingQty = Math.min(remaining, Number(item.pendingQty || 0));
        remaining -= pendingQty;
        return { ...item, pendingQty };
      }).filter(item => item.pendingQty > 0);
      return { ...entry, relatedItems,
        pendingQty: relatedItems.reduce((sum, item) => sum + item.pendingQty, 0) };
    }).filter(entry => entry.pendingQty > 0);
  },

  async refundAllPending() {
    if (this.data.refundBusy || this.data.refundLoading) return;
    const sku = this.data.refundSku;
    if (!sku) return;
    const total = this.data.refundOrders.reduce((sum, entry) => sum + Number(entry.pendingQty || 0), 0);
    if (total <= 0) return;
    const confirmed = await this.confirmRefund('全部退款',
      `将 ${sku.productName} 的待报 ${total} 件按关联订单逐笔退款，确认继续？`);
    if (!confirmed) return;
    this.setData({ refundBusy: true });
    try {
      const freshOrders = await this.fetchAllRelatedOrders(sku.skuId);
      const limited = this.limitRefundEntries(freshOrders, Number(sku.recommendQty));
      if (!limited.length) throw new Error('当前已无待报数量，请刷新后再看');
      await this.executeRefunds(limited, true);
    } catch (err) {
      wx.showModal({ title: '退款未完成', content: err.message || '刷新关联订单失败', showCancel: false });
    } finally {
      this.setData({ refundBusy: false });
    }
  },

  async executeRefunds(entries, alreadyBusy = false) {
    if (!alreadyBusy) this.setData({ refundBusy: true });
    const requested = entries.reduce((sum, entry) => sum + Number(entry.pendingQty || 0), 0);
    let completed = 0;
    let message = '';
    try {
      for (const entry of entries) {
        const result = await this.refundOneOrder(entry);
        if (result.status === 'success') {
          completed += Number(entry.pendingQty || 0);
        } else if (result.status === 'processing') {
          message = '微信正在处理一笔退款，已暂停后续订单，请稍后刷新确认';
          break;
        } else {
          message = result.errorMessage || '微信退款失败，已暂停后续订单';
          break;
        }
      }
    } catch (err) {
      message = err.message || '退款失败，已暂停后续订单';
    } finally {
      this.setData({ refundBusy: false, showRefundModal: false, refundOrders: [], refundSku: null });
      await this.loadRecommendations();
    }
    if (message) wx.showModal({ title: '退款未完成', content: `已成功退 ${completed} 件，剩余 ${Math.max(requested - completed, 0)} 件。${message}`, showCancel: false });
    else wx.showToast({ title: `已退 ${completed} 件`, icon: 'success' });
  },

  // 加载档口和标签筛选项
  loadFilterOptions: async function() {
    try {
      const [stalls, tags] = await Promise.all([
        api.get('/stalls/all'),
        api.get('/tags/all')
      ]);
      this.setData({
        stallList: Array.isArray(stalls) ? stalls : [],
        tagList: Array.isArray(tags) ? tags : []
      });
    } catch (err) {
      console.error('加载档口和标签失败:', err);
      this.setData({ stallList: [], tagList: [] });
    }
  },

  getQueryParams: function() {
    const params = {
      status: this.data.filterStatus,
      keyword: this.data.skuKeyword.trim(),
      page: this.data.page,
      size: this.data.size
    };
    if (this.data.selectedStall) params.stallId = this.data.selectedStall;
    if (this.data.selectedTag) params.tagId = this.data.selectedTag;
    return params;
  },

  // 跳转到报单记录页面
  goToOrders: function() {
    wx.navigateTo({
      url: '/pages/purchaseOrders/purchaseOrders'
    });
  },

  // 加载推荐拣货单（分页）
  loadRecommendations: async function(reset = true) {
    if (this.data.loading) return;

    if (reset) {
      this.setData({
        page: 1,
        recommendList: [],
        filteredList: [],
        hasMore: true,
        selectedCount: 0,
        totalQty: 0,
        allSelected: false
      });
    }
    
    if (!this.data.hasMore) return;
    
    this.setData({ loading: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      // 调用分页搜索接口
      const res = await api.get('/picking-list/recommend/search/query', this.getQueryParams());
      
      const newList = (res.content || []).map(item => ({
        ...item,
        selected: false,
        imageUrl: item.imageUrl || '',
        defaultImageUrl: item.defaultImageUrl || '/images/default-goods-image.png',
        // totalQty 是该 SKU 的全部数量，unshippedQty 只统计 paid/partial_shipped 的未发数量。
        allQty: Number(item.totalQty ?? item.unshippedQty) || 0,
        shippedQty: Number(item.shippedQty) || 0,
        pendingShipQty: Number(item.unshippedQty) || 0
      }));
      const nextList = reset ? newList : [...this.data.recommendList, ...newList];
      const hasMore = res.hasNext !== undefined ? res.hasNext : newList.length === this.data.size;
      
      this.setData({
        recommendList: nextList,
        filteredList: nextList,
        page: this.data.page + 1,
        hasMore: hasMore,
        selectedCount: reset ? 0 : this.data.selectedCount,
        totalQty: reset ? 0 : this.data.totalQty,
        allSelected: false,
        loading: false
      });
    } catch (err) {
      console.error('加载推荐拣货单失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 触底加载更多
  onReachBottom: function() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadRecommendations(false);
    }
  },

  // 切换筛选
  setFilter: function(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ 
      filterStatus: status,
      skuKeyword: ''
    }, () => this.loadRecommendations(true));  // 重置并重新加载
  },

  // 按档口筛选
  selectStall: function(e) {
    const stallId = e.currentTarget.dataset.stall;
    this.setData({
      selectedStall: stallId === 'all' ? '' : stallId
    }, () => this.loadRecommendations(true));
  },

  // 按标签筛选
  selectTag: function(e) {
    const tagId = e.currentTarget.dataset.tag;
    this.setData({
      selectedTag: tagId === 'all' ? '' : tagId
    }, () => this.loadRecommendations(true));
  },

  // SKU 搜索
  onSkuKeywordInput: function(e) {
    this.setData({ skuKeyword: e.detail.value });
  },

  searchSku: function() {
    this.loadRecommendations(true);  // 重置并重新加载
  },

  // 切换选中状态
  toggleSelect: function(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.filteredList[index];
    
    item.selected = !item.selected;
    
    // 重新计算选中数量和总数
    this.updateSelectedInfo();
    
    this.setData({
      filteredList: this.data.filteredList,
      recommendList: this.data.recommendList  // 同步更新原列表
    });
  },

  // 全选/取消全选
  toggleSelectAll: function() {
    const newAllSelected = !this.data.allSelected;
    const selectableItems = this.data.filteredList.filter(item => Number(item.recommendQty) > 0);

    this.data.filteredList.forEach(item => {
      item.selected = newAllSelected && Number(item.recommendQty) > 0;
    });
    
    this.setData({
      allSelected: newAllSelected && selectableItems.length > 0,
      filteredList: this.data.filteredList,
      recommendList: this.data.recommendList
    });
    
    this.updateSelectedInfo();
  },

  // 更新选中信息
  updateSelectedInfo: function() {
    const selectedCount = this.data.filteredList.filter(i => i.selected).length;
    const totalQty = this.data.filteredList
      .filter(i => i.selected)
      .reduce((sum, i) => sum + (Number(i.recommendQty) || 0), 0);
    
    this.setData({ selectedCount, totalQty });
  },

  // 图片加载失败处理
  onImageError: function(e) {
    const index = e.currentTarget.dataset.index;
    const key = `filteredList[${index}].imageLoadFailed`;
    this.setData({ [key]: true });
    console.log('图片加载失败，使用默认图片');
  },

  // 创建报单（显示详情弹窗）
  createPurchaseOrder: async function() {
    const selectedItems = this.data.filteredList
      .filter(i => i.selected && Number(i.recommendQty) > 0);

    if (selectedItems.length === 0) {
      wx.showToast({ title: '请选择商品', icon: 'none' });
      return;
    }

    // 准备预览列表
    const orderPreviewList = selectedItems.map(i => ({
      skuId: i.skuId,
      productName: i.productName,
      spec: i.spec,
      size: i.size,
      qty: Math.max(1, Number(i.recommendQty) || 1),
      imageUrl: i.imageUrl,
      defaultImageUrl: i.defaultImageUrl
    }));

    this.setData({
      orderPreviewList,
      totalQty: orderPreviewList.reduce((sum, item) => sum + item.qty, 0),
      showOrderModal: true
    });
  },

  // 调整弹窗中的报单数量，不限制上限，最低保留 1 件。
  adjustOrderQty: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    const delta = Number(e.currentTarget.dataset.delta);
    const item = this.data.orderPreviewList[index];
    if (!item) return;

    const currentQty = this.parseOrderQty(item.qty) || 1;
    const nextQty = Math.max(1, currentQty + delta);
    this.setOrderQty(index, nextQty);
  },

  // 支持直接输入报单数量，先保留输入态，失焦时再归一化。
  onOrderQtyInput: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setOrderQty(index, e.detail.value);
  },

  normalizeOrderQty: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.orderPreviewList[index];
    if (!item) return;

    const qty = this.parseOrderQty(item.qty);
    this.setOrderQty(index, qty || 1);
  },

  setOrderQty: function(index, qty) {
    const key = `orderPreviewList[${index}].qty`;
    this.setData({ [key]: qty }, () => {
      const totalQty = this.data.orderPreviewList.reduce(
        (sum, item) => sum + (this.parseOrderQty(item.qty) || 0),
        0
      );
      this.setData({ totalQty });
    });
  },

  parseOrderQty: function(qty) {
    const value = String(qty ?? '').trim();
    if (!/^\d+$/.test(value)) return 0;

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  },

  // 隐藏报单弹窗
  hideOrderModal: function() {
    this.setData({ showOrderModal: false });
    // 取消编辑时，操作栏恢复显示当前勾选商品的推荐数量合计。
    this.updateSelectedInfo();
  },

  // 确认报单
  confirmOrder: async function() {
    const selectedItems = this.data.orderPreviewList.map(item => ({
      ...item,
      qty: this.parseOrderQty(item.qty)
    }));
    const invalidItem = selectedItems.find(item => item.qty <= 0);
    if (invalidItem) {
      wx.showToast({ title: '报单数量必须是大于 0 的整数', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交中...' });

    try {
      const requestItems = selectedItems.map(i => ({
        skuId: i.skuId,
        qty: i.qty,
        note: `拣货单推荐，${i.spec} ${i.size}`
      }));

      await api.post('/picking-list/order', { items: requestItems });

      wx.hideLoading();
      wx.showToast({ title: '报单成功', icon: 'success' });

      this.setData({ showOrderModal: false });

      // 重新加载列表
      this.loadRecommendations();
    } catch (err) {
      wx.hideLoading();
      console.error('报单失败:', err);
      wx.showToast({ title: err?.message || '报单失败', icon: 'none' });
    }
  }
});
