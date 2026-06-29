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
    warehouseCheck: 'pass',
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

      // 为每个明细项添加中文状态显示
      const items = (res.items || []).map(item => ({
        ...item,
        statusDisplay: this.getStatusDisplay(item.status)
      }));

      this.setData({
        afterSale: {
          ...res,
          items,
          statusDisplay: this.getStatusDisplay(res.status),
          typeDisplay: res.type === 'refund' ? '仅退款' : '退货退款'
        },
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

  getActionDisplay: function(action) {
    const map = {
      'apply': '用户申请',
      'review_approve': '审核通过',
      'review_reject': '审核拒绝',
      'ship_return': '用户已寄回',
      'receive_pass': '仓库验收通过',
      'receive_fail': '仓库验收不通过',
      'refund': '已退款'
    };
    return map[action] || action;
  },

  formatTime: function(timeStr) {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
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
      await api.post(`/after-sales/${this.data.afterSaleId}/receive`, {
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

  // 执行退款
  submitRefund: async function() {
    wx.showModal({
      title: '确认退款',
      content: '确认要执行退款操作吗？此操作不可撤销。',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });

          try {
            await api.post(`/after-sales/${this.data.afterSaleId}/refund`);

            wx.hideLoading();
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
