// miniprogram/pages/orderDetail/orderDetail.js
const api = require('../../utils/api');
const clipboard = require('../../utils/clipboard');

// 支付超时时间（30 分钟）
const PAYMENT_TIMEOUT_MINUTES = 30;

Page({
  data: {
    order: null,
    isLoading: true,
    countdownText: '',
    afterSaleRecords: [],
    shipments: [],       // 多个发货单（支持分批发货）
    logisticsTraceList: []  // 多个发货单的物流轨迹
  },

  onLoad: function(options) {
    if (options.outTradeNo) {
      // 微信通知跳转：outTradeNo 即订单 ID
      var orderId = options.outTradeNo;
      if (orderId) {
        this.orderId = orderId;
        this.loadOrderDetail(orderId);
        return;
      }
    }
    if (options.id) {
      this.orderId = options.id;
      this.loadOrderDetail(options.id);
    } else {
      wx.showToast({ title: '订单参数丢失', icon: 'none' });
    }
  },

  onShow: function() {
    // 页面显示时重新加载订单详情（从发货页面返回时会触发）
    if (this.orderId) {
      this.loadOrderDetail(this.orderId);
    }
  },

  onUnload: function() {
    // 页面卸载时清除定时器
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  },

  // 改造：从后端 API 获取订单详情
  loadOrderDetail: async function(orderId) {
    wx.showLoading({ title: '加载中...' });

    try {
      const res = await api.get(`/orders/${orderId}`);
      wx.hideLoading();
      // 附加格式化字段
      res.statusDisplay = this.getOrderStatusDisplay(res.status);
      res.createdAtDisplay = this.formatTime(res.createdAt);
      this.setData({ order: res, isLoading: false });

      // 加载售后记录
      this.loadAfterSaleRecords(orderId);

      // 如果是已发货/部分发货/已支付订单，加载物流信息
      if (res.status === 'shipped'
        || res.status === 'paid'
        || res.status === 'partial_shipped'
        || res.status === 'completed') {
        this.loadShipmentInfo(orderId);
      }

      // 如果是待支付订单，启动倒计时
      if (res.status === 'pending' && res.createdAt) {
        this.startCountdown(res.createdAt);
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '拉取订单失败', icon: 'none' });
      console.error(err);
    }
  },

  getOrderStatusDisplay: function(status) {
    const map = {
      'pending': '待付款',
      'stocking': '备货中',
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
        // 秒级时间戳（< 1e10）转毫秒，否则直接当毫秒
        d = new Date(raw < 1e10 ? raw * 1000 : raw);
      } else if (raw instanceof Array) {
        // Jackson 默认序列化 LocalDateTime 为 [年,月,日,时,分,秒,纳秒]
        d = new Date(raw[0], raw[1] - 1, raw[2], raw[3] || 0, raw[4] || 0, raw[5] || 0);
      } else {
        var s = String(raw);
        if (s.length >= 16 && s.indexOf('T') !== -1) {
          d = new Date(s);
        } else {
          d = new Date(s);
        }
      }
      if (isNaN(d.getTime())) return String(raw);
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
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
        // 格式化每条发货单的时间
        var self = this;
        shipments.forEach(function(s) {
          s.shippedAtDisplay = self.formatTime(s.shippedAt);
        });
        this.setData({ shipments });
        this.loadLogisticsTraceList(orderId);
      }
    } catch (err) {
      console.error('加载物流信息失败:', err);
    }
  },

  // 加载多个发货单的物流轨迹列表
  loadLogisticsTraceList: async function(orderId) {
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

  // 查看单个发货单的物流轨迹
  viewShipmentTrace: async function(e) {
    const shipmentId = e.currentTarget.dataset.id;
    try {
      const trace = await api.get(`/shipments/${shipmentId}/trace`);
      if (trace) {
        wx.showModal({
          title: '物流轨迹',
          content: trace.nodes ? trace.nodes.map(node => node.description).join('\n') : '暂无物流信息',
          showCancel: false
        });
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
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

  // 启动支付倒计时
  startCountdown: function(createdAt) {
    const orderTime = new Date(createdAt).getTime();
    const timeout = PAYMENT_TIMEOUT_MINUTES * 60 * 1000; // 30 分钟超时
    const deadline = orderTime + timeout;

    // 立即计算一次
    this.updateCountdown(deadline);

    // 每秒更新一次
    this.countdownTimer = setInterval(() => {
      this.updateCountdown(deadline);
    }, 1000);
  },

  // 更新倒计时显示
  updateCountdown: function(deadline) {
    const now = new Date().getTime();
    const remaining = deadline - now;

    if (remaining <= 0) {
      // 已超时
      this.setData({ countdownText: '订单已超时，将自动取消' });
      if (this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
      // 刷新订单状态
      setTimeout(() => {
        this.loadOrderDetail(this.data.order.id);
      }, 2000);
      return;
    }

    // 计算剩余分钟和秒数
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    const minutesStr = minutes.toString().padStart(2, '0');
    const secondsStr = seconds.toString().padStart(2, '0');

    this.setData({
      countdownText: `剩余支付时间：${minutesStr}:${secondsStr}`
    });
  },

  // 一键复制订单号
  copyOrderSn: function() {
    var order = this.data.order || {};
    clipboard.copyText(order.outTradeNo || order.id, '订单号');
  },

  copyExpressNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.expressNo, '快递单号');
  },

  copyRecipientInfo: function() {
    var order = this.data.order || {};
    clipboard.copyRecipient(order);
  },

  // 各种按钮的操作逻辑
  payOrder: async function() {
    try {
      const payRes = await api.post(`/orders/${this.data.order.id}/pay/wechat`);
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
            this.loadOrderDetail(this.data.order.id);
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

  confirmReceipt: async function() {
    var order = this.data.order;
    var self = this;

    // 保存当前订单 ID，供 App.onShow 回调使用
    var app = getApp();
    app.pendingConfirmOrderId = order.id;

    console.log('[确认收货] 订单信息: merchantId=' + order.merchantId
      + ', outTradeNo=' + order.outTradeNo
      + ', payTxnId=' + order.payTxnId);

    // 检查 wx.openBusinessView 是否可用（基础库 >= 2.6.0）
    if (typeof wx.openBusinessView !== 'function') {
      console.log('[确认收货] wx.openBusinessView 不可用，降级弹框');
      this.fallbackConfirmReceipt();
      return;
    }

    wx.openBusinessView({
      businessType: 'weappOrderConfirm',
      extraData: {
        merchant_id: order.merchantId || '',
        merchant_trade_no: order.outTradeNo || '',
        transaction_id: order.payTxnId || ''
      },
      success: function(res) {
        console.log('[确认收货] 组件已打开', JSON.stringify(res));
      },
      fail: function(err) {
        console.error('[确认收货] 组件打开失败:', JSON.stringify(err));
        app.pendingConfirmOrderId = null;
        self.fallbackConfirmReceipt();
      }
    });
  },

  // 降级方案：弹框确认收货
  fallbackConfirmReceipt: function() {
    var order = this.data.order;
    var self = this;
    wx.showModal({
      title: '确认收货',
      content: '确认已收到商品？',
      confirmColor: '#111111',
      success: function(modalRes) {
        if (!modalRes.confirm) return;
        wx.showLoading({ title: '处理中...' });
        api.post('/orders/' + order.id + '/receive')
          .then(function() {
            wx.hideLoading();
            wx.showToast({ title: '交易完成', icon: 'success' });
            self.loadOrderDetail(order.id);
          })
          .catch(function(err) {
            wx.hideLoading();
            wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
          });
      }
    });
  },

  requestRefund: function() {
    // 跳转到售后申请页面
    wx.navigateTo({
      url: `/pages/afterSaleApply/afterSaleApply?orderId=${this.data.order.id}`
    });
  },

  viewAfterSaleDetail: function(e) {
    const afterSaleId = e.currentTarget.dataset.id;
    // 跳转到售后详情页
    wx.navigateTo({
      url: `/pages/afterSaleDetail/afterSaleDetail?afterSaleId=${afterSaleId}`
    });
  },

  cancelOrder: async function() {
    wx.showModal({
      title: '取消订单',
      content: '确定要取消该订单吗？取消后库存将释放',
      confirmColor: '#111111',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });
          try {
            await api.post(`/orders/${this.data.order.id}/cancel`);
            wx.hideLoading();
            wx.showToast({ title: '订单已取消', icon: 'success' });
            this.loadOrderDetail(this.data.order.id);
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  }
});
