const { getErrorMessage } = require('../../utils/error');
const autoSearch = require('../../utils/autoSearch');
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const quantityOperation = require('../../utils/quantityOperation');
const { beijingParts } = require('../../utils/productSchedule');

function normalizeSku(row) {
  return {
    id: row.skuId, spec: row.spec || '', size: row.size || '', imageUrl: row.skuImageUrl || '',
    availableQty: row.qty || 0, shortageQty: row.shortageQty || 0,
    abnormalQty: row.abnormalQty || 0,
    shippableQty: row.shippableQty == null ? (row.qty || 0) : row.shippableQty,
    reservedQty: row.reservedQty || 0, reportedQty: row.reportedQty || 0,
    receivedQty: row.receivedQty || 0, freeStockQty: row.freeStockQty || 0,
    orderAllocatedQty: row.orderAllocatedQty || 0, customerMissingQty: row.customerMissingQty || 0,
    readyToShipQty: row.readyToShipQty || 0, frozenStockQty: row.frozenStockQty || 0,
    surplusTransitQty: row.surplusTransitQty || 0, frozenDemandQty: row.frozenDemandQty || 0
  };
}
function positiveInteger(value) {
  return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}
function batchQuantity(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text)) return null;
  const qty = Number(text);
  return Number.isSafeInteger(qty) && qty <= 2147483647 ? qty : null;
}

Page(autoSearch.wrap({
  data: {
    productList: [], loading: false, keyword: '', inventoryTab: 'all',
    inventoryTabs: [
      { id: 'all', name: '全部' }, { id: 'shortage', name: '待到货' },
      { id: 'stock', name: '现货' }, { id: 'abnormal', name: '异常' }
    ],
    page: 1, pageSize: 20, hasMore: true,
    dateRange: { startDate: '', endDate: '', quickSelect: '' },
    editingDateRange: { startDate: '', endDate: '', quickSelect: '' },
    showDateModal: false, today: '',
    stallList: [], tagList: [], selectedStall: '', selectedTag: '',
    showSkuModal: false, selectedProduct: null, selectedSku: null, currentQty: 0,
    detailLoading: false, reportList: [], receiptList: [], ledgerList: [],
    activeTab: 'operate', operateType: 'normal', inputQty: '', note: '',
    stocktakeDirection: 'gain', stocktakeCategory: 'normal', abnormalAction: 'keep',
    quantityRetryPending: false, unbindReviewAvailable: false, exchangeList: [], returnInspectionList: [], targetSkuId: '', targetPurchaseOrderId: '', receiptId: '',
    saving: false, showShippingModal: false, shippingLoading: false,
    shippingProducts: [], matching: false,
    selectedCount: 0, allSelected: false,
    pendingReceiveItems: [], pendingReceiveTotal: 0, pendingReceiveProductCount: 0,
    showBatchReceiveModal: false, batchReceiveItems: [], batchReceiveSource: 'normal',
    batchReceiveTotal: 0, batchReceiveSkuCount: 0, batchReceiveSaving: false, batchRetryPending: false
  },

  onLoad() { this.setData({ today: beijingParts().date, quantityRetryPending: !!quantityOperation.pending() }); this.loadProducts(); this.loadFilterOptions(); this.restoreBatchReceive(); },
  onShow() {
    this.syncQuantityPending();
    if (this._refreshAfterShipping) {
      this._refreshAfterShipping = false;
      this.loadProducts();
    }
  },
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadProducts(false);
  },
  async loadFilterOptions() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      const results = await Promise.allSettled([api.get('/stalls/all'), api.get('/tags/all')]);
      this.setData({
        stallList: results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [],
        tagList: results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : []
      });
      if (results.some(result => result.status === 'rejected')) {
        console.error('加载库存档口或标签筛选项失败:', results.filter(result => result.status === 'rejected').map(result => result.reason));
        wx.showToast({ title: '部分筛选项加载失败，请重新进入页面', icon: 'none' });
      }
    } catch (err) {
      console.error('加载库存筛选项失败:', err);
      wx.showToast({ title: getErrorMessage(err, '加载筛选项失败'), icon: 'none' });
    }
  },
  async loadProducts(reset = true) {
    if (!reset && (!this.data.hasMore || this.data.loading)) return;
    const version = (this._listVersion || 0) + 1;
    this._listVersion = version;
    this.rememberReceiveProducts();
    if (reset) this.setData({ page: 1, productList: [], hasMore: true, allSelected: false });
    this.setData({ loading: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const query = { page: this.data.page, size: this.data.pageSize, tab: this.data.inventoryTab };
      const keyword = this.data.keyword.trim();
      if (keyword) query.keyword = keyword;
      if (this.data.selectedStall !== '') query.stallId = this.data.selectedStall;
      if (this.data.selectedTag !== '') query.tagId = this.data.selectedTag;
      if (this.data.dateRange.startDate) query.startDate = this.data.dateRange.startDate;
      if (this.data.dateRange.endDate) query.endDate = this.data.dateRange.endDate;
      const result = await api.get('/sku-inventory/query', query);
      if (this._listVersion !== version) return;
      const existing = reset ? [] : this.data.productList;
      const grouped = new Map(existing.map(product => [String(product.id), { ...product, skus: [...product.skus] }]));
      (result.content || []).forEach(row => {
        const key = String(row.productId);
        const product = grouped.get(key) || { id: row.productId, name: row.productName, coverUrl: row.coverUrl, selected: false, skus: [] };
        const sku = normalizeSku(row);
        const index = product.skus.findIndex(item => String(item.id) === String(sku.id));
        if (index < 0) product.skus.push(sku); else product.skus[index] = sku;
        grouped.set(key, product);
      });
      this.setData({
        productList: this.restoreReceiveProducts([...grouped.values()]), page: query.page + 1,
        hasMore: Boolean(result.hasNext), loading: false
      });
      this.updateProductSelection();
    } catch (err) {
      if (this._listVersion !== version) return;
      console.error('加载仓库库存失败:', err);
      wx.showToast({ title: getErrorMessage(err, '加载库存失败'), icon: 'none' });
      this.setData({ loading: false });
    }
  },
  formatCalendarDate: function(date) {
    const year = date.getUTCFullYear();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  showDateRangeSelector: function() {
    this.setData({
      today: beijingParts().date,
      editingDateRange: { ...this.data.dateRange },
      showDateModal: true
    });
  },

  closeDateModal: function() {
    this.setData({ showDateModal: false });
  },

  selectDateRange: function(e) {
    const type = e.currentTarget.dataset.type;
    const today = new Date(`${beijingParts().date}T00:00:00Z`);
    let startDate = today;
    if (type === '7days') {
      startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6));
    } else if (type === '30days') {
      startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 29));
    } else if (type === 'month') {
      startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
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
    }, () => this.loadProducts());
  },

  confirmDateRange: function() {
    const range = this.data.editingDateRange;
    if (range.startDate && range.endDate && range.startDate > range.endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.setData({ dateRange: { ...range }, showDateModal: false },
      () => this.loadProducts());
  },

  changeInventoryTab(e) {
    const inventoryTab = e.currentTarget.dataset.tab;
    if (inventoryTab === this.data.inventoryTab) return;
    this.setData({ inventoryTab });
    this.loadProducts();
  },
  selectStall(e) {
    const value = e.currentTarget.dataset.stall;
    const selectedStall = value === 'all' ? '' : value;
    if (String(selectedStall) === String(this.data.selectedStall)) return;
    this.setData({ selectedStall });
    return this.loadProducts();
  },
  selectTag(e) {
    const value = e.currentTarget.dataset.tag;
    const selectedTag = value === 'all' ? '' : value;
    if (String(selectedTag) === String(this.data.selectedTag)) return;
    this.setData({ selectedTag });
    return this.loadProducts();
  },
  onKeywordInput(e) { this.setData({ keyword: e.detail.value }); },
  search() { return this.loadProducts(); },
  receiveDrafts() {
    if (!this._receiveDrafts) this._receiveDrafts = new Map();
    return this._receiveDrafts;
  },
  rememberReceiveProducts() {
    const drafts = this.receiveDrafts();
    this.data.productList.forEach(product => drafts.set(String(product.id), {
      ...product, skus: product.skus.map(sku => ({ ...sku, receiveQty: sku.receiveQty == null ? 0 : sku.receiveQty }))
    }));
  },
  restoreReceiveProducts(products) {
    const drafts = this.receiveDrafts();
    return products.map(product => {
      const saved = drafts.get(String(product.id));
      const quantities = new Map((saved ? saved.skus : []).map(sku => [String(sku.id), sku.receiveQty]));
      return {
        ...product, selected: saved ? Boolean(saved.selected) : Boolean(product.selected),
        skus: product.skus.map(sku => ({ ...sku, receiveQty: quantities.has(String(sku.id))
          ? quantities.get(String(sku.id)) : (sku.receiveQty == null ? 0 : sku.receiveQty) }))
      };
    });
  },
  receiveItem(product, sku) {
    return {
      skuId: sku.id, productId: product.id, productName: product.name,
      imageUrl: sku.imageUrl || product.coverUrl || '/images/default-goods-image.png',
      spec: sku.spec, size: sku.size, shortageQty: sku.shortageQty || 0,
      qty: batchQuantity(sku.receiveQty)
    };
  },
  updateProductSelection() {
    this.rememberReceiveProducts();
    const selected = [...this.receiveDrafts().values()].filter(product => product.selected && product.skus.length);
    const selectable = this.data.productList.filter(product => product.skus && product.skus.length);
    const pendingReceiveItems = selected.flatMap(product => product.skus
      .filter(sku => batchQuantity(sku.receiveQty) > 0).map(sku => this.receiveItem(product, sku)));
    this.setData({
      selectedCount: selected.length,
      allSelected: selectable.length > 0 && selectable.every(product => product.selected),
      pendingReceiveItems,
      pendingReceiveTotal: pendingReceiveItems.reduce((sum, item) => sum + item.qty, 0),
      pendingReceiveProductCount: new Set(pendingReceiveItems.map(item => String(item.productId))).size
    });
  },
  toggleProductSelection(e) {
    if (this.data.batchReceiveSaving || this.data.batchRetryPending) return;
    const id = e.currentTarget.dataset.id;
    this.setData({ productList: this.data.productList.map(product => String(product.id) === String(id)
      && product.skus.length ? { ...product, selected: !product.selected } : product) });
    this.updateProductSelection();
  },
  toggleSelectAll() {
    if (this.data.batchReceiveSaving || this.data.batchRetryPending) return;
    const selected = !this.data.allSelected;
    this.setData({ productList: this.data.productList.map(product => ({ ...product, selected: selected && product.skus.length > 0 })) });
    this.updateProductSelection();
  },
  setCardReceiveQty(productId, skuId, qty) {
    if (this.data.batchReceiveSaving || this.data.batchRetryPending) return;
    this.setData({ productList: this.data.productList.map(product => {
      if (String(product.id) !== String(productId)) return product;
      if (skuId != null && !product.skus.some(sku => String(sku.id) === String(skuId))) return product;
      const skus = product.skus.map(sku => skuId == null || String(sku.id) === String(skuId)
        ? { ...sku, receiveQty: qty } : sku);
      return { ...product, skus, selected: skus.length > 0 };
    }) });
    this.updateProductSelection();
  },
  adjustCardReceiveQty(e) {
    if (this.data.batchReceiveSaving || this.data.batchRetryPending) return;
    const { productId, skuId, delta } = e.currentTarget.dataset;
    if (![1, -1].includes(Number(delta))) return;
    const product = this.data.productList.find(item => String(item.id) === String(productId));
    if (!product) return;
    const targets = product.skus.filter(sku => skuId == null || String(sku.id) === String(skuId));
    if (!targets.length) return;
    if (targets.some(sku => batchQuantity(sku.receiveQty) === null)) {
      wx.showToast({ title: '请先把入库数量改为非负整数', icon: 'none' }); return;
    }
    if (targets.some(sku => batchQuantity(Math.max(0, batchQuantity(sku.receiveQty) + Number(delta))) === null)) {
      wx.showToast({ title: '入库数量不能超过2147483647', icon: 'none' }); return;
    }
    this.setData({ productList: this.data.productList.map(item => {
      if (String(item.id) !== String(productId)) return item;
      const skus = item.skus.map(sku => skuId == null || String(sku.id) === String(skuId)
        ? { ...sku, receiveQty: Math.max(0, batchQuantity(sku.receiveQty) + Number(delta)) } : sku);
      return { ...item, skus, selected: true };
    }) });
    this.updateProductSelection();
  },
  onCardReceiveQtyInput(e) {
    const { productId, skuId } = e.currentTarget.dataset;
    this.setCardReceiveQty(productId, skuId, e.detail.value);
  },
  normalizeCardReceiveQty(e) {
    const { productId, skuId } = e.currentTarget.dataset;
    const product = this.data.productList.find(item => String(item.id) === String(productId));
    const sku = product && product.skus.find(item => String(item.id) === String(skuId));
    if (!sku) return;
    const qty = batchQuantity(sku.receiveQty);
    if (qty === null) { wx.showToast({ title: '入库数量请输入非负整数', icon: 'none' }); return; }
    this.setCardReceiveQty(productId, skuId, qty);
  },
  syncBatchReceiveDraft(item, qty) {
    this.rememberReceiveProducts();
    const drafts = this.receiveDrafts();
    const product = drafts.get(String(item.productId));
    if (!product) return;
    drafts.set(String(item.productId), { ...product, skus: product.skus.map(sku => String(sku.id) === String(item.skuId)
      ? { ...sku, receiveQty: qty } : sku) });
    this.setData({ productList: this.restoreReceiveProducts(this.data.productList) });
    this.updateProductSelection();
  },
  clearReceivedDraft(payload) {
    const skuIds = new Set([...payload.items, ...this.data.batchReceiveItems].map(item => String(item.skuId)));
    const drafts = this.receiveDrafts();
    drafts.forEach((product, key) => {
      if (!product.skus.some(sku => skuIds.has(String(sku.id)))) return;
      drafts.set(key, { ...product, selected: false,
        skus: product.skus.map(sku => skuIds.has(String(sku.id)) ? { ...sku, receiveQty: 0 } : sku) });
    });
    this.setData({ productList: this.restoreReceiveProducts(this.data.productList), batchReceiveItems: [],
      batchReceiveTotal: 0, batchReceiveSkuCount: 0 });
    this.updateProductSelection();
  },
  batchReceiveStorageKey() {
    const user = auth.getUserInfo ? auth.getUserInfo() : {};
    return 'warehouseBatchReceive_' + ((user && user.userId) || 'admin');
  },
  restoreBatchReceive() {
    try {
      const saved = wx.getStorageSync(this.batchReceiveStorageKey());
      if (!saved || !saved.payload || !saved.payload.requestId || !Array.isArray(saved.preview)) return;
      this._pendingBatchReceive = saved.payload;
      const drafts = this.receiveDrafts();
      saved.preview.forEach(item => {
        const key = String(item.productId);
        const product = drafts.get(key) || { id: item.productId, name: item.productName, selected: true, skus: [] };
        const sku = { id: item.skuId, spec: item.spec, size: item.size, imageUrl: item.imageUrl,
          shortageQty: item.shortageQty, receiveQty: item.qty };
        const index = product.skus.findIndex(value => String(value.id) === String(item.skuId));
        if (index < 0) product.skus.push(sku); else product.skus[index] = sku;
        drafts.set(key, { ...product, selected: true });
      });
      this.setData({ productList: this.restoreReceiveProducts(this.data.productList) });
      this.updateProductSelection();
      this.setData({ batchReceiveItems: saved.preview, batchReceiveSource: saved.payload.source,
        batchRetryPending: true, showBatchReceiveModal: true });
      this.updateBatchReceiveSummary();
    } catch (err) { console.error('读取待确认批量入库记录失败:', err); }
  },
  openBatchReceiveModal() {
    if (this.data.batchReceiveSaving) return;
    if (this._pendingBatchReceive) {
      this.setData({ showBatchReceiveModal: true });
      return;
    }
    this.updateProductSelection();
    if ([...this.receiveDrafts().values()].some(product => product.selected
      && product.skus.some(sku => batchQuantity(sku.receiveQty) === null))) {
      wx.showToast({ title: '已选商品的入库数量请输入非负整数', icon: 'none' }); return;
    }
    if (!this.data.pendingReceiveItems.length) {
      wx.showToast({ title: '请填写大于0的数量并选择要入库的商品', icon: 'none' }); return;
    }
    this.setData({ batchReceiveItems: this.data.pendingReceiveItems.map(item => ({ ...item })),
      showBatchReceiveModal: true, batchRetryPending: false });
    this.updateBatchReceiveSummary();
  },
  closeBatchReceiveModal() {
    if (!this.data.batchReceiveSaving) this.setData({ showBatchReceiveModal: false });
  },
  changeBatchReceiveSource(e) {
    if (this.data.batchReceiveSaving || this.data.batchRetryPending) return;
    const source = e.currentTarget.dataset.source;
    if (['normal', 'history'].includes(source)) this.setData({ batchReceiveSource: source });
  },
  setBatchReceiveQty(index, qty) {
    if (this.data.batchReceiveSaving || this.data.batchRetryPending || !this.data.batchReceiveItems[index]) return;
    const item = this.data.batchReceiveItems[index];
    this.setData({ batchReceiveItems: this.data.batchReceiveItems.map((item, i) => i === index ? { ...item, qty } : item) });
    this.syncBatchReceiveDraft(item, qty);
    this.updateBatchReceiveSummary();
  },
  adjustBatchReceiveQty(e) {
    const { index, delta } = e.currentTarget.dataset;
    const item = this.data.batchReceiveItems[Number(index)];
    if (!item) return;
    const qty = Math.max(0, (batchQuantity(item.qty) || 0) + Number(delta));
    if (batchQuantity(qty) !== null) this.setBatchReceiveQty(Number(index), qty);
  },
  onBatchReceiveQtyInput(e) { this.setBatchReceiveQty(Number(e.currentTarget.dataset.index), e.detail.value); },
  normalizeBatchReceiveQty(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.batchReceiveItems[index];
    if (!item) return;
    const qty = batchQuantity(item.qty);
    if (qty === null) { wx.showToast({ title: '入库数量请输入非负整数', icon: 'none' }); return; }
    this.setBatchReceiveQty(index, qty);
  },
  updateBatchReceiveSummary() {
    const quantities = this.data.batchReceiveItems.map(item => batchQuantity(item.qty) || 0);
    this.setData({ batchReceiveTotal: quantities.reduce((sum, qty) => sum + qty, 0),
      batchReceiveSkuCount: quantities.filter(qty => qty > 0).length });
  },
  clearPendingBatchReceive() {
    this._pendingBatchReceive = null;
    this.setData({ batchRetryPending: false });
    try { wx.removeStorageSync(this.batchReceiveStorageKey()); }
    catch (err) { console.error('清除待确认批量入库记录失败:', err); }
  },
  async confirmBatchReceive() {
    if (this.data.batchReceiveSaving) return;
    let payload = this._pendingBatchReceive;
    if (!payload) {
      if (this.data.batchReceiveItems.some(item => batchQuantity(item.qty) === null)) {
        wx.showToast({ title: '入库数量请输入非负整数', icon: 'none' }); return;
      }
      const items = this.data.batchReceiveItems.filter(item => batchQuantity(item.qty) > 0)
        .map(item => ({ skuId: item.skuId, qty: batchQuantity(item.qty) }));
      if (!items.length) { wx.showToast({ title: '至少填写一个大于0的入库数量', icon: 'none' }); return; }
      if (items.length > 500) { wx.showToast({ title: '一次最多入库500个规格，请分批操作', icon: 'none' }); return; }
      payload = { requestId: 'receipt_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        source: this.data.batchReceiveSource, items };
      try {
        wx.setStorageSync(this.batchReceiveStorageKey(), { payload, preview: this.data.batchReceiveItems });
      } catch (err) {
        console.error('保存批量入库请求失败:', err);
        wx.showToast({ title: getErrorMessage(err, '保存入库请求失败，请重试'), icon: 'none' }); return;
      }
      this._pendingBatchReceive = payload;
    }
    this.setData({ batchReceiveSaving: true, batchRetryPending: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      await api.post('/sku-inventory/batch-receive', payload);
      this.clearPendingBatchReceive();
      this.clearReceivedDraft(payload);
      this.setData({ showBatchReceiveModal: false });
      payload.items.forEach(item => require('../../utils/pageSync').publish('picking-skus', item.skuId));
      wx.showToast({ title: '批量入库成功', icon: 'success' });
      await this.loadProducts();
    } catch (err) {
      if (err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 408) this.clearPendingBatchReceive();
      console.error('批量入库失败:', err);
      wx.showToast({ title: getErrorMessage(err, '入库结果待确认，请重试原批次'), icon: 'none' });
    } finally { this.setData({ batchReceiveSaving: false }); }
  },
  stopCardTap() {},
  operateSku(e) {
    const { product, sku } = e.currentTarget.dataset;
    if (sku) this.openSkuModal(product, sku);
  },
  openSkuModal(product, sku) {
    if (!sku || !sku.id) return;
    this.setData({
      selectedProduct: product, selectedSku: sku, currentQty: sku.availableQty || 0,
      showSkuModal: true, activeTab: 'operate', operateType: 'normal',
      inputQty: '', note: '', stocktakeDirection: 'gain', stocktakeCategory: 'normal',
      abnormalAction: 'keep', reportList: [], receiptList: [], ledgerList: [], exchangeList: [], returnInspectionList: [], targetSkuId: '', targetPurchaseOrderId: '', receiptId: ''
    });
    this.loadLedger(sku.id);
  },
  selectSku(e) {
    if (this.data.saving) return;
    const sku = this.data.selectedProduct.skus[Number(e.currentTarget.dataset.index)];
    this.setData({ selectedSku: sku, currentQty: sku.availableQty || 0, inputQty: '', note: '' });
    this.loadLedger(sku.id);
  },
  hideSkuModal() {
    if (this.data.saving) return;
    this._detailVersion = (this._detailVersion || 0) + 1;
    this.setData({ showSkuModal: false });
  },
  async loadLedger(skuId) {
    const version = (this._detailVersion || 0) + 1;
    this._detailVersion = version;
    this.setData({ detailLoading: true });
    try {
      const result = await api.get('/sku-inventory/' + skuId + '/detail');
      const extra = await Promise.all([api.get('/sku-inventory/' + skuId + '/exchanges'), api.get('/sku-inventory/' + skuId + '/return-inspections')]);
      if (this._detailVersion !== version || !this.data.showSkuModal) return;
      const selectedSku = normalizeSku(result.inventory);
      this.setData({
        exchangeList: Array.isArray(extra[0]) ? extra[0] : [], returnInspectionList: Array.isArray(extra[1]) ? extra[1] : [],
        selectedSku, currentQty: selectedSku.availableQty, reportList: result.reports || [],
        receiptList: (result.receipts || []).map(item => ({
          ...item, sourceText: this.getSourceText(item.source), timeText: this.formatTime(item.createdAt)
        })),
        ledgerList: (result.ledger || []).map(item => ({
          ...item, changeTypeText: this.getChangeTypeText(item.changeType), timeText: this.formatTime(item.createdAt)
        })),
        detailLoading: false
      });
    } catch (err) {
      if (this._detailVersion !== version) return;
      this.setData({ detailLoading: false });
      wx.showToast({ title: getErrorMessage(err, '加载库存明细失败'), icon: 'none' });
    }
  },
  switchTab(e) { this.setData({ activeTab: e.currentTarget.dataset.tab }); },
  setOperateType(e) { if (!this.data.saving) this.setData({ operateType: e.currentTarget.dataset.type, inputQty: '', note: '' }); },
  setStocktakeDirection(e) { this.setData({ stocktakeDirection: e.currentTarget.dataset.value }); },
  setStocktakeCategory(e) { this.setData({ stocktakeCategory: e.currentTarget.dataset.value }); },
  setAbnormalAction(e) { this.setData({ abnormalAction: e.currentTarget.dataset.value }); },
  onTargetSkuInput(e) { this.setData({ targetSkuId: e.detail.value.trim() }); },
  onTargetPurchaseInput(e) { this.setData({ targetPurchaseOrderId: e.detail.value.trim() }); },
  onReceiptIdInput(e) { this.setData({ receiptId: e.detail.value.trim() }); },
  syncQuantityPending() {
    const pending = quantityOperation.pending();
    this.setData({ quantityRetryPending: !!pending, unbindReviewAvailable: !!(pending && /^\/admin\/orders-manage\/orders\/shipments\/[^/]+\/(partial-)?unbind$/.test(pending.path)) });
  },
  async confirmPendingUnbindWaybill() {
    const pending = quantityOperation.pending();
    const match = pending && pending.path.match(/^\/admin\/orders-manage\/orders\/shipments\/([^/]+)\/(partial-)?unbind$/);
    if (!match || this.data.saving) return;
    const note = await new Promise(resolve => wx.showModal({ title: '核实面单取消', editable: true,
      placeholderText: '填写物流平台取消记录等核查依据', content: '仅在物流平台已经确认面单取消，且所选实物未出库或已回仓时办理。', success: r => resolve(r.confirm ? (r.content || '').trim() : ''), fail: () => resolve('') }));
    if (!note) return;
    this.setData({ saving: true });
    try {
      await api.post('/admin/orders-manage/orders/shipments/' + match[1] + '/unbind/' + encodeURIComponent(pending.payload.requestId) + '/confirm-waybill-cancelled', { note });
      await quantityOperation.retry(api);
      await this.loadProducts();
      wx.showToast({ title: '原解绑操作已完成', icon: 'success' });
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '核查或解绑未完成'), icon: 'none' }); }
    finally { this.setData({ saving: false }); this.syncQuantityPending(); }
  },
  async retryQuantityOperation() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try { await quantityOperation.retry(api); await this.loadProducts(); if (this.data.showSkuModal) await this.loadLedger(this.data.selectedSku.id); wx.showToast({ title: '原操作已确认', icon: 'success' }); }
    catch (err) { wx.showToast({ title: getErrorMessage(err, '原操作结果待确认'), icon: 'none' }); }
    finally { this.setData({ saving: false }); this.syncQuantityPending(); }
  },
  async postQuantity(path, payload) {
    try { return await quantityOperation.run(api, path, payload); }
    finally { this.syncQuantityPending(); }
  },
  onQtyInput(e) { this.setData({ inputQty: e.detail.value }); },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },
  async confirmOperate() {
    if (this.data.saving) return;
    if (!positiveInteger(this.data.inputQty)) {
      wx.showToast({ title: '请输入正整数数量', icon: 'none' }); return;
    }
    const { selectedSku, operateType, inputQty, note } = this.data;
    if ((operateType === 'stocktake' || operateType === 'backfill' || (operateType === 'abnormal' && this.data.abnormalAction === 'confirm_history')) && !note.trim()) {
      wx.showToast({ title: '盘点调整必须填写原因', icon: 'none' }); return;
    }
    if (operateType === 'abnormal' && Number(inputQty) > selectedSku.abnormalQty) {
      wx.showToast({ title: '处理数量超过异常库存', icon: 'none' }); return;
    }
    this.setData({ saving: true });
    try {
      const qty = Number(inputQty);
      if (operateType === 'stocktake') {
        await this.postQuantity('/sku-inventory/' + selectedSku.id + '/stocktake', {
          qty, direction: this.data.stocktakeDirection, category: this.data.stocktakeCategory, note: note.trim()
        });
      } else if (operateType === 'abnormal') {
        await this.postQuantity('/sku-inventory/' + selectedSku.id + '/abnormal/resolve', {
          qty, action: this.data.abnormalAction, note: note.trim(), targetSkuId: this.data.targetSkuId || null, purchaseOrderId: this.data.targetPurchaseOrderId || null
        });
      } else if (operateType === 'backfill') {
        await this.postQuantity('/sku-inventory/' + selectedSku.id + '/backfill', { qty, receiptId: this.data.receiptId || null, note: note.trim() });
      } else {
        await this.postQuantity('/sku-inventory', { skuId: selectedSku.id, qty, source: operateType, note: note.trim() });
      }
      await this.refreshSku(selectedSku.id);
      await this.loadLedger(selectedSku.id);
      this.setData({ inputQty: '', note: '' });
      wx.showToast({ title: '操作成功', icon: 'success' });
    } catch (err) {
      console.error('仓库库存操作失败:', err);
      wx.showToast({ title: getErrorMessage(err, '操作失败'), icon: 'none' });
    } finally { this.setData({ saving: false }); }
  },
  async adjustSupply(e) {
    if (this.data.saving) return;
    const report = e.currentTarget.dataset.item;
    try {
      const preview = await api.get('/sku-inventory/supply/' + report.purchaseOrderId + '/preview');
      const quantity = await this.promptQuantity('取消未到供货', '已到货 ' + preview.receivedQty + ' 件，待到货 ' + preview.pendingQty + ' 件。只填写供应商已确认取消/短交的数量。');
      if (!quantity) return;
      const note = await this.promptText('确认原因', '请记录供应商取消或短交的确认依据');
      if (!note) return;
      this.setData({ saving: true });
      await this.postQuantity('/sku-inventory/supply/' + report.purchaseOrderId + '/adjust', { qty: quantity, note });
      await this.refreshSku(this.data.selectedSku.id); await this.loadLedger(this.data.selectedSku.id);
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '供货调整失败'), icon: 'none' }); }
    finally { this.setData({ saving: false }); }
  },
  promptText(title, content) {
    return new Promise(resolve => wx.showModal({ title, content, editable: true, placeholderText: '请输入', success: r => resolve(r.confirm ? (r.content || '').trim() : ''), fail: () => resolve('') }));
  },
  async promptQuantity(title, content) {
    const value = await this.promptText(title, content);
    if (!value) return 0;
    if (!positiveInteger(value)) throw new Error('数量须为正整数');
    return Number(value);
  },
  async receiveExchange(e) {
    if (this.data.saving) return;
    const exchange = e.currentTarget.dataset.item;
    try {
      const qty = await this.promptQuantity('换回验收入库', '应回规格 ID：' + exchange.targetSkuId + '，待回 ' + (exchange.qty - exchange.receivedQty) + ' 件；确认实际收到正确规格。');
      if (!qty) return;
      this.setData({ saving: true });
      await this.postQuantity('/sku-inventory/exchanges/' + exchange.id + '/receive', { qty, note: '管理员确认正确规格换回' });
      await this.loadProducts(); await this.loadLedger(this.data.selectedSku.id);
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '换回验收失败'), icon: 'none' }); }
    finally { this.setData({ saving: false }); }
  },
  async disposeReturn(e) {
    if (this.data.saving) return;
    const item = e.currentTarget.dataset.item;
    try {
      const qty = await this.promptQuantity('处理不合格退件', '尚有 ' + item.rejectedQty + ' 件；填写实际退回客户或报损数量。');
      if (!qty) return;
      const note = await this.promptText('处理依据', '记录去向、物流单号或报损原因'); if (!note) return;
      const choice = await new Promise(resolve => wx.showActionSheet({ itemList: ['实际退回客户', '实际报损'], success: r => resolve(r.tapIndex), fail: () => resolve(-1) }));
      if (choice < 0) return;
      this.setData({ saving: true });
      await this.postQuantity('/sku-inventory/return-inspections/' + item.afterSaleItemId + '/dispose', { qty, action: choice === 0 ? 'return_customer' : 'scrap', note });
      await this.loadLedger(this.data.selectedSku.id);
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '退件处理失败'), icon: 'none' }); }
    finally { this.setData({ saving: false }); }
  },
  revokeLedger(e) {
    const item = e.currentTarget.dataset.item;
    if (!item.canRevoke || this.data.saving) return;
    const skuId = this.data.selectedSku.id;
    wx.showModal({
      title: '撤销入库', content: '撤销这笔入库 ' + item.qty + ' 件？对应的报单待到货会恢复。',
      success: async result => {
        if (!result.confirm) return;
        this.setData({ saving: true });
        try {
          await this.postQuantity('/sku-inventory/' + skuId + '/receipts/' + item.id + '/revoke', { note: '管理员撤销入库' });
          await this.refreshSku(skuId);
          await this.loadLedger(skuId);
          wx.showToast({ title: '已撤销', icon: 'success' });
        } catch (err) { wx.showToast({ title: getErrorMessage(err, '撤销失败'), icon: 'none' }); }
        finally { this.setData({ saving: false }); }
      }
    });
  },
  async refreshSku(skuId) {
    const inventory = await api.get('/sku-inventory/' + skuId);
    const update = sku => String(sku.id) === String(skuId) ? { ...sku, ...normalizeSku({ ...inventory, skuId }) } : sku;
    const productList = this.data.productList.map(product => ({ ...product, skus: product.skus.map(update) }))
      .filter(product => this.matchesTab(product));
    const patch = { productList };
    if (this.data.selectedProduct) patch.selectedProduct = { ...this.data.selectedProduct, skus: this.data.selectedProduct.skus.map(update) };
    if (this.data.selectedSku && String(this.data.selectedSku.id) === String(skuId)) {
      patch.selectedSku = update(this.data.selectedSku);
      patch.currentQty = patch.selectedSku.availableQty;
    }
    this.setData(patch);
    this.updateProductSelection();
    require('../../utils/pageSync').publish('picking-skus', skuId);
  },
  matchesTab(product) {
    const field = { shortage: 'shortageQty', stock: 'availableQty', abnormal: 'abnormalQty' }[this.data.inventoryTab];
    return !field || product.skus.some(sku => sku[field] > 0);
  },
  async openShippingModal() {
    if (this.data.shippingLoading) return;
    this.setData({ showShippingModal: true, shippingLoading: true, shippingProducts: [] });
    try {
      const rows = await api.get('/sku-inventory/shipping-stock');
      if (!this.data.showShippingModal) return;
      const grouped = new Map();
      (rows || []).filter(row => row.shippableQty > 0).forEach(row => {
        const key = String(row.productId);
        const product = grouped.get(key) || { id: row.productId, name: row.productName, coverUrl: row.coverUrl, skus: [] };
        product.skus.push({ ...normalizeSku(row), selected: true, shipQty: row.shippableQty });
        grouped.set(key, product);
      });
      this.setData({ shippingProducts: [...grouped.values()] });
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '加载可发库存失败'), icon: 'none' }); }
    finally { this.setData({ shippingLoading: false }); }
  },
  closeShippingModal() { if (!this.data.matching) this.setData({ showShippingModal: false }); },
  toggleShippingSku(e) { this.updateShippingSku(e, sku => ({ ...sku, selected: !sku.selected })); },
  onShippingQtyInput(e) { this.updateShippingSku(e, sku => ({ ...sku, shipQty: e.detail.value })); },
  updateShippingSku(e, update) {
    const { productIndex, skuIndex } = e.currentTarget.dataset;
    const shippingProducts = this.data.shippingProducts.map((product, pi) => ({
      ...product, skus: product.skus.map((sku, si) => pi === Number(productIndex) && si === Number(skuIndex) ? update(sku) : sku)
    }));
    this.setData({ shippingProducts });
  },
  async goToStockShipping() {
    if (this.data.matching) return;
    const skus = this.data.shippingProducts.flatMap(product => product.skus.filter(sku => sku.selected));
    if (!skus.length) { wx.showToast({ title: '请至少选择一个规格', icon: 'none' }); return; }
    if (skus.some(sku => !positiveInteger(sku.shipQty) || Number(sku.shipQty) > sku.shippableQty)) {
      wx.showToast({ title: '发货数量须为正整数，且不能超过可发库存', icon: 'none' }); return;
    }
    this.setData({ matching: true });
    try {
      const result = await api.post('/sku-inventory/match-shipments', { items: skus.map(sku => ({ skuId: sku.id, qty: Number(sku.shipQty) })) });
      if (!result.items || !result.items.length) {
        wx.showToast({ title: '暂无匹配的已报单未发货商品', icon: 'none' }); return;
      }
      const navigate = () => wx.navigateTo({
        url: '/pages/adminOrder/adminOrder?fromInventory=1',
        success: res => {
          res.eventChannel.emit('inventoryShipmentItems', result);
          this._refreshAfterShipping = true;
          this.setData({ showShippingModal: false });
        },
        fail: () => wx.showToast({ title: '打开发货页面失败，请重试', icon: 'none' })
      });
      const unmatched = (result.unmatched || []).reduce((sum, item) => sum + item.qty, 0);
      if (unmatched) {
        wx.showModal({ title: '部分库存暂无可发订单', content: '有 ' + unmatched + ' 件未匹配到订单，是否继续发货已匹配的商品？',
          success: res => { if (res.confirm) navigate(); } });
      } else navigate();
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '匹配发货订单失败'), icon: 'none' }); }
    finally { this.setData({ matching: false }); }
  },
  getSourceText(source) {
    return { normal: '报单到货', history: '历史库存', stocktake_gain: '盘点盈余', abnormal_keep: '异常保留补报', return_inspection: '退货验收入库', history_confirm: '历史/盘盈来源确认', existing_receipt_confirm: '既有收货补录确认', exchange_in: '换回入库' }[source] || source;
  },
  getChangeTypeText(type) {
    return { arrival: '报单到货入库', history_in: '历史库存入库', shipment: '发货出库',
      return_inspection: '退货退款验收通过入库', stocktake_gain: '盘盈（待处理异常）',
      stocktake_loss: '盘亏出库', abnormal_keep: '异常保留并补报', abnormal_exchange_out: '异常换货出库',
      history_confirm: '历史/盘盈转正常', receipt_backfill: '既有收货来源补录', exchange_in: '换回验收入库', abnormal_return_out: '异常退货出库', receipt_revoke: '撤销入库', shipment_cancel: '发货解绑返还'
    }[type] || type;
  },
  formatTime(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
}, { input: 'onKeywordInput', submit: 'search', field: 'keyword' }));
