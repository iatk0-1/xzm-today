const { getErrorMessage } = require('../../utils/error');
const autoSearch = require('../../utils/autoSearch');
// miniprogram/pages/purchaseOrders/purchaseOrders.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const quantityOperation = require('../../utils/quantityOperation');
const pageSync = require('../../utils/pageSync');

Page(autoSearch.wrap({
  data: {
    status: 'ordered',
    viewMode: 'records',
    stallList: [], tagList: [], selectedStall: '', selectedTag: '',
    skuList: [],
    purchaseSelectedCount: 0, purchaseTotalQty: 0, purchaseAllSelected: false,
    showPurchaseModal: false, purchasePreview: [], purchaseCost: '0.00', purchaseMissingCost: 0,
    purchaseBusy: false,
    showSkuRecords: false, currentSku: null, relatedBatches: [],
    relatedPage: 1, relatedHasMore: true, relatedLoading: false, relatedError: '',
    batchList: [],
    loading: false,
    refreshing: false,
    keyword: '',
    appliedKeyword: '',
    dateRange: { startDate: '', endDate: '', quickSelect: '' },
    draftDateRange: { startDate: '', endDate: '', quickSelect: '' },
    showDateModal: false,
    today: '',
    page: 1,
    pageSize: 20,
    hasMore: true
  },

  async onShow() {
    const id = this._purchaseEditedProduct;
    if (id == null) return;
    try {
      const detail = await api.get('/products/' + encodeURIComponent(String(id)) + '?manage=true');
      const product = detail.product || {};
      const skus = new Map([...(detail.skus || []), ...(detail.bundleGroups || []).flatMap(group => group.skus || [])]
        .map(sku => [String(sku.id), sku]));
      const update = item => {
        if (String(item.productId) !== String(id)) return item;
        const sku = skus.get(String(item.skuId));
        if (!sku) return { ...item, canPurchase: false, purchaseSelected: false };
        return { ...item, productName: product.name, spec: sku.spec, size: sku.size,
          imageUrl: sku.imageUrl || '', defaultImageUrl: product.coverUrl || '/images/default-goods-image.png',
          costPrice: sku.costPrice ?? detail.costPrice ?? null };
      };
      this.setData({ skuList: this.data.skuList.map(update) });
      this.updatePurchaseSelection();
      if (this.data.showPurchaseModal) this.updatePurchasePreview(this.data.purchasePreview.map(update));
      this._purchaseEditedProduct = null;
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '同步商品成本失败，请稍后重试'), icon: 'none' });
    }
  },

  parsePurchaseQty(value) {
    const text = String(value ?? '').trim();
    const qty = Number(text);
    return /^\d+$/.test(text) && Number.isSafeInteger(qty) && qty > 0 && qty <= 2147483647 ? qty : 0;
  },

  updatePurchaseSelection() {
    const selected = this.data.skuList.filter(item => item.purchaseSelected && item.canPurchase !== false);
    const selectable = this.data.skuList.filter(item => item.canPurchase !== false);
    this.setData({ purchaseSelectedCount: selected.length,
      purchaseTotalQty: selected.reduce((sum, item) => sum + this.parsePurchaseQty(item.purchaseQty), 0),
      purchaseAllSelected: selectable.length > 0 && selectable.every(item => item.purchaseSelected) });
  },

  togglePurchaseSelect(e) {
    if (this.data.purchaseBusy) return;
    const id = String(e.currentTarget.dataset.skuId);
    this.setData({ skuList: this.data.skuList.map(item => String(item.skuId) === id && item.canPurchase !== false
      ? { ...item, purchaseSelected: !item.purchaseSelected } : item) });
    this.updatePurchaseSelection();
  },

  togglePurchaseSelectAll() {
    if (this.data.purchaseBusy) return;
    const selected = !this.data.purchaseAllSelected;
    this.setData({ skuList: this.data.skuList.map(item => ({ ...item,
      purchaseSelected: selected && item.canPurchase !== false })) });
    this.updatePurchaseSelection();
  },

  setPurchaseQty(id, qty, preview = false) {
    if (this.data.purchaseBusy) return;
    const update = item => String(item.skuId) === String(id) ? { ...item, purchaseQty: qty } : item;
    this.setData({ skuList: this.data.skuList.map(update) });
    this.updatePurchaseSelection();
    if (preview) this.updatePurchasePreview(this.data.purchasePreview.map(update));
  },

  adjustPurchaseQty(e) {
    const { skuId, delta, preview } = e.currentTarget.dataset;
    const rows = preview ? this.data.purchasePreview : this.data.skuList;
    const item = rows.find(row => String(row.skuId) === String(skuId));
    if (!item) return;
    const qty = Math.min(2147483647, Math.max(1, (this.parsePurchaseQty(item.purchaseQty) || 1) + Number(delta)));
    this.setPurchaseQty(skuId, qty, !!preview);
  },

  onPurchaseQtyInput(e) {
    this.setPurchaseQty(e.currentTarget.dataset.skuId, e.detail.value, !!e.currentTarget.dataset.preview);
  },

  normalizePurchaseQty(e) {
    const { skuId, preview } = e.currentTarget.dataset;
    const item = (preview ? this.data.purchasePreview : this.data.skuList).find(row => String(row.skuId) === String(skuId));
    if (item) this.setPurchaseQty(skuId, this.parsePurchaseQty(item.purchaseQty) || 1, !!preview);
  },

  updatePurchasePreview(items) {
    let cents = 0;
    let missing = 0;
    const purchasePreview = items.map(item => {
      const price = this.formatCost(item.costPrice);
      if (price === null) missing += 1;
      const subtotal = price === null ? null : Math.round(Number(price) * 100) * this.parsePurchaseQty(item.purchaseQty);
      cents += subtotal || 0;
      return { ...item, costSubtotal: subtotal === null ? null : (subtotal / 100).toFixed(2) };
    });
    this.setData({ purchasePreview, purchaseCost: (cents / 100).toFixed(2), purchaseMissingCost: missing });
  },

  openPurchaseModal() {
    if (this.data.purchaseBusy) return;
    const items = this.data.skuList.filter(item => item.purchaseSelected && item.canPurchase !== false);
    if (!items.length) return wx.showToast({ title: '请选择要追加报单的商品', icon: 'none' });
    if (items.some(item => !this.parsePurchaseQty(item.purchaseQty))) {
      return wx.showToast({ title: '报单数量须为 1 至 2147483647 的整数', icon: 'none' });
    }
    this.updatePurchasePreview(items.map(item => ({ ...item })));
    this.setData({ showPurchaseModal: true });
  },

  closePurchaseModal() {
    if (!this.data.purchaseBusy) this.setData({ showPurchaseModal: false });
  },

  stopModalTouchMove() {},

  previewPurchaseImage(e) {
    const item = this.data.purchasePreview.find(row => String(row.skuId) === String(e.currentTarget.dataset.skuId));
    const url = item && (item.imageUrl || item.defaultImageUrl);
    if (!url || url.startsWith('/images/')) return wx.showToast({ title: '暂无可预览图片', icon: 'none' });
    wx.previewImage({ current: url, urls: [url] });
  },

  editPurchaseProduct(e) {
    if (this.data.purchaseBusy) return;
    const item = this.data.purchasePreview.find(row => String(row.skuId) === String(e.currentTarget.dataset.skuId));
    if (!item || item.productId == null) return wx.showToast({ title: '商品信息不完整，请刷新列表后重试', icon: 'none' });
    this._purchaseEditedProduct = item.productId;
    wx.navigateTo({ url: '/pages/admin/admin?editId=' + encodeURIComponent(String(item.productId)) });
  },

  async confirmPurchase() {
    if (this.data.purchaseBusy) return;
    const rows = this.data.purchasePreview;
    if (!rows.length || rows.some(item => item.canPurchase === false || !this.parsePurchaseQty(item.purchaseQty))) {
      return wx.showToast({ title: '请核对商品和报单数量，数量须为正整数', icon: 'none' });
    }
    this.setData({ purchaseBusy: true });
    wx.showLoading({ title: '提交中...' });
    let submitError;
    try {
      await quantityOperation.run(api, '/picking-list/order', { purpose: 'stock', items: rows.map(item => ({
        skuId: item.skuId, qty: this.parsePurchaseQty(item.purchaseQty), note: `报单记录追加，${item.spec || ''} ${item.size || ''}` })) });
    } catch (err) {
      submitError = err;
    } finally {
      this.setData({ purchaseBusy: false });
      wx.hideLoading();
    }
    if (submitError) {
      wx.showToast({ title: getErrorMessage(submitError, '追加报单失败'), icon: 'none' });
      return;
    }
    rows.forEach(item => pageSync.publish('picking-skus', item.skuId));
    const submitted = new Set(rows.map(item => String(item.skuId)));
    this.setData({ showPurchaseModal: false, skuList: this.data.skuList.map(item => submitted.has(String(item.skuId))
      ? { ...item, purchaseSelected: false, purchaseQty: 1 } : item) });
    this.updatePurchaseSelection();
    wx.showToast({ title: '追加报单成功', icon: 'success' });
    // 已成功提交后刷新失败只提示列表重试，不把成功报单误报成提交失败。
    await this.loadSkus(true, true);
  },

  onLoad: function() {
    this.setData({ today: this.formatDate(new Date()) });
    this.loadFilterOptions();
    this.loadBatches();
  },

  async loadFilterOptions() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      const results = await Promise.allSettled([
        api.get(auth.isStallManager() ? '/stall-managers/stalls/mine' : '/stalls/all'),
        api.get('/tags/all')
      ]);
      this.setData({
        stallList: results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [],
        tagList: results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : []
      });
      if (results.some(result => result.status === 'rejected')) throw new Error('部分筛选项加载失败');
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '加载档口和标签失败'), icon: 'none' });
    }
  },

  selectStall(e) {
    this.setData({ selectedStall: e.currentTarget.dataset.stall === 'all' ? '' : String(e.currentTarget.dataset.stall) });
    return this.loadBatches(true, true);
  },

  selectTag(e) {
    this.setData({ selectedTag: e.currentTarget.dataset.tag === 'all' ? '' : String(e.currentTarget.dataset.tag) });
    return this.loadBatches(true, true);
  },

  toggleView() {
    this.closeSkuRecords();
    this.setData({ viewMode: this.data.viewMode === 'records' ? 'products' : 'records' });
    return this.loadBatches(true, true);
  },

  recordQuery({ page, size, skuId, details = false, all = false } = {}) {
    const data = this.data;
    const params = { status: all ? 'all' : data.status };
    if (page != null) params.page = page;
    if (size != null) params.size = size;
    if (!all) {
      if (data.appliedKeyword) params.keyword = data.appliedKeyword;
      if (!details && data.dateRange.startDate) params.startDate = data.dateRange.startDate;
      if (!details && data.dateRange.endDate) params.endDate = data.dateRange.endDate;
      if (data.selectedStall) params.stallId = data.selectedStall;
      if (data.selectedTag) params.tagId = data.selectedTag;
      if (skuId != null) params.skuId = skuId;
    }
    return Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  },

  formatRecord(item) {
    return { ...item, costPriceText: this.formatCost(item.costPrice), costAmountText: this.formatCost(item.costAmount),
      imageUrl: item.imageUrl || '', defaultImageUrl: item.defaultImageUrl || '/images/default-goods-image.png',
      displayTime: this.formatTime(item.createdAt), selected: false };
  },

  async loadSkus(reset = true, preserveDrafts = false) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const requestId = (this._batchRequestId || 0) + 1;
    this._batchRequestId = requestId;
    const drafts = new Map((!reset || preserveDrafts ? this.data.skuList : []).map(item => [String(item.skuId), item]));
    if (reset) {
      this._detailGeneration = (this._detailGeneration || 0) + 1;
      this.setData({ page: 1, skuList: [], batchList: [], hasMore: true });
      this.updatePurchaseSelection();
    }
    this.setData({ loading: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const page = this.data.page;
      const res = await api.get('/picking-list/orders/skus/query?' + this.recordQuery({ page, size: this.data.pageSize }));
      if (requestId !== this._batchRequestId) return;
      const rows = (res.content || []).map(item => ({ ...item,
        purchaseSelected: item.canPurchase !== false && !!drafts.get(String(item.skuId))?.purchaseSelected,
        purchaseQty: drafts.get(String(item.skuId))?.purchaseQty ?? 1,
        defaultImageUrl: item.defaultImageUrl || '/images/default-goods-image.png',
        costSummary: this.formatBatchCost({ ...item, itemCount: item.recordCount }) }));
      this.setData({ skuList: reset ? rows : [...this.data.skuList, ...rows], page: page + 1,
        hasMore: res.hasNext !== undefined ? res.hasNext : rows.length === this.data.pageSize, loading: false
      }, () => { this.updatePurchaseSelection(); this.checkLoadMoreAtBottom(requestId); });
    } catch (err) {
      if (requestId !== this._batchRequestId) return;
      this.setData({ loading: false });
      wx.showToast({ title: getErrorMessage(err, '加载商品报单汇总失败'), icon: 'none' });
    }
  },

  openSkuRecords(e) {
    const sku = this.data.skuList.find(item => String(item.skuId) === String(e.currentTarget.dataset.skuId));
    if (!sku) return;
    this._skuModalGeneration = (this._skuModalGeneration || 0) + 1;
    this.setData({ showSkuRecords: true, currentSku: sku, relatedBatches: [], relatedPage: 1,
      relatedHasMore: true, relatedLoading: false, relatedError: '' });
    return this.loadRelatedBatches();
  },

  closeSkuRecords() {
    this._skuModalGeneration = (this._skuModalGeneration || 0) + 1;
    this.setData({ showSkuRecords: false, currentSku: null, relatedBatches: [], relatedLoading: false });
  },

  async loadRelatedBatches() {
    if (!this.data.showSkuRecords || this.data.relatedLoading || !this.data.relatedHasMore) return;
    const generation = this._skuModalGeneration;
    this.setData({ relatedLoading: true, relatedError: '' });
    try {
      const page = this.data.relatedPage;
      const res = await api.get('/picking-list/orders/batches/query?' + this.recordQuery({
        page, size: this.data.pageSize, skuId: this.data.currentSku.skuId }));
      if (generation !== this._skuModalGeneration) return;
      this.setData({ relatedBatches: [...this.data.relatedBatches, ...(res.content || []).map(item => ({ ...item,
        displayTime: this.formatTime(item.createdAt), costSummary: this.formatBatchCost(item), expanded: false,
        detailList: [], detailLoading: false, detailLoaded: false, detailError: '', showAll: false,
        allItems: [], allLoading: false, allLoaded: false, allError: '' }))],
        relatedPage: page + 1, relatedHasMore: res.hasNext !== undefined ? res.hasNext : (res.content || []).length === this.data.pageSize,
        relatedLoading: false });
    } catch (err) {
      if (generation !== this._skuModalGeneration) return;
      this.setData({ relatedLoading: false, relatedError: getErrorMessage(err, '关联报单加载失败，点击重试') });
    }
  },

  updateRelatedBatch(id, patch) {
    this.setData({ relatedBatches: this.data.relatedBatches.map(item => {
      if (String(item.id) !== String(id)) return item;
      const next = { ...item, ...patch };
      const visibleIds = new Set(next.detailList.map(detail => String(detail.id)));
      next.extraItems = next.allItems.filter(detail => !visibleIds.has(String(detail.id)));
      return next;
    }) });
  },

  async toggleRelatedBatch(e) {
    const id = e.currentTarget.dataset.id;
    const batch = this.data.relatedBatches.find(item => String(item.id) === String(id));
    if (!batch) return;
    this.updateRelatedBatch(id, { expanded: !batch.expanded, showAll: false });
    if (!batch.expanded && !batch.detailLoaded && !batch.detailLoading) return this.loadRelatedDetails(id, false);
  },

  async toggleAllSkuRecords(e) {
    const id = e.currentTarget.dataset.id;
    const batch = this.data.relatedBatches.find(item => String(item.id) === String(id));
    if (!batch) return;
    const showAll = !batch.showAll;
    this.updateRelatedBatch(id, { showAll, expanded: true });
    if (!batch.detailLoaded && !batch.detailLoading) this.loadRelatedDetails(id, false);
    if (showAll && !batch.allLoaded && !batch.allLoading) return this.loadRelatedDetails(id, true);
  },

  async loadRelatedDetails(id, all) {
    const generation = this._skuModalGeneration;
    const loadingKey = all ? 'allLoading' : 'detailLoading';
    const errorKey = all ? 'allError' : 'detailError';
    this.updateRelatedBatch(id, { [loadingKey]: true, [errorKey]: '' });
    try {
      const items = await api.get(`/picking-list/orders/batches/${encodeURIComponent(id)}/items?`
        + this.recordQuery({ skuId: this.data.currentSku.skuId, details: true, all }));
      if (generation !== this._skuModalGeneration) return;
      const rows = (items || []).map(item => this.formatRecord(item));
      this.updateRelatedBatch(id, { [loadingKey]: false, [all ? 'allLoaded' : 'detailLoaded']: true,
        [all ? 'allItems' : 'detailList']: rows });
    } catch (err) {
      if (generation !== this._skuModalGeneration) return;
      this.updateRelatedBatch(id, { [loadingKey]: false, [errorKey]: getErrorMessage(err, '明细加载失败，请重试') });
    }
  },

  retryRelatedDetails(e) {
    return this.loadRelatedDetails(e.currentTarget.dataset.id, e.currentTarget.dataset.all === true || e.currentTarget.dataset.all === 'true');
  },

  showDateRangeSelector: function() {
    this.setData({
      draftDateRange: { ...this.data.dateRange },
      today: this.formatDate(new Date()),
      showDateModal: true
    });
  },

  closeDateModal: function() {
    this.setData({ showDateModal: false });
  },

  selectDateRange: function(e) {
    const type = e.currentTarget.dataset.type;
    const today = new Date();
    const endDate = this.formatDate(today);
    let start;
    switch (type) {
      case '1day': start = today; break;
      case '7days': start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6); break;
      case '30days': start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29); break;
      case 'month': start = new Date(today.getFullYear(), today.getMonth(), 1); break;
      default: return;
    }
    this.setData({ draftDateRange: {
      startDate: this.formatDate(start), endDate, quickSelect: type
    } });
  },

  onStartDateChange: function(e) {
    this.setData({ draftDateRange: {
      ...this.data.draftDateRange, startDate: e.detail.value, quickSelect: ''
    } });
  },

  onEndDateChange: function(e) {
    this.setData({ draftDateRange: {
      ...this.data.draftDateRange, endDate: e.detail.value, quickSelect: ''
    } });
  },

  confirmDateRange: function() {
    const range = this.data.draftDateRange;
    if (range.startDate && range.endDate && range.startDate > range.endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.setData({ dateRange: { ...range }, showDateModal: false });
    return this.loadBatches(true, true);
  },

  clearDateRange: function() {
    this.setData({ dateRange: { startDate: '', endDate: '', quickSelect: '' } });
    return this.loadBatches(true, true);
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
    if (this.data.viewMode === 'products') return this.loadSkus(reset);
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
      const { page, pageSize } = this.data;
      const query = this.recordQuery({ page, size: pageSize });
      const res = await api.get(`/picking-list/orders/batches/query?${query}`);
      if (requestId !== this._batchRequestId) return;

      const batches = (res.content || []).map(item => ({
        ...item,
        costSummary: this.formatBatchCost(item),
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
      wx.showToast({ title: getErrorMessage(err, '批次加载失败'), icon: 'none' });
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
      const query = this.recordQuery({ details: true });
      const items = await api.get(
        `/picking-list/orders/batches/${encodeURIComponent(batchId)}/items?${query}`
      );
      if (generation !== (this._detailGeneration || 0)) return;
      this.updateBatch(batchId, {
        detailList: (items || []).map(item => this.formatRecord(item)),
        detailLoading: false,
        selectedCount: 0,
        allSelected: false
      });
    } catch (err) {
      if (generation !== (this._detailGeneration || 0)) return;
      console.error('加载报单商品明细失败:', err);
      wx.showToast({ title: getErrorMessage(err, '明细加载失败'), icon: 'none' });
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

            this.updateCancelledOrders([orderId]);
          } catch (err) {
            wx.hideLoading();
            console.error('撤销失败:', err);
            wx.showToast({ title: getErrorMessage(err, '撤销失败'), icon: 'none' });
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
            const results = await Promise.allSettled(selectedItems.map(item => api.delete(`/picking-list/order/${item.id}`)));
            this.updateCancelledOrders(selectedItems.filter((item, index) => results[index].status === 'fulfilled').map(item => item.id));
            const failed = results.find(result => result.status === 'rejected');
            if (failed) throw failed.reason;

            wx.hideLoading();
            wx.showToast({ title: '批量撤销成功', icon: 'success' });

          } catch (err) {
            wx.hideLoading();
            console.error('批量撤销失败:', err);
            wx.showToast({ title: getErrorMessage(err, '批量撤销失败'), icon: 'none' });
          }
        }
      }
    });
  },

  updateCancelledOrders: function(ids) {
    const cancelled = new Set(ids.map(String));
    const batchList = this.data.batchList.flatMap(batch => {
      const changed = batch.detailList.filter(item => cancelled.has(String(item.id)));
      changed.forEach(item => require('../../utils/pageSync').publish('picking-skus', item.skuId));
      if (!changed.length) return [batch];
      const keepCancelled = this.data.status === 'all' || this.data.status === 'cancelled';
      const detailList = batch.detailList.flatMap(item => !cancelled.has(String(item.id)) ? [item]
        : (keepCancelled ? [{ ...item, status: 'cancelled', selected: false }] : []));
      if (!detailList.length) return [];
      const nextBatch = { ...batch, detailList, selectedCount: detailList.filter(item => item.selected).length, allSelected: false,
        itemCount: keepCancelled ? batch.itemCount : Math.max(0, Number(batch.itemCount) - changed.length),
        totalQty: keepCancelled ? batch.totalQty : Math.max(0, Number(batch.totalQty) - changed.reduce((sum, item) => sum + Number(item.qty || 0), 0)),
        orderedCount: Math.max(0, Number(batch.orderedCount) - changed.length),
        cancelledCount: keepCancelled ? Number(batch.cancelledCount || 0) + changed.length : batch.cancelledCount
      };
      // 明细不分页，撤销后用当前筛选下剩余记录重算，保留列表位置和展开状态。
      let recordedCostCents = 0;
      let missingCostCount = 0;
      detailList.forEach(item => {
        const amount = this.formatCost(item.costAmount);
        if (amount === null) missingCostCount += 1;
        else recordedCostCents += Math.round(Number(amount) * 100);
      });
      nextBatch.recordedCostAmount = (recordedCostCents / 100).toFixed(2);
      nextBatch.missingCostCount = missingCostCount;
      nextBatch.costSummary = this.formatBatchCost(nextBatch);
      return [nextBatch];
    });
    this.setData({ batchList });
  },

  formatCost: function(value) {
    if (value == null || String(value).trim() === '') return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : null;
  },

  formatBatchCost: function(batch) {
    const amount = this.formatCost(batch.recordedCostAmount);
    const missingCount = batch.missingCostCount == null
      ? Number(batch.itemCount || 0) : Number(batch.missingCostCount);
    if (amount === null || missingCount >= Number(batch.itemCount || 0)) return '成本未记录';
    if (missingCount > 0) return `已记录原报成本 ¥${amount}，另 ${missingCount} 条成本未记录`;
    return `原报成本合计 ¥${amount}`;
  },

  formatDate: function(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
}, {
  input: 'onKeywordInput',
  submit: 'search',
  field: 'keyword'
}));
