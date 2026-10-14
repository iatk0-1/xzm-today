const { getErrorMessage } = require('../../utils/error');
// miniprogram/pages/afterSaleDetail/afterSaleDetail.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

const RETURN_EXPRESS_OPTIONS = [
  { code: 'ZTO', name: '中通' },
  { code: 'YTO', name: '圆通' },
  { code: 'STO', name: '申通' },
  { code: 'YD', name: '韵达' },
  { code: 'SF', name: '顺丰' },
  { code: 'EMS', name: '邮政 EMS' },
  { code: 'OTHER', name: '其他' }
];

Page({
  data: {
    afterSaleId: null,
    afterSale: null,
    isLoading: true,
    // 售后进度
    timeline: [],
    showReturnShippingModal: false,
    returnExpressOptions: RETURN_EXPRESS_OPTIONS,
    showReturnExpressOptions: false,
    returnExpressCode: '',
    returnExpressName: '',
    returnExpressNo: '',
    returnShippingError: '',
    isSubmittingReturnShipping: false
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

      // 构建售后进度时间轴
      const timeline = this.buildTimeline(formatted);

      this.setData({
        afterSale: formatted,
        timeline,
        isLoading: false
      });
    } catch (err) {
      wx.hideLoading();
      console.error('加载售后详情失败:', err);
      wx.showToast({ title: getErrorMessage(err, '加载失败'), icon: 'none' });
    }
  },

  formatAfterSaleDetail: function(res) {
    const orderDetail = res.orderDetail ? this.formatOrderDetail(res.orderDetail) : null;
    return {
      ...res,
      statusDisplay: res.status === 'cancelled' && res.rejectReason ? '已关闭' : this.getStatusDisplay(res.status),
      typeDisplay: this.getAfterSaleTypeDisplay(res.type),
      createdAtDisplay: this.formatDateTime(res.createdAt),
      updatedAtDisplay: this.formatDateTime(res.updatedAt),
      returnShippedAtDisplay: this.formatDateTime(res.returnShippedAt),
      returnExpressName: this.getReturnExpressName(res.returnExpressCode),
      canModifyReturnShipping: this.canModifyReturnShipping(res),
      orderDetail
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

  // 构建售后进度时间轴
  buildTimeline: function(afterSale) {
    const timeline = [];
    
    // 1. 用户申请
    timeline.push({
      status: '用户申请',
      time: this.formatTime(afterSale.createdAt),
      description: `申请${afterSale.typeDisplay}，退款 ¥${this.formatAmount(afterSale.totalRefundAmount)}`
    });

    // 2. 管理员审核
    if (afterSale.status === 'approved' || afterSale.status === 'received' || afterSale.status === 'refunded') {
      timeline.push({
        status: '商家审核',
        time: '-',
        description: afterSale.type === 'return_refund' ? '审核通过，等待用户退货' : '审核通过，等待退款处理'
      });
    } else if (afterSale.status === 'rejected') {
      timeline.push({
        status: '商家审核',
        time: '-',
        description: `审核拒绝：${afterSale.rejectReason || '原因未填写'}`
      });
      return timeline;
    } else if (afterSale.status === 'cancelled') {
      timeline.push({
        status: afterSale.rejectReason ? '已关闭' : '已撤销',
        time: this.formatTime(afterSale.updatedAt),
        description: afterSale.rejectReason || '用户主动撤销申请'
      });
      return timeline;
    }

    // 3. 用户退货（仅退货退款）
    if (afterSale.type === 'return_refund') {
      if (afterSale.returnExpressNo) {
        timeline.push({
          status: '用户已寄回',
          time: afterSale.returnShippedAt ? this.formatTime(afterSale.returnShippedAt) : '-',
          description: `${this.getReturnExpressName(afterSale.returnExpressCode)}：${afterSale.returnExpressNo}`
        });
      } else if (afterSale.status === 'approved') {
        timeline.push({
          status: '等待用户退货',
          time: '-',
          description: '请填写退货物流信息'
        });
      }
    }

    // 4. 仓库收货
    if (afterSale.status === 'received' || afterSale.status === 'refunded') {
      if (afterSale.warehouseCheck === 'pass') {
        timeline.push({
          status: '仓库已收货',
          time: '-',
          description: '验收通过，等待退款'
        });
      } else if (afterSale.warehouseCheck === 'fail') {
        timeline.push({
          status: '仓库已收货',
          time: '-',
          description: '验收不通过'
        });
      }
    }

    // 5. 退款完成
    if (afterSale.status === 'refunded') {
      timeline.push({
        status: '退款完成',
        time: '-',
        description: '退款已原路返回'
      });
    }

    return timeline;
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

  formatTime: function(timeStr) {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
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

  // 填写退货物流
  getReturnExpressName: function(code) {
    const legacyNames = { YUNDA: '韵达', BEST: '百世快递', PJ: '品骏物流' };
    if (legacyNames[code]) return legacyNames[code];
    const normalizedCode = code;
    const option = RETURN_EXPRESS_OPTIONS.find(item => item.code === normalizedCode);
    return option ? option.name : (code ? '其他' : '-');
  },

  canModifyReturnShipping: function(afterSale) {
    if (!afterSale || afterSale.type !== 'return_refund' || afterSale.status !== 'approved') return false;
    if (afterSale.warehouseCheck === 'pass' || afterSale.warehouseCheck === 'fail') return false;
    return !(afterSale.items || []).some(item => item.afterSaleType === 'return_refund'
      && (item.status === 'received' || item.status === 'refunded'));
  },

  shipReturnGoods: function() {
    if (this.data.isSubmittingReturnShipping) return;
    const afterSale = this.data.afterSale;
    if (!this.canModifyReturnShipping(afterSale)) {
      wx.showToast({ title: '当前售后状态不允许修改退货物流', icon: 'none' });
      return;
    }
    const code = afterSale.returnExpressCode === 'YUNDA' ? 'YD' : afterSale.returnExpressCode;
    const option = RETURN_EXPRESS_OPTIONS.find(item => item.code === code);
    this.setData({
      showReturnShippingModal: true,
      showReturnExpressOptions: false,
      returnExpressCode: option ? option.code : '',
      returnExpressName: option ? option.name : '',
      returnExpressNo: afterSale.returnExpressNo || '',
      returnShippingError: ''
    });
  },

  closeReturnShippingModal: function() {
    if (this.data.isSubmittingReturnShipping) return;
    this.setData({ showReturnShippingModal: false, showReturnExpressOptions: false });
  },

  stopReturnShippingEvent: function() {},

  toggleReturnExpressOptions: function() {
    if (this.data.isSubmittingReturnShipping) return;
    this.setData({ showReturnExpressOptions: !this.data.showReturnExpressOptions });
  },

  selectReturnExpress: function(e) {
    if (this.data.isSubmittingReturnShipping) return;
    const option = RETURN_EXPRESS_OPTIONS.find(item => item.code === e.currentTarget.dataset.code);
    if (!option) return;
    this.setData({
      returnExpressCode: option.code,
      returnExpressName: option.name,
      showReturnExpressOptions: false,
      returnShippingError: ''
    });
  },

  onReturnExpressNoInput: function(e) {
    if (this.data.isSubmittingReturnShipping) return;
    this.setData({ returnExpressNo: e.detail.value, returnShippingError: '' });
  },

  onReturnExpressNoFocus: function() {
    this.setData({ showReturnExpressOptions: false });
  },

  submitReturnShipping: async function() {
    if (this.data.isSubmittingReturnShipping || !this.data.showReturnShippingModal) return;
    if (!this.canModifyReturnShipping(this.data.afterSale)) {
      this.setData({ returnShippingError: '当前售后状态不允许修改退货物流' });
      return;
    }
    const expressCode = this.data.returnExpressCode;
    const expressNo = (this.data.returnExpressNo || '').trim();
    if (!RETURN_EXPRESS_OPTIONS.some(item => item.code === expressCode)) {
      this.setData({ returnShippingError: '请选择快递公司' });
      return;
    }
    if (!expressNo) {
      this.setData({ returnShippingError: '请输入快递单号' });
      return;
    }
    this.setData({ isSubmittingReturnShipping: true, showReturnExpressOptions: false, returnShippingError: '' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const result = await api.post(`/after-sales/${this.data.afterSaleId}/return-ship`, { expressCode, expressNo });
      const afterSale = this.formatAfterSaleDetail(result);
      this.setData({
        afterSale,
        timeline: this.buildTimeline(afterSale),
        showReturnShippingModal: false,
        returnExpressNo: ''
      });
      wx.showToast({ title: '提交成功', icon: 'success' });
    } catch (err) {
      this.setData({ returnShippingError: getErrorMessage(err, '提交失败，请重试') });
    } finally {
      this.setData({ isSubmittingReturnShipping: false });
    }
  },

  // 查看物流轨迹
  viewLogistics: function() {
    const afterSale = this.data.afterSale;
    if (!afterSale.returnExpressNo) {
      wx.showToast({ title: '还未填写退货物流', icon: 'none' });
      return;
    }
    
    // TODO: 跳转到物流查询页面
    wx.showToast({ title: '物流查询功能开发中', icon: 'none' });
  },

  // 撤销售后申请
  cancelAfterSale: function() {
    if (this.data.afterSale.status !== 'pending') {
      wx.showToast({ title: '该状态无法撤销', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '撤销申请',
      content: '确定要撤销该售后申请吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });
          try {
            await auth.ensureAuthenticated({ silent: true });
            await api.post(`/after-sales/${this.data.afterSaleId}/cancel`);
            wx.hideLoading();
            wx.showToast({ title: '已撤销', icon: 'success' });
            this.loadAfterSaleDetail();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: getErrorMessage(err, '撤销失败'), icon: 'none' });
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

  previewImage: function(e) {
    const index = e.currentTarget.dataset.index;
    const urls = this.data.afterSale && this.data.afterSale.evidenceUrls
      ? this.data.afterSale.evidenceUrls.split(',')
      : [];

    if (!urls.length) {
      wx.showToast({ title: '没有图片', icon: 'none' });
      return;
    }

    wx.previewImage({
      current: urls[index],
      urls
    });
  }
});
