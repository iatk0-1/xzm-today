const autoSearch = require('../../utils/autoSearch');
const api = require('../../utils/api');
const auth = require('../../utils/auth');

function normalizeSku(row) {
  return {
    id: row.skuId, spec: row.spec || '', size: row.size || '', imageUrl: '',
    availableQty: row.qty || 0, shortageQty: row.shortageQty || 0,
    abnormalQty: row.abnormalQty || 0,
    shippableQty: row.shippableQty == null ? (row.qty || 0) : row.shippableQty,
    reservedQty: row.reservedQty || 0, reportedQty: row.reportedQty || 0,
    receivedQty: row.receivedQty || 0
  };
}
function positiveInteger(value) {
  return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

Page(autoSearch.wrap({
  data: {
    productList: [], loading: false, keyword: '', inventoryTab: 'all',
    inventoryTabs: [
      { id: 'all', name: '全部' }, { id: 'shortage', name: '欠货' },
      { id: 'stock', name: '现货' }, { id: 'abnormal', name: '异常' }
    ],
    page: 1, pageSize: 20, hasMore: true,
    stallList: [], tagList: [], selectedStall: '', selectedTag: '',
    showSkuModal: false, selectedProduct: null, selectedSku: null, currentQty: 0,
    detailLoading: false, reportList: [], receiptList: [], ledgerList: [],
    activeTab: 'operate', operateType: 'normal', inputQty: '', note: '',
    stocktakeDirection: 'gain', stocktakeCategory: 'normal', abnormalAction: 'keep',
    saving: false, showShippingModal: false, shippingLoading: false,
    shippingProducts: [], matching: false
  },

  onLoad() { this.loadProducts(); this.loadFilterOptions(); },
  onShow() {
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
      wx.showToast({ title: err.message || '加载筛选项失败', icon: 'none' });
    }
  },
  async loadProducts(reset = true) {
    if (!reset && (!this.data.hasMore || this.data.loading)) return;
    const version = (this._listVersion || 0) + 1;
    this._listVersion = version;
    if (reset) this.setData({ page: 1, productList: [], hasMore: true });
    this.setData({ loading: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const query = { page: this.data.page, size: this.data.pageSize, tab: this.data.inventoryTab };
      const keyword = this.data.keyword.trim();
      if (keyword) query.keyword = keyword;
      if (this.data.selectedStall !== '') query.stallId = this.data.selectedStall;
      if (this.data.selectedTag !== '') query.tagId = this.data.selectedTag;
      const result = await api.get('/sku-inventory/query', query);
      if (this._listVersion !== version) return;
      const existing = reset ? [] : this.data.productList;
      const grouped = new Map(existing.map(product => [String(product.id), { ...product, skus: [...product.skus] }]));
      (result.content || []).forEach(row => {
        const key = String(row.productId);
        const product = grouped.get(key) || { id: row.productId, name: row.productName, coverUrl: row.coverUrl, skus: [] };
        const sku = normalizeSku(row);
        const index = product.skus.findIndex(item => String(item.id) === String(sku.id));
        if (index < 0) product.skus.push(sku); else product.skus[index] = sku;
        grouped.set(key, product);
      });
      this.setData({
        productList: [...grouped.values()], page: query.page + 1,
        hasMore: Boolean(result.hasNext), loading: false
      });
    } catch (err) {
      if (this._listVersion !== version) return;
      console.error('加载仓库库存失败:', err);
      wx.showToast({ title: err.message || '加载库存失败', icon: 'none' });
      this.setData({ loading: false });
    }
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
  selectProduct(e) {
    const product = e.currentTarget.dataset.item;
    if (product.skus && product.skus.length) this.openSkuModal(product, product.skus[0]);
  },
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
      abnormalAction: 'keep', reportList: [], receiptList: [], ledgerList: []
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
      if (this._detailVersion !== version || !this.data.showSkuModal) return;
      const selectedSku = normalizeSku(result.inventory);
      this.setData({
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
      wx.showToast({ title: err.message || '加载库存明细失败', icon: 'none' });
    }
  },
  switchTab(e) { this.setData({ activeTab: e.currentTarget.dataset.tab }); },
  setOperateType(e) { if (!this.data.saving) this.setData({ operateType: e.currentTarget.dataset.type, inputQty: '', note: '' }); },
  setStocktakeDirection(e) { this.setData({ stocktakeDirection: e.currentTarget.dataset.value }); },
  setStocktakeCategory(e) { this.setData({ stocktakeCategory: e.currentTarget.dataset.value }); },
  setAbnormalAction(e) { this.setData({ abnormalAction: e.currentTarget.dataset.value }); },
  onQtyInput(e) { this.setData({ inputQty: e.detail.value }); },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },
  async confirmOperate() {
    if (this.data.saving) return;
    if (!positiveInteger(this.data.inputQty)) {
      wx.showToast({ title: '请输入正整数数量', icon: 'none' }); return;
    }
    const { selectedSku, operateType, inputQty, note } = this.data;
    if (operateType === 'stocktake' && !note.trim()) {
      wx.showToast({ title: '盘点调整必须填写原因', icon: 'none' }); return;
    }
    if (operateType === 'abnormal' && Number(inputQty) > selectedSku.abnormalQty) {
      wx.showToast({ title: '处理数量超过异常库存', icon: 'none' }); return;
    }
    this.setData({ saving: true });
    try {
      const qty = Number(inputQty);
      if (operateType === 'stocktake') {
        await api.post('/sku-inventory/' + selectedSku.id + '/stocktake', {
          qty, direction: this.data.stocktakeDirection, category: this.data.stocktakeCategory, note: note.trim()
        });
      } else if (operateType === 'abnormal') {
        await api.post('/sku-inventory/' + selectedSku.id + '/abnormal/resolve', {
          qty, action: this.data.abnormalAction, note: note.trim()
        });
      } else {
        await api.post('/sku-inventory', { skuId: selectedSku.id, qty, source: operateType, note: note.trim() });
      }
      await this.refreshSku(selectedSku.id);
      await this.loadLedger(selectedSku.id);
      this.setData({ inputQty: '', note: '' });
      wx.showToast({ title: '操作成功', icon: 'success' });
    } catch (err) {
      console.error('仓库库存操作失败:', err);
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally { this.setData({ saving: false }); }
  },
  revokeLedger(e) {
    const item = e.currentTarget.dataset.item;
    if (!item.canRevoke || this.data.saving) return;
    const skuId = this.data.selectedSku.id;
    wx.showModal({
      title: '撤销入库', content: '撤销这笔入库 ' + item.qty + ' 件？对应的报单欠货会恢复。',
      success: async result => {
        if (!result.confirm) return;
        this.setData({ saving: true });
        try {
          await api.post('/sku-inventory/' + skuId + '/receipts/' + item.id + '/revoke', { note: '管理员撤销入库' });
          await this.refreshSku(skuId);
          await this.loadLedger(skuId);
          wx.showToast({ title: '已撤销', icon: 'success' });
        } catch (err) { wx.showToast({ title: err.message || '撤销失败', icon: 'none' }); }
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
    } catch (err) { wx.showToast({ title: err.message || '加载可发库存失败', icon: 'none' }); }
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
    } catch (err) { wx.showToast({ title: err.message || '匹配发货订单失败', icon: 'none' }); }
    finally { this.setData({ matching: false }); }
  },
  getSourceText(source) {
    return { normal: '报单到货', history: '历史库存', stocktake_gain: '盘点盈余', abnormal_keep: '异常保留补报', return_inspection: '退货验收入库' }[source] || source;
  },
  getChangeTypeText(type) {
    return { arrival: '报单到货入库', history_in: '历史库存入库', shipment: '发货出库',
      return_inspection: '退货退款验收通过入库', stocktake_gain: '盘盈（待处理异常）',
      stocktake_loss: '盘亏出库', abnormal_keep: '异常保留并补报', abnormal_exchange_out: '异常换货出库',
      abnormal_return_out: '异常退货出库', receipt_revoke: '撤销入库', shipment_cancel: '发货解绑返还'
    }[type] || type;
  },
  formatTime(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
}, { input: 'onKeywordInput', submit: 'search', field: 'keyword' }));
