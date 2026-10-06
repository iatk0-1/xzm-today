const { getErrorMessage } = require('../../utils/error');
const autoSearch = require('../../utils/autoSearch');
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page(autoSearch.wrap({
  data: {
    type: 'stall',
    groupId: '',
    groupName: '',
    scope: 'included',
    status: 'all',
    keyword: '',
    products: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    operating: false,
    renaming: false,
    renameVisible: false,
    editName: '',
    selectedIds: [],
    selectedCount: 0,
    allLoadedSelected: false,
    managers: [], managerId: '', managerName: '',
    pricingRuleId: '', pricingRuleName: '', pricingRuleEnabled: null, pricingRuleDeleted: false,
    pricingRuleLoaded: false, pricingRuleError: '', pricingRuleCount: 0
  },

  async onLoad(options) {
    this.setData({
      type: options.type === 'tag' ? 'tag' : 'stall',
      groupId: options.id || '',
      groupName: decodeURIComponent(options.name || ''),
      managerId: options.type === 'tag' ? '' : (options.managerId || ''),
      managerName: decodeURIComponent(options.managerName || '')
    });
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) {
        wx.showToast({ title: '无权限', icon: 'none' });
        wx.navigateBack();
        return;
      }
      this._authorized = true;
      this.loadProducts(true);
      if (this.data.type === 'stall') this.loadGroup();
      if (this.data.type === 'stall' && !this.data.managerId) {
        this.loadManagers();
      }
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '登录状态恢复失败'), icon: 'none' });
    }
  },

  resourcePath() {
    return this.data.type === 'stall' ? '/stalls' : '/tags';
  },

  onShow() {
    if (this._openedPricingRule) {
      this._openedPricingRule = false;
      return this.loadGroup();
    }
  },

  async loadGroup() {
    if (!this._authorized || this.data.type !== 'stall' || !this.data.groupId) return;
    try {
      const group = await api.get('/stalls/' + encodeURIComponent(this.data.groupId) + '/manage');
      this.setData({
        groupName: group.name,
        pricingRuleId: group.pricingRuleId || '',
        pricingRuleName: group.pricingRuleNames ? group.pricingRuleNames.join('、') : (group.pricingRuleName || ''),
        pricingRuleCount: group.pricingRuleNames ? group.pricingRuleNames.length : (group.pricingRuleId ? 1 : 0),
        pricingRuleEnabled: group.pricingRuleEnabled, pricingRuleDeleted: !!group.pricingRuleDeleted,
        pricingRuleLoaded: true, pricingRuleError: ''
      });
    } catch (err) {
      this.setData({ pricingRuleError: '加载失败' });
      wx.showToast({ title: getErrorMessage(err, '加载档口计价规则失败'), icon: 'none' });
    }
  },

  async loadManagers() {
    const revision = this._managerRevision || 0;
    try {
      const managers = await api.get('/stall-managers/stalls/' + this.data.groupId);
      if (revision !== (this._managerRevision || 0)) return;
      this.setData({ managers: managers || [] });
    } catch (err) {
      if (revision !== (this._managerRevision || 0)) return;
      wx.showToast({ title: getErrorMessage(err, '加载负责人失败'), icon: 'none' });
    }
  },

  openPricingRule() {
    if (this.data.managerId || this.data.type !== 'stall') return;
    this._openedPricingRule = true;
    wx.navigateTo({
      url: '/pages/pricingRules/pricingRules?stallId=' + encodeURIComponent(String(this.data.groupId))
        + '&stallName=' + encodeURIComponent(this.data.groupName)
    });
  },

  noop() {},

  renameGroup() {
    if (this.data.managerId) return;
    if (this.data.renaming || this.data.operating) return;
    this.setData({ renameVisible: true, editName: this.data.groupName });
  },

  onEditNameInput(e) {
    this.setData({ editName: e.detail.value });
  },

  closeRename() {
    if (this.data.renaming) return;
    this.setData({ renameVisible: false, editName: '' });
  },

  async saveRename() {
    if (!this.data.renameVisible || this.data.renaming) return;
    const name = this.data.editName.trim();
    const label = this.data.type === 'stall' ? '档口' : '标签';
    if (!name) {
      wx.showToast({ title: label + '名称不能为空', icon: 'none' });
      return;
    }
    if (name.length > 64) {
      wx.showToast({ title: label + '名称最多 64 个字符', icon: 'none' });
      return;
    }
    if (name === this.data.groupName) {
      this.closeRename();
      return;
    }
    this.setData({ renaming: true });
    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const updated = await api.patch(
        this.resourcePath() + '/' + this.data.groupId + '/name', { name }
      );
      this.setData({ groupName: updated.name, renameVisible: false, editName: '' });
      wx.hideLoading();
      wx.showToast({ title: '名称已修改', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: getErrorMessage(err, '修改名称失败'), icon: 'none' });
    } finally {
      this.setData({ renaming: false });
    }
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
        page: 1,
        hasMore: true,
        selectedIds: [],
        selectedCount: 0,
        allLoadedSelected: false
      });
    }
    this.setData({ loading: true });
    try {
      const managerId = this.data.managerId;
      const params = managerId ? {
        stallId: this.data.groupId,
        keyword: this.data.keyword.trim(),
        page: this.data.page,
        size: this.data.pageSize
      } : {
        scope: this.data.scope,
        status: this.data.status,
        keyword: this.data.keyword.trim(),
        page: this.data.page,
        size: this.data.pageSize
      };
      if (managerId && this.data.status !== 'all') params.status = this.data.status;
      const res = await api.get(
        managerId ? '/stall-managers/' + encodeURIComponent(managerId) + '/commission-products'
          : this.resourcePath() + '/' + this.data.groupId + '/products',
        params
      );
      const list = (res.content || []).map(item => ({ ...item, id: managerId ? item.productId : item.id, selected: false }));
      if (list.length && !managerId) {
        const owners = await api.get('/stall-managers/products/owners',
          { ids: list.map(item => item.id).join(',') }).catch(() => []);
        const ownerMap = {};
        (owners || []).forEach(owner => { ownerMap[String(owner.productId)] = owner; });
        list.forEach(item => { item.managerOwner = ownerMap[String(item.id)] || null; });
      }
      const products = reset ? list : this.data.products.concat(list);
      this.setData({
        products: this.applySelection(products),
        page: this.data.page + 1,
        hasMore: res.hasNext !== undefined ? res.hasNext
          : res.totalPages !== undefined ? this.data.page < res.totalPages : list.length === this.data.pageSize,
        loading: false
      });
      this.refreshSelection(products, this.data.selectedIds);
    } catch (err) {
      console.error('加载分类商品失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: getErrorMessage(err, '加载失败'), icon: 'none' });
    }
  },

  loadMore() {
    this.loadProducts(false);
  },

  switchScope(e) {
    if (this.data.type === 'stall') return;
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
    if (this.data.managerId) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(String(e.currentTarget.dataset.id)) });
      return;
    }
    if (this.data.type === 'stall') {
      wx.navigateTo({ url: '/pages/admin/admin?editId=' + encodeURIComponent(String(e.currentTarget.dataset.id)) });
      return;
    }
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
    if (this.data.type === 'stall') {
      wx.showToast({ title: '请进入商品编辑页修改档口和计价规则', icon: 'none' });
      return;
    }
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
          const selectedIds = new Set(this.data.selectedIds.map(String));
          this.refreshSelection(this.data.products.filter(item => !selectedIds.has(String(item.id))), []);
        } catch (err) {
          wx.hideLoading();
          this.setData({ operating: false });
          wx.showToast({ title: getErrorMessage(err, '批量操作失败'), icon: 'none' });
        }
      }
    });
  }
}, {
  input: 'onKeywordInput',
  submit: 'search',
  field: 'keyword'
}));
