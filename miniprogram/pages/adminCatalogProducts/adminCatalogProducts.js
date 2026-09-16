const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    type: 'stall',
    groupId: '',
    groupName: '',
    scope: 'included',
    status: 'all',
    keyword: '',
    products: [],
    page: 0,
    pageSize: 20,
    hasMore: true,
    loading: false,
    operating: false,
    selectedIds: [],
    selectedCount: 0,
    allLoadedSelected: false
  },

  async onLoad(options) {
    this.setData({
      type: options.type === 'tag' ? 'tag' : 'stall',
      groupId: options.id || '',
      groupName: decodeURIComponent(options.name || '')
    });
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) {
        wx.showToast({ title: '无权限', icon: 'none' });
        wx.navigateBack();
        return;
      }
      this.loadProducts(true);
    } catch (err) {
      wx.showToast({ title: '登录状态恢复失败', icon: 'none' });
    }
  },

  resourcePath() {
    return this.data.type === 'stall' ? '/stalls' : '/tags';
  },

  normalizeId(id) {
    return String(id);
  },

  applySelection(products, selectedIds = this.data.selectedIds) {
    const selectedMap = {};
    selectedIds.forEach(id => { selectedMap[this.normalizeId(id)] = true; });
    return products.map(item => ({
      ...item,
      selected: !!selectedMap[this.normalizeId(item.id)]
    }));
  },

  refreshSelection(products = this.data.products, selectedIds = this.data.selectedIds) {
    const normalized = selectedIds.map(id => this.normalizeId(id));
    const visibleIds = products.map(item => this.normalizeId(item.id));
    const allLoadedSelected = visibleIds.length > 0
      && visibleIds.every(id => normalized.includes(id));
    this.setData({
      products: this.applySelection(products, normalized),
      selectedIds: normalized,
      selectedCount: normalized.length,
      allLoadedSelected
    });
  },

  async loadProducts(reset = false) {
    if (this.data.loading || (!reset && !this.data.hasMore)) return;
    if (reset) {
      this.setData({
        products: [],
        page: 0,
        hasMore: true,
        selectedIds: [],
        selectedCount: 0,
        allLoadedSelected: false
      });
    }
    this.setData({ loading: true });
    try {
      const res = await api.get(
        this.resourcePath() + '/' + this.data.groupId + '/products',
        {
          scope: this.data.scope,
          status: this.data.status,
          keyword: this.data.keyword.trim(),
          page: this.data.page,
          size: this.data.pageSize
        }
      );
      const list = (res.content || []).map(item => ({ ...item, selected: false }));
      const products = reset ? list : this.data.products.concat(list);
      this.setData({
        products: this.applySelection(products),
        page: this.data.page + 1,
        hasMore: res.hasNext !== undefined ? res.hasNext : list.length === this.data.pageSize,
        loading: false
      });
      this.refreshSelection(products, this.data.selectedIds);
    } catch (err) {
      console.error('加载分类商品失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  loadMore() {
    this.loadProducts(false);
  },

  switchScope(e) {
    const scope = e.currentTarget.dataset.scope;
    if (scope === this.data.scope) return;
    this.setData({ scope }, () => this.loadProducts(true));
  },

  switchStatus(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.status) return;
    this.setData({ status }, () => this.loadProducts(true));
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  search() {
    this.loadProducts(true);
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.loadProducts(true));
  },

  toggleProduct(e) {
    const id = this.normalizeId(e.currentTarget.dataset.id);
    const selectedIds = this.data.selectedIds.slice();
    const index = selectedIds.indexOf(id);
    if (index >= 0) selectedIds.splice(index, 1);
    else selectedIds.push(id);
    this.refreshSelection(this.data.products, selectedIds);
  },

  toggleSelectAllLoaded() {
    const visibleIds = this.data.products.map(item => this.normalizeId(item.id));
    let selectedIds = this.data.selectedIds.slice();
    if (this.data.allLoadedSelected) {
      selectedIds = selectedIds.filter(id => !visibleIds.includes(id));
    } else {
      visibleIds.forEach(id => {
        if (!selectedIds.includes(id)) selectedIds.push(id);
      });
    }
    this.refreshSelection(this.data.products, selectedIds);
  },

  clearSelection() {
    this.refreshSelection(this.data.products, []);
  },

  submitBatch() {
    if (this.data.selectedCount === 0 || this.data.operating) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }
    if (this.data.selectedCount > 200) {
      wx.showToast({ title: '单次最多操作 200 个商品', icon: 'none' });
      return;
    }
    const isAdd = this.data.scope === 'excluded';
    const actionText = isAdd ? '添加' : '移除';
    wx.showModal({
      title: '批量' + actionText,
      content: '确认' + actionText + '选中的 ' + this.data.selectedCount + ' 个商品？',
      confirmText: actionText,
      confirmColor: isAdd ? '#1f2933' : '#c83e35',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ operating: true });
        wx.showLoading({ title: '处理中...', mask: true });
        try {
          const result = await api.patch(
            this.resourcePath() + '/' + this.data.groupId + '/products',
            {
              action: isAdd ? 'ADD' : 'REMOVE',
              productIds: this.data.selectedIds
            }
          );
          wx.hideLoading();
          this.setData({ operating: false });
          wx.showToast({
            title: '已' + actionText + (result.updatedCount || this.data.selectedCount) + '个',
            icon: 'success'
          });
          this.loadProducts(true);
        } catch (err) {
          wx.hideLoading();
          this.setData({ operating: false });
          wx.showToast({ title: err.message || '批量操作失败', icon: 'none' });
        }
      }
    });
  }
});
