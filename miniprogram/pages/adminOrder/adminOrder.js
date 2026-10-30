const { getErrorMessage, getBusinessFailureMessage } = require('../../utils/error');
// adminOrder.js - 完整版
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');
const orderNavigation = require('../../utils/orderNavigation');
const { getExpressName } = require('../../utils/expressCompany');
const BATCH_TASK_STORAGE = 'admin_order_active_batch_task';

Page({
  onOrderTouchStart: orderNavigation.onTouchStart,
  onOrderTouchMove: orderNavigation.onTouchMove,
  onOrderTouchEnd: orderNavigation.onTouchEnd,
  onOrderTouchCancel: orderNavigation.onTouchCancel,

  data: {
    searchKeyword: '',
    searchDropdown: [],  // 搜索下拉列表
    searchActive: false,  // 正在输入或选择搜索商品
    searchFocus: false,  // 是否聚焦
    searchPage: 0,
    searchHasMore: false,
    searchLoading: false,
    stallList: [],       // 档口列表
    tagList: [],         // 标签列表
    selectedStall: '',   // 当前档口筛选
    selectedTag: '',     // 当前标签筛选
    dateRange: { startDate: '', endDate: '', quickSelect: '' },
    editingDateRange: { startDate: '', endDate: '', quickSelect: '' },
    today: '',
    showDateModal: false,
    selectedProducts: [],  // 已选商品列表 (SPU 维度)
    selectedSkuIds: [],    // 已选 SKU ID 列表
    logisticsAccounts: [],
    logisticsIndex: 0,
    orderGroups: [],       // 订单分组列表
    allSelected: false,
    selectedItems: [],     // 已选发货项
    pendingShipItems: [],  // 跨筛选条件累计的待发货项
    pendingOrderGroups: [],
    pendingOrderCount: 0,
    pendingItemCount: 0,
    pendingTotalQty: 0,
    showPendingShipList: false,
    loading: false,
    isRefreshing: false,
    showSkuModal: false,
    showPreviewModal: false,
    selectedProduct: null,
    previewGroups: [],
    canShip: false,
    page: 0,
    hasMore: true,
    loadingMore: false,
    selectingAll: false,
    blockedAfterSaleCount: 0,
    batchTask: null,
    batchProgress: null,
    showBatchProgress: false,
    showRecentBatchTasks: false,
    recentBatchTasks: [],
    historyFilter: 'all',
    historyPage: 0,
    historyHasMore: true,
    historyLoading: false,
    historyError: '',
    viewingBatchHistory: false,
    batchGroupPage: 1,
    batchGroupPages: 1,
    batchSubmitting: false,
    batchDetailLoading: false,
    batchQueryError: '',
    batchTraceMap: {},
    activeBatchTask: null,
    showFailedWaybills: false,
    failedWaybillGroups: [],
    failedWaybillPage: 0,
    failedWaybillHasMore: true,
    failedWaybillLoading: false
  },

  onLoad: async function(options = {}) {
    if (options.fromInventory === '1') {
      const channel = this.getOpenerEventChannel();
      channel.on('inventoryShipmentItems', result => this.importInventoryShipmentItems(result.items || []));
    }
    this.setData({ today: this.formatCalendarDate(new Date()) });
    try {
      await auth.ensureAuthenticated({ silent: true });
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '登录状态恢复失败，请稍后重试'), icon: 'none' });
      return;
    }
    this.loadLogisticsAccounts();
    this.loadStallList();
    this.loadTagList();
    // 空搜索时，自动加载所有未发货商品明细
    this.loadAllPendingItems();
    this.batchReady = true;
    this.resumeBatchTask();
  },

  onShow: function() {
    this.batchPageClosed = false;
    if (this.batchReady) {
      if (this.data.showBatchProgress && this.data.batchTask) this.runBatchTask(false);
      else this.refreshActiveBatchTask();
    }
  },

  onHide: function() {
    this.batchPageClosed = true;
    this.stopBatchPolling();
    this.resetBatchTraces();
  },

  importInventoryShipmentItems: function(matches) {
    const pendingShipItems = matches.map(({ item, shipQty }) => ({
      ...item, uniqueKey: this.getPendingItemKey(item), shipQty,
      canShip: Number(item.unshippedQty) > 0,
      createdAt: this.formatDate(item.orderCreatedAt)
    }));
    this.updatePendingShipSummary(pendingShipItems);
    this.setData({ showPendingShipList: pendingShipItems.length > 0 });
    if (this.rawPendingItems && this.rawPendingItems.length) {
      const grouped = this.groupByOrder(this.rawPendingItems);
      this.setData({ orderGroups: grouped.groups, selectedItems: this.collectSelectedItems(grouped.groups) });
    }
  },

  refreshPendingData: async function() {
    await Promise.all([this.reloadPendingItems(), this.loadLogisticsAccounts(),
      this.loadStallList(), this.loadTagList()]);
  },

  onListPullDownRefresh: async function() {
    if (this.data.isRefreshing) return;
    this.setData({ isRefreshing: true });
    try {
      await this.refreshPendingData();
    } finally {
      this.setData({ isRefreshing: false });
    }
  },

  onPullDownRefresh: async function() {
    try {
      await this.refreshPendingData();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onListScrollToLower: function() {
    if (!this.data.selectingAll) this.loadNextPendingPage();
  },

  onReachBottom: function() {
    this.onListScrollToLower();
  },

  backToTop: function() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  loadMorePendingItems: function() {
    if (!this.data.selectingAll) this.loadNextPendingPage();
  },

  copyOrderNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.orderNo, '订单号');
  },

  goToOrderDetail: function(e) {
    if (!orderNavigation.canNavigate(this, e)) return;
    const orderId = e.currentTarget.dataset.orderId;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/adminOrderDetail/adminOrderDetail?id=${orderId}` });
  },

  copyRecipientInfo: function(e) {
    clipboard.copyRecipient({
      recipientName: e.currentTarget.dataset.name,
      recipientPhone: e.currentTarget.dataset.phone,
      recipientAddress: e.currentTarget.dataset.address
    });
  },

  // ==================== 物流账号管理 ====================

  loadLogisticsAccounts: async function() {
    try {
      const accounts = await api.get('/logistics/bound-accounts');
      // 韵达默认排在首位，其他物流账号保留原有顺序。
      if (Array.isArray(accounts)) {
        accounts.sort((a, b) => Number(b.deliveryId === 'YUNDA') - Number(a.deliveryId === 'YUNDA'));
      }
      const selected = this.data.logisticsAccounts[this.data.logisticsIndex];
      const selectedIndex = selected && Array.isArray(accounts)
        ? accounts.findIndex(account => account.bizId === selected.bizId && account.deliveryId === selected.deliveryId)
        : -1;
      this.setData({
        logisticsAccounts: accounts,
        logisticsIndex: selectedIndex >= 0 ? selectedIndex : 0
      });
    } catch (err) {
      console.error('加载物流账号失败:', err);
      wx.showToast({ title: getErrorMessage(err, '加载物流账号失败'), icon: 'none' });
    }
  },

  onLogisticsChange: function(e) {
    this.setData({ logisticsIndex: parseInt(e.detail.value) });
  },

  editAdminRemark: async function(e) {
    const item = e.currentTarget.dataset.item;
    if (!item || !item.orderId || !item.orderItemId) return;
    wx.showModal({
      title: '管理员备注',
      editable: true,
      content: item.adminRemark || '',
      placeholderText: '仅管理员可见，最多500字',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          const remark = result.content || '';
          await api.patch(`/admin/orders-manage/orders/${item.orderId}/items/${item.orderItemId}/admin-remark`, { remark });
          this.updateAdminRemarkItem(item.orderId, item.orderItemId, remark);
          wx.showToast({ title: '已保存', icon: 'success' });
        } catch (err) { wx.showToast({ title: getErrorMessage(err, '保存失败'), icon: 'none' }); }
      }
    });
  },

  updateAdminRemarkItem: function(orderId, orderItemId, remark) {
    const matches = item => String(item.orderId) === String(orderId)
      && String(item.orderItemId) === String(orderItemId);
    const updateItem = item => matches(item) ? { ...item, adminRemark: remark } : item;
    const updateGroups = groups => groups.map(group => String(group.orderId) === String(orderId)
      ? { ...group, items: group.items.map(updateItem) } : group);
    this.rawPendingItems = (this.rawPendingItems || []).map(updateItem);
    this.setData({
      orderGroups: updateGroups(this.data.orderGroups),
      selectedItems: this.data.selectedItems.map(updateItem),
      pendingShipItems: this.data.pendingShipItems.map(updateItem),
      pendingOrderGroups: updateGroups(this.data.pendingOrderGroups)
    });
  },

  // ==================== 档口和标签筛选 ====================

  loadStallList: async function() {
    try {
      // 管理端筛选展示全部未删除档口，不受可见性和上架商品数量限制。
      const stalls = await api.get('/stalls/all');
      this.setData({ stallList: Array.isArray(stalls) ? stalls : [] });
    } catch (err) {
      console.error('加载档口列表失败:', err);
      this.setData({ stallList: [] });
    }
  },

  loadTagList: async function() {
    try {
      // 管理端筛选展示全部未删除标签，不受可见性和上架商品数量限制。
      const tags = await api.get('/tags/all');
      this.setData({ tagList: Array.isArray(tags) ? tags : [] });
    } catch (err) {
      console.error('加载标签列表失败:', err);
      this.setData({ tagList: [] });
    }
  },

  getPendingFilterParams: function() {
    const params = {};
    const keyword = this.data.searchKeyword.trim();
    if (keyword) {
      params.keyword = keyword;
    }
    if (this.data.selectedStall) {
      params.stallId = this.data.selectedStall;
    }
    if (this.data.selectedTag) {
      params.tagId = this.data.selectedTag;
    }
    if (this.data.dateRange.startDate) {
      params.startDate = this.data.dateRange.startDate;
    }
    if (this.data.dateRange.endDate) {
      params.endDate = this.data.dateRange.endDate;
    }
    return params;
  },

  showDateRangeSelector: function() {
    this.setData({
      editingDateRange: { ...this.data.dateRange },
      showDateModal: true
    });
  },

  closeDateModal: function() {
    this.setData({ showDateModal: false });
  },

  selectDateRange: function(e) {
    const type = e.currentTarget.dataset.type;
    const today = new Date();
    let startDate = today;
    if (type === '7days') {
      startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    } else if (type === '30days') {
      startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    } else if (type === 'month') {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    this.setData({
      editingDateRange: {
        startDate: this.formatCalendarDate(startDate),
        endDate: this.formatCalendarDate(today),
        quickSelect: type
      }
    });
  },

  onStartDateChange: function(e) {
    this.setData({
      'editingDateRange.startDate': e.detail.value,
      'editingDateRange.quickSelect': ''
    });
  },

  onEndDateChange: function(e) {
    this.setData({
      'editingDateRange.endDate': e.detail.value,
      'editingDateRange.quickSelect': ''
    });
  },

  clearDateRange: function() {
    this.setData({
      dateRange: { startDate: '', endDate: '', quickSelect: '' }
    }, () => this.reloadPendingItems());
  },

  confirmDateRange: function() {
    const range = this.data.editingDateRange;
    if (range.startDate && range.endDate && range.startDate > range.endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.setData({ dateRange: { ...range }, showDateModal: false },
      () => this.reloadPendingItems());
  },

  selectStall: function(e) {
    const stallId = e.currentTarget.dataset.stall;
    this.searchRequestVersion = (this.searchRequestVersion || 0) + 1;
    this.setData({
      selectedStall: stallId === 'all' ? '' : stallId,
      searchDropdown: [], searchHasMore: false, searchLoading: false
    }, () => this.reloadPendingItems());
  },

  selectTag: function(e) {
    const tagId = e.currentTarget.dataset.tag;
    this.searchRequestVersion = (this.searchRequestVersion || 0) + 1;
    this.setData({
      selectedTag: tagId === 'all' ? '' : tagId,
      searchDropdown: [], searchHasMore: false, searchLoading: false
    }, () => this.reloadPendingItems());
  },

  reloadPendingItems: function() {
    if (this.data.selectedProducts.length === 0) {
      return this.loadAllPendingItems();
    }

    const productsWithoutSkus = this.data.selectedProducts.filter(product =>
      !product.skus || product.skus.length === 0
    );
    if (productsWithoutSkus.length > 0) {
      return this.loadProductsSkus(productsWithoutSkus);
    } else {
      return this.loadPendingItems();
    }
  },

  getPendingItemKey: function(item) {
    return item.uniqueKey || [item.orderId || '', item.orderItemId || '', item.skuId || ''].join('_');
  },

  // ==================== 商品搜索 ====================

  // 加载所有未发货商品明细（进入页面时调用）
  loadAllPendingItems: function() {
    return this.resetPendingPages(this.getPendingFilterParams());
  },

  // 输入时搜索（防抖）
  onSearchInput: function(e) {
    const keyword = e.detail.value.trim();
    this.searchRequestVersion = (this.searchRequestVersion || 0) + 1;
    this.setData({ searchKeyword: keyword, searchActive: Boolean(keyword), searchDropdown: [], searchPage: 0, searchHasMore: false, searchLoading: false });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    
    if (!keyword) {
      // bindinput 的返回值会影响输入框内容，不能把异步查询结果返回给输入组件。
      this.reloadPendingItems();
      return;
    }
    
    // 防抖：500ms 后搜索
    this.searchTimer = setTimeout(() => {
      this.searchProducts();
    }, 500);
  },

  searchProducts: function() {
    const keyword = this.data.searchKeyword.trim();
    if (!keyword) return Promise.resolve();
    return this.fetchSearchProducts(1);
  },

  loadMoreSearchProducts: function() {
    if (this.data.searchLoading || !this.data.searchHasMore) return Promise.resolve();
    return this.fetchSearchProducts(this.data.searchPage + 1);
  },

  fetchSearchProducts: async function(page) {
    const keyword = this.data.searchKeyword.trim();
    if (!keyword) return;
    const version = this.searchRequestVersion || 0;
    const size = 10;
    this.setData({ searchLoading: true });
    try {
      const res = await api.get('/products/query', {
        status: 'all',
        keyword,
        ...(this.data.selectedStall ? { stallId: this.data.selectedStall } : {}),
        ...(this.data.selectedTag ? { tagId: this.data.selectedTag } : {}),
        page,
        size
      });
      if (version !== (this.searchRequestVersion || 0)) return;
      const products = (res && res.content) || (Array.isArray(res) ? res : []);
      
      // 获取已选商品 ID 列表
      const selectedIds = this.data.selectedProducts.map(p => p.id);
      
      // 标记已选商品
      const markedProducts = products.map(p => ({
        ...p,
        skuCount: p.skus ? p.skus.length : 0,
        isSelected: selectedIds.includes(p.id)
      }));
      
      this.setData({
        searchDropdown: page === 1 ? markedProducts : this.data.searchDropdown.concat(markedProducts),
        searchPage: page,
        searchHasMore: res.hasNext !== undefined ? res.hasNext : products.length === size
      });
    } catch (err) {
      if (version !== (this.searchRequestVersion || 0)) return;
      console.error('搜索商品失败:', err);
      wx.showToast({ title: getErrorMessage(err, '搜索商品失败，请重试'), icon: 'none' });
    } finally {
      if (version === (this.searchRequestVersion || 0)) this.setData({ searchLoading: false });
    }
  },

  // 点击搜索按钮
  onSearchConfirm: function() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchRequestVersion = (this.searchRequestVersion || 0) + 1;
    this.setData({ searchDropdown: [], searchHasMore: false, searchLoading: false, searchFocus: false, searchActive: false }, () => this.reloadPendingItems());
  },

  // 批量加载商品 SKU
  loadProductsSkus: function(products) {
    wx.showLoading({ title: '加载中...' });
    
    const promises = products.map(product => {
      return api.get(`/products/${product.id}`).then(res => {
        return {
          productId: product.id,
          skus: res.skus || res.skuMatrix || []
        };
      }).catch(err => {
        console.error('加载 SKU 失败:', product.id, err);
        return { productId: product.id, skus: [] };
      });
    });
    
    return Promise.all(promises).then(results => {
      // 更新已选商品的 SKU 列表
      const updatedProducts = this.data.selectedProducts.map(product => {
        const skuResult = results.find(r => r.productId === product.id);
        if (skuResult) {
          return { ...product, skus: skuResult.skus };
        }
        return product;
      });
      
      this.setData({ selectedProducts: updatedProducts });
      wx.hideLoading();
      
      // 加载订单明细
      return this.loadPendingItems();
    });
  },

  // 选择商品（添加到已选列表）
  onSelectProduct: function(e) {
    const product = e.currentTarget.dataset.product;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchRequestVersion = (this.searchRequestVersion || 0) + 1;
    
    // 添加到已选列表
    const selectedProducts = [...this.data.selectedProducts, {
      ...product,
      skuCount: 0,
      selectedSkus: []
    }];
    
    this.setData({
      selectedProducts,
      searchDropdown: [],
      searchHasMore: false,
      searchLoading: false,
      searchKeyword: ''
    }, () => this.onSearchConfirm());
  },

  // 点击下拉列表商品
  onDropdownItemClick: function(e) {
    const product = e.currentTarget.dataset.product;
    
    // 如果已选，打开 SKU 选择器
    if (product.isSelected) {
      // 在已选商品列表中找到该商品
      const index = this.data.selectedProducts.findIndex(p => p.id === product.id);
      if (index !== -1) {
        this.openSkuSelector({ currentTarget: { dataset: { product: this.data.selectedProducts[index] } } });
      }
      return;
    }
    
    // 未选，添加到已选列表
    this.onSelectProduct(e);
  },

  // 移除已选商品
  removeProduct: function(e) {
    const id = e.currentTarget.dataset.id;
    const products = this.data.selectedProducts.filter(p => p.id !== id);
    this.setData({ selectedProducts: products });
    
    // 清除该商品的 SKU 选择
    const product = this.data.selectedProducts.find(p => p.id === id);
    if (product && product.skus) {
      const skuIdsToRemove = product.skus.map(s => s.id);
      const selectedSkuIds = this.data.selectedSkuIds.filter(id => !skuIdsToRemove.includes(id));
      this.setData({ selectedSkuIds });
    }
  },

  // 清空已选
  clearSelected: function() {
    this.setData({ 
      selectedProducts: [],
      selectedSkuIds: []
    });
  },

  // ==================== SKU 选择器 ====================

  openSkuSelector: function(e) {
    const product = e.currentTarget.dataset.product;
    
    // 加载商品的 SKU 列表（如果还没有）
    if (!product.skus || product.skus.length === 0) {
      wx.showLoading({ title: '加载中...' });
      api.get(`/products/${product.id}`).then(res => {
        wx.hideLoading();
        const skus = res.skus || res.skuMatrix || [];
        const updatedProduct = { ...product, skus };
        this._showSkuModal(updatedProduct);
      }).catch(err => {
        wx.hideLoading();
        wx.showToast({ title: getErrorMessage(err, '加载 SKU 失败'), icon: 'none' });
      });
    } else {
      this._showSkuModal(product);
    }
  },

  // 显示 SKU 选择器
  _showSkuModal: function(product) {
    // 标记已选中的 SKU
    const skus = product.skus.map(sku => ({
      ...sku,
      selected: product.selectedSkus && product.selectedSkus.some(s => s.id === sku.id)
    }));

    this.setData({
      selectedProduct: { ...product, skus },
      showSkuModal: true
    });
  },

  closeSkuModal: function() {
    this.setData({ showSkuModal: false });
  },

  toggleSkuSelect: function(e) {
    const skuId = e.currentTarget.dataset.skuId;
    const currentSkus = this.data.selectedProduct.skus || [];
    
    const skus = currentSkus.map(sku => {
      if (sku.id === skuId) {
        return { ...sku, selected: !sku.selected };
      }
      return sku;
    });

    // 更新 selectedProduct 中的 skus
    this.setData({
      'selectedProduct.skus': skus
    });
  },

  confirmSkuSelection: function() {
    const product = this.data.selectedProduct;
    const selectedSkus = product.skus.filter(s => s.selected);
    
    // 更新已选商品列表
    const selectedProducts = this.data.selectedProducts.map(p => {
      if (p.id === product.id) {
        return {
          ...p,
          skus: product.skus,
          skuCount: selectedSkus.length,
          selectedSkus: selectedSkus
        };
      }
      return p;
    });

    this.setData({
      selectedProducts,
      showSkuModal: false
    }, () => this.onSearchConfirm());
  },

  // ==================== 加载订单明细 ====================

  // 加载订单明细（根据已选商品和 SKU）
  loadPendingItems: function() {
    if (this.data.selectedProducts.length === 0) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return Promise.resolve();
    }

    // 收集已选 SKU ID
    const selectedSkuIds = this.data.selectedProducts.reduce((acc, product) => {
      // 如果用户手动选择了 SKU，使用已选 SKU
      if (product.selectedSkus && product.selectedSkus.length > 0) {
        return [...acc, ...product.selectedSkus.map(s => s.id)];
      }
      // 如果没有选择 SKU，使用该商品的所有 SKU
      if (product.skus && product.skus.length > 0) {
        return [...acc, ...product.skus.map(s => s.id)];
      }
      // 如果商品没有 SKU，返回空数组（后面会提示）
      return acc;
    }, []);

    if (selectedSkuIds.length === 0) {
      wx.showToast({ title: '请选择商品', icon: 'none' });
      return Promise.resolve();
    }

    return this.resetPendingPages({
      ...this.getPendingFilterParams(),
      skuIds: selectedSkuIds.join(',')
    });
  },

  resetPendingPages: function(params) {
    this.pendingRequestVersion = (this.pendingRequestVersion || 0) + 1;
    this.pendingQueryParams = params;
    this.rawPendingItems = [];
    this.pendingPagePromise = null;
    this.setData({
      orderGroups: [], selectedItems: [], allSelected: false,
      blockedAfterSaleCount: 0, page: 0, hasMore: true, loading: true,
      loadingMore: false, selectingAll: false
    });
    return this.loadNextPendingPage(this.pendingRequestVersion);
  },

  loadNextPendingPage: function(version) {
    const requestVersion = version || this.pendingRequestVersion;
    if (!this.data.hasMore || requestVersion !== this.pendingRequestVersion) {
      return Promise.resolve();
    }
    if (this.pendingPagePromise) return this.pendingPagePromise;

    const nextPage = this.data.page + 1;
    this.setData({ loadingMore: nextPage > 1 });
    const request = api.get('/shipments/pending-items/query', {
      ...this.pendingQueryParams, page: nextPage
    }).then(res => {
      if (requestVersion !== this.pendingRequestVersion) return;
      const content = Array.isArray(res.content) ? res.content : [];
      const seen = new Set(this.rawPendingItems.map(item => this.getPendingItemKey(item)));
      content.forEach(item => {
        const key = this.getPendingItemKey(item);
        if (!seen.has(key)) {
          this.rawPendingItems.push(item);
          seen.add(key);
        }
      });
      const grouped = this.groupByOrder(this.rawPendingItems);
      this.setData({
        orderGroups: grouped.groups,
        selectedItems: this.collectSelectedItems(grouped.groups),
        allSelected: !res.hasNext && grouped.groups.length > 0
          && grouped.groups.every(group => group.selected),
        blockedAfterSaleCount: grouped.blockedAfterSaleCount,
        hasMore: Boolean(res.hasNext),
        page: nextPage
      });
      return true;
    }).catch(err => {
      if (requestVersion === this.pendingRequestVersion) {
        console.error('加载未发货商品失败:', err);
        wx.showToast({ title: getErrorMessage(err, '加载失败'), icon: 'none' });
      }
      return false;
    }).finally(() => {
      if (requestVersion === this.pendingRequestVersion) {
        this.setData({ loading: false, loadingMore: false });
      }
      if (this.pendingPagePromise === request) this.pendingPagePromise = null;
    });
    this.pendingPagePromise = request;
    return request;
  },

  // 按订单分组
  groupByOrder: function(items) {
    const groupsMap = new Map();
    const pendingMap = {};
    (this.data.pendingShipItems || []).forEach(pendingItem => {
      pendingMap[this.getPendingItemKey(pendingItem)] = pendingItem;
    });

    items.forEach(item => {
      const key = item.orderId;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          orderId: item.orderId,
          adminSeqNo: item.adminSeqNo || '',
          orderNo: String(item.orderId),
          createdAt: this.formatDate(item.orderCreatedAt),
          orderCreatedAt: item.orderCreatedAt,
          recipientName: item.recipientName,
          recipientPhone: item.recipientPhone,
          recipientAddress: item.recipientAddress,
          selected: false,
          items: []
        });
      }

      const uniqueKey = [item.orderId, item.orderItemId, item.skuId].join('_');
      const pendingItem = pendingMap[uniqueKey];
      const unshippedQty = Math.max(0, item.unshippedQty || 0);
      groupsMap.get(key).items.push({
        orderId: item.orderId,
        orderItemId: item.orderItemId,
        uniqueKey,
        productId: item.productId,
        productName: item.productName,
        productImage: item.productImage,
        skuImageUrl: item.skuImageUrl,
        skuId: item.skuId,
        skuSpec: item.skuSpec,
        skuSize: item.skuSize,
        skuImage: item.skuImage,
        totalQty: item.totalQty,
        shippedQty: item.shippedQty,
        unshippedQty: item.unshippedQty,
        afterSaleQty: item.afterSaleQty || 0,
        afterSaleStatusText: item.afterSaleStatusText || (item.afterSaleStatus ? '售后' : ''),
        afterSaleSummary: item.afterSaleSummary || null,
        afterSaleStatus: item.afterSaleStatus,
        adminRemark: item.adminRemark || '',
        canShip: unshippedQty > 0,
        shipQty: pendingItem ? Math.min(Number(pendingItem.shipQty) || 0, unshippedQty) : unshippedQty,
        selected: Boolean(pendingItem)
      });
    });

    const allGroups = Array.from(groupsMap.values());
    const blockedAfterSaleCount = allGroups.filter(group =>
      group.items.length > 0 &&
      group.items.every(item => !item.canShip) &&
      group.items.some(item => item.afterSaleQty > 0 || item.afterSaleStatus)
    ).length;

    // 过滤：去掉所有商品都因售后不可发的订单，但保留部分售后仍可发的订单
    const groups = allGroups
      .filter(group => group.items.some(item => item.canShip));

    groups.forEach(group => {
      const selectableItems = group.items.filter(item => item.canShip);
      group.selected = selectableItems.length > 0 && selectableItems.every(item => item.selected);
    });

    return { groups, blockedAfterSaleCount };
  },

  // ==================== 选择逻辑 ====================

  collectSelectedItems: function(orderGroups) {
    const selectedItems = [];
    orderGroups.forEach(group => {
      group.items.forEach(item => {
        if (!item.canShip || !item.selected) return;
        selectedItems.push({
          ...item,
          orderId: group.orderId,
          adminSeqNo: group.adminSeqNo,
          orderNo: group.orderNo,
          createdAt: group.createdAt,
          orderCreatedAt: group.orderCreatedAt,
          recipientName: group.recipientName,
          recipientPhone: group.recipientPhone,
          recipientAddress: group.recipientAddress
        });
      });
    });
    return selectedItems;
  },

  isAllGroupsSelected: function(orderGroups) {
    const selectableGroups = orderGroups.filter(group => group.items.some(item => item.canShip));
    return selectableGroups.length > 0 && selectableGroups.every(group => group.selected);
  },

  toggleSelectAll: async function() {
    if (this.data.selectingAll || this.data.loading) return;
    const allSelected = !this.data.allSelected;
    if (allSelected && this.data.hasMore) {
      const version = this.pendingRequestVersion;
      this.setData({ selectingAll: true });
      try {
        while (this.data.hasMore && version === this.pendingRequestVersion) {
          const loaded = await this.loadNextPendingPage(version);
          if (!loaded) return;
        }
        if (version !== this.pendingRequestVersion) return;
      } finally {
        if (version === this.pendingRequestVersion) this.setData({ selectingAll: false });
      }
    }
    
    const orderGroups = this.data.orderGroups.map(group => ({
      ...group,
      selected: allSelected,
      items: group.items.map(item => ({ ...item, selected: item.canShip ? allSelected : false }))
    }));

    this.updateSelectedItems(orderGroups);
  },

  toggleGroupSelect: function(e) {
    const index = e.currentTarget.dataset.index;
    const group = this.data.orderGroups[index];
    
    group.selected = !group.selected;
    group.items = group.items.map(item => ({ ...item, selected: item.canShip ? group.selected : false }));
    
    const orderGroups = [...this.data.orderGroups];
    orderGroups[index] = group;
    
    this.updateSelectedItems(orderGroups);
  },

  toggleItemSelect: function(e) {
    const groupIndex = e.currentTarget.dataset.groupIndex;
    const itemIndex = e.currentTarget.dataset.itemIndex;
    
    const item = this.data.orderGroups[groupIndex].items[itemIndex];
    if (!item.canShip) {
      return;
    }
    item.selected = !item.selected;
    
    // 更新分组选中状态
    const group = this.data.orderGroups[groupIndex];
    const selectableItems = group.items.filter(i => i.canShip);
    group.selected = selectableItems.length > 0 && selectableItems.every(i => i.selected);
    
    const orderGroups = [...this.data.orderGroups];
    orderGroups[groupIndex] = group;
    
    this.updateSelectedItems(orderGroups);
  },

  updateSelectedItems: function(orderGroups) {
    const selectedItems = this.collectSelectedItems(orderGroups);
    const selectedMap = new Map(selectedItems.map(item => [this.getPendingItemKey(item), item]));
    const pendingMap = {};
    (this.data.pendingShipItems || []).forEach(item => {
      pendingMap[this.getPendingItemKey(item)] = item;
    });

    // 只同步当前筛选结果，其他筛选条件下的待发货项继续保留。
    orderGroups.forEach(group => {
      group.items.forEach(item => {
        const key = this.getPendingItemKey(item);
        if (item.canShip && item.selected) {
          pendingMap[key] = selectedMap.get(key);
        } else {
          delete pendingMap[key];
        }
      });
    });

    const pendingShipItems = Object.values(pendingMap).filter(Boolean);
    this.setData({
      orderGroups,
      selectedItems,
      allSelected: !this.data.hasMore && this.isAllGroupsSelected(orderGroups)
    });
    this.updatePendingShipSummary(pendingShipItems);
    if (pendingShipItems.length === 0) {
      this.closePendingShipList();
    }
  },

  onShipQtyInput: function(e) {
    const groupIndex = e.currentTarget.dataset.groupIndex;
    const itemIndex = e.currentTarget.dataset.itemIndex;
    const value = parseInt(e.detail.value) || 0;

    const item = this.data.orderGroups[groupIndex].items[itemIndex];

    // 限制最大值为未发货数量
    item.shipQty = Math.max(0, Math.min(value, item.unshippedQty));

    const orderGroups = [...this.data.orderGroups];
    orderGroups[groupIndex].items[itemIndex] = item;

    this.setData({ orderGroups });

    // 同步更新 selectedItems 中的 shipQty
    this.syncSelectedItemsShipQty(groupIndex, itemIndex, item.shipQty);
  },

  // 减少数量
  onDecrease: function(e) {
    const groupIndex = e.currentTarget.dataset.groupIndex;
    const itemIndex = e.currentTarget.dataset.itemIndex;

    const item = this.data.orderGroups[groupIndex].items[itemIndex];

    if (item.shipQty > 0) {
      item.shipQty = Math.max(0, item.shipQty - 1);

      const orderGroups = [...this.data.orderGroups];
      orderGroups[groupIndex].items[itemIndex] = item;

      this.setData({ orderGroups });

      // 同步更新 selectedItems 中的 shipQty
      this.syncSelectedItemsShipQty(groupIndex, itemIndex, item.shipQty);
    }
  },

  // 增加数量
  onIncrease: function(e) {
    const groupIndex = e.currentTarget.dataset.groupIndex;
    const itemIndex = e.currentTarget.dataset.itemIndex;

    const item = this.data.orderGroups[groupIndex].items[itemIndex];

    // 限制最大值为未发货数量
    item.shipQty = Math.min(item.unshippedQty, item.shipQty + 1);

    const orderGroups = [...this.data.orderGroups];
    orderGroups[groupIndex].items[itemIndex] = item;

    this.setData({ orderGroups });

    // 同步更新 selectedItems 中的 shipQty
    this.syncSelectedItemsShipQty(groupIndex, itemIndex, item.shipQty);
  },

  // 同步更新 selectedItems 中的 shipQty（只更新数量，不改变选中状态）
  syncSelectedItemsShipQty: function(groupIndex, itemIndex, newShipQty) {
    const item = this.data.orderGroups[groupIndex].items[itemIndex];

    // 只更新已选中商品的 shipQty
    if (item.selected) {
      const selectedItems = [...this.data.selectedItems];
      const selectedItemIndex = selectedItems.findIndex(si =>
        si.orderItemId === item.orderItemId && si.skuId === item.skuId
      );

      if (selectedItemIndex !== -1) {
        selectedItems[selectedItemIndex].shipQty = newShipQty;
        this.setData({ selectedItems });
      }

      const pendingShipItems = this.data.pendingShipItems.map(pendingItem => {
        return this.getPendingItemKey(pendingItem) === this.getPendingItemKey(item)
          ? { ...pendingItem, shipQty: newShipQty }
          : pendingItem;
      });
      this.updatePendingShipSummary(pendingShipItems);
    }
  },

  // ==================== 待发货列表 ====================

  updatePendingShipSummary: function(pendingShipItems) {
    this.pendingShipRevision = (this.pendingShipRevision || 0) + 1;
    const orderIds = {};
    const groupsMap = new Map();
    pendingShipItems.forEach((item, index) => {
      orderIds[item.orderId] = true;
      if (!groupsMap.has(item.orderId)) {
        groupsMap.set(item.orderId, {
          orderId: item.orderId,
          adminSeqNo: item.adminSeqNo || '',
          orderNo: String(item.orderId),
          createdAt: item.createdAt || '',
          orderCreatedAt: item.orderCreatedAt || '',
          recipientName: item.recipientName || '',
          recipientPhone: item.recipientPhone || '',
          recipientAddress: item.recipientAddress || '',
          items: []
        });
      }
      groupsMap.get(item.orderId).items.push({ ...item, pendingIndex: index });
    });
    const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => {
      const timeA = Date.parse(a.orderCreatedAt || a.createdAt) || 0;
      const timeB = Date.parse(b.orderCreatedAt || b.createdAt) || 0;
      if (timeA !== timeB) return timeA - timeB;
      const idA = String(a.orderId);
      const idB = String(b.orderId);
      return idA.length - idB.length || idA.localeCompare(idB);
    });
    this.setData({
      pendingShipItems,
      pendingOrderGroups: sortedGroups,
      pendingOrderCount: Object.keys(orderIds).length,
      pendingItemCount: pendingShipItems.length,
      pendingTotalQty: pendingShipItems.reduce((sum, item) => sum + (Number(item.shipQty) || 0), 0)
    });
  },

  openPendingShipList: function() {
    if (this.data.pendingShipItems.length === 0) {
      wx.showToast({ title: '请先选择待发货订单', icon: 'none' });
      return;
    }
    this.setData({ showPendingShipList: true });
  },

  openFailedWaybills: function() {
    this.failedWaybillRequestVersion = (this.failedWaybillRequestVersion || 0) + 1;
    this.setData({ showFailedWaybills: true, failedWaybillGroups: [],
      failedWaybillPage: 0, failedWaybillHasMore: true, failedWaybillLoading: false });
    this.loadFailedWaybills();
  },

  closeFailedWaybills: function() {
    this.failedWaybillRequestVersion = (this.failedWaybillRequestVersion || 0) + 1;
    this.setData({ showFailedWaybills: false });
  },

  loadFailedWaybills: async function() {
    if (this.data.failedWaybillLoading || !this.data.failedWaybillHasMore) return;
    const page = this.data.failedWaybillPage + 1;
    const version = this.failedWaybillRequestVersion;
    this.setData({ failedWaybillLoading: true });
    try {
      const result = await api.get('/shipments/batch-tasks/failed-waybills', { page });
      const groups = (result.content || []).map(group => {
        const orderMap = new Map();
        const shippableIds = new Set((group.shippableItemIds || []).map(String));
        (group.items || []).forEach(item => {
          const key = String(item.orderId);
          if (!orderMap.has(key)) orderMap.set(key, {
            orderId: item.orderId, orderNo: String(item.orderId),
            adminSeqNo: item.adminSeqNo || '', createdAt: this.formatDate(item.orderCreatedAt),
            recipientName: item.recipientName, recipientPhone: item.recipientPhone,
            recipientAddress: item.recipientAddress, items: []
          });
          orderMap.get(key).items.push({ ...item,
            uniqueKey: this.getPendingItemKey(item),
            canShip: shippableIds.has(String(item.orderItemId)) && Number(item.unshippedQty) > 0 });
        });
        return { ...group, reason: getBusinessFailureMessage(group.reason, '获取面单失败，请核查后重试'), failedAtText: this.formatDate(group.failedAt),
          orders: Array.from(orderMap.values()) };
      });
      if (!this.data.showFailedWaybills || version !== this.failedWaybillRequestVersion) return;
      this.setData({
        failedWaybillGroups: this.data.failedWaybillGroups.concat(groups),
        failedWaybillPage: page,
        failedWaybillHasMore: Boolean(result.hasNext)
      });
    } catch (err) {
      if (version === this.failedWaybillRequestVersion) {
        wx.showToast({ title: getErrorMessage(err, '查询失败列表失败'), icon: 'none' });
      }
    } finally {
      if (version === this.failedWaybillRequestVersion) this.setData({ failedWaybillLoading: false });
    }
  },

  addFailedWaybillsToPending: function(event) {
    const selectedGroup = event && event.currentTarget && event.currentTarget.dataset.groupIndex;
    const groups = selectedGroup === undefined
      ? this.data.failedWaybillGroups : [this.data.failedWaybillGroups[Number(selectedGroup)]];
    const existing = new Set(this.data.pendingShipItems.map(item => this.getPendingItemKey(item)));
    const added = [];
    groups.filter(Boolean).forEach(group => group.orders.forEach(order => order.items.forEach(item => {
      const key = this.getPendingItemKey(item);
      if (!item.canShip || existing.has(key)) return;
      existing.add(key);
      added.push({ ...item,
        orderNo: order.orderNo, adminSeqNo: order.adminSeqNo,
        createdAt: order.createdAt, orderCreatedAt: item.orderCreatedAt,
        recipientName: order.recipientName, recipientPhone: order.recipientPhone,
        recipientAddress: order.recipientAddress,
        shipQty: Number(item.unshippedQty)
      });
    })));
    if (!added.length && !this.data.pendingShipItems.length) {
      wx.showToast({ title: '失败订单目前没有可发商品', icon: 'none' });
      return;
    }
    const addedKeys = new Set(added.map(item => this.getPendingItemKey(item)));
    const orderGroups = this.data.orderGroups.map(order => {
      const items = order.items.map(item => addedKeys.has(this.getPendingItemKey(item))
        ? { ...item, selected: true } : item);
      const selectable = items.filter(item => item.canShip);
      return { ...order, items, selected: selectable.length > 0 && selectable.every(item => item.selected) };
    });
    this.setData({ orderGroups, selectedItems: this.collectSelectedItems(orderGroups),
      allSelected: this.isAllGroupsSelected(orderGroups), showFailedWaybills: false,
      showPendingShipList: true });
    this.updatePendingShipSummary(this.data.pendingShipItems.concat(added));
  },

  closePendingShipList: function() {
    this.setData({ showPendingShipList: false });
  },

  stopPendingShipEvent: function() {},

  removePendingShipItem: function(e) {
    const index = Number(e.currentTarget.dataset.pendingIndex);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.pendingShipItems.length) return;
    const pendingShipItems = this.data.pendingShipItems.filter((item, itemIndex) => itemIndex !== index);
    const removedKey = this.getPendingItemKey(this.data.pendingShipItems[index]);
    const orderGroups = this.data.orderGroups.map(group => ({
      ...group,
      items: group.items.map(item => item.uniqueKey === removedKey ? { ...item, selected: false } : item)
    }));
    orderGroups.forEach(group => {
      const selectableItems = group.items.filter(item => item.canShip);
      group.selected = selectableItems.length > 0 && selectableItems.every(item => item.selected);
    });
    this.setData({
      orderGroups,
      selectedItems: this.collectSelectedItems(orderGroups),
      allSelected: this.isAllGroupsSelected(orderGroups)
    });
    this.updatePendingShipSummary(pendingShipItems);
    if (pendingShipItems.length === 0) {
      this.closePendingShipList();
    }
  },

  clearPendingShipItems: function() {
    if (this.data.pendingShipItems.length === 0) return;
    wx.showModal({
      title: '清空待发货列表',
      content: '清空后需要重新选择订单，确定继续吗？',
      success: res => {
        if (res.confirm) {
          const orderGroups = this.data.orderGroups.map(group => ({
            ...group,
            selected: false,
            items: group.items.map(item => ({ ...item, selected: false }))
          }));
          this.updatePendingShipSummary([]);
          this.setData({ orderGroups, selectedItems: [], allSelected: false });
          this.closePendingShipList();
        }
      }
    });
  },

  onPendingShipQtyInput: function(e) {
    const index = Number(e.currentTarget.dataset.pendingIndex);
    const pendingShipItems = [...this.data.pendingShipItems];
    const item = pendingShipItems[index];
    if (!item) return;
    const value = parseInt(e.detail.value, 10);
    item.shipQty = Math.max(0, Math.min(Number.isNaN(value) ? 0 : value, item.unshippedQty || 0));
    this.updatePendingShipSummary(pendingShipItems);
  },

  onPendingShipDecrease: function(e) {
    const index = Number(e.currentTarget.dataset.pendingIndex);
    const pendingShipItems = [...this.data.pendingShipItems];
    const item = pendingShipItems[index];
    if (!item) return;
    item.shipQty = Math.max(0, item.shipQty - 1);
    this.updatePendingShipSummary(pendingShipItems);
  },

  onPendingShipIncrease: function(e) {
    const index = Number(e.currentTarget.dataset.pendingIndex);
    const pendingShipItems = [...this.data.pendingShipItems];
    const item = pendingShipItems[index];
    if (!item) return;
    item.shipQty = Math.min(item.unshippedQty || 0, item.shipQty + 1);
    this.updatePendingShipSummary(pendingShipItems);
  },

  validatePendingShipItems: function() {
    const invalidItem = this.data.pendingShipItems.find(item =>
      !item.orderId || !item.orderItemId || !item.skuId ||
      !item.canShip ||
      !Number.isInteger(Number(item.shipQty)) || Number(item.shipQty) <= 0 ||
      Number(item.shipQty) > Number(item.unshippedQty || 0)
    );
    if (invalidItem) {
      wx.showToast({ title: `${invalidItem.productName || '商品'}发货数量或状态无效`, icon: 'none' });
      return false;
    }
    return this.data.pendingShipItems.length > 0;
  },

  // 提交前刷新待发数量，防止列表停留期间订单或售后状态发生变化。
  refreshPendingShipItems: async function() {
    const skuIds = [...new Set(this.data.pendingShipItems.map(item => item.skuId).filter(Boolean))];
    if (skuIds.length === 0) return;

    const latestMap = {};
    let page = 1;
    let hasNext = true;
    while (hasNext) {
      const res = await api.get('/shipments/pending-items/query', {
        skuIds: skuIds.join(','), page
      });
      (res.content || []).forEach(item => {
        latestMap[item.orderId + '_' + item.orderItemId + '_' + item.skuId] = item;
      });
      hasNext = Boolean(res.hasNext);
      page += 1;
    }

    const refreshedItems = this.data.pendingShipItems.map(item => {
      const latest = latestMap[item.uniqueKey || (item.orderId + '_' + item.orderItemId + '_' + item.skuId)];
      if (!latest) {
        return { ...item, canShip: false, unshippedQty: 0, shipQty: 0 };
      }
      const unshippedQty = Math.max(0, Number(latest.unshippedQty) || 0);
      return {
        ...item,
        unshippedQty,
        shippedQty: latest.shippedQty,
        afterSaleQty: latest.afterSaleQty || 0,
        afterSaleStatus: latest.afterSaleStatus,
        afterSaleStatusText: latest.afterSaleStatusText || item.afterSaleStatusText,
        canShip: unshippedQty > 0,
        shipQty: Math.min(Number(item.shipQty) || 0, unshippedQty)
      };
    });
    this.updatePendingShipSummary(refreshedItems);
  },

  // ==================== 批量发货 ====================

  batchShip: async function() {
    if (!this.data.pendingShipItems.length || !this.validatePendingShipItems()) {
      return;
    }

    if (!this.data.logisticsAccounts[this.data.logisticsIndex]) {
      wx.showToast({ title: '请选择物流账号', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '校验中...' });
    try {
      await this.refreshPendingShipItems();
    } catch (err) {
      console.error('刷新待发货状态失败:', err);
      wx.hideLoading();
      wx.showToast({ title: getErrorMessage(err, '校验待发货状态失败，请重试'), icon: 'none' });
      return;
    }
    wx.hideLoading();

    if (!this.validatePendingShipItems()) {
      return;
    }

    const account = this.data.logisticsAccounts[this.data.logisticsIndex];
    let task;
    try {
      task = await this.createBatchTask(account);
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '建立发货任务失败'), icon: 'none' });
      return;
    }
    const neededWaybills = task.groups.length;
    if (account.quotaNum < neededWaybills) {
      wx.showToast({
        title: `剩余单号不足 (${account.quotaNum} < ${neededWaybills})`,
        icon: 'none'
      });
      return;
    }

    this.setData({ showPendingShipList: false });
    // 生成发货预览
    this.generatePreview(task);
  },

  sanitizeBatchTask: function(task) {
    return task && { ...task, groups: (task.groups || []).map(group => ({ ...group,
      reason: group.reason ? getBusinessFailureMessage(group.reason, '发货结果待核查，请核对面单和发货单') : group.reason })) };
  },

  generatePreview: function(task) {
    task = this.sanitizeBatchTask(task);
    // 以后端分组为准，避免同地址不同用户被误合并。
    const previewGroups = task.groups.map(group => {
      const orderIds = new Set(group.orderIds.map(String));
      const items = this.data.pendingShipItems.filter(item => orderIds.has(String(item.orderId)));
      return {
        recipientName: group.recipientName,
        recipientPhone: group.recipientPhone,
        recipientAddress: group.recipientAddress,
        totalItems: items.reduce((sum, item) => sum + Number(item.shipQty || 0), 0),
        items
      };
    });
    this.setData({
      batchTask: this.sanitizeBatchTask(task),
      previewGroups,
      canShip: true,
      showPreviewModal: true
    });
  },

  closePreviewModal: function() {
    if (this.data.batchSubmitting) return;
    this.setData({ showPreviewModal: false });
    const saved = this.getSavedBatchTask();
    if (saved && !saved.confirmed && !saved.submissionPending) {
      wx.removeStorageSync(BATCH_TASK_STORAGE);
      this.setData({ batchTask: null });
    }
  },

  confirmBatchShip: async function() {
    const task = this.data.batchTask;
    const saved = this.getSavedBatchTask();
    if (!task || !saved || this.data.batchSubmitting) return;
    const selectionRevision = this.pendingShipRevision || 0;
    this.setData({ batchSubmitting: true });
    saved.submissionPending = true;
    wx.setStorageSync(BATCH_TASK_STORAGE, saved);
    try {
      let submitted;
      try { submitted = await api.post(`/shipments/batch-tasks/${task.id}/submit`, {}); }
      catch (error) {
        // 响应丢失时查询原批次；不把本地“已确认”当成后端已接收。
        submitted = await api.get(`/shipments/batch-tasks/${task.id}`, { groupPage: 1 });
        if (!submitted.confirmedAt || submitted.executionMode !== 'BACKGROUND') throw error;
      }
      saved.confirmed = true;
      saved.submissionPending = false;
      wx.setStorageSync(BATCH_TASK_STORAGE, saved);
      this.removeSubmittedSelection(saved.items || [], selectionRevision);
      this.setData({ showPreviewModal: false, showBatchProgress: true,
        viewingBatchHistory: false, batchGroupPage: 1, activeBatchTask: this.decorateBatchTask(submitted) });
      this.updateBatchProgress(submitted);
      wx.showToast({ title: '已提交，后台将继续发货', icon: 'none' });
      this.runBatchTask(false);
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '提交结果暂不可查，请重试确认原任务'), icon: 'none' });
    } finally { this.setData({ batchSubmitting: false }); }
  },

  getSavedBatchTask: function() {
    try { return wx.getStorageSync(BATCH_TASK_STORAGE) || null; }
    catch (err) { return null; }
  },

  isBatchTaskRunning: function(task) {
    if (task && ['QUEUED', 'RUNNING'].includes(task.status)) return true;
    if (task && ['DRAFT', 'LEGACY_PAUSED'].includes(task.status)) return false;
    return (task && task.groups || []).some(group =>
      ['WAITING', 'PROCESSING', 'PROCESSING_WECHAT'].includes(group.status));
  },

  removeSubmittedSelection: function(taskItems, selectionRevision) {
    // 仅在本次确认成功时移出已提交选择，不影响请求期间新编辑的另一批商品。
    if ((this.pendingShipRevision || 0) !== selectionRevision) return;
    const taskKeys = new Set(taskItems.map(item => this.getPendingItemKey(item)));
    if (taskKeys.size === 0) return;

    const orderGroups = this.data.orderGroups.map(group => {
      const items = group.items.map(item =>
        taskKeys.has(this.getPendingItemKey(item)) ? { ...item, selected: false } : item);
      const selectableItems = items.filter(item => item.canShip);
      return {
        ...group,
        items,
        selected: selectableItems.length > 0 && selectableItems.every(item => item.selected)
      };
    });
    const pendingShipItems = this.data.pendingShipItems.filter(item =>
      !taskKeys.has(this.getPendingItemKey(item)));
    this.setData({
      orderGroups,
      selectedItems: this.collectSelectedItems(orderGroups),
      allSelected: this.isAllGroupsSelected(orderGroups)
    });
    this.updatePendingShipSummary(pendingShipItems);
  },

  createBatchTask: async function(account) {
    const existing = this.getSavedBatchTask();
    if (existing && (existing.confirmed || existing.submissionPending) && !existing.historyOnly) {
      let previousTask;
      try {
        previousTask = existing.requestId
          ? await api.get(`/shipments/batch-tasks/by-request/${existing.requestId}`)
          : await api.get(`/shipments/batch-tasks/${existing.taskId}`);
      } catch (err) {
        throw new Error('上次发货任务状态暂不可查，请先查看进度');
      }
      if (existing.submissionPending && !previousTask.confirmedAt) {
        throw new Error('上次提交结果尚未确认，请打开原任务重新确认');
      }
      if (this.isBatchTaskRunning(previousTask)) {
        throw new Error('上次发货任务仍在处理中，请先查看进度');
      }
      wx.removeStorageSync(BATCH_TASK_STORAGE);
      this.setData({ batchTask: null, batchProgress: null, showBatchProgress: false });
    }
    const requestId = `admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const saved = { requestId, confirmed: false, items: this.data.pendingShipItems };
    wx.setStorageSync(BATCH_TASK_STORAGE, saved);
    const payload = {
      clientRequestId: requestId,
      accountId: account.bizId,
      expressCode: account.deliveryId,
      useElectronicWaybill: true,
      items: saved.items.map(item => ({
        orderId: item.orderId, orderItemId: item.orderItemId,
        skuId: item.skuId, shipQty: item.shipQty
      }))
    };
    let task;
    try {
      task = await api.post('/shipments/batch-tasks', payload);
    } catch (err) {
      // 创建响应丢失时先按客户端请求号查询，避免重复建立任务。
      try { task = await api.get(`/shipments/batch-tasks/by-request/${requestId}`); }
      catch (lookupError) { throw err; }
    }
    saved.taskId = task.id;
    wx.setStorageSync(BATCH_TASK_STORAGE, saved);
    return task;
  },

  refreshActiveBatchTask: async function() {
    try {
      const result = await api.get('/shipments/batch-tasks/query', { page: 1, filter: 'running' });
      if (!this.batchPageClosed) this.setData({ activeBatchTask: result.content && result.content.length
        ? this.decorateBatchTask(result.content[0]) : null });
    } catch (err) { console.error('查询后台发货任务失败:', err); }
  },

  resumeBatchTask: async function() {
    const saved = this.getSavedBatchTask();
    if (!saved || (!saved.confirmed && !saved.submissionPending) || saved.historyOnly) {
      this.refreshActiveBatchTask();
      return;
    }
    try {
      const task = saved.taskId
        ? await api.get(`/shipments/batch-tasks/${saved.taskId}`, { groupPage: 1 })
        : await api.get(`/shipments/batch-tasks/by-request/${saved.requestId}`);
      const latest = this.getSavedBatchTask();
      if (this.batchPageClosed || !latest || (saved.requestId
        ? latest.requestId !== saved.requestId : String(latest.taskId) !== String(saved.taskId))) return;
      saved.taskId = task.id;
      if (task.confirmedAt) { saved.confirmed = true; saved.submissionPending = false; }
      const running = this.isBatchTaskRunning(task);
      if (task.confirmedAt && !running) wx.removeStorageSync(BATCH_TASK_STORAGE);
      else wx.setStorageSync(BATCH_TASK_STORAGE, saved);
      // 进入页面只更新独立的任务提示，不能覆盖当前选择或强制弹出旧任务。
      this.setData({ activeBatchTask: running || saved.submissionPending ? this.decorateBatchTask(task) : null });
    } catch (err) {
      this.setData({ batchQueryError: '任务状态暂不可查，请稍后刷新；后台任务会继续处理' });
      this.refreshActiveBatchTask();
    }
  },

  decorateBatchTask: function(task) {
    const groups = task.groups || [];
    const summary = task.summary || {
      total: groups.length,
      completed: groups.filter(g => !['WAITING', 'PROCESSING', 'PROCESSING_WECHAT'].includes(g.status)).length,
      success: groups.filter(g => ['SUCCESS', 'SHIPMENT_CREATED_WECHAT_FAILED'].includes(g.status)).length,
      failed: groups.filter(g => ['FAILED', 'BLOCKED', 'NEEDS_REVIEW'].includes(g.status)).length,
      review: groups.filter(g => g.status === 'NEEDS_REVIEW').length,
      wechatPending: groups.filter(g => g.status === 'SHIPMENT_CREATED_WECHAT_FAILED').length,
      orders: new Set(groups.flatMap(g => (g.orderIds || []).map(String))).size,
      quantity: groups.flatMap(g => g.items || []).reduce((sum, i) => sum + Number(i.shipQty || 0), 0)
    };
    const labels = { DRAFT: '未提交', QUEUED: '排队中', RUNNING: '发货中',
      LEGACY_PAUSED: '旧任务待继续', COMPLETED: '全部完成', COMPLETED_WITH_ISSUES: '已结束，有异常' };
    return { ...task, summary, statusText: labels[task.status] || '历史任务',
      createdAtText: this.formatDate(task.createdAt) || '时间未记录',
      confirmedAtText: this.formatDate(task.confirmedAt),
      startedAtText: this.formatDate(task.startedAt), finishedAtText: this.formatDate(task.finishedAt),
      progressPercent: summary.total ? Math.round(summary.completed * 100 / summary.total) : 0,
      isRunning: this.isBatchTaskRunning(task) && task.status !== 'LEGACY_PAUSED' };
  },

  updateBatchProgress: function(task) {
    task = this.sanitizeBatchTask(task);
    const labels = {
      WAITING: '等待处理', PROCESSING: '正在处理', PROCESSING_WECHAT: '正在补报微信', SUCCESS: '发货完成',
      FAILED: '发货失败', BLOCKED: '商品被其他任务占用', SHIPMENT_CREATED_WECHAT_FAILED: '发货完成，微信同步失败',
      NEEDS_REVIEW: '需人工核查'
    };
    const stageLabels = {
      WAITING: '等待处理', VALIDATING: '校验订单与数量',
      REQUESTING_WAYBILL: '准备获取面单', WAYBILL_API_CALL: '获取面单中',
      WAYBILL_ACQUIRED: '面单已获取', SHIPMENT_CREATED: '发货单已创建',
      WECHAT_REPORT: '上报微信', MANUALLY_VERIFIED: '人工核查完成',
      WECHAT_REVIEWED: '微信上报已核查'
    };
    const expanded = new Set((this.data.batchProgress?.groups || []).filter(g => g.expanded).map(g => String(g.id)));
    const groups = (task.groups || []).map(group => {
      const orders = new Map();
      for (const item of group.items || []) {
        const key = String(item.orderId);
        if (!orders.has(key)) orders.set(key, { orderId: item.orderId,
          orderNo: key, adminSeqNo: item.adminSeqNo,
          createdAtText: this.formatDate(item.orderCreatedAt), items: [] });
        orders.get(key).items.push({ ...item, productName: item.productName || '历史商品信息未记录' });
      }
      // 缺少历史快照时仍可进入关联订单。
      for (const id of group.orderIds || []) {
        if (!orders.has(String(id))) orders.set(String(id), { orderId: id, orderNo: String(id), items: [] });
      }
      return { ...group,
        expressName: getExpressName(group.expressCode),
        statusText: labels[group.status] || group.status,
        stageText: stageLabels[group.stage] || group.stage || '',
        orderText: (group.orderIds || []).join('、'),
        startedAtText: this.formatDate(group.startedAt), finishedAtText: this.formatDate(group.finishedAt),
        totalQty: (group.items || []).reduce((sum, item) => sum + Number(item.shipQty || 0), 0),
        orders: Array.from(orders.values()), expanded: expanded.has(String(group.id)),
        canReview: task.canOperate !== false && group.status === 'NEEDS_REVIEW' && !group.shipmentId,
        canReviewWechat: task.canOperate !== false && group.status === 'NEEDS_REVIEW' && !!group.shipmentId,
        canRetryWechat: false
      };
    });
    const decorated = this.decorateBatchTask(task);
    this.setData({
      batchTask: decorated,
      batchGroupPages: Math.max(1, Math.ceil(decorated.summary.total / 30)),
      batchProgress: { ...decorated.summary,
        canRetry: task.canOperate !== false && !decorated.isRunning && decorated.summary.failed > decorated.summary.review,
        hasPendingReview: decorated.summary.review > 0, groups }
    });
    const saved = this.getSavedBatchTask();
    if (saved && String(saved.taskId) === String(task.id) && !saved.historyOnly) {
      if (task.confirmedAt) { saved.confirmed = true; saved.submissionPending = false; }
      wx.setStorageSync(BATCH_TASK_STORAGE, saved);
    }
    this.batchTracePromise = this.loadBatchTraces(groups);
  },

  resetBatchTraces: function() {
    this.batchTraceVersion = (this.batchTraceVersion || 0) + 1;
    this.batchTraceScope = '';
    this.setData({ batchTraceMap: {} });
  },

  loadBatchTraces: async function(groups) {
    if (this.batchPageClosed) return;
    const scope = `${this.data.batchTask.id}:${this.data.batchGroupPage}`;
    if (scope !== this.batchTraceScope) {
      this.resetBatchTraces();
      this.batchTraceScope = scope;
    }
    const version = this.batchTraceVersion;
    const current = () => !this.batchPageClosed && version === this.batchTraceVersion;
    const ids = [...new Set(groups.filter(g => g.shipmentId && g.expressNo && !g.shipmentDeleted).map(g => String(g.shipmentId)))];
    const pending = ids.filter(id => !this.data.batchTraceMap[id]);
    if (!pending.length) return;
    const traceMap = { ...this.data.batchTraceMap };
    pending.forEach(id => { traceMap[id] = { loading: true, nodes: [], visibleNodes: [], expanded: false }; });
    this.setData({ batchTraceMap: traceMap });
    const worker = async () => {
      while (pending.length && current()) {
        const id = pending.shift();
        let result;
        try {
          const trace = await api.get(`/shipments/${id}/trace`);
          const nodes = (trace.nodes || []).map((node, index) => ({ ...node, index,
            timeDisplay: node.time && Number.isFinite(new Date(node.time).getTime()) ? this.formatDate(node.time) : node.time || '' }));
          result = { loading: false, expanded: false, nodes, visibleNodes: nodes.slice(0, 1) };
        } catch (err) {
          result = { loading: false, expanded: false, nodes: [], visibleNodes: [],
            error: getErrorMessage(err, '物流加载失败，请重试') };
        }
        if (current()) this.setData({ batchTraceMap: { ...this.data.batchTraceMap, [id]: result } });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
  },

  toggleBatchShipmentTrace: function(event) {
    const id = event.currentTarget.dataset.shipmentId;
    const trace = this.data.batchTraceMap[id];
    if (!trace || trace.nodes.length <= 1) return;
    const expanded = !trace.expanded;
    this.setData({ batchTraceMap: { ...this.data.batchTraceMap, [id]: {
      ...trace, expanded, visibleNodes: expanded ? trace.nodes : trace.nodes.slice(0, 1)
    } } });
  },

  retryBatchShipmentTrace: function(event) {
    const id = event.currentTarget.dataset.shipmentId;
    if (!this.data.batchTraceMap[id]?.error) return;
    const traceMap = { ...this.data.batchTraceMap };
    delete traceMap[id];
    this.setData({ batchTraceMap: traceMap });
    this.batchTracePromise = this.loadBatchTraces(this.data.batchProgress.groups);
    return this.batchTracePromise;
  },

  stopBatchPolling: function() {
    this.batchRunToken = (this.batchRunToken || 0) + 1;
    this.batchTaskRunning = false;
    if (this.batchPollTimer) clearTimeout(this.batchPollTimer);
    if (this.batchPollResolve) this.batchPollResolve();
    this.batchPollResolve = null;
  },

  runBatchTask: async function() {
    if (this.batchTaskRunning || this.batchPageClosed || !this.data.showBatchProgress) return;
    const taskId = this.data.batchTask?.id || this.getSavedBatchTask()?.taskId;
    if (!taskId) return;
    this.batchTaskRunning = true;
    const token = (this.batchRunToken || 0) + 1;
    this.batchRunToken = token;
    const current = () => this.batchRunToken === token && !this.batchPageClosed && this.data.showBatchProgress;
    try {
      while (current()) {
        const task = await api.get(`/shipments/batch-tasks/${taskId}`, { groupPage: this.data.batchGroupPage });
        if (!current()) return;
        this.updateBatchProgress(task);
        this.setData({ batchQueryError: '' });
        if (!this.isBatchTaskRunning(task)) {
          if (!this.data.viewingBatchHistory) {
            this.setData({ activeBatchTask: null });
            this.reloadPendingItems();
          }
          break;
        }
        await new Promise(resolve => {
          this.batchPollResolve = resolve;
          this.batchPollTimer = setTimeout(resolve, 2500);
        });
      }
    } catch (err) {
      if (current()) this.setData({ batchQueryError: '进度暂不可查，点击刷新重试；后台发货会继续处理' });
    } finally {
      if (this.batchRunToken === token) this.batchTaskRunning = false;
    }
  },

  retryBatchFailedGroups: async function() {
    const task = this.data.batchTask;
    if (!task || task.canOperate === false || this.data.batchSubmitting) return;
    this.setData({ batchSubmitting: true });
    this.stopBatchPolling();
    try {
      const updated = await api.post(`/shipments/batch-tasks/${task.id}/retry-failed`, {});
      this.setData({ batchGroupPage: 1 });
      this.updateBatchProgress(updated);
      wx.showToast({ title: '失败包裹已交后台重试', icon: 'none' });
      this.runBatchTask();
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '重试结果暂不可查，请刷新原任务确认'), icon: 'none' });
      this.runBatchTask();
    } finally { this.setData({ batchSubmitting: false }); }
  },

  continueLegacyBatchTask: function() {
    const task = this.data.batchTask;
    if (!task || task.canOperate === false) return;
    wx.showModal({ title: '继续后台发货', content: '确认后将按原任务的收货信息、商品和数量处理尚未执行的包裹，请先核对详情。',
      success: async result => {
        if (!result.confirm || this.data.batchSubmitting) return;
        this.setData({ batchSubmitting: true });
        try {
          this.setData({ batchGroupPage: 1 });
          this.updateBatchProgress(await api.post(`/shipments/batch-tasks/${task.id}/submit`, {}));
          this.runBatchTask();
        } catch (err) { wx.showToast({ title: getErrorMessage(err, '提交结果暂不可查，请刷新确认'), icon: 'none' }); }
        finally { this.setData({ batchSubmitting: false }); }
      }
    });
  },

  toggleBatchPackage: function(event) {
    const id = String(event.currentTarget.dataset.groupId);
    const groups = this.data.batchProgress.groups.map(g => String(g.id) === id ? { ...g, expanded: !g.expanded } : g);
    this.setData({ 'batchProgress': { ...this.data.batchProgress, groups } });
  },

  changeBatchGroupPage: async function(event) {
    const next = this.data.batchGroupPage + Number(event.currentTarget.dataset.step);
    if (next < 1 || next > this.data.batchGroupPages || this.data.batchDetailLoading) return;
    this.stopBatchPolling();
    this.setData({ batchGroupPage: next });
    this.runBatchTask();
  },

  copyBatchExpressNo: function(event) {
    clipboard.copyText(event.currentTarget.dataset.expressNo, '运单号');
  },

  reviewBatchGroup: function(event) {
    const groupId = event.currentTarget.dataset.groupId;
    const task = this.data.batchTask;
    if (!task || task.canOperate === false) return;
    wx.showModal({
      title: '人工核查确认',
      content: '请先在物流平台确认未取得面单，并在后台确认未创建发货单。确认后才可解除占用。',
      editable: true,
      placeholderText: '填写核查依据',
      success: async result => {
        if (!result.confirm) return;
        try {
          const updated = await api.post(`/shipments/batch-tasks/${task.id}/groups/${groupId}/confirm-no-shipment`,
            { note: result.content });
          this.setData({ batchGroupPage: 1 });
          this.updateBatchProgress(updated);
        } catch (err) {
          wx.showToast({ title: getErrorMessage(err, '人工核查确认失败'), icon: 'none' });
        }
      }
    });
  },

  reviewBatchWechat: function(event) {
    const groupId = event.currentTarget.dataset.groupId;
    const task = this.data.batchTask;
    if (!task || task.canOperate === false) return;
    wx.showModal({
      title: '核查微信上报',
      content: '请先核对微信后台。填写仍需补报的订单 ID，多个用逗号隔开；全部已上报则留空。',
      editable: true,
      placeholderText: '待补报订单 ID',
      success: idsResult => {
        if (!idsResult.confirm) return;
        const failedOrderIds = (idsResult.content || '').split(/[,，、\s]+/).filter(Boolean);
        wx.showModal({
          title: '填写核查依据',
          editable: true,
          placeholderText: '微信后台核查结果及时间',
          success: async noteResult => {
            if (!noteResult.confirm) return;
            try {
              const updated = await api.post(
                `/shipments/batch-tasks/${task.id}/groups/${groupId}/resolve-wechat-review`,
                { failedOrderIds, note: noteResult.content });
              this.setData({ batchGroupPage: 1 });
              this.updateBatchProgress(updated);
            } catch (err) {
              wx.showToast({ title: getErrorMessage(err, '微信上报核查保存失败'), icon: 'none' });
            }
          }
        });
      }
    });
  },

  retryBatchWechat: async function(event) {
    const task = this.data.batchTask;
    if (!task || task.canOperate === false) return;
    const groupId = event.currentTarget.dataset.groupId;
    try {
      const updated = await api.post(`/shipments/batch-tasks/${task.id}/groups/${groupId}/retry-wechat`, {});
      this.setData({ batchGroupPage: 1 });
      this.updateBatchProgress(updated);
      this.runBatchTask(false);
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '微信补报启动失败'), icon: 'none' });
    }
  },

  closeBatchProgress: function() {
    this.stopBatchPolling();
    this.resetBatchTraces();
    const history = this.data.viewingBatchHistory;
    const saved = this.getSavedBatchTask();
    // 兼容旧版本遗留的历史缓存，不影响当前真正提交的任务。
    if (saved?.historyOnly) wx.removeStorageSync(BATCH_TASK_STORAGE);
    this.setData({ showBatchProgress: false, viewingBatchHistory: false, batchQueryError: '',
      showRecentBatchTasks: history });
    if (history) this.loadBatchTaskHistory(true);
    this.refreshActiveBatchTask();
  },

  finishBatchTask: async function() {
    const progress = this.data.batchProgress;
    if (!progress || progress.completed !== progress.total) return;
    const saved = this.getSavedBatchTask();
    if (!this.data.viewingBatchHistory && saved && String(saved.taskId) === String(this.data.batchTask?.id)) {
      wx.removeStorageSync(BATCH_TASK_STORAGE);
    }
    this.closeBatchProgress();
  },

  openBatchProgress: async function() {
    const taskId = this.data.activeBatchTask?.id || this.getSavedBatchTask()?.taskId;
    if (!taskId) return;
    await this.openBatchTaskDetail(taskId, false);
  },

  openRecentBatchTasks: function() {
    this.setData({ showRecentBatchTasks: true });
    return this.loadBatchTaskHistory(true);
  },

  loadBatchTaskHistory: async function(reset = false) {
    if (this.data.historyLoading || (!reset && !this.data.historyHasMore)) return;
    const filter = this.data.historyFilter;
    const page = reset ? 1 : this.data.historyPage + 1;
    this.setData({ historyLoading: true, historyError: '',
      ...(reset ? { recentBatchTasks: [], historyPage: 0, historyHasMore: true } : {}) });
    try {
      const result = await api.get('/shipments/batch-tasks/query', { page, filter });
      if (filter !== this.data.historyFilter || !this.data.showRecentBatchTasks) return;
      const tasks = (result.content || []).map(task => this.decorateBatchTask(task));
      this.setData({ recentBatchTasks: reset ? tasks : this.data.recentBatchTasks.concat(tasks),
        historyPage: page, historyHasMore: result.hasNext });
    } catch (err) {
      this.setData({ historyError: getErrorMessage(err, '历史任务加载失败，请重试') });
    } finally { this.setData({ historyLoading: false }); }
  },

  loadMoreBatchTaskHistory: function() { return this.loadBatchTaskHistory(false); },
  refreshBatchTaskHistory: function() { return this.loadBatchTaskHistory(true); },

  changeBatchHistoryFilter: function(event) {
    if (this.data.historyLoading) return;
    this.setData({ historyFilter: event.currentTarget.dataset.filter });
    this.loadBatchTaskHistory(true);
  },

  selectRecentBatchTask: function(event) {
    const task = this.data.recentBatchTasks[event.currentTarget.dataset.index];
    if (task) return this.openBatchTaskDetail(task.id, true);
  },

  openBatchTaskDetail: async function(taskId, history) {
    if (this.data.batchDetailLoading) return;
    this.stopBatchPolling();
    this.resetBatchTraces();
    const request = (this.batchDetailRequest || 0) + 1;
    this.batchDetailRequest = request;
    this.setData({ batchDetailLoading: true, batchGroupPage: 1, batchQueryError: '' });
    try {
      const task = await api.get(`/shipments/batch-tasks/${taskId}`, { groupPage: 1 });
      if (this.batchPageClosed || request !== this.batchDetailRequest) return;
      this.updateBatchProgress(task);
      this.setData({ showRecentBatchTasks: false, viewingBatchHistory: history, showBatchProgress: true });
      this.runBatchTask();
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '任务详情加载失败，请重试'), icon: 'none' });
    } finally { this.setData({ batchDetailLoading: false }); }
  },

  closeRecentBatchTasks: function() {
    this.batchDetailRequest = (this.batchDetailRequest || 0) + 1;
    this.setData({ showRecentBatchTasks: false, batchDetailLoading: false });
  },

  onUnload: function() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchRequestVersion = (this.searchRequestVersion || 0) + 1;
    this.batchPageClosed = true;
    this.stopBatchPolling();
    this.resetBatchTraces();
  },

  // ==================== 工具函数 ====================

  formatCalendarDate: function(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  formatDate: function(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
});
