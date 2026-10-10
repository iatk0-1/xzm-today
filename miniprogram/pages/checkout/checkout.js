const { getErrorMessage } = require('../../utils/error');
// miniprogram/pages/checkout/checkout.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { buildPurchaseNoticeSections } = require('../../utils/purchaseNotice');

Page({
  data: {
    address: null,
    checkoutItems: [],
    totalPrice: '0.00',
    goodsAmount: '0.00', shippingFee: '0.00', itemQuantity: 0,
    shippingReady: false, shippingLoading: false, shippingError: '',
    shippingAllowed: false, maxQuantity: null, shippingMessage: '',
    orderCreated: false,
    purchaseNoticeAgreed: false,
    purchaseNoticeSections: [],
    purchaseNoticeReady: false,
    purchaseNoticeLoading: false,
    showPurchaseNotice: false,
    submitting: false
  },

  onLoad: async function() {
    try {
      await auth.ensureAuthenticated({ silent: true });
    } catch (err) {
      console.error('结算页认证恢复失败:', err);
      wx.showToast({ title: getErrorMessage(err, '登录状态恢复失败，请稍后重试'), icon: 'none' });
      return;
    }

    // 优先从本地存储获取（立即购买模式），如果没有则从后端获取（购物车结算模式）
    let localItems = wx.getStorageSync('checkoutItems') || [];

    if (localItems && localItems.length > 0) {
      this._localCheckout = true;
      // 立即购买模式，使用本地数据
      await this.loadLocalCheckoutItems(localItems);
    } else {
      // 购物车结算模式，从后端获取选中商品
      await this.loadCartSelectedItems();
    }
  },

  // 加载本地结算商品（立即购买模式）
  loadLocalCheckoutItems: async function(items) {
    let total = 0;
    items.forEach(item => {
      let currentPrice = Number(item.finalPrice || item.price || 0);
      total += (currentPrice * item.count);
    });

    this.setData({
      checkoutItems: items,
      totalPrice: total.toFixed(2)
    });
    this.recalculateGoods();
    await this.refreshShippingQuote();
    await this.loadPurchaseNotices();
  },

  // 从后端获取购物车选中商品
  loadCartSelectedItems: async function() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await api.get('/cart/selected');
      wx.hideLoading();

      const cartItems = res.items || [];

      // 转换后端数据格式到前端格式
      const checkoutItems = cartItems.map(item => ({
        id: item.id,
        productId: item.productId,
        skuId: item.skuId,
        name: item.productName,
        image: item.productImage,
        coverUrl: item.skuImageUrl || item.productImage,  // 优先使用 SKU 图片
        selectedColor: item.color || '默认',
        selectedSize: item.size || '均码',
        price: Number(item.price),
        finalPrice: Number(item.price),
        count: item.count,
        selected: item.selected,
        bundleConfig: item.bundleConfig || null
      }));

      let total = 0;
      checkoutItems.forEach(item => {
        let currentPrice = Number(item.finalPrice || item.price || 0);
        total += (currentPrice * item.count);
      });

      this.setData({
        checkoutItems: checkoutItems,
        totalPrice: total.toFixed(2)
      });
      this.recalculateGoods();
      await this.refreshShippingQuote();
      await this.loadPurchaseNotices();
    } catch (err) {
      wx.hideLoading();
      console.error('加载结算商品失败:', err);
      wx.showToast({ title: getErrorMessage(err, '加载失败'), icon: 'none' });
    }
  },

  // 用最新商品规则，避免本地结算数据或购物车中保存的文案过期。
  loadPurchaseNotices: async function() {
    if (this._noticeLoading) return;
    const items = this.data.checkoutItems || [];
    if (!items.length) return;
    this._noticeLoading = true;
    this.setData({ purchaseNoticeReady: false, purchaseNoticeLoading: true });
    try {
      const ids = [...new Set(items.map(item => String(item.productId || '')))];
      if (ids.some(id => !id)) throw new Error('结算商品缺少商品编号');
      const products = await Promise.all(ids.map(async id => {
        const res = await api.get(`/products/${id}`);
        if (!res || !res.product) throw new Error('购买须知加载失败');
        return res.product;
      }));
      if (items !== this.data.checkoutItems) return;
      this.setData({
        purchaseNoticeSections: buildPurchaseNoticeSections(products),
        purchaseNoticeReady: true
      });
    } catch (err) {
      console.error('加载购买须知失败:', err);
      wx.showToast({ title: getErrorMessage(err, '购买须知加载失败，请点击重试'), icon: 'none' });
    } finally {
      this._noticeLoading = false;
      this.setData({ purchaseNoticeLoading: false });
      if (items !== this.data.checkoutItems && this.data.checkoutItems.length) await this.loadPurchaseNotices();
    }
  },

  togglePurchaseNoticeAgreement: function() {
    if (this.data.submitting) return;
    this.setData({ purchaseNoticeAgreed: !this.data.purchaseNoticeAgreed });
  },

  openPurchaseNotice: async function() {
    if (!this.data.purchaseNoticeReady) await this.loadPurchaseNotices();
    if (this.data.purchaseNoticeReady) this.setData({ showPurchaseNotice: true });
  },

  closePurchaseNotice: function() {
    this.setData({ showPurchaseNotice: false });
  },

  stopPurchaseNoticeTouch: function() {},

  ensurePurchaseNoticeAgreed: function() {
    if (!this.data.purchaseNoticeAgreed) {
      wx.showToast({ title: '请阅读购买须知并勾选', icon: 'none' });
      return false;
    }
    if (!this.data.purchaseNoticeReady) {
      wx.showToast({ title: '请先点击购买须知加载完整内容', icon: 'none' });
      return false;
    }
    return true;
  },

  recalculateGoods: function() {
    let cents = 0, quantity = 0;
    (this.data.checkoutItems || []).forEach(item => {
      cents += Math.round(Number(item.finalPrice != null ? item.finalPrice : item.price || 0) * 100) * Number(item.count);
      quantity += Number(item.count);
    });
    this.setData({ goodsAmount: (cents / 100).toFixed(2), itemQuantity: quantity,
      totalPrice: ((cents + Math.round(Number(this.data.shippingFee || 0) * 100)) / 100).toFixed(2) });
  },

  refreshShippingQuote: async function() {
    const revision = this._quoteRevision = (this._quoteRevision || 0) + 1;
    this.recalculateGoods();
    const { address, itemQuantity } = this.data;
    this.setData({ shippingReady: false, shippingAllowed: false, shippingError: '',
      shippingMessage: '', maxQuantity: null, shippingFee: '0.00', totalPrice: this.data.goodsAmount });
    if (!address || !itemQuantity) { this.setData({ shippingLoading: false }); return; }
    this.setData({ shippingLoading: true });
    try {
      const quote = await api.get('/orders/shipping-quote', { province: address.province, quantity: itemQuantity });
      if (revision !== this._quoteRevision) return;
      const fee = Number(quote.shippingFee);
      if (!Number.isFinite(fee) || fee < 0 || typeof quote.allowed !== 'boolean') throw new Error('运费计算结果无效，请重试');
      this.setData({ shippingFee: fee.toFixed(2), shippingReady: true, shippingAllowed: quote.allowed,
        maxQuantity: quote.maxQuantity, shippingMessage: quote.message || '' });
      this.recalculateGoods();
    } catch (error) {
      if (revision === this._quoteRevision) this.setData({ shippingError: getErrorMessage(error, '运费计算失败，请点击重试') });
    } finally {
      if (revision === this._quoteRevision) this.setData({ shippingLoading: false });
    }
  },

  changeQuantity: async function(event) {
    if (this.data.submitting || this.data.orderCreated) return;
    const index = Number(event.currentTarget.dataset.index), delta = Number(event.currentTarget.dataset.delta);
    const item = this.data.checkoutItems[index];
    if (!item || ![1, -1].includes(delta)) return;
    const count = Number(item.count) + delta;
    if (!Number.isSafeInteger(count) || count < 1 || count > 2147483647) return;
    const items = this.data.checkoutItems.map((entry, i) => i === index ? { ...entry, count } : entry);
    this.setData({ checkoutItems: items });
    this.persistLocalItems();
    await this.refreshShippingQuote();
  },

  removeItem: async function(event) {
    if (this.data.submitting || this.data.orderCreated) return;
    const items = this.data.checkoutItems.filter((_, i) => i !== Number(event.currentTarget.dataset.index));
    this.setData({ checkoutItems: items, purchaseNoticeAgreed: false, purchaseNoticeReady: false, purchaseNoticeSections: [] });
    this.persistLocalItems();
    await this.refreshShippingQuote();
    if (items.length) await this.loadPurchaseNotices();
  },

  persistLocalItems: function() {
    if (this._localCheckout) wx.setStorageSync('checkoutItems', this.data.checkoutItems);
  },

  onUnload: function() { this._quoteRevision = (this._quoteRevision || 0) + 1; },

  // 输入商品备注
  onRemarkInput: function(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value;
    this.setData({
      ['checkoutItems[' + index + '].remark']: value
    });
  },

  // 选择收货地址
  chooseAddress: function() {
    if (this.data.submitting || this.data.orderCreated) return;
    wx.chooseAddress({
      success: (res) => {
        this.setData({
          address: {
            recipient: res.userName,
            phone: res.telNumber,
            province: res.provinceName,
            city: res.cityName,
            district: res.countyName,
            detail: res.detailInfo
          }
        });
        this.refreshShippingQuote();
      },
      fail: (err) => {
        console.error('获取地址失败或取消', err);
      }
    });
  },

  // 提交订单 & 拉起微信支付
  submitOrder: function() {
    return this.submitOrderInternal();
  },

  // 内部提交订单方法
  submitOrderInternal: async function() {
    if (this.data.submitting) return;
    if (this._createdOrderId) { wx.redirectTo({ url: '/pages/orderDetail/orderDetail?id=' + this._createdOrderId }); return; }
    if (!this.ensurePurchaseNoticeAgreed()) return;
    const { address, checkoutItems } = this.data;

    if (!address) {
      wx.showToast({ title: '请先选择收货地址', icon: 'none' });
      return;
    }

    if (!checkoutItems || checkoutItems.length === 0) {
      wx.showToast({ title: '购物车为空', icon: 'none' });
      return;
    }

    if (!this.data.shippingReady || this.data.shippingLoading) {
      wx.showToast({ title: this.data.shippingError || '请等待运费计算完成', icon: 'none' }); return;
    }
    if (!this.data.shippingAllowed) {
      wx.showModal({ title: '收货地址件数限制', content: this.data.shippingMessage, showCancel: false }); return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '创建订单...', mask: true });
    let stage = 'auth';
    let createdOrderId = null;

    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!this.ensurePurchaseNoticeAgreed()) return;

      // 构造后端要求的订单格式（包含 SKU 快照数据）
      const orderItems = checkoutItems.map(item => {
        var orderItem = {
          skuId: item.skuId || 0,
          qty: item.count,
          salePrice: Number(item.finalPrice || item.price),
          pool: 'main',
          // SKU 快照数据（下单时保存，后续不会随商品修改而变化）
          skuSpec: item.selectedColor || '默认',
          skuSize: item.selectedSize || '均码',
          productName: item.name,
          productImage: item.image || item.coverUrl
        };
        if (!this._localCheckout && item.id) orderItem.cartItemId = item.id;
        // 套装商品：传递 bundleConfig
        if (item.bundleConfig && item.bundleConfig.length > 0) {
          orderItem.bundleConfig = item.bundleConfig;
        }
        // 商品备注
        if (item.remark && item.remark.trim()) {
          orderItem.remark = item.remark.trim();
        }
        return orderItem;
      });

      // 构造收货地址
      const orderData = {
        items: orderItems,
        recipientName: address.recipient,
        recipientPhone: address.phone,
        recipientProvince: address.province,
        recipientCity: address.city,
        recipientDistrict: address.district,
        recipientDetail: address.detail,
        expectedShippingFee: this.data.shippingFee
      };

      // 1. 创建订单
      stage = 'create';
      const orderRes = await api.post('/orders', orderData);
      const orderId = orderRes.id;
      createdOrderId = orderId;
      this._createdOrderId = orderId;
      this.setData({ orderCreated: true });
      wx.removeStorageSync('checkoutItems');
      stage = 'payment';

      // 2. 调用微信支付预下单
      if (!this.ensurePurchaseNoticeAgreed()) return;
      wx.showLoading({ title: '准备支付...', mask: true });
      const payRes = await api.post(`/orders/${orderId}/pay/wechat`);

      // 3. 拉起微信支付
      // 后端返回可能是 package (原始 JSON) 或 packageValue (JSON 序列化后)
      const packageValue = payRes.package || payRes.packageValue;
      if (payRes && packageValue) {
        if (!this.ensurePurchaseNoticeAgreed()) return;
        wx.hideLoading();
        await new Promise(resolve => wx.requestPayment({
          timeStamp: payRes.timeStamp.toString(),
          nonceStr: payRes.nonceStr,
          package: packageValue,
          signType: payRes.signType || 'RSA',
          paySign: payRes.paySign,
          success: (successRes) => {
            wx.showToast({ title: '支付成功!', icon: 'success' });
            // 清除本地结算数据
            wx.removeStorageSync('checkoutItems');
            // 后端仅清理实际提交的商品，结算页移除的购物车商品继续保留。
            setTimeout(() => {
              wx.reLaunch({ url: '/pages/index/index' });
            }, 1500);
          },
          fail: (err) => {
            if (err.errMsg === 'requestPayment:fail cancel') {
              wx.showToast({ title: '您手动取消了支付', icon: 'none' });
            } else {
              wx.showModal({
                title: '支付失败',
                content: getErrorMessage(err, '支付未完成，请在订单列表核对支付状态后继续支付'),
                showCancel: false
              });
            }
          },
          complete: resolve
        }));
      } else {
        wx.showModal({
          title: '支付准备失败',
          content: '未能获取支付参数',
          showCancel: false,
          success: () => wx.redirectTo({ url: '/pages/orderDetail/orderDetail?id=' + orderId })
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('订单创建失败:', err);
      if (err && ['SHIPPING_FEE_CHANGED', 'SHIPPING_QUANTITY_EXCEEDED'].includes(err.code)) {
        await this.refreshShippingQuote();
        wx.showModal({ title: err.code === 'SHIPPING_FEE_CHANGED' ? '运费已更新' : '收货地址件数限制',
          content: getErrorMessage(err, '请核对地址、商品和金额后再次提交'), showCancel: false });
        return;
      }
      wx.showModal({
        title: stage === 'payment' ? '支付准备失败' : (stage === 'auth' ? '登录恢复失败' : '订单创建失败'),
        content: getErrorMessage(err, stage === 'payment' ? '订单已创建，请在订单详情继续支付' : '提交结果待确认，请先到订单列表核对，避免重复下单'),
        showCancel: false,
        success: () => {
          if (createdOrderId) wx.redirectTo({ url: '/pages/orderDetail/orderDetail?id=' + createdOrderId });
          else if (stage === 'create' && (!err || !err.statusCode || err.statusCode >= 500)) wx.redirectTo({ url: '/pages/orderList/orderList' });
        }
      });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  }
});
