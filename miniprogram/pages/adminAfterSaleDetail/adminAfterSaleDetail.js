// miniprogram/pages/adminAfterSaleDetail/adminAfterSaleDetail.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
    afterSaleId: null,
    afterSale: null,
    isLoading: true,
    // 审核操作
    showReviewModal: false,
    reviewDecision: 'approve',
    returnPurchaseOrder: false,
    reviewItems: [],
    rejectReason: '',
    // 仓库收货
    showReceiveModal: false,
    isReinspection: false,
    warehouseCheck: 'pass',
    // 协商退款
    showNegotiatedRefundModal: false,
    negotiatedItems: [],
    negotiatedReason: '',
    negotiatedNote: '',
    // 售后日志
    logs: [],
    // 原订单发货单
    shipments: []
  },

  onLoad: function(options) {
    if (options.afterSaleId) {
      this.setData({ afterSaleId: options.afterSaleId });
      this.loadAfterSaleDetail();
    } else {
      wx.showToast({ title: '售后单号参数丢失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  // 加载售后详情
  loadAfterSaleDetail: async function() {
    wx.showLoading({ title: '加载中...' });

    try {
      await auth.ensureAuthenticated({ silent: true });
      const res = await api.get(`/after-sales/${this.data.afterSaleId}`);
      wx.hideLoading();
      const formatted = this.formatAfterSaleDetail(res);

      this.setData({
        afterSale: formatted,
        isLoading: false
      });

      // 加载售后日志
      this.loadLogs();
      // 加载原订单发货单，管理员审核退货退款时需要核对关联物流。
      this.loadShipmentInfo(res.orderId);
    } catch (err) {
      wx.hideLoading();
      console.error('加载售后详情失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  formatAfterSaleDetail: function(res) {
    const orderDetail = res.orderDetail ? this.formatOrderDetail(res.orderDetail) : null;
    const orderItemsById = (orderDetail && orderDetail.items || []).reduce((map, item) => {
      map[String(item.id)] = item;
      return map;
    }, {});
    const items = (res.items || []).map(item => {
      const orderItem = orderItemsById[String(item.orderItemId)] || {};
      return {
        ...item,
        displayImage: item.productImage || item.skuImageUrl || orderItem.skuImageUrl || orderItem.productImage || '',
        statusDisplay: this.getStatusDisplay(item.status)
      };
    });
    const hasApprovedRefundItems = items.some(item =>
      item.afterSaleType === 'refund' && item.status === 'approved'
    ) || (items.length === 0 && res.status === 'approved' && res.type === 'refund');
    const hasApprovedReturnRefundItems = items.some(item =>
      item.afterSaleType === 'return_refund' && item.status === 'approved'
    ) || (items.length === 0 && res.status === 'approved' && res.type === 'return_refund');
    return {
      ...res,
      items,
      orderDetail,
      hasApprovedRefundItems,
      hasApprovedReturnRefundItems,
      statusDisplay: this.getStatusDisplay(res.status),
      typeDisplay: this.getAfterSaleTypeDisplay(res.type),
      createdAtDisplay: this.formatDateTime(res.createdAt),
      updatedAtDisplay: this.formatDateTime(res.updatedAt),
      returnShippedAtDisplay: this.formatDateTime(res.returnShippedAt),
      evidenceImages: this.parseEvidenceUrls(res.evidenceUrls),
      hasReturnLogistics: res.type === 'return_refund',
      hasReturnShipment: Boolean(res.returnExpressNo)
    };
  },

  parseEvidenceUrls: function(raw) {
    if (Array.isArray(raw)) {
      return raw.filter(Boolean).map(url => String(url).trim()).filter(Boolean);
    }
    if (!raw || typeof raw !== 'string') return [];

    const value = raw.trim();
    if (!value) return [];

    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean).map(url => String(url).trim()).filter(Boolean);
      }
    } catch (err) {
      // 兼容历史数据：凭证可能是逗号字符串或带中括号的伪数组字符串。
    }

    const normalized = value
      .replace(/^\s*\[\s*/, '')
      .replace(/\s*\]\s*$/, '');
    return normalized
      .split(',')
      .map(url => url.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  },

  // 加载原订单发货单，支持分批发货。
  loadShipmentInfo: async function(orderId) {
    if (!orderId) return;
    try {
      const shipments = await api.get(`/orders/${orderId}/shipments/detail`);
      const formatted = (shipments || []).map(shipment => ({
        ...shipment,
        shippedAtDisplay: this.formatDateTime(shipment.shippedAt),
        expressName: this.getExpressName(shipment.expressCode),
        items: (shipment.items || []).map(item => ({
          ...item,
          specDisplay: [item.spec || item.productSpec, item.size].filter(Boolean).join(' / '),
          displayImage: item.skuImageUrl || item.productImage || ''
        }))
      }));
      this.setData({ shipments: formatted });
    } catch (err) {
      console.error('加载关联物流失败:', err);
      this.setData({ shipments: [] });
    }
  },

  getExpressName: function(code) {
    const names = {
      ZTO: '中通快递',
      YTO: '圆通速递',
      STO: '申通快递',
      YD: '韵达快递',
      SF: '顺丰速运',
      EMS: '邮政 EMS'
    };
    return names[code] || code || '未知物流';
  },

  formatOrderDetail: function(orderDetail) {
    const items = (orderDetail.items || []).map(item => ({
      ...item,
      afterSaleStatusDisplay: this.getAfterSaleItemStatusDisplay(item.afterSaleStatus),
      salePriceDisplay: this.formatAmount(item.salePrice)
    }));
    return {
      ...orderDetail,
      statusDisplay: this.getOrderStatusDisplay(orderDetail.status),
      createdAtDisplay: this.formatDateTime(orderDetail.createdAt),
      payAmountDisplay: this.formatAmount(orderDetail.payAmount),
      totalPriceDisplay: this.formatAmount(orderDetail.totalPrice),
      items
    };
  },

  // 加载售后日志
  loadLogs: async function() {
    try {
      const logs = await api.get(`/after-sales/${this.data.afterSaleId}/logs?limit=50`);
      this.setData({
        logs: logs.map(log => ({
          ...log,
          time: this.formatTime(log.createdAt),
          actionDisplay: this.getActionDisplay(log.action)
        }))
      });
    } catch (err) {
      console.error('加载日志失败:', err);
    }
  },

  getStatusDisplay: function(status) {
    const map = {
      'pending': '待审核',
      'approved': '已同意',
      'rejected': '已拒绝',
      'received': '已收货',
      'refunded': '已退款',
      'cancelled': '已取消'
    };
    return map[status] || status;
  },

  getAfterSaleTypeDisplay: function(type) {
    return type === 'refund' ? '仅退款' : '退货退款';
  },

  getAfterSaleItemStatusDisplay: function(status) {
    const map = {
      pending: '售后中',
      approved: '处理中',
      received: '待退款',
      refunded: '已退款',
      rejected: '已拒绝',
      cancelled: '已取消'
    };
    return map[status] || '';
  },

  getOrderStatusDisplay: function(status) {
    const map = {
      pending: '待付款',
      stocking: '备货中',
      paid: '待发货',
      partial_shipped: '部分发货',
      shipped: '已发货',
      completed: '已完成',
      cancelled: '已关闭'
    };
    return map[status] || status;
  },

  getActionDisplay: function(action) {
    const map = {
      'apply': '用户申请',
      'review_approve': '审核通过',
      'review_reject': '审核拒绝',
      'ship_return': '用户已寄回',
      'receive_pass': '仓库验收通过',
      'receive_fail': '仓库验收不通过',
      'reinspect_pass': '重新验收通过',
      'reinspect_fail': '重新验收不通过',
      'refund': '已退款',
      'negotiated_refund': '协商退款'
    };
    return map[action] || action;
  },

  formatTime: function(timeStr) {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  },

  formatDateTime: function(raw) {
    if (!raw) return '-';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return String(raw);
    }
    const pad = num => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },

  formatAmount: function(value) {
    const amount = Number(value);
    if (Number.isNaN(amount)) {
      return value || '0.00';
    }
    return amount.toFixed(2);
  },

  noop: function() {},

  // 显示审核弹窗
  showReviewModal: function(e) {
    const decision = e && e.currentTarget && e.currentTarget.dataset.decision
      ? e.currentTarget.dataset.decision : 'approve';
    const reviewItems = ((this.data.afterSale && this.data.afterSale.items) || [])
      .filter(item => item.status === 'pending')
      .map(item => {
        const reviewQtyLimit = Math.max(1, Number(item.requestedQty || item.qty || 1));
        return {
          ...item,
          selected: true,
          reviewQty: String(reviewQtyLimit),
          reviewQtyLimit,
          reviewAmount: Number(item.requestedRefundAmount || item.refundAmount || 0).toFixed(2),
          reviewType: item.afterSaleType
        };
      });
    this.setData({
      showReviewModal: true,
      reviewDecision: decision,
      returnPurchaseOrder: false,
      reviewItems,
      rejectReason: ''
    });
  },

  // 隐藏审核弹窗
  hideReviewModal: function() {
    this.setData({
      showReviewModal: false,
      reviewItems: [],
      rejectReason: ''
    });
  },

  // 选择审核结果
  selectDecision: function(e) {
    this.setData({ reviewDecision: e.currentTarget.dataset.decision });
  },

  // 输入拒绝原因
  onRejectReasonInput: function(e) {
    this.setData({ rejectReason: e.detail.value });
  },

  toggleReviewItem: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`reviewItems[${index}].selected`]: !this.data.reviewItems[index].selected });
  },

  updateReviewQty: function(index, nextQty) {
    const item = this.data.reviewItems[index];
    if (!item) return;

    const maxQty = Math.max(1, Number(item.reviewQtyLimit || item.requestedQty || item.qty || 1));
    const qty = Math.min(maxQty, Math.max(1, Number(nextQty) || 1));
    const requestedAmount = Number(item.requestedRefundAmount || item.refundAmount || 0);
    const unitSalePrice = Number(item.salePrice || 0);
    // 数量变化时按商品单价重新计算，不沿用管理员之前手动调整的退款比例。
    const amountBySalePrice = unitSalePrice * qty;
    const reviewAmount = Math.min(requestedAmount, amountBySalePrice).toFixed(2);
    this.setData({
      [`reviewItems[${index}].reviewQty`]: String(qty),
      [`reviewItems[${index}].reviewAmount`]: reviewAmount
    });
  },

  decreaseReviewQty: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.reviewItems[index];
    this.updateReviewQty(index, Number(item && item.reviewQty) - 1);
  },

  increaseReviewQty: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.reviewItems[index];
    this.updateReviewQty(index, Number(item && item.reviewQty) + 1);
  },

  onReviewAmountInput: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`reviewItems[${index}].reviewAmount`]: e.detail.value });
  },

  chooseReviewType: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`reviewItems[${index}].reviewType`]: e.currentTarget.dataset.type });
  },

  // 提交审核
  changeReturnPurchaseOrder: function(e) {
    this.setData({ returnPurchaseOrder: e.detail.value.includes('return') });
  },

  submitReview: async function() {
    if (this.data.reviewDecision === 'reject' && !this.data.rejectReason) {
      wx.showToast({ title: '请填写拒绝原因', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '处理中...' });

    try {
      const payload = {
        decision: this.data.reviewDecision,
        rejectReason: this.data.reviewDecision === 'reject' ? this.data.rejectReason : null,
        returnPurchaseOrder: this.data.reviewDecision === 'approve' && this.data.returnPurchaseOrder
      };
      if (this.data.reviewDecision === 'approve') {
        const invalid = this.data.reviewItems.find(item => {
          const qty = Number(item.reviewQty);
          const amount = Number(item.reviewAmount);
          const amountByQty = Number(item.salePrice || 0) * qty;
          return !item.selected
            ? false
            : !Number.isInteger(qty) || qty < 1 || qty > Number(item.reviewQtyLimit || item.requestedQty || item.qty)
              || !Number.isFinite(amount) || amount <= 0
              || amount > Number(item.requestedRefundAmount || item.refundAmount)
              || amount > amountByQty;
        });
        if (invalid) {
          wx.hideLoading();
          wx.showToast({ title: '请填写正确的审核数量和金额', icon: 'none' });
          return;
        }
        if (!this.data.reviewItems.some(item => item.selected)) {
          wx.hideLoading();
          wx.showToast({ title: '请至少选择一个商品', icon: 'none' });
          return;
        }
        payload.itemResults = this.data.reviewItems.map(item => ({
          afterSaleItemId: item.id,
          orderItemId: item.orderItemId,
          decision: item.selected ? 'approve' : 'reject',
          rejectReason: item.selected ? null : '本次不予退款',
          qty: item.selected ? Number(item.reviewQty) : null,
          refundAmount: item.selected ? Number(item.reviewAmount).toFixed(2) : null,
          afterSaleType: item.selected ? item.reviewType : null
        }));
      }
      await api.post(`/after-sales/${this.data.afterSaleId}/review`, payload);

      wx.hideLoading();
      wx.showToast({ title: '审核成功', icon: 'success' });
      this.hideReviewModal();
      this.loadAfterSaleDetail();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '审核失败', icon: 'none' });
    }
  },

  // 显示仓库收货弹窗
  showReceiveModal: function() {
    this.setData({
      showReceiveModal: true,
      isReinspection: false,
      warehouseCheck: 'pass'
    });
  },

  showReinspectModal: function() {
    this.setData({
      showReceiveModal: true,
      isReinspection: true,
      warehouseCheck: 'pass'
    });
  },

  // 隐藏仓库收货弹窗
  hideReceiveModal: function() {
    this.setData({ showReceiveModal: false });
  },

  // 选择验收结果
  selectWarehouseCheck: function(e) {
    this.setData({ warehouseCheck: e.currentTarget.dataset.check });
  },

  // 提交仓库收货
  submitReceive: async function() {
    wx.showLoading({ title: '处理中...' });

    try {
      const action = this.data.isReinspection ? 'reinspect' : 'receive';
      await api.post(`/after-sales/${this.data.afterSaleId}/${action}`, {
        warehouseCheck: this.data.warehouseCheck
      });

      wx.hideLoading();
      wx.showToast({ title: '操作成功', icon: 'success' });
      this.hideReceiveModal();
      this.loadAfterSaleDetail();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  showNegotiatedRefundModal: function() {
    const afterSale = this.data.afterSale || {};
    const negotiatedItems = (afterSale.items || [])
      .filter(item => item.afterSaleType === 'return_refund' && item.status === 'received')
      .map(item => ({
        ...item,
        selected: true,
        inputAmount: Number(item.refundAmount || 0).toFixed(2)
      }));
    this.setData({
      showNegotiatedRefundModal: true,
      negotiatedItems,
      negotiatedReason: '',
      negotiatedNote: ''
    });
  },

  hideNegotiatedRefundModal: function() {
    this.setData({ showNegotiatedRefundModal: false });
  },

  toggleNegotiatedItem: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    const selected = !this.data.negotiatedItems[index].selected;
    this.setData({ [`negotiatedItems[${index}].selected`]: selected });
  },

  onNegotiatedAmountInput: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`negotiatedItems[${index}].inputAmount`]: e.detail.value });
  },

  onNegotiatedReasonInput: function(e) {
    this.setData({ negotiatedReason: e.detail.value });
  },

  onNegotiatedNoteInput: function(e) {
    this.setData({ negotiatedNote: e.detail.value });
  },

  submitNegotiatedRefund: async function() {
    const reason = (this.data.negotiatedReason || '').trim();
    if (!reason) {
      wx.showToast({ title: '请填写协商原因', icon: 'none' });
      return;
    }
    const selectedItems = this.data.negotiatedItems.filter(item => item.selected);
    if (selectedItems.length === 0) {
      wx.showToast({ title: '请选择退款商品', icon: 'none' });
      return;
    }
    const invalidItem = selectedItems.find(item => {
      const amount = Number(item.inputAmount || 0);
      return amount <= 0 || amount > Number(item.refundAmount || 0);
    });
    if (invalidItem) {
      wx.showToast({ title: '退款金额超出可协商范围', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '退款处理中...' });
    try {
      const result = await api.post(
        `/after-sales/${this.data.afterSaleId}/negotiated-refund`,
        {
          reason,
          note: (this.data.negotiatedNote || '').trim(),
          items: selectedItems.map(item => ({
            afterSaleItemId: item.id,
            refundAmount: Number(item.inputAmount).toFixed(2)
          }))
        }
      );
      wx.hideLoading();
      if (result.status === 'failed') {
        wx.showToast({ title: result.errorMessage || '退款失败，可重试', icon: 'none' });
        return;
      }
      wx.showToast({ title: '协商退款成功', icon: 'success' });
      this.hideNegotiatedRefundModal();
      this.loadAfterSaleDetail();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '协商退款失败', icon: 'none' });
    }
  },

  // 执行退款
  submitRefund: async function() {
    const isRetry = this.data.afterSale && this.data.afterSale.refundStatus === 'failed';
    wx.showModal({
      title: isRetry ? '重试退款' : '确认退款',
      content: isRetry
        ? '确认重新查询或发起这笔退款吗？'
        : '确认要执行退款操作吗？此操作不可撤销。',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });

          try {
            const result = await api.post(`/after-sales/${this.data.afterSaleId}/refund`);

            wx.hideLoading();
            if (result.refundStatus === 'failed') {
              wx.showToast({ title: result.refundError || '退款失败，可重试', icon: 'none' });
              this.loadAfterSaleDetail();
              return;
            }
            if (result.refundStatus === 'processing') {
              wx.showToast({ title: '退款处理中，请稍后查看', icon: 'none' });
              this.loadAfterSaleDetail();
              return;
            }
            wx.showToast({ title: '退款成功', icon: 'success' });
            this.loadAfterSaleDetail();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: err.message || '退款失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 复制快递单号
  copyExpressNo: function() {
    const afterSale = this.data.afterSale;
    clipboard.copyText(afterSale && afterSale.returnExpressNo, '快递单号');
  },

  copyShipmentExpressNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.expressNo, '快递单号');
  },

  // 查看关联发货单的物流详情
  viewShipmentTrace: function(e) {
    const shipmentId = e.currentTarget.dataset.shipmentId;
    if (!shipmentId) {
      wx.showToast({ title: '暂无发货单信息', icon: 'none' });
      return;
    }

    wx.navigateTo({
      url: `/pages/shipmentTraceDetail/shipmentTraceDetail?shipmentId=${shipmentId}&orderId=${this.data.afterSale && this.data.afterSale.orderId || ''}`
    });
  },

  copyOrderNo: function() {
    const afterSale = this.data.afterSale || {};
    clipboard.copyText(afterSale.outTradeNo, '订单号');
  },

  goToOrderDetail: function() {
    const orderId = this.data.afterSale && this.data.afterSale.orderId;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/adminOrderDetail/adminOrderDetail?id=${orderId}` });
  },

  copyRecipientInfo: function() {
    const orderDetail = this.data.afterSale && this.data.afterSale.orderDetail;
    clipboard.copyRecipient(orderDetail || {});
  },

  // 预览页面中的商品图片
  previewPageImage: function(e) {
    const url = e.currentTarget.dataset.imageUrl;
    if (!url) {
      wx.showToast({ title: '没有图片', icon: 'none' });
      return;
    }

    wx.previewImage({
      current: url,
      urls: [url]
    });
  },

  // 预览凭证图片
  previewImage: function(e) {
    const index = e.currentTarget.dataset.index;
    const urls = (this.data.afterSale && this.data.afterSale.evidenceImages) || [];
    
    if (urls.length === 0) {
      wx.showToast({ title: '没有图片', icon: 'none' });
      return;
    }

    wx.previewImage({
      current: urls[index],
      urls: urls
    });
  }
});
