// miniprogram/pages/adminAfterSaleDetail/adminAfterSaleDetail.js
const api = require('../../utils/api');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
    afterSaleId: null,
    afterSale: null,
    isLoading: true,
    // 审核操作
    showReviewModal: false,
    reviewDecision: 'approve',
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
    logs: []
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
      const res = await api.get(`/after-sales/${this.data.afterSaleId}`);
      wx.hideLoading();
      const formatted = this.formatAfterSaleDetail(res);

      this.setData({
        afterSale: formatted,
        isLoading: false
      });

      // 加载售后日志
      this.loadLogs();
    } catch (err) {
      wx.hideLoading();
      console.error('加载售后详情失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  formatAfterSaleDetail: function(res) {
    const items = (res.items || []).map(item => ({
      ...item,
      statusDisplay: this.getStatusDisplay(item.status)
    }));
    const orderDetail = res.orderDetail ? this.formatOrderDetail(res.orderDetail) : null;
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
      returnShippedAtDisplay: this.formatDateTime(res.returnShippedAt)
    };
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

  // 显示审核弹窗
  showReviewModal: function() {
    this.setData({
      showReviewModal: true,
      reviewDecision: 'approve',
      rejectReason: ''
    });
  },

  // 隐藏审核弹窗
  hideReviewModal: function() {
    this.setData({
      showReviewModal: false,
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

  // 提交审核
  submitReview: async function() {
    if (this.data.reviewDecision === 'reject' && !this.data.rejectReason) {
      wx.showToast({ title: '请填写拒绝原因', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '处理中...' });

    try {
      await api.post(`/after-sales/${this.data.afterSaleId}/review`, {
        decision: this.data.reviewDecision,
        rejectReason: this.data.reviewDecision === 'reject' ? this.data.rejectReason : null
      });

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

  copyOrderNo: function() {
    const afterSale = this.data.afterSale || {};
    clipboard.copyText(afterSale.outTradeNo, '订单号');
  },

  copyRecipientInfo: function() {
    const orderDetail = this.data.afterSale && this.data.afterSale.orderDetail;
    clipboard.copyRecipient(orderDetail || {});
  },

  // 预览凭证图片
  previewImage: function(e) {
    const index = e.currentTarget.dataset.index;
    const urls = this.data.afterSale.evidenceUrls ? this.data.afterSale.evidenceUrls.split(',') : [];
    
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
