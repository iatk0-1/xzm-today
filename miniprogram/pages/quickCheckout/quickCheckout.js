const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { getErrorMessage } = require('../../utils/error');
const subscriptions = require('../../utils/quickOrder');

Page({
  data: { loading: true, error: '', product: null, address: null, shippingFee: '', shippingReady: false,
    shippingLoading: false, shippingError: '', submitting: false, subscription: null },
  async onLoad(options) {
    this._token = options.token;
    if (wx.hideShareMenu) wx.hideShareMenu();
    await this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const product = await api.post('/quick-orders/' + encodeURIComponent(this._token || '') + '/claim');
      if (product.available === false) throw new Error(product.message || '商品暂未就绪，请稍后重试');
      await subscriptions.flushSubscriptions(api, wx);
      if (product.orderId && !product.preview) { wx.redirectTo({ url: '/pages/orderDetail/orderDetail?id=' + product.orderId }); return; }
      this.setData({ product, subscription: product.subscription, loading: false });
    } catch (error) { this.setData({ loading: false, error: getErrorMessage(error, '链接暂不可用，请稍后重试') }); }
  },
  chooseAddress() {
    if (this.data.submitting) return;
    wx.chooseAddress({ success: address => {
      this.setData({ address });
      this.refreshShipping();
    } });
  },
  async refreshShipping() {
    if (!this.data.address) return;
    const version = this._shippingVersion = (this._shippingVersion || 0) + 1;
    this.setData({ shippingReady: false, shippingLoading: true, shippingError: '' });
    try {
      const quote = await api.get('/orders/shipping-quote', { province: this.data.address.provinceName, quantity: 1 });
      if (version !== this._shippingVersion) return;
      if (!quote.allowed || !Number.isFinite(Number(quote.shippingFee)) || Number(quote.shippingFee) < 0) throw new Error(quote.message || '该地址暂不支持配送');
      this.setData({ shippingFee: Number(quote.shippingFee).toFixed(2), shippingReady: true });
    } catch (error) { if (version === this._shippingVersion) this.setData({ shippingError: getErrorMessage(error, '运费计算失败，请重试') }); }
    finally { if (version === this._shippingVersion) this.setData({ shippingLoading: false }); }
  },
  previewImage(e) { wx.previewImage({ current: e.currentTarget.dataset.url, urls: this.data.product.images || [this.data.product.coverUrl] }); },
  submit() {
    if (this.data.submitting || this.data.product && this.data.product.preview) return;
    if (!this.data.address || !this.data.shippingReady || this.data.shippingLoading) {
      wx.showToast({ title: this.data.address ? '请先确认运费' : '请选择收货地址', icon: 'none' }); return;
    }
    // 必须在点击调用栈内申请；是否同意订阅不影响零付款下单。
    const subscription = Number(this.data.shippingFee) === 0
      ? subscriptions.requestShippingSubscription(wx, this.data.subscription) : Promise.resolve(null);
    this.finishOrder(subscription);
  },
  async finishOrder(subscription) {
    this.setData({ submitting: true });
    let orderId;
    try {
      const grant = await subscription;
      const address = this.data.address;
      const order = await api.post('/quick-orders/' + this._token + '/orders', {
        recipientName: address.userName, recipientPhone: address.telNumber, recipientProvince: address.provinceName,
        recipientCity: address.cityName, recipientDistrict: address.countyName, recipientDetail: address.detailInfo,
        expectedShippingFee: this.data.shippingFee
      });
      orderId = order.id;
      await subscriptions.saveSubscription(api, wx, orderId, grant);
      if (order.requiresPayment) {
        const payment = await api.post('/orders/' + orderId + '/pay/wechat');
        if (!payment.paid) {
          const packageValue = payment.package || payment.packageValue;
          if (!packageValue) throw new Error('未能获取运费支付参数，请在订单中继续支付');
          await new Promise((resolve, reject) => wx.requestPayment({ timeStamp: String(payment.timeStamp),
            nonceStr: payment.nonceStr, package: packageValue, signType: payment.signType || 'RSA', paySign: payment.paySign,
            success: resolve, fail: reject }));
        }
      } else wx.showToast({ title: '下单成功', icon: 'success' });
      wx.redirectTo({ url: '/pages/orderDetail/orderDetail?id=' + orderId });
    } catch (error) {
      wx.showModal({ title: orderId ? '请核对订单状态' : '下单未完成', content: getErrorMessage(error, orderId ? '运费支付未完成，请进入订单继续处理' : '请重新核对运费后重试'),
        showCancel: false, success: () => { if (orderId) wx.redirectTo({ url: '/pages/orderDetail/orderDetail?id=' + orderId }); } });
      if (!orderId) this.refreshShipping();
    } finally { this.setData({ submitting: false }); }
  }
});
