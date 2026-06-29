// miniprogram/pages/afterSaleDetail/afterSaleDetail.js
const api = require('../../utils/api');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
    afterSaleId: null,
    afterSale: null,
    isLoading: true,
    // 售后进度
    timeline: []
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
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  formatAfterSaleDetail: function(res) {
    const orderDetail = res.orderDetail ? this.formatOrderDetail(res.orderDetail) : null;
    return {
      ...res,
      statusDisplay: this.getStatusDisplay(res.status),
      typeDisplay: this.getAfterSaleTypeDisplay(res.type),
      createdAtDisplay: this.formatDateTime(res.createdAt),
      updatedAtDisplay: this.formatDateTime(res.updatedAt),
      returnShippedAtDisplay: this.formatDateTime(res.returnShippedAt),
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
        status: '已撤销',
        time: this.formatTime(afterSale.updatedAt),
        description: '用户主动撤销申请'
      });
      return timeline;
    }

    // 3. 用户退货（仅退货退款）
    if (afterSale.type === 'return_refund') {
      if (afterSale.returnExpressNo) {
        timeline.push({
          status: '用户已寄回',
          time: afterSale.returnShippedAt ? this.formatTime(afterSale.returnShippedAt) : '-',
          description: `${afterSale.returnExpressCode}：${afterSale.returnExpressNo}`
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
  shipReturnGoods: function() {
    wx.showModal({
      title: '填写退货物流',
      editable: true,
      placeholderText: '请输入快递单号',
      success: (res) => {
        if (res.confirm && res.content) {
          // 选择快递公司
          wx.showActionSheet({
            itemList: ['中通', '圆通', '申通', '韵达', '顺丰', '邮政 EMS', '其他'],
            success: (sheetRes) => {
              const expressCodes = ['ZTO', 'YTO', 'STO', 'YD', 'SF', 'EMS', 'OTHER'];
              const expressNames = ['中通', '圆通', '申通', '韵达', '顺丰', '邮政 EMS', '其他'];
              
              wx.showLoading({ title: '提交中...' });
              
              api.post(`/after-sales/${this.data.afterSaleId}/return-ship`, {
                expressCode: expressCodes[sheetRes.tapIndex],
                expressNo: res.content
              }).then(() => {
                wx.hideLoading();
                wx.showToast({ title: '提交成功', icon: 'success' });
                this.loadAfterSaleDetail();
              }).catch(err => {
                wx.hideLoading();
                wx.showToast({ title: err.message || '提交失败', icon: 'none' });
              });
            }
          });
        } else if (!res.content) {
          wx.showToast({ title: '请输入快递单号', icon: 'none' });
        }
      }
    });
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
            await api.post(`/after-sales/${this.data.afterSaleId}/cancel`);
            wx.hideLoading();
            wx.showToast({ title: '已撤销', icon: 'success' });
            this.loadAfterSaleDetail();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: err.message || '撤销失败', icon: 'none' });
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
