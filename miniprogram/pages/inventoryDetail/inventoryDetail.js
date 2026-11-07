const { parseDate, dateTimestamp } = require('../../utils/date');
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { getErrorMessage } = require('../../utils/error');
const quantityOperation = require('../../utils/quantityOperation');
const inventory = require('../../utils/inventoryOperations');
const pageSync = require('../../utils/pageSync');

Page({
  data: {
    productId: '', product: null, skus: [], loading: false, error: '', saving: false,
    tabs: inventory.tabs, activeTab: 'inbound', functionTabs: inventory.functions.inbound,
    functionId: 'normal', operation: inventory.operations.normal, isOperating: true, recordView: '', specsExpanded: false, note: '', fixedNote: true,
    inboundReason: 'normal', outboundReason: 'wechat', noteCategory: 'normal', noteOptions: inventory.noteOptions.inbound,
    exchangeLines: [], outgoingTotal: 0, incomingTotal: 0, invalidQty: false, quantityPending: false,
    receipts: [], exchanges: [], inspections: [], reports: [], visibleReports: [], visibleFlows: [], visibleExchanges: [],
    ledgerPage: 0, ledgerHasNext: true, ledgerLoading: false, ledgerError: '', ledgerScope: 'all', ledgerTitle: '库存流水',
    showCorrection: false, correctionLoading: false, correctionError: '', correctionContext: null,
    correctionReceipt: null, correctionQty: '0', correctionNote: '', correctionPreview: null
  },
  onLoad(options) {
    this.setData({ productId: options.id || '' });
    if (options.name) { try { wx.setNavigationBarTitle({ title: decodeURIComponent(options.name) }); } catch (err) { console.error('设置商品标题失败:', err); } }
    this._channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
    this.syncPending();
    return this.loadDetail();
  },
  onShow() { this.syncPending(); },
  onUnload() { this._ledgerVersion = (this._ledgerVersion || 0) + 1; this._disposed = true; this._detailVersion = (this._detailVersion || 0) + 1; this._correctionVersion = (this._correctionVersion || 0) + 1; },
  async onPullDownRefresh() {
    try { if (!this.data.saving) await this.loadDetail(); } finally { wx.stopPullDownRefresh(); }
  },
  syncPending() { this.setData({ quantityPending: !!quantityOperation.pending() }); },
  async loadDetail(resetQuantities = false) {
    if (!this.data.productId) { this.setData({ error: '缺少商品编号，请返回库存列表重新进入' }); return; }
    const version = (this._detailVersion || 0) + 1;
    this._detailVersion = version;
    this.setData({ loading: true, error: '' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const result = await api.get('/sku-inventory/products/' + encodeURIComponent(this.data.productId));
      if (this._disposed || version !== this._detailVersion) return;
      const previous = new Map((resetQuantities === true ? [] : this.data.skus).map(sku => [String(sku.id), sku]));
      const skus = (result.skus || []).map(item => inventory.row(item, previous.get(String(item.skuId))));
      const receipts = [], inspections = [], reports = [], exchangeMap = new Map();
      const labels = new Map(skus.map(sku => [String(sku.id), sku.label]));
      for (const records of result.records || []) {
        const label = labels.get(String(records.skuId)) || [records.spec, records.size].filter(Boolean).join(' / ');
        for (const item of (records.receipts || []).filter(inventory.isPhysicalReceipt)) receipts.push({ ...inventory.receiptChoice(item), skuId: records.skuId, skuLabel: label,
          sourceText: inventory.sourceText(item.source), timeText: this.formatTime(item.createdAt) });
        for (const item of records.reports || []) reports.push({ ...item, skuId: records.skuId, skuLabel: label, timeText: this.formatTime(item.createdAt) });
        for (const item of records.returnInspections || []) inspections.push({ ...item, skuLabel: label });
        for (const item of records.exchanges || []) exchangeMap.set(String(item.id), { ...item,
          sourceLabel: labels.get(String(item.sourceSkuId)) || '规格 ' + item.sourceSkuId,
          targetLabel: labels.get(String(item.targetSkuId)) || '规格 ' + item.targetSkuId, timeText: this.formatTime(item.createdAt),
          pendingQty: item.cancelled ? 0 : item.qty - item.receivedQty, cancelledQty: item.cancelled ? item.qty - item.receivedQty : 0 });
      }
      const latestFirst = (a, b) => dateTimestamp(b.createdAt || 0) - dateTimestamp(a.createdAt || 0);
      this.setData({ product: result.product, skus, receipts: receipts.sort(latestFirst),
        inspections: inspections.map(item => ({ ...item, disposeQty: '0' })), reports: reports.sort(latestFirst), exchanges: [...exchangeMap.values()].sort(latestFirst), loading: false });
      wx.setNavigationBarTitle({ title: result.product.name });
      this.filterReports(); this.updateTotals();
      if (this.data.recordView === 'flows') await this.loadLedger(true);
    } catch (err) {
      if (this._disposed || version !== this._detailVersion) return;
      this.setData({ loading: false, error: getErrorMessage(err, '加载商品库存详情失败') });
    }
  },
  switchTab(e) {
    if (this.data.saving) return;
    const id = e.currentTarget.dataset.id;
    const choices = inventory.functions[id];
    if (!choices || id === this.data.activeTab) return;
    this._functionDrafts = this._functionDrafts || {};
    this._functionDrafts[this.data.activeTab] = this.data.functionId;
    const selected = choices.find(item => item.id === this._functionDrafts[id]) || choices[0];
    this.setData({ activeTab: id, functionTabs: choices });
    return this.selectFunction(selected || { id: 'all', view: id === 'ledger' ? 'flows' : 'reports' });
  },
  switchFunction(e) {
    if (this.data.saving) return;
    const choice = this.data.functionTabs.find(item => item.id === e.currentTarget.dataset.id);
    if (!choice || choice.id === this.data.functionId) return;
    return this.selectFunction(choice);
  },
  selectFunction(choice) {
    this._ledgerVersion = (this._ledgerVersion || 0) + 1;
    const operation = inventory.operations[choice.id];
    if (operation && operation.id !== this.data.operation.id) {
      this.setData({ skus: this.data.skus.map(sku => ({ ...sku, operationQty: '0' })), exchangeLines: [], note: '', inboundReason: 'normal', outboundReason: 'wechat' });
    }
    const fixedNote = !!operation && ['normal', 'outbound'].includes(choice.id);
    const options = choice.id === 'outbound' ? inventory.noteOptions.outbound : inventory.noteOptions.inbound;
    const category = choice.id === 'outbound' ? this.data.outboundReason : this.data.inboundReason;
    const shownOperation = operation && choice.id === 'normal' && category === 'history'
      ? { ...inventory.operations.history, id: 'normal', name: '入库' } : operation;
    this.setData({ functionId: choice.id, isOperating: !!operation, recordView: choice.view || '',
      operation: shownOperation || this.data.operation, specsExpanded: false, fixedNote, noteOptions: options, noteCategory: category,
      ledgerLoading: false, ledgerError: '' });
    this.filterReports(); this.updateTotals();
    if (choice.view === 'flows') return this.loadLedger(true);
  },
  onNoteCategoryChange(e) {
    if (this.data.saving || !this.data.fixedNote) return;
    const id = e.currentTarget.dataset.id;
    if (!this.data.noteOptions.some(item => item.id === id)) return;
    const field = this.data.functionId === 'normal' ? 'inboundReason' : 'outboundReason';
    const operation = this.data.functionId === 'normal'
      ? (id === 'history' ? { ...inventory.operations.history, id: 'normal', name: '入库' } : inventory.operations.normal) : inventory.operations.outbound;
    this.setData({ [field]: id, noteCategory: id, operation });
  },
  onReachBottom() { if (this.data.recordView === 'flows') return this.loadMoreFlows(); },
  loadMoreFlows() { return this.loadLedger(false); },
  async loadLedger(reset = false) {
    if (this.data.recordView !== 'flows' || !this.data.productId || (!reset && (this.data.ledgerLoading || !this.data.ledgerHasNext))) return;
    const version = reset ? (this._ledgerVersion || 0) + 1 : this._ledgerVersion;
    this._ledgerVersion = version;
    const scope = this.data.activeTab === 'outbound' ? 'outbound' : this.data.activeTab === 'return' ? 'return' : 'all';
    const page = reset ? 1 : this.data.ledgerPage + 1;
    const title = scope === 'outbound' ? '出库记录' : scope === 'return' ? '退货记录' : '库存流水';
    if (reset) this.setData({ visibleFlows: [], ledgerPage: 0, ledgerHasNext: true });
    this.setData({ ledgerLoading: true, ledgerError: '', ledgerScope: scope, ledgerTitle: title });
    try {
      const result = await api.get('/sku-inventory/products/' + encodeURIComponent(this.data.productId) + '/ledger', { scope, page, size: 30 });
      if (this._disposed || version !== this._ledgerVersion || this.data.recordView !== 'flows') return;
      const rows = (result.content || []).map(item => ({ ...item, skuLabel: [item.spec || '默认规格', item.size].filter(Boolean).join(' / '),
        changeText: inventory.changeText(item.changeType), timeText: this.formatTime(item.createdAt) }));
      const combined = reset ? rows : this.data.visibleFlows.concat(rows);
      this.setData({ visibleFlows: [...new Map(combined.map(item => [String(item.id), item])).values()], ledgerPage: page,
        ledgerHasNext: !!result.hasNext, ledgerLoading: false });
    } catch (err) {
      if (version === this._ledgerVersion) this.setData({ ledgerLoading: false, ledgerError: getErrorMessage(err, '加载' + title + '失败') });
    }
  },
  toggleSpecs() { this.setData({ specsExpanded: !this.data.specsExpanded }); },
  onNoteInput(e) { this.setData({ note: e.detail.value }); },
  rowQuantityChange(e) {
    if (this.data.saving) return;
    const { skuId, delta } = e.currentTarget.dataset;
    const change = sku => {
      if (String(sku.id) !== String(skuId)) return sku;
      const value = delta == null ? e.detail.value : String(Math.max(0, (inventory.quantity(sku.operationQty) || 0) + Number(delta)));
      if (delta != null) {
        let limit = inventory.LIMIT;
        if (this.data.operation.type === 'outbound') limit = sku.qty;
        if (this.data.functionId === 'backfill') limit = sku.abnormalQty;
        if (Number(value) > limit) { wx.showToast({ title: '已达到本次可操作数量上限', icon: 'none' }); return sku; }
      }
      return { ...sku, operationQty: value };
    };
    this.setData({ skus: this.data.skus.map(change) });
    this.updateTotals();
  },
  updateTotals() {
    const values = this.data.skus.map(sku => inventory.quantity(sku.operationQty));
    if (this.data.operation.id === 'exchange') this.syncExchangeLines();
    const incoming = this.data.exchangeLines.map(line => inventory.quantity(line.qty));
    const overLimit = this.data.skus.some((sku, index) => values[index] > (this.data.operation.type === 'backfill'
      ? sku.abnormalQty : this.data.operation.type === 'outbound' ? sku.qty : inventory.LIMIT));
    this.setData({ outgoingTotal: values.reduce((sum, qty) => sum + (qty || 0), 0), incomingTotal: incoming.reduce((sum, qty) => sum + (qty || 0), 0),
      invalidQty: values.includes(null) || overLimit || (this.data.operation.id === 'exchange' && incoming.includes(null)) });
  },
  syncExchangeLines() {
    const previous = new Map(this.data.exchangeLines.map(line => [String(line.sourceSkuId), line]));
    const lines = this.data.skus.filter(sku => inventory.quantity(sku.operationQty) > 0).map(sku => {
      const old = previous.get(String(sku.id));
      const index = old ? this.data.skus.findIndex(target => String(target.id) === String(old.targetSkuId)) : -1;
      const targetIndex = index >= 0 ? index : this.data.skus.findIndex(target => String(target.id) === String(sku.id));
      const target = this.data.skus[targetIndex];
      return { sourceSkuId: sku.id, sourceLabel: sku.label, targetSkuId: target.id, targetIndex,
        targetLabel: target.label, qty: inventory.quantity(sku.operationQty) };
    });
    this.setData({ exchangeLines: lines });
  },
  changeExchangeSpec(e) {
    if (this.data.saving) return;
    const sourceSkuId = e.currentTarget.dataset.sourceId;
    const index = Number(e.detail.value), target = this.data.skus[index];
    if (!target) return;
    this.setData({ exchangeLines: this.data.exchangeLines.map(line => String(line.sourceSkuId) === String(sourceSkuId)
      ? { ...line, targetSkuId: target.id, targetIndex: index, targetLabel: target.label } : line) });
  },
  async submitOperation() {
    if (this.data.saving || this.data.loading || !this.data.isOperating) return;
    let payload;
    try { payload = inventory.buildOperation(this.data); }
    catch (err) { wx.showToast({ title: err.message, icon: 'none' }); return; }
    this.setData({ saving: true });
    try {
      await quantityOperation.run(api, '/sku-inventory/products/' + encodeURIComponent(this.data.productId) + '/operations', payload);
      this.notifyChanged([...payload.items, ...payload.targets].map(item => item.skuId));
      this.setData({ exchangeLines: [] });
      this.setData({ note: '', inboundReason: 'normal', outboundReason: 'wechat',
        noteCategory: this.data.functionId === 'outbound' ? 'wechat' : 'normal',
        operation: this.data.functionId === 'normal' ? inventory.operations.normal : this.data.operation });
      await this.loadDetail(true);
      wx.showToast({ title: '操作成功', icon: 'success' });
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '操作失败，结果不明时请重试原操作'), icon: 'none' }); }
    finally { this.setData({ saving: false }); this.syncPending(); }
  },
  notifyChanged(ids) {
    const skuIds = [...new Set(ids.map(String))];
    skuIds.forEach(id => pageSync.publish('picking-skus', id));
    if (this._channel && this._channel.emit) this._channel.emit('inventoryChanged', { skuIds });
  },
  async retryPendingOperation() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const result = await quantityOperation.retry(api);
      if (result) {
        const payload = result.operation.payload;
        this.notifyChanged([...(payload.items || []), ...(payload.targets || []), ...(payload.skuId ? [{ skuId: payload.skuId }] : [])].filter(item => item.skuId).map(item => item.skuId).concat(result.operation.context && result.operation.context.skuIds || []));
      }
      this.setData({ showCorrection: false });
      await this.loadDetail(true); wx.showToast({ title: '原操作已确认', icon: 'success' });
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '原操作结果待确认'), icon: 'none' }); }
    finally { this.setData({ saving: false }); this.syncPending(); }
  },
  filterReports() {
    this.setData({ visibleReports: this.data.reports.filter(item => this.data.recordView !== 'backfills' || item.purpose === 'backfill'),
      visibleExchanges: this.data.exchanges.map((item, recordIndex) => ({ ...item, recordIndex }))
        .filter(item => this.data.functionId !== 'exchange_pending' || item.pendingQty > 0) });
  },
  async revokeReceipt(e) {
    const item = this.data.receipts[Number(e.currentTarget.dataset.index)];
    if (!item || !item.canRevoke || this.data.saving) return;
    const confirmed = await this.confirm('撤销入库', item.skuLabel + '，撤销 ' + item.qty + ' 件入库？对应报单待到货会恢复。');
    if (confirmed) return this.writeRecord('/sku-inventory/' + item.skuId + '/receipts/' + item.id + '/revoke', { note: '管理员撤销入库' }, [item.skuId]);
  },
  async openReceiptCorrection(e) {
    if (this.data.saving || this.data.quantityPending) return;
    const receipt = this.data.receipts[Number(e.currentTarget.dataset.index)];
    if (!receipt || receipt.revoked) return;
    this.setData({ showCorrection: true, correctionReceipt: receipt, correctionContext: null, correctionPreview: null,
      correctionError: '', correctionNote: '', correctionQty: String(receipt.effectiveQty == null ? receipt.qty : receipt.effectiveQty) });
    return this.loadCorrectionContext();
  },
  async loadCorrectionContext() {
    const receipt = this.data.correctionReceipt;
    if (!receipt || !this.data.showCorrection || this.data.saving) return;
    const version = (this._correctionVersion || 0) + 1; this._correctionVersion = version;
    this.setData({ correctionLoading: true, correctionError: '', correctionPreview: null });
    try {
      const context = await api.get('/sku-inventory/' + receipt.skuId + '/receipts/' + receipt.id + '/correction');
      if (this._disposed || version !== this._correctionVersion || !this.data.showCorrection) return;
      this.setData({ correctionContext: { ...context, losses: (context.losses || []).map(loss => ({ ...loss, selected: false,
        timeText: this.formatTime(loss.createdAt) })), history: (context.history || []).map(item => ({ ...item, timeText: this.formatTime(item.createdAt) })) },
      correctionQty: String(context.effectiveQty) });
    } catch (err) {
      if (version === this._correctionVersion) this.setData({ correctionError: getErrorMessage(err, '加载更正信息失败') });
    } finally { if (version === this._correctionVersion) this.setData({ correctionLoading: false }); }
  },
  closeReceiptCorrection() {
    if (this.data.saving) return;
    this._correctionVersion = (this._correctionVersion || 0) + 1;
    this.setData({ showCorrection: false, correctionLoading: false, correctionPreview: null });
  },
  correctionQtyChange(e) {
    if (this.data.saving || this.data.correctionLoading) return;
    const delta = e.currentTarget.dataset.delta, context = this.data.correctionContext;
    this.setData({ correctionQty: delta == null ? e.detail.value : String(Math.min(inventory.LIMIT,
      Math.max(context ? context.shippedQty : 0, (inventory.quantity(this.data.correctionQty) || 0) + Number(delta)))), correctionPreview: null });
  },
  onCorrectionNoteInput(e) { if (!this.data.saving) this.setData({ correctionNote: e.detail.value }); },
  toggleCorrectionLoss(e) {
    if (this.data.saving || this.data.correctionLoading || !this.data.correctionContext) return;
    const id = e.currentTarget.dataset.id;
    this.setData({ correctionPreview: null, correctionContext: { ...this.data.correctionContext,
      losses: this.data.correctionContext.losses.map(loss => String(loss.ledgerId) === String(id) ? { ...loss, selected: !loss.selected } : loss) } });
  },
  correctionInput() {
    const qty = inventory.quantity(this.data.correctionQty), context = this.data.correctionContext;
    if (!context) throw new Error('请先加载更正信息');
    if (context.blockedReason) throw new Error(context.blockedReason);
    if (qty == null) throw new Error('正确实收数量请输入非负整数');
    if (qty < context.shippedQty) throw new Error('正确实收数量不能低于本次已发货的 ' + context.shippedQty + ' 件');
    if (qty === context.effectiveQty) throw new Error('数量没有变化，无需更正');
    return { qty, version: context.version, lossLedgerIds: context.losses.filter(loss => loss.selected).map(loss => loss.ledgerId) };
  },
  async previewReceiptCorrection() {
    if (this.data.saving || this.data.correctionLoading || this.data.quantityPending) return;
    let input;
    try { input = this.correctionInput(); } catch (err) { wx.showToast({ title: err.message, icon: 'none' }); return; }
    const receipt = this.data.correctionReceipt, version = (this._correctionVersion || 0) + 1;
    this._correctionVersion = version; this.setData({ correctionLoading: true, correctionPreview: null, correctionError: '' });
    try {
      const preview = await api.post('/sku-inventory/' + receipt.skuId + '/receipts/' + receipt.id + '/correction-preview', input);
      if (!this._disposed && version === this._correctionVersion && this.data.showCorrection) this.setData({ correctionPreview: preview });
    } catch (err) { if (version === this._correctionVersion) this.setData({ correctionError: getErrorMessage(err, '预览失败，请刷新更正信息后重试') }); }
    finally { if (version === this._correctionVersion) this.setData({ correctionLoading: false }); }
  },
  async submitReceiptCorrection() {
    if (this.data.saving || this.data.correctionLoading || this.data.quantityPending || this._correctionConfirming) return;
    let input;
    try { input = this.correctionInput(); } catch (err) { wx.showToast({ title: err.message, icon: 'none' }); return; }
    const receipt = this.data.correctionReceipt, preview = this.data.correctionPreview, note = this.data.correctionNote.trim();
    if (!preview) { wx.showToast({ title: '请先预览更正结果', icon: 'none' }); return; }
    this._correctionConfirming = true;
    try {
      if (!await this.confirm('确认入库数量更正', '将本次有效实收数量从 ' + preview.beforeQty + ' 件更正为 ' + preview.afterQty + ' 件，已发货记录保留。请核对预览结果。')) return;
      // 确认弹窗期间如果数量被编辑，必须重新预览。
      if (this.data.correctionPreview !== preview) return;
      const success = await this.writeRecord('/sku-inventory/' + receipt.skuId + '/receipts/' + receipt.id + '/correct',
        { correction: input, previewToken: preview.previewToken, note }, [receipt.skuId]);
      if (success) this.setData({ showCorrection: false });
      else this.setData({ correctionPreview: null });
    } finally { this._correctionConfirming = false; }
  },
  confirm(title, content) { return new Promise(resolve => wx.showModal({ title, content, success: result => resolve(result.confirm), fail: () => resolve(false) })); },
  recordQtyChange(e) {
    if (this.data.saving) return;
    const { kind, index, delta } = e.currentTarget.dataset;
    const field = kind === 'exchange' ? 'exchanges' : 'inspections';
    const qtyField = kind === 'exchange' ? 'receiveQty' : 'disposeQty';
    const list = this.data[field].map((item, position) => position === Number(index) ? { ...item, [qtyField]: delta == null ? e.detail.value : String(Math.max(0, (inventory.quantity(item[qtyField]) || 0) + Number(delta))) } : item);
    this.setData({ [field]: list });
    this.filterReports();
  },
  async cancelExchange(e) {
    if (this.data.saving || this.data.quantityPending || this._exchangeCancelConfirming) return;
    const item = this.data.exchanges[Number(e.currentTarget.dataset.index)];
    if (!item || item.cancelled || item.pendingQty <= 0) return;
    this._exchangeCancelConfirming = true;
    try {
      if (await this.confirm('取消换货', '取消 ' + item.targetLabel + ' 待换回的 ' + item.pendingQty + ' 件？已出库按普通出库处理，不返还库存；已换回的数量保留。'))
        return await this.writeRecord('/sku-inventory/exchanges/' + item.id + '/cancel', { note: '管理员取消剩余换货，已出库按普通出库处理' }, [item.sourceSkuId, item.targetSkuId]);
    } finally { this._exchangeCancelConfirming = false; }
  },
  async disposeReturn(e) {
    const item = this.data.inspections[Number(e.currentTarget.dataset.index)];
    const qty = item && inventory.quantity(item.disposeQty);
    if (!qty || qty > item.rejectedQty) { wx.showToast({ title: '处置数量须为正整数，且不超过不合格余额', icon: 'none' }); return; }
    const result = await new Promise(resolve => wx.showModal({ title: '处置不合格退件', editable: true, placeholderText: '填写去向、物流单号或报损原因', success: resolve, fail: () => resolve({}) }));
    if (!result.confirm) return;
    const choice = await new Promise(resolve => wx.showActionSheet({ itemList: ['实际退回客户', '实际报损'], success: value => resolve(value.tapIndex), fail: () => resolve(-1) }));
    if (choice < 0) return;
    return this.writeRecord('/sku-inventory/return-inspections/' + item.afterSaleItemId + '/dispose', { qty, action: choice === 0 ? 'return_customer' : 'scrap', note: (result.content || '').trim() }, [item.skuId]);
  },
  async adjustSupply(e) {
    const report = this.data.visibleReports[Number(e.currentTarget.dataset.index)];
    if (!report || this.data.saving) return;
    this.setData({ supplyReport: report, supplyQty: '0', supplyNote: '', showSupplyEditor: true });
  },
  closeSupplyEditor() { if (!this.data.saving) this.setData({ showSupplyEditor: false }); },
  supplyQtyChange(e) {
    if (this.data.saving) return;
    const delta = e.currentTarget.dataset.delta;
    this.setData({ supplyQty: delta == null ? e.detail.value : String(Math.max(0, (inventory.quantity(this.data.supplyQty) || 0) + Number(delta))) });
  },
  onSupplyNoteInput(e) { this.setData({ supplyNote: e.detail.value }); },
  async submitSupplyAdjustment() {
    const qty = inventory.quantity(this.data.supplyQty), report = this.data.supplyReport;
    if (!report || !qty || qty > report.shortageQty) { wx.showToast({ title: '数量须为正整数，且不超过待到货数量', icon: 'none' }); return; }
    if (await this.writeRecord('/sku-inventory/supply/' + report.purchaseOrderId + '/adjust', { qty, note: this.data.supplyNote.trim() }, [report.skuId])) this.setData({ showSupplyEditor: false });
  },
  async writeRecord(path, payload, ids) {
    if (this.data.saving) return false;
    this.setData({ saving: true });
    try {
      await quantityOperation.run(api, path, payload, { skuIds: ids });
      this.notifyChanged(ids); await this.loadDetail(); wx.showToast({ title: '操作成功', icon: 'success' }); return true;
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '操作失败'), icon: 'none' }); return false; }
    finally { this.setData({ saving: false }); this.syncPending(); }
  },
  formatTime(value) {
    if (!value) return '';
    return parseDate(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
});
