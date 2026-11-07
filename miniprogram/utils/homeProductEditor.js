const api = require('./api');
const auth = require('./auth');
const { getErrorMessage } = require('./error');

const initialData = {
  homeEditing: false, homeEditorLoading: false, homeSaving: false, homeDirty: false,
  homeProducts: [], homeSelectedCount: 0, homeAllSelected: false, homeRevision: 0,
  homeDragId: '', homeEditorHeight: 0, homeRowHeight: 84, homeEditorScrollTop: 0,
  showHomeProductPicker: false, homeExistingIds: []
};
const touchOf = (event, identifier) => {
  const touches = event.touches && event.touches.length ? event.touches : (event.changedTouches || []);
  return identifier == null ? touches[0] : touches.find(item => item.identifier === identifier);
};

const methods = {
  canEditHome() { return this.data.homeEditing && auth.isAdmin() && !this.data.homeSaving && !this.data.homeEditorLoading; },
  setHomeProducts(products, dirty = true) {
    const selected = products.filter(item => item.selected).length;
    this.setData({
      homeProducts: products.map((item, index) => ({ ...item, y: index * this.data.homeRowHeight })),
      homeEditorHeight: products.length * this.data.homeRowHeight,
      homeSelectedCount: selected, homeAllSelected: !!products.length && selected === products.length,
      homeExistingIds: products.map(item => String(item.id)),
      ...(dirty ? { homeDirty: true } : {})
    });
  },
  async toggleHomeEditor() {
    if (!auth.isAdmin() || this.data.currentMainTab !== '首页' || this.data.homeSaving || this.data.homeEditorLoading) return;
    if (this._isInitializingHome || this._isRefreshingHome) return;
    if (this.data.homeEditing) {
      if (await this.confirmLeaveHomeEditor()) this.closeHomeEditor();
      return;
    }
    const session = this._homeEditSession = (this._homeEditSession || 0) + 1;
    this.setData({ homeEditorLoading: true });
    try {
      // 等待浏览请求结束，避免编辑途中迟到响应重新铺回瀑布流。
      if (this._productsTask) await this._productsTask;
      const result = await api.get('/home-products/manage');
      if (this._pageClosed || session !== this._homeEditSession || !auth.isAdmin() || this.data.currentMainTab !== '首页') return;
      const rowHeight = 168 * this.getWindowSize().width / 750;
      this.setData({ homeEditing: true, homeRevision: result.revision, homeDirty: false,
        homeRowHeight: rowHeight, homeEditorScrollTop: 0, showAllPanel: false });
      this._homeScrollTop = 0;
      this.setHomeProducts((result.products || []).map(item => ({ ...item, selected: false })), false);
      this.updateListMetrics();
    } catch (error) {
      if (!this._pageClosed) wx.showToast({ title: getErrorMessage(error, '加载首页商品失败，请重试'), icon: 'none' });
    } finally {
      if (!this._pageClosed && session === this._homeEditSession) this.setData({ homeEditorLoading: false });
    }
  },
  confirmLeaveHomeEditor() {
    if (this.data.homeSaving || this.data.homeEditorLoading) return Promise.resolve(false);
    if (!this.data.homeEditing || !this.data.homeDirty) return Promise.resolve(true);
    return new Promise(resolve => wx.showModal({ title: '放弃本次修改？',
      content: '新增、移除和排序尚未保存，退出后将不生效。', confirmText: '放弃修改',
      success: result => resolve(!!result.confirm), fail: () => resolve(false) }));
  },
  closeHomeEditor() {
    this.cancelHomeDrag();
    this._homeEditSession = (this._homeEditSession || 0) + 1;
    this.setData({ ...initialData });
    this.updateListMetrics();
  },
  toggleHomeProduct(event) {
    if (!this.canEditHome() || this._homeDrag || Date.now() < (this._homeIgnoreTapUntil || 0)) return;
    const id = String(event.currentTarget.dataset.id);
    this.setHomeProducts(this.data.homeProducts.map(item => String(item.id) === id
      ? { ...item, selected: !item.selected } : item), false);
  },
  async selectAllHomeProducts() {
    if (!this.canEditHome() || this._homeDrag) return;
    const selected = !this.data.homeAllSelected;
    if (!selected) {
      this.setHomeProducts(this.data.homeProducts.map(item => ({ ...item, selected: false })), false);
      return;
    }
    const session = this._homeEditSession;
    this.setData({ homeEditorLoading: true });
    try {
      // 全选重新查询完整首页名单，不受浏览页分页限制，也不覆盖本地增删和排序。
      const result = await api.get('/home-products/manage');
      if (this._pageClosed || session !== this._homeEditSession || !auth.isAdmin()) return;
      if (String(result.revision) !== String(this.data.homeRevision)) {
        throw new Error('首页商品已被其他管理员修改，请退出编辑后重新加载');
      }
      const fresh = new Map((result.products || []).map(item => [String(item.id), item]));
      this.setHomeProducts(this.data.homeProducts.map(item => ({ ...item, ...fresh.get(String(item.id)), selected: true })), false);
    } catch (error) {
      if (!this._pageClosed) wx.showToast({ title: getErrorMessage(error, '加载全部首页商品失败，请重试'), icon: 'none' });
    } finally {
      if (!this._pageClosed && session === this._homeEditSession) this.setData({ homeEditorLoading: false });
    }
  },
  removeHomeProducts(event) {
    if (!this.canEditHome() || this._homeDrag) return;
    const id = event.currentTarget.dataset.id;
    const products = this.data.homeProducts.filter(item => id != null ? String(item.id) !== String(id) : !item.selected);
    if (products.length !== this.data.homeProducts.length) this.setHomeProducts(products);
  },
  moveHomeProduct(event) {
    if (!this.canEditHome() || this._homeDrag) return;
    const { id, direction } = event.currentTarget.dataset;
    const products = this.data.homeProducts.slice();
    const from = products.findIndex(item => String(item.id) === String(id));
    const to = from + Number(direction);
    if (from < 0 || to < 0 || to >= products.length) return;
    const [item] = products.splice(from, 1);
    products.splice(to, 0, item);
    this.setHomeProducts(products);
  },
  openHomeProductPicker() {
    if (this.canEditHome() && !this._homeDrag) this.setData({ showHomeProductPicker: true });
  },
  closeHomeProductPicker() { this.setData({ showHomeProductPicker: false }); },
  addHomeProducts(event) {
    if (!this.canEditHome()) return;
    const ids = new Set(this.data.homeProducts.map(item => String(item.id)));
    const added = (event.detail.products || []).filter(item => {
      if (ids.has(String(item.id))) return false;
      ids.add(String(item.id));
      return true;
    }).map(({ id, name, coverUrl, articleNo }) => ({ id, name, coverUrl, articleNo, selected: false }));
    if (added.length) this.setHomeProducts(this.data.homeProducts.concat(added));
    this.closeHomeProductPicker();
  },
  async saveHomeProducts() {
    if (!this.canEditHome() || this._homeDrag) return;
    this.setData({ homeSaving: true });
    try {
      await api.put('/home-products', { revision: this.data.homeRevision,
        productIds: this.data.homeProducts.map(item => item.id) });
      if (this._pageClosed) return;
      this.closeHomeEditor();
      wx.showToast({ title: '首页已保存', icon: 'success' });
      await this.getProductsList(true, { silent: true });
    } catch (error) {
      // 保存失败继续保留草稿，避免管理员重做增删和排序。
      if (!this._pageClosed) wx.showModal({ title: '保存失败',
        content: getErrorMessage(error, '首页商品保存失败，请重试'), showCancel: false });
    } finally { if (!this._pageClosed) this.setData({ homeSaving: false }); }
  },
  onHomeEditorScroll(event) { this._homeScrollTop = event.detail.scrollTop || 0; },
  startHomeDrag(event) {
    if (!this.canEditHome() || this._homeDrag) return;
    const id = String(event.currentTarget.dataset.id);
    const from = this.data.homeProducts.findIndex(item => String(item.id) === id);
    const touch = touchOf(event);
    if (from < 0 || !touch || !Number.isFinite(touch.clientY)) return;
    this._homeDrag = { id, from, identifier: touch.identifier, startY: touch.clientY,
      clientY: touch.clientY, startScroll: this._homeScrollTop || 0, y: from * this.data.homeRowHeight };
    this.setData({ homeDragId: id });
    this._homeDragTimer = setInterval(() => this.tickHomeDrag(), 50);
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light', fail() {} });
  },
  moveHomeDrag(event) {
    const drag = this._homeDrag;
    if (!drag) return;
    const touch = touchOf(event, drag.identifier);
    if (!touch || !Number.isFinite(touch.clientY)) return;
    drag.clientY = touch.clientY;
    this.tickHomeDrag();
  },
  tickHomeDrag() {
    const drag = this._homeDrag;
    if (!drag) return;
    const top = this.data.totalNavHeight + this.data.listTop;
    const bottom = Math.min(top + this.data.listHeight, this.getWindowSize().height - 60);
    let scroll = this._homeScrollTop || 0;
    const delta = drag.clientY < top + 40 ? -14 : drag.clientY > bottom - 40 ? 14 : 0;
    scroll = Math.max(0, Math.min(Math.max(0, this.data.homeEditorHeight - this.data.listHeight + 80), scroll + delta));
    if (delta) {
      this._homeScrollTop = scroll;
      this.setData({ homeEditorScrollTop: scroll });
    }
    drag.y = Math.max(0, Math.min((this.data.homeProducts.length - 1) * this.data.homeRowHeight,
      drag.from * this.data.homeRowHeight + drag.clientY - drag.startY + scroll - drag.startScroll));
    this.setData({ [`homeProducts[${drag.from}].y`]: drag.y });
  },
  endHomeDrag(event) {
    const drag = this._homeDrag;
    if (!drag || !touchOf({ changedTouches: event.changedTouches }, drag.identifier)) return;
    this.moveHomeDrag({ changedTouches: event.changedTouches });
    const to = Math.round(drag.y / this.data.homeRowHeight);
    const products = this.data.homeProducts.slice();
    const [item] = products.splice(drag.from, 1);
    products.splice(to, 0, item);
    this.clearHomeDrag();
    this.setHomeProducts(products, to !== drag.from);
  },
  clearHomeDrag() {
    if (this._homeDragTimer) clearInterval(this._homeDragTimer);
    this._homeDragTimer = null;
    this._homeDrag = null;
    this._homeIgnoreTapUntil = Date.now() + 300;
    if (!this._pageClosed) this.setData({ homeDragId: '' });
  },
  cancelHomeDrag() {
    if (!this._homeDrag) return;
    this.clearHomeDrag();
    this.setHomeProducts(this.data.homeProducts, false);
  }
};
module.exports = { initialData, methods };
