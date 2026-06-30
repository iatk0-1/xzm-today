const api = require('../../utils/api');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
    shipmentId: '',
    orderId: '',
    trace: null,
    isLoading: true
  },

  onLoad: function(options) {
    const shipmentId = options.shipmentId || '';
    const orderId = options.orderId || '';
    if (!shipmentId) {
      wx.showToast({ title: '缺少发货单参数', icon: 'none' });
      return;
    }

    this.setData({
      shipmentId,
      orderId
    });
    this.loadTrace(shipmentId);
  },

  loadTrace: async function(shipmentId) {
    wx.showLoading({ title: '加载中...' });
    try {
      const trace = await api.get(`/shipments/${shipmentId}/trace`);
      const nodes = (trace.nodes || []).map((node, index) => ({
        ...node,
        timeDisplay: this.formatTime(node.time),
        isLatest: index === 0
      }));

      this.setData({
        trace: {
          ...trace,
          nodes
        },
        isLoading: false
      });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      this.setData({ isLoading: false });
      wx.showToast({ title: '加载物流失败', icon: 'none' });
    }
  },

  formatTime: function(raw) {
    if (!raw) return '';
    try {
      var d = new Date(raw);
      if (isNaN(d.getTime())) {
        return String(raw);
      }
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
        + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch (e) {
      return String(raw);
    }
  },

  getExpressName: function(expressCode) {
    const nameMap = {
      ZTO: '中通快递',
      YTO: '圆通速递',
      STO: '申通快递',
      YD: '韵达速递',
      YUNDA: '韵达速递',
      SF: '顺丰速运',
      JD: '京东物流',
      EMS: 'EMS',
      BEST: '百世快递'
    };
    return nameMap[expressCode] || expressCode || '-';
  },

  copyExpressNo: function() {
    const trace = this.data.trace || {};
    clipboard.copyText(trace.expressNo, '快递单号');
  }
});
