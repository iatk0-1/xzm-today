const api = require('../../utils/api');
const auth = require('../../utils/auth');
const query = require('../../utils/productManagementQuery');
const { getErrorMessage } = require('../../utils/error');
const compactProduct = ({ id, name, coverUrl, articleNo }) => ({ id, name, coverUrl, articleNo });

Component({
  properties: { visible: { type: Boolean, value: false }, existingIds: { type: Array, value: [] } },
  data: {
    products: [], activeStatus: 'all', searchKeyword: '', selectedStall: '', selectedTag: '',
    stalls: [], tags: [], page: 1, pageSize: 20, hasMore: true, loading: false,
    error: '', selectedCount: 0, allSelected: false, selectingAll: false,
    statusTabs: [
      { key: 'all', label: '全部' }, { key: 'on', label: '已上架' }, { key: 'off', label: '已下架' },
      { key: 'sold_out', label: '已售罄' }, { key: 'scheduled', label: '已定时' },
      { key: 'promotion', label: '优惠' }, { key: 'ready_stock', label: '现货' }
    ]
  },
  observers: {
    visible(value) {
      if (value) this.open();
      else {
        this._version = (this._version || 0) + 1;
        clearTimeout(this._searchTimer);
        this.setData({ selectingAll: false, loading: false, allSelected: false });
      }
    }
  },
  lifetimes: { detached() { this._detached = true; this._version = (this._version || 0) + 1; clearTimeout(this._searchTimer); } },
  methods: {
    async open() {
      this._selected = new Map();
      this.setData({ products: [], activeStatus: 'all', searchKeyword: '', selectedStall: '', selectedTag: '',
        selectedCount: 0, allSelected: false, selectingAll: false });
      const session = this._filterSession = (this._filterSession || 0) + 1;
      this.loadProducts(true);
      try {
        const [stalls, tags] = await Promise.all([api.get('/stalls/all'), api.get('/tags/all')]);
        if (!this._detached && this.data.visible && session === this._filterSession) this.setData({ stalls, tags });
      } catch (error) {
        if (!this._detached && this.data.visible && session === this._filterSession) {
          this.setData({ error: getErrorMessage(error, '加载筛选项失败，请关闭后重试') });
        }
      }
    },
    async loadProducts(reset = true) {
      if (!auth.isAdmin() || !this.data.visible || (!reset && (this.data.loading || this.data.selectingAll || !this.data.hasMore))) return;
      clearTimeout(this._searchTimer);
      const version = this._version = (this._version || 0) + 1;
      if (reset) this.setData({ page: 1, products: [], hasMore: true, allSelected: false, selectingAll: false });
      this.setData({ loading: true, error: '' });
      try {
        const response = await api.get('/products/query', query.build(this.data));
        if (this._detached || !this.data.visible || version !== this._version) return;
        const existing = new Set(this.data.existingIds.map(String));
        const products = (response.content || []).map(({ id, name, coverUrl, articleNo }) => ({
          id, name, coverUrl, articleNo, selected: this._selected.has(String(id)), existing: existing.has(String(id))
        }));
        const all = reset ? products : this.data.products.concat(products);
        const seen = new Set();
        this.setData({ products: all.filter(item => {
          if (seen.has(String(item.id))) return false;
          seen.add(String(item.id)); return true;
        }), page: this.data.page + 1,
        hasMore: response.hasNext !== undefined ? response.hasNext : products.length === this.data.pageSize });
        this.refreshSelection();
      } catch (error) {
        if (!this._detached && this.data.visible && version === this._version) this.setData({ error: getErrorMessage(error, '加载商品失败，点击重试') });
      } finally {
        if (!this._detached && this.data.visible && version === this._version) this.setData({ loading: false });
      }
    },
    inputSearch(event) {
      this.setData({ searchKeyword: event.detail.value || '', allSelected: false, selectingAll: false });
      // 立即作废旧响应，停顿后再发新查询。
      this._version = (this._version || 0) + 1;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.loadProducts(true), 350);
    },
    search() { return this.loadProducts(true); },
    loadMore() { return this.loadProducts(false); },
    retry() { return this.loadProducts(!this.data.products.length); },
    selectStatus(event) {
      this.setData({ activeStatus: event.currentTarget.dataset.key });
      return this.loadProducts(true);
    },
    selectFilter(event) {
      const { type, id } = event.currentTarget.dataset;
      this.setData({ [type === 'stall' ? 'selectedStall' : 'selectedTag']: id === 'all' ? '' : id });
      return this.loadProducts(true);
    },
    toggleProduct(event) {
      if (this.data.selectingAll || !auth.isAdmin()) return;
      const id = String(event.currentTarget.dataset.id);
      const product = this.data.products.find(item => String(item.id) === id);
      if (!product || product.existing) return;
      if (this._selected.has(id)) this._selected.delete(id);
      else this._selected.set(id, product);
      this.refreshSelection();
    },
    refreshSelection() {
      const products = this.data.products.map(item => ({ ...item, selected: !item.existing && this._selected.has(String(item.id)) }));
      const selectable = products.filter(item => !item.existing);
      this.setData({ products, selectedCount: this._selected.size,
        allSelected: !this.data.hasMore && selectable.length > 0 && selectable.every(item => item.selected) });
    },
    async toggleSelectAll() {
      if (!auth.isAdmin() || !this.data.visible || this.data.loading || this.data.selectingAll) return;
      if (this.data.allSelected) {
        // 只取消当前筛选范围，保留在其他筛选下勾选的商品。
        this.data.products.filter(item => !item.existing).forEach(item => this._selected.delete(String(item.id)));
        this.refreshSelection();
        return;
      }
      clearTimeout(this._searchTimer);
      const version = this._version = (this._version || 0) + 1;
      const params = { ...query.build(this.data), size: 100 };
      const existing = new Set(this.data.existingIds.map(String));
      const products = new Map();
      const selected = new Map(this._selected);
      this.setData({ selectingAll: true });
      try {
        let page = 1;
        while (true) {
          const response = await api.get('/products/query', { ...params, page });
          if (this._detached || !this.data.visible || version !== this._version || !auth.isAdmin()) return;
          const batch = response.content || [];
          batch.forEach(item => {
            const product = compactProduct(item);
            const id = String(product.id);
            products.set(id, { ...product, existing: existing.has(id) });
            if (!existing.has(id)) selected.set(id, product);
          });
          const hasMore = response.hasNext !== undefined ? response.hasNext : batch.length === params.size;
          if (hasMore && !batch.length) throw new Error('商品分页数据异常，请重新全选');
          page += 1;
          if (!hasMore) break;
        }
        // 全部分页成功后一次应用，失败时保留原来的选择，不出现半选成功。
        this._selected = selected;
        this.setData({ products: Array.from(products.values()), page, hasMore: false });
        this.refreshSelection();
      } catch (error) {
        if (!this._detached && this.data.visible && version === this._version) {
          wx.showToast({ title: getErrorMessage(error, '全选失败，请重试'), icon: 'none' });
        }
      } finally {
        if (!this._detached && this.data.visible && version === this._version) this.setData({ selectingAll: false });
      }
    },
    confirm() {
      if (!auth.isAdmin() || this.data.selectingAll || !this._selected || !this._selected.size) return;
      this.triggerEvent('confirm', { products: Array.from(this._selected.values()) });
    },
    close() { this.triggerEvent('close'); },
    stop() {}
  }
});
