// miniprogram/pages/orderDetail/orderDetail.js
const api = require('../../utils/api');

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
    if (options.id) {
      this.loadOrderDetail(options.id);
    } else {
      wx.showToast({ title: '订单参数丢失', icon: 'none' });
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
      this.setData({ order: res, isLoading: false });

      // 加载售后记录
      this.loadAfterSaleRecords(orderId);

      // 如果是已发货或发货中订单，加载物流信息（支持分批发货）
      if (res.status === 'shipped' || res.status === 'paid') {
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
      // 获取订单维度的发货单列表（只包含当前订单的商品）
      const shipments = await api.get(`/orders/${orderId}/shipments/detail`);
      if (shipments && shipments.length > 0) {
        this.setData({ shipments });

        // 获取所有发货单的物流轨迹
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
        // 将物流轨迹按 shipmentId 映射，方便查找
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

  // 查看单个发货单的物流轨迹
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
    wx.setClipboardData({
      data: String(this.data.order.id),
      success: () => {
        wx.showToast({ title: '单号已复制', icon: 'success' });
      }
    });
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
    wx.showModal({
      title: '确认收货',
      content: '确认已收到商品？',
      confirmColor: '#111111',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });
          try {
            await api.post(`/orders/${this.data.order.id}/receive`);
            wx.hideLoading();
            wx.showToast({ title: '交易完成', icon: 'success' });
            this.loadOrderDetail(this.data.order.id);
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
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
