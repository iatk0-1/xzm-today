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
      this.setData({ orderId: parseInt(options.id) });
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
      this.setData({
        order: res,
        isLoading: false
      });

      // 加载售后记录
      this.loadAfterSaleRecords(this.data.orderId);

      // 如果是已发货或发货中订单，加载物流信息（支持分批发货）
      if (res.status === 'shipped' || res.status === 'paid') {
        this.loadShipmentInfo(this.data.orderId);
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '拉取订单失败', icon: 'none' });
      console.error(err);
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
      // 获取订单维度的发货单列表
      const shipments = await api.get(`/orders/${orderId}/shipments/detail`);
      if (shipments && shipments.length > 0) {
        this.setData({ shipments });

        // 获取所有发货单的物流轨迹
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
        // 将物流轨迹按 shipmentId 映射
        const traceMap = {};
        traceList.forEach(trace => {
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
      data: String(this.data.order.id),
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

  // 跳转到蓝牙打印页面
  bluetoothPrint: function(e) {
    const shipmentId = e.currentTarget.dataset.shipmentId;
    if (shipmentId) {
      wx.navigateTo({
        url: `/pages/bluetoothPrint/bluetoothPrint?shipmentId=${shipmentId}`
      });
    }
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
    wx.showToast({ title: '售后详情页开发中', icon: 'none' });
  }
});
