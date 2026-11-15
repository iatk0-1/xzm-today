const api = require('./api');
const { getErrorMessage } = require('./error');

module.exports = {
  async openSpecChange(e) {
    if (!this.data.canManageOrders || this.data.isStallScoped || this._specOpening || this.data.specSaving) return;
    const item = this.data.order.items[Number(e.currentTarget.dataset.index)];
    if (!item || Number(item.shippedQty) > 0 || Number(item.frozenQty) > 0) return;
    this._specOpening = true;
    wx.showLoading({ title: '加载可选规格' });
    try {
      const options = await api.get(`/admin/orders-manage/orders/${this.data.orderId}/items/${item.id}/spec-options`);
      const choices = options.filter(row => Number(row.availableQty) > 0).map(row => ({ ...row,
        label: `${row.spec || '默认规格'} / ${row.size || '均码'} · 可售${row.availableQty} · 空闲现货${row.readyQty}` }));
      if (!choices.length) { wx.showToast({ title: '其他规格暂无可售库存', icon: 'none' }); return; }
      this.setData({ specChange: { itemId: item.id, expectedSkuId: item.skuId, maxQty: item.qty,
        name: item.productName, oldSpec: [item.productSpec, item.productSize].filter(Boolean).join(' / '),
        options: choices, index: 0, qty: '1' } });
      this._specRequest = null;
    } catch (error) {
      wx.showToast({ title: getErrorMessage(error, '规格加载失败，请重试'), icon: 'none' });
    } finally { this._specOpening = false; wx.hideLoading(); }
  },
  closeSpecChange() { if (!this.data.specSaving) this.setData({ specChange: null }); },
  onSpecChangeSelection(e) {
    if (!this.data.specSaving) this.setData({ specChange: { ...this.data.specChange, index: Number(e.detail.value) } });
  },
  onSpecChangeQty(e) {
    if (!this.data.specSaving) this.setData({ specChange: { ...this.data.specChange, qty: e.detail.value } });
  },
  async saveSpecChange() {
    const draft = this.data.specChange;
    if (!this.data.canManageOrders || this.data.isStallScoped || !draft || this.data.specSaving) return;
    const target = draft.options[draft.index];
    const qty = Number(draft.qty);
    if (!/^\d+$/.test(String(draft.qty)) || !Number.isSafeInteger(qty) || qty < 1 || qty > Number(draft.maxQty)
        || !target || qty > Number(target.availableQty)) {
      wx.showToast({ title: '数量须大于0，且不能超过原数量和新规格可售库存', icon: 'none' }); return;
    }
    this.setData({ specSaving: true });
    try {
      const confirmed = await new Promise(resolve => wx.showModal({ title: '确认商品变更',
        content: `将${qty}件商品改为${target.spec || '默认规格'} / ${target.size || '均码'}。成交金额不变；原报单保留，释放原现货占用，新规格重新配货或报单。`,
        success: res => resolve(res.confirm), fail: () => resolve(false) }));
      if (!confirmed) return;
      const signature = `${draft.itemId}:${draft.expectedSkuId}:${target.skuId}:${qty}`;
      if (!this._specRequest || this._specRequest.signature !== signature) this._specRequest = {
        signature, requestId: `spec-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      await api.post(`/admin/orders-manage/orders/${this.data.orderId}/items/${draft.itemId}/change-spec`, {
        requestId: this._specRequest.requestId, expectedSkuId: draft.expectedSkuId, targetSkuId: target.skuId, qty
      });
      this.setData({ specChange: null });
      wx.showToast({ title: '商品规格已变更', icon: 'success' });
      await this.loadOrderDetail();
    } catch (error) {
      wx.showToast({ title: getErrorMessage(error, '变更失败，请刷新核对后重试'), icon: 'none' });
    } finally { this.setData({ specSaving: false }); }
  }
};
