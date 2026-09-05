// adminOrder.js - 完整版
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
    searchKeyword: '',
    searchDropdown: [],  // 搜索下拉列表
    searchFocus: false,  // 是否聚焦
    selectedProducts: [],  // 已选商品列表 (SPU 维度)
    selectedSkuIds: [],    // 已选 SKU ID 列表
    logisticsAccounts: [],
    logisticsIndex: 0,
    orderGroups: [],       // 订单分组列表
    allSelected: false,
    selectedItems: [],     // 已选发货项
    loading: false,
    showSkuModal: false,
    showPreviewModal: false,
    selectedProduct: null,
    previewGroups: [],
    canShip: false,
    page: 0,
    hasMore: true,
    blockedAfterSaleCount: 0
  },

  onLoad: async function() {
    try {
      await auth.ensureAuthenticated({ silent: true });
    } catch (err) {
      wx.showToast({ title: '登录状态恢复失败，请稍后重试', icon: 'none' });
      return;
    }
    this.loadLogisticsAccounts();
    // 空搜索时，自动加载所有未发货商品明细
    this.loadAllPendingItems();
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

  // ==================== 商品搜索 ====================

  // 加载所有未发货商品明细（进入页面时调用）
  loadAllPendingItems: async function() {
    wx.showLoading({ title: '加载中...' });

    try {
      // 调用后端 API，不传参数表示查询所有未发货商品
      const res = await api.get('/shipments/pending-items');
      
      const items = res || [];
      
      // 按订单分组
      const grouped = this.groupByOrder(items);
      
      this.setData({
        orderGroups: grouped.groups,
        blockedAfterSaleCount: grouped.blockedAfterSaleCount,
        hasMore: false,
        page: 1
      });
    } catch (err) {
      console.error('加载未发货商品失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
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
      const res = await api.get(`/products/search?keyword=${encodeURIComponent(keyword)}&limit=10`);
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
    this.setData({ searchDropdown: [], searchFocus: false });

    if (this.data.selectedProducts.length === 0) {
      this.loadAllPendingItems();
      return;
    }

    const productsWithoutSkus = this.data.selectedProducts.filter(p => !p.skus || p.skus.length === 0);
    if (productsWithoutSkus.length > 0) {
      this.loadProductsSkus(productsWithoutSkus);
    } else {
      this.loadPendingItems();
    }
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
    
    Promise.all(promises).then(results => {
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
      this.loadPendingItems();
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
  loadPendingItems: async function() {
    if (this.data.selectedProducts.length === 0) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
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
      return;
    }

    wx.showLoading({ title: '加载中...' });

    try {
      // 调用后端 API 获取未发货商品明细
      const skuIdsParam = selectedSkuIds.join(',');
      const res = await api.get(`/shipments/pending-items?skuIds=${skuIdsParam}`);
      
      const items = res || [];
      
      // 按订单分组
      const grouped = this.groupByOrder(items);
      
      this.setData({
        orderGroups: grouped.groups,
        blockedAfterSaleCount: grouped.blockedAfterSaleCount,
        hasMore: false,
        page: 1
      });
    } catch (err) {
      console.error('加载未发货商品失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 按订单分组
  groupByOrder: function(items) {
    const groupsMap = {};

    items.forEach(item => {
      const key = item.orderId;
      if (!groupsMap[key]) {
        groupsMap[key] = {
          orderId: item.orderId,
          adminSeqNo: item.adminSeqNo || '',
          orderNo: item.orderNo || item.orderId,
          createdAt: this.formatDate(item.orderCreatedAt),
          recipientName: item.recipientName,
          recipientPhone: item.recipientPhone,
          recipientAddress: item.recipientAddress,
          selected: false,
          items: []
        };
      }

      groupsMap[key].items.push({
        orderItemId: item.orderItemId,
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
        canShip: (item.unshippedQty || 0) > 0,
        shipQty: Math.max(0, item.unshippedQty || 0),
        selected: false
      });
    });

    const allGroups = Object.values(groupsMap);
    const blockedAfterSaleCount = allGroups.filter(group =>
      group.items.length > 0 &&
      group.items.every(item => !item.canShip) &&
      group.items.some(item => item.afterSaleQty > 0 || item.afterSaleStatus)
    ).length;

    // 过滤：去掉所有商品都因售后不可发的订单，但保留部分售后仍可发的订单
    const groups = allGroups
      .filter(group => group.items.some(item => item.canShip))
      .sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });

    return { groups, blockedAfterSaleCount };
  },

  // ==================== 选择逻辑 ====================

  toggleSelectAll: function() {
    const allSelected = !this.data.allSelected;
    
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
    const selectedItems = [];

    orderGroups.forEach(group => {
      group.items.forEach(item => {
        if (item.canShip && item.selected) {
          selectedItems.push({
            orderItemId: item.orderItemId,
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
            shipQty: item.shipQty || 0,  // 确保包含最新的发货数量
            orderId: group.orderId,
            orderNo: group.orderNo,
            recipientName: group.recipientName,
            recipientPhone: group.recipientPhone,
            recipientAddress: group.recipientAddress
          });
        }
      });
    });

    // 检查是否全选
    const selectableGroups = orderGroups.filter(g => g.items.some(item => item.canShip));
    const allSelected = selectableGroups.length > 0 && selectableGroups.every(g => g.selected);

    this.setData({
      orderGroups,
      selectedItems,
      allSelected
    });
  },

  onShipQtyInput: function(e) {
    const groupIndex = e.currentTarget.dataset.groupIndex;
    const itemIndex = e.currentTarget.dataset.itemIndex;
    const value = parseInt(e.detail.value) || 0;

    const item = this.data.orderGroups[groupIndex].items[itemIndex];

    // 限制最大值为未发货数量
    item.shipQty = Math.min(value, item.unshippedQty);

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
    }
  },

  // ==================== 批量发货 ====================

  batchShip: function() {
    if (this.data.selectedItems.length === 0) {
      wx.showToast({ title: '请选择要发货的商品', icon: 'none' });
      return;
    }

    if (!this.data.logisticsAccounts[this.data.logisticsIndex]) {
      wx.showToast({ title: '请选择物流账号', icon: 'none' });
      return;
    }

    // 检查剩余单号：按收件人分组后需要的面单数 vs 剩余余额
    const account = this.data.logisticsAccounts[this.data.logisticsIndex];
    const groupsMap = {};
    this.data.selectedItems.forEach(item => {
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

    // 生成发货预览
    this.generatePreview();
  },

  generatePreview: function() {
    // 按收件人信息分组
    const groupsMap = {};

    this.data.selectedItems.forEach(item => {
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
    wx.showLoading({ title: '发货中...' });

    try {
      const selectedAccount = this.data.logisticsAccounts[this.data.logisticsIndex];
      const accountId = selectedAccount.bizId;
      const expressCode = selectedAccount.deliveryId;  // 获取快递公司编码

      // 调用批量发货 API
      await api.post('/shipments/batch-create', {
        accountId: accountId,
        expressCode: expressCode,  // 传递快递公司编码
        items: this.data.selectedItems.map(item => ({
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
        allSelected: false,
        showPreviewModal: false
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
