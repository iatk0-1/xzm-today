// miniprogram/pages/unbindOrder/unbindOrder.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
    shipmentId: null,
    orders: [],
    expressCode: '',
    expressNo: '',
    isLoading: true
  },

  onLoad: function(options) {
    const shipmentId = options.shipmentId || null;
    this.setData({ shipmentId }, () => {
      this.loadShipmentOrders();
    });
    wx.setNavigationBarTitle({ title: `解绑订单 #${shipmentId}` });
  },

  copyOrderNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.orderNo, '订单号');
  },

  copyExpressNo: function() {
    clipboard.copyText(this.data.expressNo, '快递单号');
  },

  // 加载发货单关联的订单列表
  loadShipmentOrders: async function() {
    this.setData({ isLoading: true });
    wx.showLoading({ title: '加载中...' });

    try {
      await auth.ensureAuthenticated({ silent: true });
      // 获取发货单详情
      const shipment = await api.get(`/shipments/${this.data.shipmentId}`);
      this.setData({
        expressCode: shipment.expressCode || '-',
        expressNo: shipment.expressNo || '-'
      });

      // 获取发货单关联的订单列表
      const orders = await api.get(`/shipments/${this.data.shipmentId}/orders`);

      // 处理订单状态：statuses 是数组，取第一个
      const processedOrders = orders.map(order => ({
        ...order,
        status: order.statuses && order.statuses.length > 0 ? order.statuses[0] : order.status
      }));

      this.setData({ orders: processedOrders, isLoading: false });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ isLoading: false });
      console.error('loadShipmentOrders error:', err);
    } finally {
      wx.hideLoading();
    }
  },

  // 解绑订单
  unbindOrder: async function(e) {
    const orderId = e.currentTarget.dataset.orderId;

    wx.showModal({
      title: '确认解绑',
      content: `确定要解绑订单 ${orderId} 吗？解绑后该订单将恢复为独立订单。`,
      confirmText: '确认解绑',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (res.confirm) {
          await this.doUnbindOrder(orderId);
        }
      }
    });
  },

  // 执行解绑
  doUnbindOrder: async function(orderId) {
    wx.showLoading({ title: '解绑中...', mask: true });

    try {
      await api.delete(`/shipments/${this.data.shipmentId}/orders/${orderId}`);
      wx.showToast({ title: '解绑成功', icon: 'success' });

      // 刷新订单列表
      await this.loadShipmentOrders();

      // 通知上一页刷新
      const pages = getCurrentPages();
      if (pages.length > 1) {
        const prevPage = pages[pages.length - 2];
        if (prevPage && prevPage.loadOrders) {
          prevPage.loadOrders();
        }
      }
    } catch (err) {
      wx.showModal({
        title: '解绑失败',
        content: err.message || '未知错误',
        showCancel: false
      });
    } finally {
      wx.hideLoading();
    }
  }
});
