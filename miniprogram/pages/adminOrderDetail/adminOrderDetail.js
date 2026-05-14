// miniprogram/pages/adminOrderDetail/adminOrderDetail.js
const api = require('../../utils/api');

Page({
  data: {
    orderId: null,
    order: null,
    isLoading: true,
    afterSaleRecords: [],
    shipments: [],       // 多个发货单（支持分批发货）
    logisticsTraceMap: {}  // 物流轨迹映射
  },

  onLoad: function(options) {
    if (options.id) {
      // 雪花 ID 超 15 位，JS parseInt 会丢精度，直接用字符串
      this.setData({ orderId: options.id });
      this.loadOrderDetail();
    } else {
      wx.showToast({ title: '订单参数丢失', icon: 'none' });
    }
  },

  // 加载订单详情
  loadOrderDetail: async function() {
    wx.showLoading({ title: '加载中...' });

    try {
      const res = await api.get(`/orders/${this.data.orderId}`);
      wx.hideLoading();
      // 附加格式化字段
      res.statusDisplay = this.getOrderStatusDisplay(res.status);
      res.createdAtDisplay = this.formatTime(res.createdAt);
      this.setData({ order: res, isLoading: false });

      this.loadAfterSaleRecords(this.data.orderId);

      if (res.status === 'shipped' || res.status === 'paid' || res.status === 'partial_shipped') {
        this.loadShipmentInfo(this.data.orderId);
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ isLoading: false });
      wx.showModal({
        title: '加载失败',
        content: err.message || '订单详情加载失败，请重试',
        showCancel: false
      });
      console.error('拉取订单详情失败:', err);
    }
  },

  getOrderStatusDisplay: function(status) {
    var map = {
      'pending': '待付款',
      'paid': '待发货',
      'partial_shipped': '部分发货',
      'shipped': '已发货',
      'completed': '已完成',
      'cancelled': '已取消'
    };
    return map[status] || status;
  },

  formatTime: function(raw) {
    if (!raw) return '';
    try {
      var d;
      if (typeof raw === 'number') {
        d = new Date(raw < 1e10 ? raw * 1000 : raw);
      } else if (raw instanceof Array) {
        d = new Date(raw[0], raw[1] - 1, raw[2], raw[3] || 0, raw[4] || 0, raw[5] || 0);
      } else {
        d = new Date(String(raw));
      }
      if (isNaN(d.getTime())) return String(raw);
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
        + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch (e) {
      return String(raw);
    }
  },

  // 加载售后记录
  loadAfterSaleRecords: async function(orderId) {
    try {
      const res = await api.get('/after-sales', { orderId: orderId });
      const records = (res.items || []).map(item => ({
        ...item,
        typeDisplay: item.type === 'refund' ? '仅退款' : '退货退款',
        statusDisplay: this.getAfterSaleStatusDisplay(item.status)
      }));
      this.setData({ afterSaleRecords: records });
    } catch (err) {
      console.error('加载售后记录失败:', err);
    }
  },

  getAfterSaleStatusDisplay: function(status) {
    const map = {
      'pending': '待审核',
      'approved': '已同意',
      'rejected': '已拒绝',
      'received': '已收货',
      'refunded': '已退款'
    };
    return map[status] || status;
  },

  // 加载物流信息（支持分批发货）
  loadShipmentInfo: async function(orderId) {
    try {
      const shipments = await api.get(`/orders/${orderId}/shipments/detail`);
      if (shipments && shipments.length > 0) {
        var self = this;
        shipments.forEach(function(s) {
          s.shippedAtDisplay = self.formatTime(s.shippedAt);
        });
        this.setData({ shipments });
        this.loadLogisticsTraceMap(orderId);
      }
    } catch (err) {
      console.error('加载物流信息失败:', err);
    }
  },

  // 加载多个发货单的物流轨迹映射
  loadLogisticsTraceMap: async function(orderId) {
    try {
      const traceList = await api.get(`/orders/${orderId}/shipments/trace`);
      if (traceList && traceList.length > 0) {
        var self = this;
        var traceMap = {};
        traceList.forEach(function(trace) {
          if (trace.nodes) {
            trace.nodes.forEach(function(node) {
              node.timeDisplay = self.formatTime(node.time);
            });
          }
          traceMap[trace.shipmentId] = trace;
        });
        this.setData({ logisticsTraceMap: traceMap });
      }
    } catch (err) {
      console.error('加载物流轨迹失败:', err);
    }
  },

  // 一键复制订单号
  copyOrderSn: function() {
    wx.setClipboardData({
      data: String(this.data.order.outTradeNo || this.data.order.id),
      success: () => {
        wx.showToast({ title: '单号已复制', icon: 'success' });
      }
    });
  },

  // 预览面单 PDF
  previewWaybill: function(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      wx.previewImage({
        urls: [url],
        success: () => {
          wx.showToast({ title: '请尽快打印面单', icon: 'none', duration: 2000 });
        }
      });
    }
  },

  // 取消运单
  cancelWaybill: function(e) {
    const shipmentId = e.currentTarget.dataset.shipmentId;
    const orderNo = e.currentTarget.dataset.orderNo;
    
    wx.showModal({
      title: '取消运单',
      content: `确定要取消订单 ${orderNo} 的运单吗？\n\n取消后：\n1. 该运单将失效\n2. 已发货数量将回退\n3. 如果订单没有其他运单，订单状态将回退为"待发货"`,
      confirmText: '确认取消',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '取消中...' });
          try {
            await api.post(`/admin/orders-manage/orders/shipments/${shipmentId}/cancel-waybill`);
            wx.hideLoading();
            wx.showToast({ title: '运单已取消', icon: 'success' });
            // 重新加载订单详情
            this.loadOrderDetail();
          } catch (err) {
            wx.hideLoading();
            wx.showModal({
              title: '取消失败',
              content: err.message || '取消运单失败',
              showCancel: false
            });
          }
        }
      }
    });
  },

  // 查看物流轨迹
  viewShipmentTrace: async function(e) {
    const shipmentId = e.currentTarget.dataset.id;
    try {
      const trace = await api.get(`/shipments/${shipmentId}/trace`);
      if (trace) {
        wx.showModal({
          title: '物流轨迹',
          content: trace.list ? trace.list.map(node => node.description).join('\n') : '暂无物流信息',
          showCancel: false
        });
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 查看售后详情
  viewAfterSaleDetail: function(e) {
    const afterSaleId = e.currentTarget.dataset.id;
    // 跳转到管理员售后处理页
    wx.navigateTo({
      url: `/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${afterSaleId}`
    });
  }
});
