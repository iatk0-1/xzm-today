const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
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
    showRefundPanel: false,
    partialUnbindShipment: null,
    partialUnbindItems: [],
    showPartialUnbindPanel: false
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '订单参数丢失', icon: 'none' });
      return;
    }
    this.setData({ orderId: options.id });
    this.loadOrderDetail();
  },

  async loadOrderDetail() {
    wx.showLoading({ title: '加载中...' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const order = await api.get(`/orders/${this.data.orderId}`);
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
      this.loadAfterSaleRecords(this.data.orderId);
      if (['shipped', 'paid', 'partial_shipped', 'completed'].includes(order.status)) {
        this.loadShipmentInfo(this.data.orderId);
      }
    } catch (err) {
      this.setData({ isLoading: false });
      wx.showModal({
        title: '加载失败',
        content: err.message || '订单详情加载失败，请重试',
        showCancel: false
      });
      console.error('load order detail failed:', err);
    } finally {
      wx.hideLoading();
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
      const res = await api.get('/after-sales', { orderId });
      const records = (res.items || []).map(item => ({
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
          s.shippedAtDisplay = this.formatTime(s.shippedAt);
        });
        this.setData({ shipments });
        this.loadLogisticsTraceMap(orderId);
      }
    } catch (err) {
      console.error('load shipments failed:', err);
    }
  },

  async loadLogisticsTraceMap(orderId) {
    try {
      const traceList = await api.get(`/orders/${orderId}/shipments/trace`);
      const traceMap = {};
      (traceList || []).forEach(trace => {
        if (trace.nodes) {
          trace.nodes.forEach(node => {
            node.timeDisplay = this.formatTime(node.time);
          });
        }
        traceMap[trace.shipmentId] = trace;
      });
      this.setData({ logisticsTraceMap: traceMap });
    } catch (err) {
      console.error('load logistics trace failed:', err);
    }
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

  cancelWaybill(e) {
    const shipmentId = e.currentTarget.dataset.shipmentId;
    const orderNo = e.currentTarget.dataset.orderNo || '';
    wx.showModal({
      title: '完全解绑快递单号',
      content: `确定要解绑 ${orderNo} 的快递单号吗？\n\n解绑后该包裹会失效，已发数量会回退，订单状态会重新计算。`,
      confirmText: '确认解绑',
      confirmColor: '#d93026',
      success: async res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '解绑中...' });
        try {
          await api.post(`/admin/orders-manage/orders/shipments/${shipmentId}/unbind`);
          wx.showToast({ title: '已解绑', icon: 'success' });
          this.loadOrderDetail();
        } catch (err) {
          wx.showModal({ title: '解绑失败', content: err.message || '解绑快递单号失败', showCancel: false });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  openPartialUnbindPanel(e) {
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
    const shipment = this.data.partialUnbindShipment;
    const items = this.data.partialUnbindItems
      .map(item => ({
        orderItemId: item.orderItemId,
        qty: parseInt(item.unbindQty, 10) || 0,
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
    wx.showLoading({ title: '解绑中...' });
    try {
      await api.post(`/admin/orders-manage/orders/shipments/${shipment.id}/partial-unbind`, {
        items: items.map(item => ({ orderItemId: item.orderItemId, qty: item.qty }))
      });
      wx.showToast({ title: '已部分解绑', icon: 'success' });
      this.closePartialUnbindPanel();
      this.loadOrderDetail();
    } catch (err) {
      wx.showModal({ title: '解绑失败', content: err.message || '部分解绑失败', showCancel: false });
    } finally {
      wx.hideLoading();
    }
  },

  async openRefundPanel() {
    wx.showLoading({ title: '加载可退信息...' });
    try {
      const preview = await api.get(`/admin/orders-manage/orders/${this.data.orderId}/refund-preview`);
      const refundItems = (preview.items || []).map(item => ({
        ...item,
        selectedQty: '',
        inputAmount: '',
        disabled: !item.availableQty || Number(item.availableQty) <= 0 || Number(item.availableRefundAmount) <= 0
      }));
      this.setData({
        refundPreview: preview,
        refundItems,
        refundReason: '管理员主动退款',
        refundNote: '',
        showRefundPanel: true
      });
    } catch (err) {
      wx.showModal({ title: '加载失败', content: err.message || '可退信息加载失败', showCancel: false });
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
      showRefundPanel: false
    });
  },

  onRefundQtyInput(e) {
    const index = e.currentTarget.dataset.index;
    const value = parseInt(e.detail.value, 10) || 0;
    const item = this.data.refundItems[index];
    const cappedQty = Math.min(value, item.availableQty || 0);
    const suggestedAmount = cappedQty > 0
      ? Math.min(Number(item.salePrice) * cappedQty, Number(item.availableRefundAmount)).toFixed(2)
      : '';
    this.setData({
      [`refundItems[${index}].selectedQty`]: cappedQty ? String(cappedQty) : '',
      [`refundItems[${index}].inputAmount`]: suggestedAmount
    });
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

  async submitAdminRefund() {
    const items = this.data.refundItems
      .map(item => ({
        orderItemId: item.orderItemId,
        qty: parseInt(item.selectedQty, 10) || 0,
        refundAmount: Number(item.inputAmount || 0),
        availableQty: item.availableQty,
        availableRefundAmount: Number(item.availableRefundAmount)
      }))
      .filter(item => item.qty > 0 && item.refundAmount > 0);
    if (items.length === 0) {
      wx.showToast({ title: '请输入退款数量和金额', icon: 'none' });
      return;
    }
    const invalid = items.find(item => item.qty > item.availableQty || item.refundAmount > item.availableRefundAmount);
    if (invalid) {
      wx.showToast({ title: '退款数量或金额超出上限', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '退款中...' });
    try {
      const res = await api.post(`/admin/orders-manage/orders/${this.data.orderId}/refunds`, {
        reason: this.data.refundReason,
        note: this.data.refundNote,
        items: items.map(item => ({
          orderItemId: item.orderItemId,
          qty: item.qty,
          refundAmount: item.refundAmount.toFixed(2)
        }))
      });
      if (res.status === 'success') {
        wx.showToast({ title: '退款成功', icon: 'success' });
      } else {
        wx.showModal({
          title: '退款未成功',
          content: res.errorMessage || '微信退款失败，请稍后重试',
          showCancel: false
        });
      }
      this.closeRefundPanel();
      this.loadOrderDetail();
    } catch (err) {
      wx.showModal({ title: '退款失败', content: err.message || '退款提交失败', showCancel: false });
    } finally {
      wx.hideLoading();
    }
  },

  async contactBuyer() {
    const order = this.data.order;
    if (!order || !order.id) return;
    wx.showLoading({ title: '发起会话...' });
    try {
      const res = await api.post('/conversations/start-from-order', { orderId: order.id });
      wx.navigateTo({
        url: '/pages/chat/chat?conversationId=' + res.conversationId + '&perspective=seller'
      });
    } catch (err) {
      console.error('start conversation failed:', err);
      wx.showToast({ title: '发起会话失败', icon: 'none' });
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
});
