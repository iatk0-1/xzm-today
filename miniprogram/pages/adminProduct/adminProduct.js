const autoSearch = require('../../utils/autoSearch');
// miniprogram/pages/adminProduct/adminProduct.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { isProductSoldOut } = require('../../utils/stock');
const { beijingParts, hasPendingSchedule } = require('../../utils/productSchedule');

Page(autoSearch.wrap({
  data: {
    products: [],
    isLoading: false,  // 初始为 false，允许首次加载
    isRefreshing: false,
    activeStatus: 'all',
    searchKeyword: '',
    searchFocus: false,
    stallList: [],
    tagList: [],
    selectedStall: '',
    selectedTag: '',
    relationEditProductId: '',
    relationEditType: '',
    showRelationPicker: false,
    relationPickerType: '',
    relationPickerProductId: '',
    relationPickerItems: [],
    relationOperating: false,
    // 分页参数
    page: 1,
    pageSize: 20,
    hasMore: true,
    selectMode: false,
    selectedProductIds: [],
    selectedCount: 0,
    allSelected: false,
    batchOperating: false,
    showProductSchedule: false
  },

  onLoad: function() {
    this.setData({ isStallManager: auth.isStallManager() });
    this.loadFilterOptions();
    this.loadProducts();
  },

  onShow() {
    this._schedulePageVisible = true;
    this.planScheduleRefresh();
  },
  onHide() {
    this._schedulePageVisible = false;
    this.clearScheduleRefresh();
  },
  onUnload() {
    this._schedulePageVisible = false;
    this.clearScheduleRefresh();
  },

  clearScheduleRefresh() {
    if (this._scheduleRefreshTimer) clearTimeout(this._scheduleRefreshTimer);
    this._scheduleRefreshTimer = null;
  },
  planScheduleRefresh() {
    this.clearScheduleRefresh();
    if (this._schedulePageVisible === false) return;
    if (this._scheduleListNeedsRefill) {
      this._scheduleRefreshTimer = setTimeout(() => this.refreshDueScheduleProducts(), 5000);
      return;
    }
    const times = this.data.products.filter(item => hasPendingSchedule(item.schedule))
      .map(item => Date.parse(item.schedule.executeAt));
    if (!times.length) return;
    const next = Math.min(...times);
    this._scheduleRefreshTimer = setTimeout(() => {
      this._scheduleRefreshTimer = null;
      if (next <= Date.now()) this.refreshDueScheduleProducts();
      else this.planScheduleRefresh();
    }, Math.min(60000, Math.max(5000, next - Date.now() + 5000)));
  },
  async refreshDueScheduleProducts() {
    if (this._schedulePageVisible === false) return;
    if (this.data.isLoading || this.data.batchOperating || this.data.showProductSchedule || this._scheduleRefreshInFlight) {
      this.planScheduleRefresh();
      return;
    }
    this._scheduleRefreshInFlight = true;
    const query = this.getQueryParams();
    const version = this._productQueryVersion;
    const currentPage = this.data.page;
    const signature = JSON.stringify(query);
    try {
      // 到点时重新取已加载的页，补齐“已定时”筛选中因任务清理而前移的商品。
      const responses = await Promise.all(Array.from({ length: Math.max(1, currentPage - 1) },
        (_, index) => api.get('/products/query', { ...query, page: index + 1 })));
      if (this._schedulePageVisible === false || this.data.isLoading || this.data.batchOperating || version !== this._productQueryVersion
        || currentPage !== this.data.page || signature !== JSON.stringify(this.getQueryParams())) return;
      const products = responses.reduce((all, response) => all.concat(response.content || []), [])
        .map(item => this.normalizeProduct(item)).filter(item => this.data.activeStatus !== 'scheduled' || item.hasSchedule);
      await this.loadProductOwners(products);
      if (this._schedulePageVisible === false || this.data.isLoading || this.data.batchOperating || version !== this._productQueryVersion
        || currentPage !== this.data.page || signature !== JSON.stringify(this.getQueryParams())) return;
      const visibleIds = new Set(products.map(item => this.normalizeId(item.id)));
      const selectedIds = this.data.selectedProductIds.filter(id => visibleIds.has(this.normalizeId(id)));
      let lastIndex = 0;
      responses.forEach((response, index) => { if ((response.content || []).length) lastIndex = index; });
      const last = responses[lastIndex];
      this.setData({ page: lastIndex + 2, hasMore: last.hasNext !== undefined ? last.hasNext
        : (last.content || []).length === this.data.pageSize });
      this.refreshSelectionState(products, selectedIds);
      this._scheduleListNeedsRefill = false;
    } catch (err) {
      console.error('刷新到期定时商品失败:', err);
    } finally {
      this._scheduleRefreshInFlight = false;
      this.planScheduleRefresh();
    }
  },

  onRefresh: async function() {
    if (this.data.isRefreshing || this.data.isLoading) return;

    this.setData({ isRefreshing: true });
    try {
      await this.loadProducts();
    } finally {
      this.setData({ isRefreshing: false });
    }
  },

  // 滚动到底部加载更多（scroll-view 使用）
  loadMore: async function() {
    if (!this.data.hasMore || this.data.isLoading) return;
    if (this._scheduleListNeedsRefill) {
      await this.refreshDueScheduleProducts();
      if (this._scheduleListNeedsRefill || !this.data.hasMore) return;
    }
    return this.loadProducts(false);
  },

  loadFilterOptions: async function() {
    try {
      const [stalls, tags] = await Promise.all([
        api.get(auth.isStallManager() ? '/stall-managers/stalls/mine' : '/stalls/all'),
        api.get('/tags/all')
      ]);
      this.setData({
        stallList: Array.isArray(stalls) ? stalls : [],
        tagList: Array.isArray(tags) ? tags : []
      }, () => this.refreshProductLabels());
    } catch (err) {
      console.error('加载档口和标签失败:', err);
      this.setData({ stallList: [], tagList: [] });
    }
  },

  getQueryParams: function() {
    const params = {
      status: this.data.activeStatus,
      page: this.data.page,
      size: this.data.pageSize,
      manage: true
    };
    const keyword = this.data.searchKeyword.trim();
    if (keyword) params.keyword = keyword;
    if (this.data.selectedStall) params.stallId = this.data.selectedStall;
    if (this.data.selectedTag) params.tagId = this.data.selectedTag;
    return params;
  },

  selectStatusTab: function(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.activeStatus) return;
    this.setData({ activeStatus: status }, () => this.loadProducts());
  },

  onSearchInput: function(e) {
    const keyword = e.detail.value || '';
    this.setData({ searchKeyword: keyword });
  },

  onSearchConfirm: function() {
    this.setData({ searchFocus: false }, () => this.loadProducts());
  },

  clearSearch: function() {
    this.setData({ searchKeyword: '', searchFocus: false }, () => this.loadProducts());
  },

  selectStall: function(e) {
    const stallId = e.currentTarget.dataset.stall;
    this.setData({ selectedStall: stallId === 'all' ? '' : stallId }, () => this.loadProducts());
  },

  selectTag: function(e) {
    const tagId = e.currentTarget.dataset.tag;
    this.setData({ selectedTag: tagId === 'all' ? '' : tagId }, () => this.loadProducts());
  },

  // 改造：从后端 API 加载商品列表（支持分页）
  loadProducts: async function(reset = true) {
    if (reset) {
      this.setData({
        page: 1,
        products: [],
        hasMore: true,
        selectMode: false,
        selectedProductIds: [],
        selectedCount: 0,
        allSelected: false
      });
    }

    if (!this.data.hasMore || this.data.isLoading) return;

    this._productQueryVersion = (this._productQueryVersion || 0) + 1;
    this.setData({ isLoading: true });

    if (reset) {
      wx.showLoading({ title: '拉取商品中...' });
    }

    try {
      await auth.ensureAuthenticated({ silent: true });
      const pageSize = this.data.pageSize;
      const res = await api.get('/products/query', this.getQueryParams());

      let list = (res.content || []).map(item => this.normalizeProduct(item))
        .filter(item => this.data.activeStatus !== 'scheduled' || item.hasSchedule);
      await this.loadProductOwners(list);

      const hasMore = res.hasNext !== undefined ? res.hasNext : list.length === pageSize;
      const products = reset ? list : [...this.data.products, ...list];

      this.setData({
        products: this.applySelectionToProducts(products, this.data.selectedProductIds),
        page: this.data.page + 1,
        hasMore: hasMore,
        isLoading: false
      });
      if (reset) this._scheduleListNeedsRefill = false;
      this.planScheduleRefresh();

      if (reset) {
        wx.hideLoading();
      }
    } catch (err) {
      if (reset) {
        wx.hideLoading();
      }
      wx.showToast({ title: '获取失败', icon: 'none' });
      this.setData({ isLoading: false });
    }
  },

  async loadProductOwners(list) {
    if (!this.data.isStallManager && list.length) {
      const batches = [];
      for (let index = 0; index < list.length; index += 200) batches.push(list.slice(index, index + 200));
      const responses = await Promise.all(batches.map(batch => api.get('/stall-managers/products/owners',
        { ids: batch.map(item => item.id).join(',') }).catch(() => [])));
      const owners = responses.reduce((all, rows) => all.concat(rows || []), []);
      const ownerMap = {};
      (owners || []).forEach(owner => {
        ownerMap[String(owner.productId)] = owner.nickname || owner.phone || String(owner.userId);
      });
      list.forEach(item => { item.managerName = ownerMap[String(item.id)] || ''; });
    }
  },

  normalizeProduct: function(item) {
    item.soldOut = isProductSoldOut(item);
    item.hasSchedule = hasPendingSchedule(item.schedule);
    if (item.hasSchedule) {
      const parts = beijingParts(Date.parse(item.schedule.executeAt));
      item.scheduleTimeStr = `${parts.date} ${parts.time}`;
      item.scheduleAction = item.schedule.status === 'on' ? '上架' : '下架';
    } else {
      item.schedule = null;
      item.scheduleTimeStr = '';
      item.scheduleAction = '';
    }
    if (item.createdAt) {
      const date = new Date(item.createdAt);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      item.createTimeStr = `${month}-${day} ${hour}:${minute}`;
    }
    item.selected = false;
    return this.enrichProductLabels(item);
  },

  enrichProductLabels: function(item) {
    const stallMap = {};
    const tagMap = {};
    (this.data.stallList || []).forEach(stall => {
      stallMap[this.normalizeId(stall.id)] = stall.name;
    });
    (this.data.tagList || []).forEach(tag => {
      tagMap[this.normalizeId(tag.id)] = tag.name;
    });
    item.stallRelations = (item.stallIds || [])
      .map(id => ({ id, name: stallMap[this.normalizeId(id)] }))
      .filter(item => item.name);
    item.tagRelations = (item.relateTagIds || [])
      .map(id => ({ id, name: tagMap[this.normalizeId(id)] }))
      .filter(item => item.name);
    item.stallNames = item.stallRelations.map(relation => relation.name);
    item.tagNames = item.tagRelations.map(relation => relation.name);
    return item;
  },

  refreshProductLabels: function() {
    if (!this.data.products.length) return;
    this.setData({ products: this.data.products.map(item => this.enrichProductLabels(item)) });
  },

  onRelationLongPress: function(e) {
    this.setData({
      relationEditProductId: e.currentTarget.dataset.productId,
      relationEditType: e.currentTarget.dataset.type
    });
  },

  onRelationTap: function() {
    // 关联项点击只处理编辑态，不允许冒泡触发商品详情；编辑态下点击非叉号区域收起叉号。
    if (this.data.relationEditProductId) {
      this.closeRelationEdit();
    }
  },

  closeRelationEdit: function() {
    this.setData({ relationEditProductId: '', relationEditType: '' });
  },

  openRelationPicker: function(e) {
    const type = e.currentTarget.dataset.type;
    const productId = e.currentTarget.dataset.productId;
    const product = this.data.products.find(item => this.normalizeId(item.id) === this.normalizeId(productId));
    if (!product) return;

    const relations = type === 'stall' ? (product.stallRelations || []) : (product.tagRelations || []);
    const selectedIds = {};
    relations.forEach(relation => { selectedIds[this.normalizeId(relation.id)] = true; });
    const source = type === 'stall' ? this.data.stallList : this.data.tagList;
    const availableItems = (source || []).filter(item => !selectedIds[this.normalizeId(item.id)]);
    if (availableItems.length === 0) {
      wx.showToast({ title: `没有可添加的${type === 'stall' ? '档口' : '标签'}`, icon: 'none' });
      return;
    }

    this.setData({
      relationEditProductId: '',
      relationEditType: '',
      showRelationPicker: true,
      relationPickerType: type,
      relationPickerProductId: productId,
      relationPickerItems: availableItems
    });
  },

  closeRelationPicker: function() {
    if (this.data.relationOperating) return;
    this.setData({
      showRelationPicker: false,
      relationPickerType: '',
      relationPickerProductId: '',
      relationPickerItems: []
    });
  },

  selectRelationOption: async function(e) {
    if (this.data.relationOperating) return;
    const type = this.data.relationPickerType;
    const productId = this.data.relationPickerProductId;
    const groupId = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    await this.updateProductRelation(type, productId, groupId, name, 'ADD');
  },

  removeProductRelation: async function(e) {
    if (this.data.relationOperating) return;
    const type = e.currentTarget.dataset.type;
    const productId = e.currentTarget.dataset.productId;
    const groupId = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    await this.updateProductRelation(type, productId, groupId, name, 'REMOVE');
  },

  updateProductRelation: async function(type, productId, groupId, name, action) {
    this.setData({ relationOperating: true });
    const endpoint = type === 'stall' ? `/stalls/${groupId}/products` : `/tags/${groupId}/products`;
    try {
      await api.patch(endpoint, { action, productIds: [productId] });
      const products = this.data.products.map(product => {
        if (this.normalizeId(product.id) !== this.normalizeId(productId)) return product;
        const idField = type === 'stall' ? 'stallIds' : 'relateTagIds';
        const relationField = type === 'stall' ? 'stallRelations' : 'tagRelations';
        const ids = (product[idField] || []).slice();
        const relations = (product[relationField] || []).slice();
        const normalizedGroupId = this.normalizeId(groupId);
        const index = ids.findIndex(id => this.normalizeId(id) === normalizedGroupId);
        if (action === 'ADD' && index < 0) {
          ids.push(groupId);
          relations.push({ id: groupId, name });
        } else if (action === 'REMOVE' && index >= 0) {
          ids.splice(index, 1);
          const relationIndex = relations.findIndex(relation => this.normalizeId(relation.id) === normalizedGroupId);
          if (relationIndex >= 0) relations.splice(relationIndex, 1);
        }
        return this.enrichProductLabels({ ...product, [idField]: ids, [relationField]: relations });
      });
      this.setData({
        products,
        relationOperating: false,
        showRelationPicker: false,
        relationPickerType: '',
        relationPickerProductId: '',
        relationPickerItems: [],
        relationEditProductId: action === 'REMOVE' ? this.data.relationEditProductId : '',
        relationEditType: action === 'REMOVE' ? this.data.relationEditType : ''
      });
      wx.showToast({ title: action === 'ADD' ? '关联成功' : '已取消关联', icon: 'success' });
    } catch (err) {
      this.setData({ relationOperating: false });
      wx.showToast({ title: err.message || '关联操作失败', icon: 'none' });
    }
  },

  normalizeId: function(id) {
    return String(id);
  },

  applySelectionToProducts: function(products, selectedProductIds) {
    const selectedMap = {};
    selectedProductIds.forEach(id => {
      selectedMap[this.normalizeId(id)] = true;
    });
    return products.map(item => ({
      ...item,
      selected: !!selectedMap[this.normalizeId(item.id)]
    }));
  },

  refreshSelectionState: function(products = this.data.products, selectedProductIds = this.data.selectedProductIds) {
    const selectedMap = {};
    selectedProductIds.forEach(id => {
      selectedMap[this.normalizeId(id)] = true;
    });
    const selectedInCurrentList = products.filter(item => selectedMap[this.normalizeId(item.id)]).length;
    this.setData({
      products: this.applySelectionToProducts(products, selectedProductIds),
      selectedProductIds,
      selectedCount: selectedProductIds.length,
      allSelected: products.length > 0 && selectedInCurrentList === products.length
    });
  },

  // 改造：切换上下架状态
  toggleStatus: async function(e) {
    const id = e.currentTarget.dataset.id;
    const currentStatus = e.currentTarget.dataset.status;
    // 后端使用 on/off，前端状态需要转换
    const newStatus = currentStatus === 'off' ? 'on' : 'off';

    wx.showLoading({ title: '处理中...' });

    try {
      const result = await api.patch(`/products/${id}/status`, { status: newStatus });
      this.updateVisibleProduct(result.product || result);
      wx.hideLoading();
      wx.showToast({
        title: newStatus === 'off' ? '已下架' : '已重新上架',
        icon: 'success'
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  toggleSelectMode: function() {
    if (this.data.selectMode) {
      this.clearSelection();
      this.setData({ selectMode: false });
      return;
    }
    this.setData({ selectMode: true });
  },

  clearSelection: function() {
    this.refreshSelectionState(this.data.products, []);
  },

  handleProductTap: function(e) {
    if (this.data.relationEditProductId) {
      this.closeRelationEdit();
      return;
    }
    const id = e.currentTarget.dataset.id;
    if (this.data.selectMode) {
      this.toggleProductId(id);
      return;
    }
    this.openProductEditor(id);
  },

  toggleProductSelect: function(e) {
    const id = e.currentTarget.dataset.id;
    this.toggleProductId(id);
  },

  toggleProductId: function(id) {
    const normalizedId = this.normalizeId(id);
    const selectedProductIds = this.data.selectedProductIds.slice();
    const currentIndex = selectedProductIds.indexOf(normalizedId);
    if (currentIndex >= 0) {
      selectedProductIds.splice(currentIndex, 1);
    } else {
      selectedProductIds.push(normalizedId);
    }
    this.refreshSelectionState(this.data.products, selectedProductIds);
  },

  toggleSelectAllLoaded: function() {
    if (this.data.products.length === 0) {
      wx.showToast({ title: '暂无商品可选择', icon: 'none' });
      return;
    }

    const visibleIds = this.data.products.map(item => this.normalizeId(item.id));
    let selectedProductIds;
    if (this.data.allSelected) {
      selectedProductIds = this.data.selectedProductIds.filter(id => !visibleIds.includes(this.normalizeId(id)));
    } else {
      selectedProductIds = this.data.selectedProductIds.slice();
      visibleIds.forEach(id => {
        if (!selectedProductIds.includes(id)) {
          selectedProductIds.push(id);
        }
      });
    }
    this.refreshSelectionState(this.data.products, selectedProductIds);
  },

  batchDelete: function() {
    const selectedCount = this.data.selectedCount;
    if (selectedCount === 0) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }
    if (this.data.batchOperating) return;

    wx.showModal({
      title: '批量删除',
      content: `确定将选中的 ${selectedCount} 个商品移入回收站吗？移入后可从回收站恢复。`,
      confirmText: '删除',
      confirmColor: '#d32f2f',
      success: async (res) => {
        if (!res.confirm) return;

        this.setData({ batchOperating: true });
        wx.showLoading({ title: '删除中...' });

        try {
          const productIds = this.data.selectedProductIds.slice();
          const results = await Promise.all(productIds.map(id =>
            api.delete(`/products/${id}`)
              .then(() => ({ id, success: true }))
              .catch(error => ({ id, success: false, error }))
          ));
          const succeededIds = {};
          const failedIds = [];
          results.forEach(result => {
            if (result.success) {
              succeededIds[this.normalizeId(result.id)] = true;
            } else {
              failedIds.push(this.normalizeId(result.id));
            }
          });

          this._productQueryVersion = (this._productQueryVersion || 0) + 1;
          const products = this.data.products.filter(item => !succeededIds[this.normalizeId(item.id)]);
          wx.hideLoading();
          this.setData({
            products,
            selectMode: failedIds.length > 0,
            selectedProductIds: failedIds,
            selectedCount: failedIds.length,
            allSelected: failedIds.length > 0 && products.length > 0 && products.every(item =>
              failedIds.includes(this.normalizeId(item.id))
            ),
            batchOperating: false
          });
          this.planScheduleRefresh();

          if (failedIds.length > 0) {
            wx.showToast({ title: `成功删除${selectedCount - failedIds.length}个，${failedIds.length}个失败`, icon: 'none' });
          } else {
            wx.showToast({ title: `已删除${selectedCount}个`, icon: 'success' });
          }
        } catch (err) {
          wx.hideLoading();
          this.setData({ batchOperating: false });
          wx.showToast({ title: err?.message || '批量删除失败', icon: 'none' });
        }
      }
    });
  },

  productMatchesFilters: function(product) {
    const { activeStatus, searchKeyword, selectedStall, selectedTag } = this.data;
    if (activeStatus === 'sold_out') {
      if (!isProductSoldOut(product)) return false;
    } else if (activeStatus === 'scheduled') {
      if (!hasPendingSchedule(product.schedule)) return false;
    } else if (activeStatus !== 'all' && product.status !== activeStatus) return false;
    const keyword = searchKeyword.trim().toLowerCase();
    if (keyword && !String(product.name || '').toLowerCase().includes(keyword)) return false;
    if (selectedStall && !(product.stallIds || []).some(id => this.normalizeId(id) === this.normalizeId(selectedStall))) return false;
    if (selectedTag && !(product.relateTagIds || []).some(id => this.normalizeId(id) === this.normalizeId(selectedTag))) return false;
    return true;
  },

  updateVisibleProduct: function(updatedProduct) {
    if (!updatedProduct || updatedProduct.id == null) return;
    const productId = this.normalizeId(updatedProduct.id);
    if (!this.data.products.some(item => this.normalizeId(item.id) === productId)) return;
    this._productQueryVersion = (this._productQueryVersion || 0) + 1;
    const previous = this.data.products.find(item => this.normalizeId(item.id) === productId);
    const product = this.normalizeProduct({ ...previous, ...updatedProduct });
    const stillVisible = this.productMatchesFilters(product);
    const products = stillVisible
      ? this.data.products.map(item => this.normalizeId(item.id) === productId ? product : item)
      : this.data.products.filter(item => this.normalizeId(item.id) !== productId);
    const selectedIds = stillVisible
      ? this.data.selectedProductIds
      : this.data.selectedProductIds.filter(id => this.normalizeId(id) !== productId);
    this.refreshSelectionState(products, selectedIds);
    this.planScheduleRefresh();
  },

  openBatchSchedule() {
    if (this.data.batchOperating) return;
    if (!this.data.selectedCount) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }
    if (this.data.selectedCount > 200) {
      wx.showToast({ title: '一次最多选择200个商品', icon: 'none' });
      return;
    }
    this._scheduleProductIds = this.data.selectedProductIds.slice();
    this.setData({ showProductSchedule: true });
  },
  closeProductSchedule() {
    if (!this.data.batchOperating) this.setData({ showProductSchedule: false });
  },
  async confirmBatchSchedule(e) {
    if (this.data.batchOperating) return;
    const productIds = (this._scheduleProductIds || []).slice();
    if (!productIds.length) return;
    this.setData({ batchOperating: true });
    try {
      await api.put('/products/schedule/batch', { productIds, schedule: e.detail });
      this.setData({ showProductSchedule: false });
      this.applyScheduleChanges(productIds, e.detail, true);
      wx.showToast({ title: `已设置${productIds.length}个商品`, icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '定时设置失败', icon: 'none' });
    } finally {
      this.setData({ batchOperating: false });
    }
  },

  applyScheduleChanges(productIds, schedule, clearSelection = false) {
    this._productQueryVersion = (this._productQueryVersion || 0) + 1;
    const ids = new Set(productIds.map(id => this.normalizeId(id)));
    const products = this.data.products.map(item => ids.has(this.normalizeId(item.id))
      ? this.normalizeProduct({ ...item, schedule: schedule && !schedule.cancelled ? { ...schedule, state: 'pending' } : null })
      : item).filter(item => this.productMatchesFilters(item));
    if (this.data.activeStatus === 'scheduled' && products.length !== this.data.products.length) {
      this._scheduleListNeedsRefill = true;
    }
    const visibleIds = new Set(products.map(item => this.normalizeId(item.id)));
    this.refreshSelectionState(products, clearSelection ? [] : this.data.selectedProductIds.filter(id => visibleIds.has(this.normalizeId(id))));
    this.planScheduleRefresh();
  },
  cancelProductSchedule(e) {
    const id = this.normalizeId(e.currentTarget.dataset.id);
    const product = this.data.products.find(item => this.normalizeId(item.id) === id);
    if (!product || !hasPendingSchedule(product.schedule)) return;
    this.confirmCancelSchedules([id], false);
  },
  batchCancelSchedules() {
    if (!this.data.selectedCount) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }
    if (this.data.selectedCount > 200) {
      wx.showToast({ title: '一次最多选择200个商品', icon: 'none' });
      return;
    }
    this.confirmCancelSchedules(this.data.selectedProductIds.slice(), true);
  },
  confirmCancelSchedules(productIds, batch) {
    if (this.data.batchOperating || this._scheduleCancelConfirming) return;
    this._scheduleCancelConfirming = true;
    wx.showModal({
      title: batch ? '批量取消定时' : '取消定时任务',
      content: batch ? `确认取消所选 ${productIds.length} 个商品的定时上架/下架任务？商品当前状态保持不变。`
        : '确认取消这件商品的定时上架/下架任务？商品当前状态保持不变。',
      confirmText: '取消定时',
      cancelText: '返回',
      confirmColor: '#d32f2f',
      success: async res => {
        if (!res.confirm) { this._scheduleCancelConfirming = false; return; }
        this.setData({ batchOperating: true });
        let succeeded = false;
        try {
          const result = await api.put('/products/schedule/batch', { productIds, schedule: { cancelled: true } });
          this.applyScheduleChanges(productIds, null, batch);
          succeeded = true;
          const count = result && result.updatedCount !== undefined ? result.updatedCount : productIds.length;
          wx.showToast({ title: count ? `已取消${count}个定时任务` : '所选商品已无定时任务', icon: count ? 'success' : 'none' });
        } catch (err) {
          wx.showToast({ title: err.message || '取消定时失败', icon: 'none' });
        } finally {
          this._scheduleCancelConfirming = false;
          this.setData({ batchOperating: false });
        }
        if (succeeded && this._scheduleListNeedsRefill) await this.refreshDueScheduleProducts();
      },
      fail: () => { this._scheduleCancelConfirming = false; }
    });
  },

  batchSetStatus: function(e) {
    const status = e.currentTarget.dataset.status;
    const selectedCount = this.data.selectedCount;
    if (selectedCount === 0) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }
    if (this.data.batchOperating) return;

    const actionText = status === 'on' ? '上架' : '下架';
    wx.showModal({
      title: `批量${actionText}`,
      content: `确认将选中的 ${selectedCount} 个商品${actionText}？`,
      confirmText: actionText,
      confirmColor: status === 'on' ? '#1f2933' : '#d32f2f',
      success: async (res) => {
        if (!res.confirm) return;

        this.setData({ batchOperating: true });
        wx.showLoading({ title: '处理中...' });

        try {
          const productIds = this.data.selectedProductIds.slice();
          const result = await api.patch('/products/status/batch', {
            productIds,
            status
          });

          const selectedMap = {};
          productIds.forEach(id => {
            selectedMap[this.normalizeId(id)] = true;
          });
          this._productQueryVersion = (this._productQueryVersion || 0) + 1;
          const products = this.data.products
            .map(item => ({
              ...item,
              status: selectedMap[this.normalizeId(item.id)] ? status : item.status,
              selected: false
            }))
            .filter(item => this.productMatchesFilters(item));

          wx.hideLoading();
          this.setData({
            products,
            selectMode: false,
            selectedProductIds: [],
            selectedCount: 0,
            allSelected: false,
            batchOperating: false
          });
          this.planScheduleRefresh();

          const updatedCount = result && result.updatedCount !== undefined ? result.updatedCount : selectedCount;
          const skippedCount = result && result.skippedCount ? result.skippedCount : 0;
          wx.showToast({
            title: skippedCount > 0 ? `成功${updatedCount} 跳过${skippedCount}` : `已${actionText}${updatedCount}个`,
            icon: 'success'
          });
        } catch (err) {
          wx.hideLoading();
          this.setData({ batchOperating: false });
          wx.showToast({ title: err?.message || '批量操作失败', icon: 'none' });
        }
      }
    });
  },

  // 改造：删除商品
  deleteProduct: async function(e) {
    const id = e.currentTarget.dataset.id;

    wx.showModal({
      title: '高危操作',
      content: '确定要彻底删除这件商品吗？删除后不可恢复！',
      confirmColor: '#f5222d',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          try {
            await api.delete(`/products/${id}`);
            wx.hideLoading();
            wx.showToast({ title: '删除成功', icon: 'success' });
            const productId = this.normalizeId(id);
            this._productQueryVersion = (this._productQueryVersion || 0) + 1;
            this.refreshSelectionState(
              this.data.products.filter(item => this.normalizeId(item.id) !== productId),
              this.data.selectedProductIds.filter(itemId => this.normalizeId(itemId) !== productId)
            );
            this.planScheduleRefresh();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 编辑商品：跳转到 admin 页面并传入商品 ID
  editProduct: function(e) {
    const id = e.currentTarget.dataset.id;
    this.openProductEditor(id);
  },

  openProductEditor: function(id) {
    wx.navigateTo({
      url: `/pages/admin/admin?editId=${id}`,
      events: {
        productUpdated: product => this.updateVisibleProduct(product)
      }
    });
  },

  // 跳转到回收站
  goToRecycleBin: function() {
    wx.navigateTo({
      url: '/pages/adminProductRecycleBin/adminProductRecycleBin'
    });
  }
}, {
  input: 'onSearchInput',
  submit: 'onSearchConfirm',
  field: 'searchKeyword',
  automatic: 'loadProducts'
}));
