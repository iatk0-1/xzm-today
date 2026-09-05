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
    filteredList: [],
    // 分页
    page: 0,
    size: 20,
    hasMore: true,
    // 报单详情弹窗
    showOrderModal: false,
    orderPreviewList: []
  },

  onLoad: function() {
    this.loadRecommendations();
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
        page: 0,
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
      const { page, size, filterStatus, skuKeyword } = this.data;
      
      // 调用分页搜索接口
      const res = await api.get(`/picking-list/recommend/search?status=${filterStatus}&keyword=${encodeURIComponent(skuKeyword)}&page=${page}&size=${size}`);
      
      const newList = (res.content || []).map(item => ({
        ...item,
        selected: false,
        imageUrl: item.imageUrl || '',
        defaultImageUrl: item.defaultImageUrl || '/images/default-goods-image.png'
      }));
      const nextList = reset ? newList : [...this.data.recommendList, ...newList];
      const hasMore = res.hasNext !== undefined ? res.hasNext : newList.length === size;
      
      this.setData({
        recommendList: nextList,
        filteredList: nextList,
        page: page + 1,
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
    });
    this.loadRecommendations(true);  // 重置并重新加载
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
    
    this.data.filteredList.forEach(item => {
      item.selected = newAllSelected;
    });
    
    this.setData({
      allSelected: newAllSelected,
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
      .reduce((sum, i) => sum + i.recommendQty, 0);
    
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
      .filter(i => i.selected);

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
      qty: i.recommendQty,
      imageUrl: i.imageUrl,
      defaultImageUrl: i.defaultImageUrl
    }));

    this.setData({
      orderPreviewList,
      showOrderModal: true
    });
  },

  // 隐藏报单弹窗
  hideOrderModal: function() {
    this.setData({ showOrderModal: false });
  },

  // 确认报单
  confirmOrder: async function() {
    wx.showLoading({ title: '提交中...' });

    try {
      const selectedItems = this.data.orderPreviewList.map(i => ({
        skuId: i.skuId,
        qty: i.qty,
        note: `拣货单推荐，${i.spec} ${i.size}`
      }));

      await api.post('/picking-list/order', { items: selectedItems });

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
