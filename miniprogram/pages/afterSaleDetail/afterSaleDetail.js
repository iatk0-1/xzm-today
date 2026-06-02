// miniprogram/pages/afterSaleDetail/afterSaleDetail.js
const api = require('../../utils/api');

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

      // 构建售后进度时间轴
      const timeline = this.buildTimeline(res);

      this.setData({
        afterSale: {
          ...res,
          statusDisplay: this.getStatusDisplay(res.status),
          typeDisplay: res.type === 'refund' ? '仅退款' : '退货退款'
        },
        timeline,
        isLoading: false
      });
    } catch (err) {
      wx.hideLoading();
      console.error('加载售后详情失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 构建售后进度时间轴
  buildTimeline: function(afterSale) {
    const timeline = [];
    
    // 1. 用户申请
    timeline.push({
      status: '用户申请',
      time: this.formatTime(afterSale.createdAt),
      description: `申请${afterSale.typeDisplay}，退款 ¥${afterSale.totalRefundAmount}`
    });

    // 2. 管理员审核
    if (afterSale.status === 'approved' || afterSale.status === 'received' || afterSale.status === 'refunded') {
      timeline.push({
        status: '商家审核',
        time: '-',
        description: '审核通过，等待用户退货'
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

  formatTime: function(timeStr) {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
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
    if (!afterSale.returnExpressNo) {
      wx.showToast({ title: '没有物流单号', icon: 'none' });
      return;
    }

    wx.setClipboardData({
      data: afterSale.returnExpressNo,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  }
});
