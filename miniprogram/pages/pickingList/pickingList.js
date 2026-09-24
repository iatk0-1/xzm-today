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
    orderPreviewList: []
  },

  onLoad: function() {
    this.loadFilterOptions();
    this.loadRecommendations();
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
