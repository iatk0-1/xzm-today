const { getErrorMessage } = require('../../utils/error');
const autoSearch = require('../../utils/autoSearch');
const pageSync = require('../../utils/pageSync');
// miniprogram/pages/adminProductRecycleBin/adminProductRecycleBin.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page(autoSearch.wrap(pageSync.wrap({
  data: {
    products: [],
    isLoading: true,
    offset: 0,
    limit: 20,
    hasMore: true,
    searchKeyword: '',

    // 筛选相关
    filterPanelTop: 0,
    showStallPanel: false,
    showTagPanel: false,
    selectedStall: '',
    selectedStallName: '',
    selectedTag: '',
    selectedTagName: '',
    hasFilter: false,
    stallList: [],
    tagList: [],
    restoreTarget: '',
    restoreCandidates: [],
    restoreSkuIds: [],
    restoreBusy: false,
    restoreError: ''
  },

  onShow: function() {
    this.updateFilterPanelPosition();
  },

  onLoad: function() {
    this.resetAndLoad();
    // 弹层位置在页面布局完成后通过 filter-bar 的真实位置计算。
  },

  onReady: function() {
    this.updateFilterPanelPosition();
  },

  updateFilterPanelPosition: function() {
    wx.nextTick(() => {
      wx.createSelectorQuery()
        .select('.filter-bar')
        .boundingClientRect(rect => {
          if (rect) {
            this.setData({ filterPanelTop: Math.round(rect.bottom) });
          }
        })
        .exec();
    });
  },

  // 重置并加载
  resetAndLoad: function() {
    this.setData({
      products: [],
      offset: 0,
      hasMore: true
    }, () => {
      this.loadProducts();
      this.loadStallList();
      this.loadTagList();
    });
  },

  // 加载档口列表
  loadStallList: async function() {
    try {
      const stalls = await api.get('/stalls');
      const stallList = Array.isArray(stalls) ? stalls : [];
      // 在档口列表前添加"全部"选项
      const stallListWithAll = [
        { id: 'all', name: '全部' },
        ...stallList.map(item => ({ ...item, id: String(item.id) }))
      ];
      this.setData({ stallList: stallListWithAll });
    } catch (err) {
      console.error('加载档口列表失败:', err);
      this.setData({
        stallList: [{ id: 'all', name: '全部' }]
      });
    }
  },

  // 加载标签列表
  loadTagList: async function() {
    try {
      const tags = await api.get('/tags');
      const tagList = Array.isArray(tags) ? tags : [];
      // 在标签列表前添加"全部"选项
      const tagListWithAll = [
        { id: 'all', name: '全部' },
        ...tagList.map(item => ({ ...item, id: String(item.id) }))
      ];
      this.setData({ tagList: tagListWithAll });
    } catch (err) {
      console.error('加载标签列表失败:', err);
      this.setData({
        tagList: [{ id: 'all', name: '全部' }]
      });
    }
  },

  // 加载商品列表
  loadProducts: async function(isLoadMore = false) {
    this.setData({ loadError: '' });
    if (!this.data.hasMore && isLoadMore) {
      return;
    }

    if (!isLoadMore) {
      this.setData({ isLoading: true });
    }

    const { offset, limit, searchKeyword, selectedStall, selectedTag } = this.data;

    try {
      await auth.ensureAuthenticated({ silent: true });
      const params = {
        limit: limit,
        offset: offset
      };

      if (searchKeyword) {
        params.keyword = searchKeyword;
      }
      if (selectedStall && selectedStall !== 'all') {
        params.stall = selectedStall;
      }
      if (selectedTag && selectedTag !== 'all') {
        params.tag = selectedTag;
      }

      const res = await api.get('/products/deleted', params);

      const list = res.map(item => ({ ...item, deleteTimeStr: this.formatDeletedTime(item.deletedAt) }));

      this.setData({
        products: isLoadMore ? [...this.data.products, ...list] : list,
        isLoading: false,
        offset: offset + list.length,
        hasMore: list.length === limit
      });
    } catch (err) {
      console.error('加载回收站失败:', err);
      this.setData({ isLoading: false, loadError: getErrorMessage(err, '回收站加载失败') });
      wx.showToast({ title: getErrorMessage(err, '加载失败'), icon: 'none' });
    }
  },

  // 加载更多
  loadMore: function() {
    if (this.data.hasMore && !this.data.isLoading) {
      this.loadProducts(true);
    }
  },

  // 搜索输入
  onSearchInput: function(e) {
    this.setData({
      searchKeyword: e.detail.value
    });
  },

  // 搜索确认
  onSearchConfirm: function() {
    this.resetAndLoad();
  },

  // 清除搜索
  clearSearch: function() {
    this.setData({
      searchKeyword: ''
    }, () => {
      this.resetAndLoad();
    });
  },

  // 切换筛选面板（档口/标签）
  handleFilterTabChange: function(e) {
    const tab = e.currentTarget.dataset.tab;

    if (tab === 'stall') {
      this.setData({
        showStallPanel: !this.data.showStallPanel,
        showTagPanel: false
      });
    } else if (tab === 'tag') {
      this.setData({
        showTagPanel: !this.data.showTagPanel,
        showStallPanel: false
      });
    }
  },

  // 关闭筛选弹层
  closeFilterPanel: function() {
    this.setData({
      showStallPanel: false,
      showTagPanel: false
    });
  },

  // 阻止点击弹层内容时触发遮罩关闭
  stopFilterPanelTap: function() {},

  normalizeFilterId: function(id) {
    return id === undefined || id === null ? '' : String(id);
  },

  // 选择档口
  selectStall: function(e) {
    const stallId = this.normalizeFilterId(e.currentTarget.dataset.stall);
    const stallName = e.currentTarget.dataset.name;

    this.setData({
      selectedStall: stallId === 'all' ? '' : stallId,
      selectedStallName: stallId === 'all' ? '' : stallName,
      showStallPanel: false,
      hasFilter: (stallId !== 'all' && stallId !== '') || !!this.data.selectedTag
    }, () => {
      // 等筛选条件写入 data 后再重新请求，避免请求读到旧条件。
      this.resetAndLoad();
    });

    if (stallId === 'all') {
      wx.showToast({ title: '已显示全部', icon: 'none' });
    } else {
      wx.showToast({ title: '已切换至：' + stallName, icon: 'none' });
    }
  },

  // 选择标签
  selectTag: function(e) {
    const tagId = this.normalizeFilterId(e.currentTarget.dataset.tag);
    const tagName = e.currentTarget.dataset.name;

    this.setData({
      selectedTag: tagId === 'all' ? '' : tagId,
      selectedTagName: tagId === 'all' ? '' : tagName,
      showTagPanel: false,
      hasFilter: (tagId !== 'all' && tagId !== '') || !!this.data.selectedStall
    }, () => {
      // 等筛选条件写入 data 后再重新请求，避免请求读到旧条件。
      this.resetAndLoad();
    });

    if (tagId === 'all') {
      wx.showToast({ title: '已显示全部', icon: 'none' });
    } else {
      wx.showToast({ title: '已切换至：' + tagName, icon: 'none' });
    }
  },

  // 重置筛选
  resetFilter: function() {
    this.setData({
      selectedStall: '',
      selectedStallName: '',
      selectedTag: '',
      selectedTagName: '',
      hasFilter: false,
      showStallPanel: false,
      showTagPanel: false
    }, () => {
      this.resetAndLoad();
    });
  },

  // 查看商品详情
  viewProductDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/admin?editId=${id}`
    });
  },

  formatDeletedTime: function(value) {
    if (!value) return '未知';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未知';
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  // 有删除记录的商品精确恢复；旧数据先由管理员核对款式。
  restoreProduct: async function(e) {
    if (this.data.restoreBusy || this.data.restoreTarget) return;
    const id = String(e.currentTarget.dataset.id);
    this.setData({ restoreBusy: true, restoreError: '' });
    try {
      const preview = await api.get(`/products/deleted/${id}/restore-preview`);
      if (preview.selectionRequired) {
        this.setData({ restoreTarget: id, restoreCandidates: (preview.skus || []).map(sku => ({ ...sku, id: String(sku.id), selected: false })), restoreSkuIds: [] });
        return;
      }
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '确认恢复',
        content: '将恢复本次随商品删除的款式和套装分组，并同步应生效的佣金。以前单独删除的款式不会恢复，已有订单佣金保持原值。',
        confirmColor: '#1890ff',
        success: result => resolve(result.confirm), fail: () => resolve(false)
      }));
      if (confirmed) await this.performRestore(id, {});
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '加载恢复信息失败'), icon: 'none' });
    } finally {
      this.setData({ restoreBusy: false });
    }
  },

  changeRestoreSelection: function(e) {
    if (this.data.restoreBusy) return;
    const selected = new Set((e.detail.value || []).map(String));
    const ids = this.data.restoreCandidates.filter(sku => selected.has(sku.id)).map(sku => sku.id);
    this.setData({ restoreSkuIds: ids, restoreCandidates: this.data.restoreCandidates.map(sku => ({ ...sku, selected: selected.has(sku.id) })), restoreError: '' });
  },

  closeRestoreSelection: function() {
    if (!this.data.restoreBusy) this.setData({ restoreTarget: '', restoreCandidates: [], restoreSkuIds: [], restoreError: '' });
  },

  confirmLegacyRestore: async function() {
    if (this.data.restoreBusy || !this.data.restoreTarget) return;
    if (!this.data.restoreSkuIds.length) {
      this.setData({ restoreError: '请先选择需要恢复的款式' });
      return;
    }
    this.setData({ restoreBusy: true, restoreError: '' });
    try {
      await this.performRestore(this.data.restoreTarget, { skuIds: this.data.restoreSkuIds });
      this.setData({ restoreTarget: '', restoreCandidates: [], restoreSkuIds: [] });
    } catch (err) {
      this.setData({ restoreError: getErrorMessage(err, '恢复失败，请重试') });
    } finally {
      this.setData({ restoreBusy: false });
    }
  },

  performRestore: async function(id, body) {
    wx.showLoading({ title: '恢复中...' });
    try {
      const result = await api.post(`/products/deleted/${id}/restore`, body);
      const products = this.data.products.filter(p => String(p.id) !== String(id));
      const removed = this.data.products.length - products.length;
      this.setData({ products, offset: Math.max(0, this.data.offset - removed) });
      pageSync.publish('products', id);
      wx.showToast({ title: result && result.product && result.product.status === 'off' ? '已恢复，请核对后上架' : '恢复成功', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
}, async function(changes) {
  await pageSync.updateList(this, changes, {
    entity: 'products', field: 'products', url: id => '/products/deleted/' + id,
    normalize: function(item) { return { ...item, deleteTimeStr: this.formatDeletedTime(item.deletedAt) }; }
  });
}), {
  input: 'onSearchInput',
  submit: 'onSearchConfirm',
  field: 'searchKeyword'
}));
