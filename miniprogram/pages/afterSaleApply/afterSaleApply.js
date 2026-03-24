// miniprogram/pages/afterSaleApply/afterSaleApply.js
const api = require('../../utils/api');

// 售后原因选项
const REASON_OPTIONS = [
  '商品质量问题',
  '尺码不符',
  '颜色/款式不喜欢',
  '商品破损',
  '发错货',
  '少件/漏发',
  '商品描述不符',
  '其他'
];

Page({
  data: {
    orderId: null,
    order: null,
    orderItems: [],
    selectedItemId: null,
    selectedItem: null,
    afterSaleType: 'refund', // refund | return_refund
    refundQty: 1,
    maxRefundAmount: '0.00',
    refundAmountInput: '',
    reason: '',
    reasonText: '',
    reasonOptions: REASON_OPTIONS,
    evidenceImages: [],
    isLoading: true
  },

  onLoad: function(options) {
    if (options.orderId) {
      this.setData({ orderId: options.orderId });
      this.loadOrderDetail(options.orderId);
    } else {
      wx.showToast({ title: '订单参数丢失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  // 加载订单详情获取订单项
  loadOrderDetail: async function(orderId) {
    wx.showLoading({ title: '加载中...' });

    try {
      const res = await api.get(`/orders/${orderId}`);
      wx.hideLoading();

      if (!res || !res.items || res.items.length === 0) {
        wx.showToast({ title: '订单无可售后商品', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      // 检查订单状态是否允许售后
      const allowedStatuses = ['paid', 'shipped', 'completed'];
      if (!allowedStatuses.includes(res.status)) {
        wx.showToast({ title: '该订单状态无法申请售后', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      this.setData({
        order: {
          ...res,
          statusDisplay: this.getStatusDisplay(res.status)
        },
        orderItems: res.items,
        selectedItemId: res.items[0].id,
        selectedItem: res.items[0],
        maxRefundAmount: this.calculateMaxRefund(res.items[0]),
        refundAmountInput: this.calculateMaxRefund(res.items[0]),
        isLoading: false
      });
    } catch (err) {
      wx.hideLoading();
      console.error('加载订单失败:', err);
      wx.showToast({ title: '加载订单失败', icon: 'none' });
    }
  },

  getStatusDisplay: function(status) {
    const map = {
      'paid': '待发货',
      'shipped': '已发货',
      'completed': '已完成'
    };
    return map[status] || status;
  },

  calculateMaxRefund: function(item) {
    return (item.salePrice * item.qty).toFixed(2);
  },

  // 选择商品
  selectItem: function(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({
      selectedItemId: item.id,
      selectedItem: item,
      refundQty: 1,
      maxRefundAmount: this.calculateMaxRefund(item),
      refundAmountInput: this.calculateMaxRefund(item)
    });
  },

  // 选择售后类型
  selectType: function(e) {
    this.setData({
      afterSaleType: e.currentTarget.dataset.type
    });
  },

  // 减少退款数量
  decreaseQty: function() {
    if (this.data.refundQty > 1) {
      const newQty = this.data.refundQty - 1;
      this.updateRefundAmount(newQty);
    }
  },

  // 增加退款数量
  increaseQty: function() {
    if (this.data.refundQty < this.data.selectedItem.qty) {
      const newQty = this.data.refundQty + 1;
      this.updateRefundAmount(newQty);
    }
  },

  updateRefundAmount: function(qty) {
    const maxAmount = (this.data.selectedItem.salePrice * qty).toFixed(2);
    this.setData({
      refundQty: qty,
      maxRefundAmount: maxAmount,
      refundAmountInput: maxAmount
    });
  },

  // 输入退款金额
  onRefundAmountInput: function(e) {
    this.setData({
      refundAmountInput: e.detail.value
    });
  },

  // 选择原因
  selectReason: function(e) {
    this.setData({
      reason: e.currentTarget.dataset.reason
    });
  },

  // 输入原因文本
  onReasonInput: function(e) {
    this.setData({
      reasonText: e.detail.value
    });
  },

  // 上传图片
  uploadImage: function() {
    const maxCount = 9 - this.data.evidenceImages.length;
    wx.chooseMedia({
      count: maxCount,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const newImages = res.tempFiles.map(file => file.tempFilePath);
        this.setData({
          evidenceImages: [...this.data.evidenceImages, ...newImages]
        });
      }
    });
  },

  // 预览图片
  previewImage: function(e) {
    const index = e.currentTarget.dataset.index;
    wx.previewImage({
      current: this.data.evidenceImages[index],
      urls: this.data.evidenceImages
    });
  },

  // 删除图片
  deleteImage: function(e) {
    const index = e.currentTarget.dataset.index;
    const newImages = this.data.evidenceImages.filter((_, i) => i !== index);
    this.setData({
      evidenceImages: newImages
    });
  },

  // 提交售后申请
  submitAfterSale: async function() {
    // 验证必填项
    if (!this.data.selectedItemId) {
      wx.showToast({ title: '请选择商品', icon: 'none' });
      return;
    }

    if (!this.data.afterSaleType) {
      wx.showToast({ title: '请选择售后类型', icon: 'none' });
      return;
    }

    const refundAmount = parseFloat(this.data.refundAmountInput);
    if (isNaN(refundAmount) || refundAmount <= 0) {
      wx.showToast({ title: '请输入有效的退款金额', icon: 'none' });
      return;
    }

    const maxAmount = parseFloat(this.data.maxRefundAmount);
    if (refundAmount > maxAmount) {
      wx.showToast({ title: '退款金额超过上限', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交中...', mask: true });

    try {
      // 上传图片到服务器（如果有）
      let evidenceUrls = '';
      if (this.data.evidenceImages.length > 0) {
        // TODO: 实现图片上传到服务器的逻辑
        // 这里暂时将本地路径转为逗号分隔的字符串
        evidenceUrls = this.data.evidenceImages.join(',');
      }

      const requestData = {
        orderId: this.data.orderId,
        orderItemId: this.data.selectedItemId,
        type: this.data.afterSaleType,
        qty: this.data.refundQty,
        reason: this.data.reason || this.data.reasonText || '无理由售后',
        evidenceUrls: evidenceUrls,
        refundAmount: refundAmount
      };

      console.log('提交售后申请:', requestData);
      await api.post('/api/v1/after-sales', requestData);

      wx.hideLoading();
      wx.showModal({
        title: '提交成功',
        content: '售后申请已提交，请等待审核',
        showCancel: false,
        confirmColor: '#111111',
        success: () => {
          wx.navigateBack();
        }
      });
    } catch (err) {
      wx.hideLoading();
      console.error('提交售后失败:', err);
      wx.showToast({
        title: err.message || '提交失败',
        icon: 'none',
        duration: 2000
      });
    }
  }
});
