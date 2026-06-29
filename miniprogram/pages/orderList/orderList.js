// miniprogram/pages/orderList/orderList.js
const api = require('../../utils/api');
const clipboard = require('../../utils/clipboard');

// 状态映射（前端中文 -> 后端英文）
const STATUS_MAP = {
  '全部': null,
  '待付款': 'pending',
  '待发货': 'paid',
  '部分发货': 'partial_shipped',
  '已发货': 'shipped',
  '已完成': 'completed',
  '退款/售后': 'after_sale',
  '已关闭': 'cancelled'
};

// 后端状态 -> 前端中文显示
const STATUS_DISPLAY_MAP = {
  'pending': '待付款',
  'paid': '待发货',
  'partial_shipped': '部分发货',
  'shipped': '已发货',
  'completed': '已完成',
  'cancelled': '已关闭'
};

Page({
  data: {
    tabs: ['全部', '待付款', '待发货', '部分发货', '已发货', '已完成', '退款/售后', '已关闭'],
    currentTab: '全部',
    orders: [],
    isLoading: true
  },

  onShow: function() {
    // 从微信确认收货组件返回后刷新列表
    if (this.data.orders.length > 0) {
      this.loadOrders();
    }
  },

  onLoad: function(options) {
    const statusMap = {
      'all': '全部',
      'pay': '待付款',
      'paid': '待发货',
      'shipped': '已发货',
      'completed': '已完成',
      'refund': '退款/售后',
      'closed': '已关闭'
    };

    if (options.status && statusMap[options.status]) {
      this.setData({ currentTab: statusMap[options.status] });
    }
    this.loadOrders();
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab }, () => {
      this.loadOrders();
    });
  },

  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/orderDetail/orderDetail?id=${id}`
    });
  },

  copyOrderNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.orderNo, '订单号');
  },

  // 改造：从后端 API 获取订单列表
  loadOrders: async function() {
    this.setData({ isLoading: true, orders: [] });
    wx.showLoading({ title: '加载订单中...' });

    try {
      const backendStatus = STATUS_MAP[this.data.currentTab];
      const params = {};
      if (backendStatus) {
        params.status = backendStatus;
      }
      params.page = 1;
      params.size = 20;

      const res = await api.get('/orders', params);

      // 后端返回格式：{ items: [...], total: N, page: 1, size: 20 }
      const orders = (res.items || []).map(order => ({
        ...order,
        statusDisplay: STATUS_DISPLAY_MAP[order.status] || order.status
      }));

      wx.hideLoading();
      this.setData({ orders, isLoading: false });
    } catch (err) {
      wx.hideLoading();
      console.error('获取订单失败:', err);
      wx.showToast({ title: '获取订单失败', icon: 'none' });
    }
  },

  // 确认收货：优先调微信组件，不可用时降级弹框
  confirmReceipt: async function(e) {
    var orderId = e.currentTarget.dataset.id;
    var order = (this.data.orders || []).find(function(o) { return o.id === orderId; });
    if (!order) return;

    var app = getApp();
    app.pendingConfirmOrderId = orderId;
    var self = this;

    console.log('[确认收货-列表] merchantId=' + order.merchantId
      + ', outTradeNo=' + order.outTradeNo + ', payTxnId=' + order.payTxnId);

    if (typeof wx.openBusinessView !== 'function') {
      console.log('[确认收货-列表] wx.openBusinessView 不可用，降级弹框');
      this.fallbackConfirm(orderId);
      return;
    }

    wx.openBusinessView({
      businessType: 'weappOrderConfirm',
      extraData: {
        merchant_id: order.merchantId || '',
        merchant_trade_no: order.outTradeNo || '',
        transaction_id: order.payTxnId || ''
      },
      success: function() {
        console.log('[确认收货-列表] 组件已打开');
      },
      fail: function(err) {
        console.error('[确认收货-列表] 组件打开失败:', JSON.stringify(err));
        app.pendingConfirmOrderId = null;
        self.fallbackConfirm(orderId);
      }
    });
  },

  fallbackConfirm: function(orderId) {
    var self = this;
    wx.showModal({
      title: '确认收货',
      content: '确认已收到商品？',
      confirmColor: '#111111',
      success: function(modalRes) {
        if (!modalRes.confirm) return;
        wx.showLoading({ title: '处理中...' });
        api.post('/orders/' + orderId + '/receive')
          .then(function() {
            wx.hideLoading();
            wx.showToast({ title: '交易完成', icon: 'success' });
            self.loadOrders();
          })
          .catch(function() {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          });
      }
    });
  },

  // 立即支付
  payOrder: async function(e) {
    const orderId = e.currentTarget.dataset.id;
    try {
      const payRes = await api.post(`/orders/${orderId}/pay/wechat`);
      // 后端返回字段是 package，不是 packageValue
      const packageValue = payRes.package || payRes.packageValue;
      if (payRes && packageValue) {
        wx.requestPayment({
          timeStamp: payRes.timeStamp.toString(),
          nonceStr: payRes.nonceStr,
          package: packageValue,
          signType: payRes.signType || 'RSA',
          paySign: payRes.paySign,
          success: () => {
            wx.showToast({ title: '支付成功', icon: 'success' });
            this.loadOrders();
          },
          fail: (err) => {
            if (err.errMsg !== 'requestPayment:fail cancel') {
              wx.showModal({ title: '支付失败', content: err.errMsg, showCancel: false });
            }
          }
        });
      }
    } catch (err) {
      wx.showModal({ title: '支付失败', content: JSON.stringify(err), showCancel: false });
    }
  },

  // 取消订单
  cancelOrder: async function(e) {
    const orderId = e.currentTarget.dataset.id;

    wx.showModal({
      title: '取消订单',
      content: '确定要取消该订单吗？取消后库存将释放',
      confirmColor: '#111111',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });
          try {
            await api.post(`/orders/${orderId}/cancel`);
            wx.hideLoading();
            wx.showToast({ title: '订单已取消', icon: 'success' });
            this.loadOrders();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  }
});
