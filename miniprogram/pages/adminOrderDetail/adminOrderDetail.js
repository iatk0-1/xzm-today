const { getErrorMessage, getBusinessFailureMessage } = require('../../utils/error');
const api = require('../../utils/api');
const orderPricing = require('../../utils/orderPricing');
const quantityOperation = require('../../utils/quantityOperation');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');
const orderNavigation = require('../../utils/orderNavigation');
const { getExpressName } = require('../../utils/expressCompany');

const pageSync = require('../../utils/pageSync');
Page(pageSync.wrap({
  onOrderTouchStart: orderNavigation.onTouchStart,
  onOrderTouchMove: orderNavigation.onTouchMove,
  onOrderTouchEnd: orderNavigation.onTouchEnd,
  onOrderTouchCancel: orderNavigation.onTouchCancel,

  data: {
    showPricePanel: false,
    priceSaving: false,
    pricing: null,
    priceDraft: {},
    pricePreview: {},
    refundPayments: [],
    orderId: null,
    order: null,
    isLoading: true,
    afterSaleRecords: [],
    shipments: [],
    logisticsTraceMap: {},
    refundPreview: null,
    refundItems: [],
    refundReason: '管理员主动退款',
    refundNote: '',
    returnPurchaseOrder: false,
    showRefundPanel: false,
    partialUnbindShipment: null,
    partialUnbindItems: [],
    showPartialUnbindPanel: false,
    showUnbindPreview: false,
    unbindPreview: null,
    unbindStockConfirmed: false,
    unbindLoading: false,
    unbindSaving: false,
    pendingShipmentUnbind: null,
    adminRemarkPanel: null
    ,adminRemarkValue: ''
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '订单参数丢失', icon: 'none' });
      return;
    }
    this._openPricingOnLoad = options.pricing === '1';
    this.setData({ orderId: options.id });
    this.loadOrderDetail();
  },

  onShow() {
    this.syncPendingShipmentUnbind();
  },

  async loadPricing() {
    try {
      const pricing = await api.get(`/admin/orders-manage/orders/${this.data.orderId}/pricing`);
      pricing.history = (pricing.history || []).map(row => ({ ...row, timeDisplay: this.formatTime(row.createdAt) }));
      const refundPayments = Number(pricing.offlineAmount) > 0
        ? await api.get(`/admin/orders-manage/orders/${this.data.orderId}/refund-payments`) : [];
      this.setData({ pricing, refundPayments });
      return pricing;
    } catch (error) {
      wx.showToast({ title: getErrorMessage(error, '金额明细加载失败，请重试'), icon: 'none' });
      return null;
    }
  },
  async openPricePanel() {
    if (this.data.priceSaving || this._priceOpening) return;
    this._priceOpening = true;
    try {
      const pricing = await this.loadPricing();
      if (!pricing) return;
      const priceDraft = {
        revision: pricing.revision,
        peerOrder: !!pricing.peerOrder,
        onlineAmount: Number(pricing.onlineAmount).toFixed(2),
        offlineAmount: Number(pricing.offlineAmount).toFixed(2),
        shippingFee: Number(pricing.shippingFee).toFixed(2),
        offlineMethod: pricing.offlineMethod || '', offlineNote: pricing.offlineNote || '',
        offlineConfirmed: false, reason: ''
      };
      this._lastShippingCents = orderPricing.cents(priceDraft.shippingFee);
      this.setData({ showPricePanel: true, priceDraft,
        pricePreview: orderPricing.preview(priceDraft, pricing.costAmount, pricing.costComplete) });
    } finally { this._priceOpening = false; }
  },
  closePricePanel() { if (!this.data.priceSaving) this.setData({ showPricePanel: false }); },
  onPriceInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!['onlineAmount', 'offlineAmount', 'shippingFee', 'offlineMethod', 'offlineNote', 'reason'].includes(field)) return;
    if (field === 'shippingFee') { this.changePriceShipping(e.detail.value); return; }
    this.updatePriceDraft({ [field]: e.detail.value });
  },
  onPeerOrderChange(e) {
    if (this.data.priceSaving) return;
    const enabled = !!e.detail.value;
    if (this.data.pricing.peerOrder && !enabled) return;
    if (enabled === !!this.data.priceDraft.peerOrder) return;
    if (enabled) {
      const defaults = orderPricing.peerDefaults(this.data.priceDraft);
      if (defaults.error) {
        this.updatePriceDraft({ peerOrder: false });
        wx.showToast({ title: defaults.error, icon: 'none' });
        return;
      }
      this.updatePriceDraft(defaults.patch);
      return;
    }
    this.updatePriceDraft({ peerOrder: false });
  },
  onOfflineConfirmedChange(e) { this.updatePriceDraft({ offlineConfirmed: !!e.detail.value }); },
  waivePriceShipping() { this.changePriceShipping('0.00'); },
  changePriceShipping(value) {
    if (this.data.priceSaving) return;
    const before = orderPricing.cents(this.data.priceDraft.shippingFee);
    const previous = before == null ? this._lastShippingCents : before;
    const next = orderPricing.cents(value);
    const online = orderPricing.cents(this.data.priceDraft.onlineAmount);
    const patch = { shippingFee: value };
    if (next != null && previous != null && online != null) {
      const adjusted = online + next - previous;
      patch.onlineAmount = adjusted >= 1 && adjusted <= 999999999 ? orderPricing.amount(adjusted) : '';
      if (adjusted < 1) wx.showToast({ title: '请核对线上应付与线下实收，线下收款不会自动变动', icon: 'none' });
    }
    if (next != null) this._lastShippingCents = next;
    else if (before != null) this._lastShippingCents = before;
    this.updatePriceDraft(patch);
  },
  updatePriceDraft(patch) {
    if (this.data.priceSaving) return;
    const priceDraft = { ...this.data.priceDraft, ...patch };
    const pricing = this.data.pricing;
    this.setData({ priceDraft, pricePreview: orderPricing.preview(priceDraft, pricing.costAmount, pricing.costComplete) });
  },
  async savePrice() {
    if (this.data.priceSaving) return;
    const draft = this.data.priceDraft;
    const check = orderPricing.preview(draft, this.data.pricing.costAmount, this.data.pricing.costComplete);
    if (!check.valid) { wx.showToast({ title: check.error, icon: 'none' }); return; }
    this.setData({ priceSaving: true });
    try {
      await api.patch(`/admin/orders-manage/orders/${this.data.orderId}/pricing`, {
        ...draft, onlineAmount: Number(draft.onlineAmount), offlineAmount: Number(draft.offlineAmount),
        shippingFee: Number(draft.shippingFee), reason: draft.reason.trim()
      });
      this.setData({ showPricePanel: false });
      await this.loadOrderDetail();
      wx.showToast({ title: '改价成功，请用户刷新后支付', icon: 'none' });
    } catch (error) {
      wx.showModal({ title: '改价未完成', content: getErrorMessage(error, '请刷新订单核对后重试'), showCancel: false });
    } finally { this.setData({ priceSaving: false }); }
  },

  async retryShippingRefund() {
    if (this._shippingRefundBusy) return;
    this._shippingRefundBusy = true;
    try {
      await api.post('/admin/orders-manage/orders/' + this.data.orderId + '/shipping-refund/retry', {});
      await this.loadOrderDetail();
    } catch (error) { wx.showToast({ title: getErrorMessage(error, '运费退款重试失败'), icon: 'none' }); }
    finally { this._shippingRefundBusy = false; }
  },

  async loadOrderDetail() {
    wx.showLoading({ title: '加载中...' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const order = await api.get(`/admin/orders-manage/orders/${this.data.orderId}`);
      order.settlementTotalDisplay = orderPricing.total(order);
      order.statusDisplay = this.getOrderStatusDisplay(order.status);
      order.createdAtDisplay = this.formatTime(order.createdAt);
      if (order.items) {
        order.items.forEach(item => {
          if (item.bundleConfig && item.bundleConfig.length > 0) {
            const piecesPerBundle = item.bundleConfig.reduce((sum, sub) => sum + (sub.count || 0), 0);
            item.totalOrderQty = piecesPerBundle * (item.qty || 1);
          } else {
            item.totalOrderQty = item.qty || 1;
          }
        });
      }
      this.setData({
        order,
        isLoading: false,
        shipments: [],
        logisticsTraceMap: {}
      });
      if (Number(order.priceRevision) > 0) await this.loadPricing();
      else this.setData({ pricing: null, refundPayments: [] });
      if (this._openPricingOnLoad && order.status === 'pending') {
        this._openPricingOnLoad = false;
        await this.openPricePanel();
      }
      this.loadAfterSaleRecords(this.data.orderId);
      if (['shipped', 'paid', 'partial_shipped', 'completed'].includes(order.status)) {
        this.loadShipmentInfo(this.data.orderId);
      }
    } catch (err) {
      this.setData({ isLoading: false });
      wx.showModal({
        title: '加载失败',
        content: getErrorMessage(err, '订单详情加载失败，请重试'),
        showCancel: false
      });
      console.error('load order detail failed:', err);
    } finally {
      wx.hideLoading();
      this.syncPendingShipmentUnbind();
    }
  },

  getOrderStatusDisplay(status) {
    const map = {
      pending: '待付款',
      stocking: '备货中',
      paid: '待发货',
      partial_shipped: '部分发货',
      shipped: '已发货',
      completed: '已完成',
      cancelled: '已取消'
    };
    return map[status] || status;
  },

  formatTime(raw) {
    if (!raw) return '';
    try {
      let d;
      if (typeof raw === 'number') {
        d = new Date(raw < 1e10 ? raw * 1000 : raw);
      } else if (raw instanceof Array) {
        d = new Date(raw[0], raw[1] - 1, raw[2], raw[3] || 0, raw[4] || 0, raw[5] || 0);
      } else {
        d = new Date(String(raw));
      }
      if (isNaN(d.getTime())) return String(raw);
      const pad = n => (n < 10 ? '0' + n : '' + n);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch (e) {
      return String(raw);
    }
  },

  async loadAfterSaleRecords(orderId) {
    try {
      const res = await api.get('/after-sales/query', { orderId, page: 1, size: 100 });
      const records = (res.content || []).map(item => ({
        ...item,
        typeDisplay: item.type === 'refund' ? '仅退款' : '退货退款',
        statusDisplay: this.getAfterSaleStatusDisplay(item.status)
      }));
      this.setData({ afterSaleRecords: records });
    } catch (err) {
      console.error('load after-sales failed:', err);
    }
  },

  getAfterSaleStatusDisplay(status) {
    const map = {
      pending: '待审核',
      approved: '已同意',
      rejected: '已拒绝',
      received: '已收货',
      refunded: '已退款',
      cancelled: '已取消'
    };
    return map[status] || status;
  },

  async loadShipmentInfo(orderId) {
    try {
      const shipments = await api.get(`/orders/${orderId}/shipments/detail`);
      if (shipments && shipments.length > 0) {
        shipments.forEach(s => {
          s.expressName = getExpressName(s.expressCode);
          s.shippedAtDisplay = this.formatTime(s.shippedAt);
        });
        this.setData({ shipments });
        this.loadLogisticsTraceMap(orderId);
      }
    } catch (err) {
      console.error('load shipments failed:', err);
    } finally {
      this.syncPendingShipmentUnbind();
    }
  },

  async loadLogisticsTraceMap(orderId) {
    try {
      const traceList = await api.get(`/orders/${orderId}/shipments/trace`);
      const traceMap = {};
      (traceList || []).forEach(trace => {
        const nodes = (trace.nodes || []).map(node => ({
          ...node,
          timeDisplay: this.formatTime(node.time)
        }));
        traceMap[trace.shipmentId] = {
          ...trace,
          nodes,
          expanded: false,
          visibleNodes: nodes.slice(0, 1)
        };
      });
      this.setData({ logisticsTraceMap: traceMap });
    } catch (err) {
      console.error('加载物流轨迹失败:', err);
    }
  },

  toggleShipmentTrace(e) {
    const shipmentId = e.currentTarget.dataset.id;
    const trace = this.data.logisticsTraceMap[shipmentId];
    if (!trace || trace.nodes.length <= 1) return;
    const expanded = !trace.expanded;
    this.setData({
      [`logisticsTraceMap.${shipmentId}.expanded`]: expanded,
      [`logisticsTraceMap.${shipmentId}.visibleNodes`]: expanded ? trace.nodes : trace.nodes.slice(0, 1)
    });
  },

  copyOrderSn() {
    const order = this.data.order || {};
    clipboard.copyText(order.outTradeNo || order.id, '订单号');
  },

  copyExpressNo(e) {
    clipboard.copyText(e.currentTarget.dataset.expressNo, '快递单号');
  },

  copyRecipientInfo() {
    clipboard.copyRecipient(this.data.order || {});
  },

  previewWaybill(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({
      urls: [url],
      success: () => wx.showToast({ title: '请尽快打印面单', icon: 'none', duration: 2000 })
    });
  },

  async cancelWaybill(e) {
    if (this.data.unbindLoading || this.data.unbindSaving) return;
    this.setData({ unbindLoading: true });
    try {
      const preview = await api.get(`/admin/orders-manage/orders/shipments/${e.currentTarget.dataset.shipmentId}/unbind-preview`);
      const orders = (preview.orders || []).map(order => ({ ...order,
        orderNo: order.orderNo || String(order.orderId), statusText: this.getOrderStatusDisplay(order.status),
        current: String(order.orderId) === String(this.data.orderId),
        items: (order.items || []).map(item => ({ ...item, productName: item.productName || '历史商品' })) }));
      this.setData({ showUnbindPreview: true, unbindPreview: { ...preview, orders }, unbindStockConfirmed: false });
    } catch (err) {
      wx.showToast({ title: getErrorMessage(err, '整包解绑范围加载失败，请重试'), icon: 'none' });
    } finally { this.setData({ unbindLoading: false }); }
  },

  closeUnbindPreview() {
    if (!this.data.unbindSaving) this.setData({ showUnbindPreview: false, unbindPreview: null, unbindStockConfirmed: false });
  },

  onUnbindStockConfirmed(e) {
    this.setData({ unbindStockConfirmed: (e.detail.value || []).includes('confirmed') });
  },

  async confirmFullUnbind() {
    const preview = this.data.unbindPreview;
    if (!preview || !this.data.unbindStockConfirmed || this.data.unbindSaving) return;
    this.setData({ unbindSaving: true });
    wx.showLoading({ title: '解绑中...', mask: true });
    try {
      await quantityOperation.run(api, `/admin/orders-manage/orders/shipments/${preview.shipmentId}/unbind`,
        { stockReturned: true, note: '管理员确认整个包裹实物未出库或已回仓', previewToken: preview.previewToken },
        { orderId: this.data.orderId });
      this.setData({ showUnbindPreview: false, unbindPreview: null, unbindStockConfirmed: false });
      wx.showToast({ title: '整个包裹已解绑', icon: 'success' });
      await this.loadOrderDetail();
    } catch (err) {
      wx.showModal({ title: '解绑未完成', content: getErrorMessage(err, '请先核查原解绑结果再操作'), showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ unbindSaving: false });
      this.syncPendingShipmentUnbind();
    }
  },

  syncPendingShipmentUnbind() {
    const pending = quantityOperation.pending();
    const match = pending && pending.path.match(/^\/admin\/orders-manage\/orders\/shipments\/([^/]+)\/(partial-)?unbind$/);
    const sameOrder = pending?.context?.orderId
      ? String(pending.context.orderId) === String(this.data.orderId)
      : match && (this.data.shipments || []).some(s => String(s.id) === match[1]);
    this.setData({ pendingShipmentUnbind: match && sameOrder ? { shipmentId: match[1], requestId: pending.payload.requestId } : null });
  },

  async retryShipmentUnbind() {
    if (this.data.unbindSaving || !this.data.pendingShipmentUnbind) return;
    this.setData({ unbindSaving: true });
    try {
      await quantityOperation.retry(api);
      this.setData({ showUnbindPreview: false });
      await this.loadOrderDetail();
      wx.showToast({ title: '原解绑操作已完成', icon: 'success' });
    } catch (err) {
      wx.showModal({ title: '解绑待核查', content: getErrorMessage(err, '请核查面单状态，再沿用原请求续办'), showCancel: false });
    } finally { this.setData({ unbindSaving: false }); this.syncPendingShipmentUnbind(); }
  },

  async reviewShipmentUnbindWaybill() {
    const pending = this.data.pendingShipmentUnbind;
    if (!pending || this.data.unbindSaving) return;
    const confirmed = await new Promise(resolve => wx.showModal({ title: '核查面单处理结果',
      content: '请先在原物流平台确认面单已取消，或核实是无需本系统取消的手工单；同时确认实物未出库或已回仓。请填写核查依据。',
      confirmText: '已核实', success: r => resolve(r.confirm), fail: () => resolve(false) }));
    if (!confirmed || this.data.unbindSaving) return;
    const note = await new Promise(resolve => wx.showModal({ title: '填写核查依据', editable: true, content: '',
      placeholderText: '平台取消记录或手工单核查依据', success: r => resolve(r.confirm ? (r.content || '').trim() : ''), fail: () => resolve('') }));
    if (!note || this.data.unbindSaving) return;
    this.setData({ unbindSaving: true });
    try {
      await api.post(`/admin/orders-manage/orders/shipments/${pending.shipmentId}/unbind/${encodeURIComponent(pending.requestId)}/confirm-waybill-cancelled`, { note });
      await quantityOperation.retry(api);
      this.setData({ showUnbindPreview: false });
      await this.loadOrderDetail();
      wx.showToast({ title: '核查后原解绑已完成', icon: 'success' });
    } catch (err) {
      wx.showModal({ title: '原解绑未完成', content: getErrorMessage(err, '请保留原请求，核查后重试'), showCancel: false });
    } finally { this.setData({ unbindSaving: false }); this.syncPendingShipmentUnbind(); }
  },

  openPartialUnbindPanel(e) {
    if (this.data.unbindSaving || this.data.unbindLoading) return;
    const shipmentIndex = e.currentTarget.dataset.shipmentIndex;
    const shipment = this.data.shipments[shipmentIndex];
    if (!shipment) return;
    const partialUnbindItems = (shipment.items || []).map(item => ({
      orderItemId: item.orderItemId,
      productName: item.productName || '商品',
      spec: [item.spec, item.size].filter(Boolean).join(' / '),
      shipQty: item.shipQty || 0,
      unbindQty: ''
    }));
    this.setData({
      partialUnbindShipment: shipment,
      partialUnbindItems,
      showPartialUnbindPanel: true
    });
  },

  closePartialUnbindPanel() {
    if (this.data.unbindSaving) return;
    this.setData({
      partialUnbindShipment: null,
      partialUnbindItems: [],
      showPartialUnbindPanel: false
    });
  },

  onPartialUnbindQtyInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value;
    this.setData({ [`partialUnbindItems[${index}].unbindQty`]: value });
  },

  async submitPartialUnbind() {
    if (this.data.unbindSaving) return;
    const shipment = this.data.partialUnbindShipment;
    if (this.data.partialUnbindItems.some(item => item.unbindQty !== '' && (!Number.isSafeInteger(Number(item.unbindQty)) || Number(item.unbindQty) < 0))) {
      wx.showToast({ title: '解绑数量必须是非负整数', icon: 'none' }); return;
    }
    const items = this.data.partialUnbindItems
      .map(item => ({
        orderItemId: item.orderItemId,
        qty: Number(item.unbindQty) || 0,
        shipQty: item.shipQty
      }))
      .filter(item => item.qty > 0);
    if (!shipment || items.length === 0) {
      wx.showToast({ title: '请输入解绑数量', icon: 'none' });
      return;
    }
    const invalid = items.find(item => item.qty > item.shipQty);
    if (invalid) {
      wx.showToast({ title: '解绑数量不能超过包裹数量', icon: 'none' });
      return;
    }
    const confirmed = await new Promise(resolve => wx.showModal({ title: '确认实物状态', content: '所选数量必须尚未实际出库或已经回仓；电子面单取消本身不能返库存。确认所选实物状态符合？', success: r => resolve(r.confirm), fail: () => resolve(false) }));
    if (!confirmed || this.data.unbindSaving) return;
    this.setData({ unbindSaving: true });
    wx.showLoading({ title: '解绑中...', mask: true });
    try {
      await quantityOperation.run(api, `/admin/orders-manage/orders/shipments/${shipment.id}/partial-unbind`, {
        items: items.map(item => ({ orderItemId: item.orderItemId, qty: item.qty })), stockReturned: true, note: '管理员确认所选实物未出库或已回仓'
      }, { orderId: this.data.orderId });
      pageSync.publish('orders', this.data.orderId);
      wx.showToast({ title: '已部分解绑', icon: 'success' });
      this.setData({ partialUnbindShipment: null, partialUnbindItems: [], showPartialUnbindPanel: false });
      await this.loadOrderDetail();
    } catch (err) {
      wx.showModal({ title: '解绑失败', content: getErrorMessage(err, '部分解绑失败'), showCancel: false });
    } finally {
      wx.hideLoading();
      this.setData({ unbindSaving: false });
      this.syncPendingShipmentUnbind();
    }
  },

  async openRefundPanel() {
    wx.showLoading({ title: '加载可退信息...' });
    try {
      const preview = await api.get(`/admin/orders-manage/orders/${this.data.orderId}/refund-preview`);
      const refundItems = (preview.items || []).map(item => ({
        ...item,
        selectedQty: '0',
        inputAmount: '',
        disabled: !item.availableQty || Number(item.availableQty) <= 0 || Number(item.availableRefundAmount) <= 0
      }));
      this.setData({
        refundPreview: preview,
        refundItems,
        refundReason: '管理员主动退款',
        refundNote: '',
        returnPurchaseOrder: false,
        showRefundPanel: true
      });
    } catch (err) {
      wx.showModal({ title: '加载失败', content: getErrorMessage(err, '可退信息加载失败'), showCancel: false });
    } finally {
      wx.hideLoading();
    }
  },

  closeRefundPanel() {
    this.setData({
      refundPreview: null,
      refundItems: [],
      refundReason: '管理员主动退款',
      refundNote: '',
      returnPurchaseOrder: false,
      showRefundPanel: false
    });
  },

  updateRefundQty(index, nextQty) {
    const item = this.data.refundItems[index];
    if (!item || item.disabled) return;

    const maxQty = Math.max(0, Number(item.availableQty) || 0);
    const cappedQty = Math.min(maxQty, Math.max(0, Number(nextQty) || 0));
    const amountLimit = Math.min(
      orderPricing.refundQtyAmount(item, cappedQty),
      Number(item.availableRefundAmount) || 0
    );
    const nextAmount = cappedQty <= 0
      ? ''
      : amountLimit.toFixed(2);
    this.setData({
      [`refundItems[${index}].selectedQty`]: String(cappedQty),
      [`refundItems[${index}].inputAmount`]: nextAmount
    });
  },

  goToProduct(e) {
    if (!orderNavigation.canNavigate(this, e)) return;
    const id = e.currentTarget.dataset.productId;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` });
  },

  openRecipientEditor() {
    const order = this.data.order || {};
    if (!['pending', 'stocking', 'paid'].includes(order.status)) {
      wx.showToast({ title: '当前状态不允许修改收件信息', icon: 'none' });
      return;
    }
    wx.chooseAddress({
      success: address => this.saveRecipient(address),
      fail: err => {
        if (!err || !String(err.errMsg || '').includes('cancel')) {
          wx.showToast({ title: getErrorMessage(err, '获取微信收货地址失败'), icon: 'none' });
        }
      }
    });
  },

  async saveRecipient(address) {
    const value = {
      recipientName: address.userName,
      recipientPhone: address.telNumber,
      recipientProvince: address.provinceName,
      recipientCity: address.cityName,
      recipientDistrict: address.countyName,
      recipientDetail: address.detailInfo
    };
    if (!value.recipientName || !value.recipientPhone || !value.recipientDetail) {
      wx.showToast({ title: '请填写完整收件信息', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中...' });
    try {
      await api.patch(`/admin/orders-manage/orders/${this.data.orderId}/recipient`, value);
      wx.showToast({ title: '收件信息已保存', icon: 'success' });
      this.loadOrderDetail();
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '保存失败'), icon: 'none' }); }
    finally { wx.hideLoading(); }
  },

  openAdminRemarkEditor(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.order.items[index];
    if (!item) return;
    this.setData({ adminRemarkPanel: { index, itemId: item.id }, adminRemarkValue: item.adminRemark || '' });
  },

  closeAdminRemarkEditor() { this.setData({ adminRemarkPanel: null, adminRemarkValue: '' }); },

  onAdminRemarkInput(e) { this.setData({ adminRemarkValue: e.detail.value }); },

  async saveAdminRemark() {
    const panel = this.data.adminRemarkPanel;
    if (!panel) return;
    wx.showLoading({ title: '保存中...' });
    try {
      await api.patch(`/admin/orders-manage/orders/${this.data.orderId}/items/${panel.itemId}/admin-remark`, { remark: this.data.adminRemarkValue });
      wx.showToast({ title: '管理员备注已保存', icon: 'success' });
      this.closeAdminRemarkEditor();
      this.loadOrderDetail();
    } catch (err) { wx.showToast({ title: getErrorMessage(err, '保存失败'), icon: 'none' }); }
    finally { wx.hideLoading(); }
  },

  decreaseRefundQty(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.refundItems[index];
    this.updateRefundQty(index, Number(item && item.selectedQty) - 1);
  },

  increaseRefundQty(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.refundItems[index];
    this.updateRefundQty(index, Number(item && item.selectedQty) + 1);
  },

  onRefundAmountInput(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ [`refundItems[${index}].inputAmount`]: e.detail.value });
  },

  onRefundReasonInput(e) {
    this.setData({ refundReason: e.detail.value });
  },

  onRefundNoteInput(e) {
    this.setData({ refundNote: e.detail.value });
  },

  changeReturnPurchaseOrder(e) {
    this.setData({ returnPurchaseOrder: e.detail.value.includes('return') });
  },

  async submitAdminRefund() {
    const items = this.data.refundItems
      .map(item => ({
        orderItemId: item.orderItemId,
        qty: parseInt(item.selectedQty, 10) || 0,
        refundAmount: Number(item.inputAmount || 0),
        salePrice: Number(item.salePrice || 0),
        availableQty: item.availableQty,
        availableRefundAmount: Number(item.availableRefundAmount)
      }))
      .filter(item => item.qty > 0 && item.refundAmount > 0);
    if (items.length === 0) {
      wx.showToast({ title: '请输入退款数量和金额', icon: 'none' });
      return;
    }
    const invalid = items.find(item => {
      const amountByQty = Number(item.salePrice || 0) * item.qty;
      return item.qty > item.availableQty
        || item.refundAmount > item.availableRefundAmount
        || item.refundAmount > amountByQty;
    });
    if (invalid) {
      wx.showToast({ title: '退款数量或金额超出上限', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '退款中...' });
    try {
      const res = await api.post(`/admin/orders-manage/orders/${this.data.orderId}/refunds`, {
        reason: this.data.refundReason,
        note: this.data.refundNote,
        returnPurchaseOrder: this.data.returnPurchaseOrder,
        items: items.map(item => ({
          orderItemId: item.orderItemId,
          qty: item.qty,
          refundAmount: item.refundAmount.toFixed(2)
        }))
      });
      if (res.status === 'success') {
        wx.showToast({ title: '退款成功', icon: 'success' });
      } else if (res.status === 'processing') {
        wx.showModal({
          title: '退款处理中',
          content: '微信正在处理这笔退款，系统会自动同步结果，无需重复提交。',
          showCancel: false
        });
      } else {
        wx.showModal({
          title: res.status === 'failed' ? '退款失败' : '退款结果待确认',
          content: getBusinessFailureMessage(res.errorMessage, res.status === 'failed' ? '退款失败，请核对原退款单后再操作' : '退款结果待确认，请查询原退款单，勿重复提交。'),
          showCancel: false
        });
      }
      this.closeRefundPanel();
      this.loadOrderDetail();
    } catch (err) {
      wx.showModal({ title: '退款结果待核对', content: getErrorMessage(err, '退款结果待核对，请刷新查看原退款单，勿重复提交'), showCancel: false });
    } finally {
      wx.hideLoading();
    }
  },

  viewShipmentTrace(e) {
    const shipmentId = e.currentTarget.dataset.id;
    const trace = this.data.logisticsTraceMap[shipmentId];
    wx.showModal({
      title: '物流轨迹',
      content: trace && trace.nodes ? trace.nodes.map(node => node.description).join('\n') : '暂无物流信息',
      showCancel: false
    });
  },

  viewAfterSaleDetail(e) {
    const afterSaleId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${afterSaleId}`
    });
  }
}, async function(changes) {
  if (changes.some(item => item.entity === 'orders' && item.id === String(this.data.orderId))) await this.loadOrderDetail();
}));
