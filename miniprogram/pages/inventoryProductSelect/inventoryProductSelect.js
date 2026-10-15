const api = require('../../utils/api');
const auth = require('../../utils/auth');
const autoSearch = require('../../utils/autoSearch');
const { getErrorMessage } = require('../../utils/error');
const { isProductSoldOut } = require('../../utils/stock');
const { hasPendingSchedule } = require('../../utils/productSchedule');

Page(autoSearch.wrap({
  data: {
    products: [], keyword: '', activeStatus: 'all', selectedStall: '', selectedTag: '', stallList: [], tagList: [],
    statuses: [{ id: 'all', name: '全部' }, { id: 'on', name: '已上架' }, { id: 'off', name: '已下架' }, { id: 'sold_out', name: '已售罄' }, { id: 'scheduled', name: '已定时' }],
    page: 1, hasMore: true, loading: false, confirming: false, error: '', selectedCount: 0, allSelected: false
  },
  onLoad() {
    this._selected = new Map();
    this._channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (this._channel && this._channel.on) this._channel.on('initialSelection', result => {
      for (const product of result.products || []) this._selected.set(String(product.id), product);
      this.updateSelection();
    });
    this.loadFilters();
    return this.loadProducts();
  },
  onUnload() { this._disposed = true; this._queryVersion = (this._queryVersion || 0) + 1; },
  onReachBottom() { return this.loadProducts(false); },
  async loadFilters() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      const result = await Promise.allSettled([api.get('/stalls/all'), api.get('/tags/all')]);
      this.setData({ stallList: result[0].status === 'fulfilled' && Array.isArray(result[0].value) ? result[0].value : [],
        tagList: result[1].status === 'fulfilled' && Array.isArray(result[1].value) ? result[1].value : [] });
      if (result.some(value => value.status === 'rejected')) wx.showToast({ title: '部分筛选项加载失败，请点击重试', icon: 'none' });
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '加载筛选项失败'), icon: 'none' }); }
  },
  getQuery(page) {
    const query = { page, size: 20, manage: true, status: this.data.activeStatus };
    if (this.data.keyword.trim()) query.keyword = this.data.keyword.trim();
    if (this.data.selectedStall) query.stallId = this.data.selectedStall;
    if (this.data.selectedTag) query.tagId = this.data.selectedTag;
    return query;
  },
  async loadProducts(reset = true) {
    if (this.data.confirming || (!reset && (this.data.loading || !this.data.hasMore))) return;
    const version = (this._queryVersion || 0) + 1; this._queryVersion = version;
    if (reset || !this._activeQuery) this._activeQuery = this.getQuery(1);
    const query = { ...this._activeQuery, page: reset ? 1 : this.data.page };
    this.setData({ loading: true, error: '', ...(reset ? { products: [], page: 1, hasMore: true, allSelected: false } : {}) });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const result = await api.get('/products/query', query);
      if (this._disposed || version !== this._queryVersion) return;
      const products = (result.content || []).map(product => ({ ...product,
        soldOut: isProductSoldOut(product), scheduled: hasPendingSchedule(product.schedule),
        selectable: (product.skuMatrix || []).length > 0,
        skuText: (product.skuMatrix || []).map(sku => [sku.color || '默认规格', sku.size].filter(Boolean).join('/')).join('、')
      }));
      const unique = new Map((reset ? [] : this.data.products).map(product => [String(product.id), product]));
      products.forEach(product => unique.set(String(product.id), product));
      this.setData({ products: [...unique.values()], page: query.page + 1, hasMore: result.hasNext === undefined ? products.length === 20 : !!result.hasNext, loading: false });
      this.updateSelection();
    } catch (err) {
      if (this._disposed || version !== this._queryVersion) return;
      this.setData({ loading: false, error: getErrorMessage(err, '查询商品失败，请重试') });
    }
  },
  onKeywordInput(e) { this.setData({ keyword: e.detail.value }); },
  search() { return this.loadProducts(); },
  clearSearch() { this.setData({ keyword: '' }); return this.loadProducts(); },
  setFilter(e) {
    if (this.data.confirming) return;
    const { field, value } = e.currentTarget.dataset;
    if (!['activeStatus', 'selectedStall', 'selectedTag'].includes(field)) return;
    this.setData({ [field]: value === 'all' && field !== 'activeStatus' ? '' : value });
    return this.loadProducts();
  },
  updateSelection() {
    if (!this._selected) this._selected = new Map();
    const products = this.data.products.map(product => ({ ...product, selected: this._selected.has(String(product.id)) }));
    const eligible = products.filter(product => product.selectable);
    this.setData({ products, selectedCount: this._selected.size, allSelected: eligible.length > 0 && eligible.every(product => product.selected) });
  },
  toggleProduct(e) {
    if (this.data.confirming) return;
    const product = this.data.products.find(item => String(item.id) === String(e.currentTarget.dataset.id));
    if (!product || !product.selectable) return;
    const id = String(product.id);
    if (this._selected.has(id)) this._selected.delete(id); else this._selected.set(id, product);
    this.updateSelection();
  },
  toggleAll() {
    if (this.data.confirming) return;
    const clear = this.data.allSelected;
    this.data.products.filter(product => product.selectable).forEach(product => {
      if (clear) this._selected.delete(String(product.id)); else this._selected.set(String(product.id), product);
    });
    this.updateSelection();
  },
  async confirmSelection() {
    if (this.data.confirming) return;
    if (!this._channel || !this._channel.emit) { wx.showToast({ title: '请从库存详情页进入商品选择', icon: 'none' }); return; }
    if (this._selected.size > 100) { wx.showToast({ title: '一次最多选择100个换回商品', icon: 'none' }); return; }
    this.setData({ confirming: true });
    try {
      const selected = [...this._selected.values()];
      const products = [];
      // 分组读取完整库存规格；全部成功才返回，避免漏带某个商品或某些规格。
      for (let offset = 0; offset < selected.length; offset += 5) {
        const batch = await Promise.all(selected.slice(offset, offset + 5).map(product => api.get('/sku-inventory/products/' + encodeURIComponent(product.id), { records: false })));
        batch.forEach(result => {
          if (!result.skus || !result.skus.length) throw new Error('商品“' + result.product.name + '”没有有效规格，请取消选择后重试');
          products.push({ ...result.product, skus: result.skus });
        });
      }
      if (products.reduce((sum, product) => sum + product.skus.length, 0) > 500) throw new Error('换回规格超过500个，请减少所选商品');
      this._channel.emit('productsSelected', { products });
      wx.navigateBack();
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '读取换回规格失败，请重试'), icon: 'none' }); }
    finally { this.setData({ confirming: false }); }
  }
}, { input: 'onKeywordInput', submit: 'search', field: 'keyword', loading: [] }));
