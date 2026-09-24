// adminOrder.js - 完整版
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
    searchKeyword: '',
    searchDropdown: [],  // 搜索下拉列表
    searchFocus: false,  // 是否聚焦
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
    showSkuModal: false,
    showPreviewModal: false,
    selectedProduct: null,
    previewGroups: [],
    canShip: false,
    page: 0,
    hasMore: true,
    loadingMore: false,
    selectingAll: false,
    blockedAfterSaleCount: 0
  },

  onLoad: async function() {
    this.setData({ today: this.formatCalendarDate(new Date()) });
    try {
      await auth.ensureAuthenticated({ silent: true });
    } catch (err) {
      wx.showToast({ title: '登录状态恢复失败，请稍后重试', icon: 'none' });
      return;
    }
    this.loadLogisticsAccounts();
    this.loadStallList();
    this.loadTagList();
    // 空搜索时，自动加载所有未发货商品明细
    this.loadAllPendingItems();
  },

  onPullDownRefresh: async function() {
    try {
      await Promise.all([this.reloadPendingItems(), this.loadLogisticsAccounts(),
        this.loadStallList(), this.loadTagList()]);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onReachBottom: function() {
    if (!this.data.selectingAll) this.loadNextPendingPage();
  },

  loadMorePendingItems: function() {
    if (!this.data.selectingAll) this.loadNextPendingPage();
  },

  copyOrderNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.orderNo, '订单号');
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
      this.setData({
        logisticsAccounts: accounts,
        logisticsIndex: 0
      });
    } catch (err) {
      console.error('加载物流账号失败:', err);
      wx.showToast({ title: '加载物流账号失败', icon: 'none' });
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
          await api.patch(`/admin/orders-manage/orders/${item.orderId}/items/${item.orderItemId}/admin-remark`, { remark: result.content || '' });
          wx.showToast({ title: '已保存', icon: 'success' });
          this.reloadPendingItems();
        } catch (err) { wx.showToast({ title: err.message || '保存失败', icon: 'none' }); }
      }
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
    let startDate;
    if (type === '7days') {
      startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    } else if (type === '30days') {
      startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    } else {
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
    this.setData({
      selectedStall: stallId === 'all' ? '' : stallId,
      searchDropdown: []
    }, () => this.reloadPendingItems());
  },

  selectTag: function(e) {
    const tagId = e.currentTarget.dataset.tag;
    this.setData({
      selectedTag: tagId === 'all' ? '' : tagId,
      searchDropdown: []
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
    this.setData({ searchKeyword: keyword });
    
    // 清空下拉列表
    if (!keyword) {
      this.setData({ searchDropdown: [] });
      return;
    }
    
    // 防抖：500ms 后搜索
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    
    this.searchTimer = setTimeout(() => {
      this.searchProducts();
    }, 500);
  },

  // 搜索商品
  searchProducts: async function() {
    const keyword = this.data.searchKeyword.trim();
    if (!keyword) {
      this.setData({ searchDropdown: [] });
      return;
    }

    try {
      const res = await api.get('/products/query', {
        keyword,
        ...(this.data.selectedStall ? { stallId: this.data.selectedStall } : {}),
        ...(this.data.selectedTag ? { tagId: this.data.selectedTag } : {}),
        page: 1,
        size: 10
      });
      const products = (res && res.content) || (Array.isArray(res) ? res : []);
      
      // 获取已选商品 ID 列表
      const selectedIds = this.data.selectedProducts.map(p => p.id);
      
      // 标记已选商品
      const markedProducts = products.map(p => ({
        ...p,
        skuCount: p.skus ? p.skus.length : 0,
        isSelected: selectedIds.includes(p.id)
      }));
      
      // 更新下拉列表
      this.setData({
        searchDropdown: markedProducts
      });
    } catch (err) {
      console.error('搜索商品失败:', err);
      this.setData({ searchDropdown: [] });
    }
  },

  // 点击搜索按钮
  onSearchConfirm: function() {
    this.setData({ searchDropdown: [], searchFocus: false }, () => this.reloadPendingItems());
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
    
    // 添加到已选列表
    const selectedProducts = [...this.data.selectedProducts, {
      ...product,
      skuCount: 0,
      selectedSkus: []
    }];
    
    this.setData({
      selectedProducts,
      searchDropdown: [],
      searchKeyword: ''
    });
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
      }).catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '加载 SKU 失败', icon: 'none' });
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
          skuCount: selectedSkus.length,
          selectedSkus: selectedSkus
        };
      }
      return p;
    });

    this.setData({
      selectedProducts,
      showSkuModal: false
    });
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
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
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
          orderNo: item.orderNo || item.orderId,
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
    const orderIds = {};
    const groupsMap = new Map();
    pendingShipItems.forEach((item, index) => {
      orderIds[item.orderId] = true;
      if (!groupsMap.has(item.orderId)) {
        groupsMap.set(item.orderId, {
          orderId: item.orderId,
          adminSeqNo: item.adminSeqNo || '',
          orderNo: item.orderNo || item.orderId,
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
      wx.showToast({ title: '校验待发货状态失败，请重试', icon: 'none' });
      return;
    }
    wx.hideLoading();

    if (!this.validatePendingShipItems()) {
      return;
    }

    // 检查剩余单号：按收件人分组后需要的面单数 vs 剩余余额
    const account = this.data.logisticsAccounts[this.data.logisticsIndex];
    const groupsMap = {};
    this.data.pendingShipItems.forEach(item => {
      const key = `${item.recipientName}|${item.recipientPhone}|${item.recipientAddress}`;
      groupsMap[key] = true;
    });
    const neededWaybills = Object.keys(groupsMap).length;
    if (account.quotaNum < neededWaybills) {
      wx.showToast({
        title: `剩余单号不足 (${account.quotaNum} < ${neededWaybills})`,
        icon: 'none'
      });
      return;
    }

    this.setData({ showPendingShipList: false });
    // 生成发货预览
    this.generatePreview();
  },

  generatePreview: function() {
    // 按收件人信息分组
    const groupsMap = {};

    this.data.pendingShipItems.forEach(item => {
      const key = `${item.recipientName}|${item.recipientPhone}|${item.recipientAddress}`;

      if (!groupsMap[key]) {
        groupsMap[key] = {
          recipientName: item.recipientName,
          recipientPhone: item.recipientPhone,
          recipientAddress: item.recipientAddress,
          packageCount: 0,  // 包裹数（商品种类数）
          totalItems: 0,    // 总商品件数
          items: []
        };
      }

      groupsMap[key].packageCount += 1;  // 每个 item 是一个商品种类
      groupsMap[key].totalItems += (item.shipQty || 0);  // 累加发货数量
      groupsMap[key].items.push(item);
    });

    const previewGroups = Object.values(groupsMap);

    this.setData({
      previewGroups,
      canShip: true,
      showPreviewModal: true
    });
  },

  closePreviewModal: function() {
    this.setData({ showPreviewModal: false });
  },

  confirmBatchShip: async function() {
    if (!this.validatePendingShipItems()) {
      return;
    }
    wx.showLoading({ title: '发货中...' });

    try {
      const selectedAccount = this.data.logisticsAccounts[this.data.logisticsIndex];
      const accountId = selectedAccount.bizId;
      const expressCode = selectedAccount.deliveryId;  // 获取快递公司编码

      // 调用批量发货 API
      await api.post('/shipments/batch-create', {
        accountId: accountId,
        expressCode: expressCode,  // 传递快递公司编码
        items: this.data.pendingShipItems.map(item => ({
          orderId: item.orderId,
          orderItemId: item.orderItemId,
          skuId: item.skuId,
          shipQty: item.shipQty
        }))
      });

      wx.hideLoading();
      wx.showToast({ title: '发货成功', icon: 'success' });

      // 清除选中状态并重新加载
      this.setData({
        selectedItems: [],
        pendingShipItems: [],
        pendingOrderGroups: [],
        pendingOrderCount: 0,
        pendingItemCount: 0,
        pendingTotalQty: 0,
        allSelected: false,
        showPreviewModal: false,
        showPendingShipList: false
      });

      // 自动重新加载未发货数据
      if (this.data.selectedProducts.length > 0) {
        this.loadPendingItems();
      } else {
        this.loadAllPendingItems();
      }

    } catch (err) {
      wx.hideLoading();
      console.error('批量发货失败:', err);
      wx.showToast({ title: err.message || '发货失败', icon: 'none' });
    }
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
