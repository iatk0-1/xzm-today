const { clearCheckoutDrafts } = require('../../utils/skuSelectionDraft');
const { getErrorMessage } = require('../../utils/error');
const api = require('../../utils/api');
const promotionDisplay = require('../../utils/skuPromotionDisplay');
const paymentTimeout = require('../../utils/orderPaymentTimeout');
const { readyStockPrompt } = require('../../utils/readyStockPrompt');
const auth = require('../../utils/auth');
const customerServiceNavigation = require('../../utils/customerServiceNavigation');
const { buildPurchaseNoticeSections } = require('../../utils/purchaseNotice');

Page({
  data: {
    address: null,
    checkoutItems: [],
    checkoutDisplayItems: [],
    totalPrice: '0.00',
    goodsAmount: '0.00', shippingFee: '0.00', itemQuantity: 0,
    originalGoodsAmount: '0.00', discountAmount: '0.00', promotionRows: [], goodsQuoteReady: false,
    promotionExpanded: false,
    shippingReady: false, shippingLoading: false, shippingError: '',
    shippingAllowed: false, showShippingTip: false,
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

    // SKU 购买和购物车都可能通过本地传入商品，来源决定是否首次匹配现货。
    let localItems = wx.getStorageSync('checkoutItems') || [];

    if (localItems && localItems.length > 0) {
      const fromCart = wx.getStorageSync('checkoutSource') === 'cart'
        || localItems.every(item => item.id && !item.skuSelectionDraft);
      this._localCheckout = !fromCart;
      // 使用入口传入的结算商品。
      await this.loadLocalCheckoutItems(localItems);
    } else {
      // 购物车结算模式，从后端获取选中商品
      await this.loadCartSelectedItems();
    }
  },

  loadLocalCheckoutItems: async function(items) {
    this.initializeCheckoutReadyStock(items, this._localCheckout === false);
    this.setData({ checkoutItems: items });
    this.recalculateGoods();
    await this.refreshShippingQuote();
    await this.loadPurchaseNotices();
  },

  // 从后端获取购物车选中商品
  loadCartSelectedItems: async function() {
    this._localCheckout = false;
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await api.get('/cart/selected');
      wx.hideLoading();

      const cartItems = res.items || [];

      const checkoutItems = cartItems.map(item => ({
        id: item.id,
        productId: item.productId,
        skuId: item.skuId,
        name: item.productName,
        image: item.productImage,
        coverUrl: item.skuImageUrl || item.productImage,
        selectedColor: item.color || '默认',
        selectedSize: item.size || '均码',
        price: Number(item.price),
        finalPrice: Number(item.price),
        count: item.count,
        selected: item.selected,
        bundleConfig: item.bundleConfig || null
      }));
      this.initializeCheckoutReadyStock(checkoutItems, true);

      this.setData({ checkoutItems });
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

  initializeCheckoutReadyStock: function(items, fromCart) {
    this._matchReadyStockOnLoad = fromCart;
    if (fromCart) { this._checkoutReadyStock = null;return; }
    const knownQuantity = (value, quantity) => Number.isInteger(value) && value >= 0 && value <= quantity ? value : null;
    this._checkoutReadyStock = items.flatMap((item, requestIndex) => {
      const count = Number(item.count);
      if (item.bundleConfig && item.bundleConfig.length) return item.bundleConfig.map(sub => {
        const quantity = Number(sub.count == null ? 1 : sub.count) * count;
        return { requestIndex, skuId: sub.skuId, quantity, readyStockQty: knownQuantity(sub.readyStockQty, quantity) };
      });
      return [{ requestIndex, skuId: item.skuId, quantity: count, readyStockQty: knownQuantity(item.readyStockQty, count) }];
    });
  },

  recalculateGoods: function() {
    let cents = 0, quantity = 0;
    (this.data.checkoutItems || []).forEach(item => {
      cents += Math.round(Number(item.finalPrice != null ? item.finalPrice : item.price || 0) * 100) * Number(item.count);
      quantity += Number(item.count);
    });
    const quote = this._checkoutQuote;
    const amounts = quote ? promotionDisplay.amountSummary(quote, cents) : {
      originalGoodsAmount: (cents / 100).toFixed(2), goodsAmount: (cents / 100).toFixed(2), discountAmount: '0.00', promotionRows: [] };
    const checkoutDisplayItems = promotionDisplay.checkoutItemPrices(this.data.checkoutItems || [], quote, this._checkoutReadyStock);
    this.setData({ ...amounts, checkoutDisplayItems, itemQuantity: quantity,
      totalPrice: ((Math.round(Number(amounts.goodsAmount) * 100) + Math.round(Number(this.data.shippingFee || 0) * 100)) / 100).toFixed(2) });
  },

  buildQuoteItems: function() {
    return (this.data.checkoutItems || []).map(item => ({ skuId: item.skuId, qty: item.count,
      salePrice: Number(item.finalPrice != null ? item.finalPrice : item.price), pool: 'main',
      ...(item.bundleConfig && item.bundleConfig.length ? { bundleConfig: item.bundleConfig } : {}) }));
  },

  buildReadyStockExpectation: function() {
    const lines = this._checkoutReadyStock === undefined ? this._checkoutQuote && this._checkoutQuote.items : this._checkoutReadyStock;
    if (!Array.isArray(lines) || !lines.length) return null;
    const totals = new Map();
    for (const line of lines) {
      if (!line || !line.skuId || !Number.isInteger(line.readyStockQty) || line.readyStockQty < 0) return null;
      const key = String(line.skuId);
      totals.set(key, (totals.get(key) || 0) + line.readyStockQty);
    }
    return Array.from(totals, ([skuId, readyStockQty]) => ({ skuId, readyStockQty }));
  },

  updateReadyStockQuote: function(current) {
    if (!this._checkoutQuote || !Array.isArray(this._checkoutQuote.items)) return;
    const remaining = new Map(current.map(line => [String(line.skuId), line.readyStockQty]));
    const items = this._checkoutQuote.items.map(line => {
      const key = String(line.skuId);
      if (!remaining.has(key)) return line;
      const readyStockQty = Math.min(Number(line.quantity), remaining.get(key));
      remaining.set(key, remaining.get(key) - readyStockQty);
      return { ...line, readyStockQty };
    });
    this._checkoutReadyStock = items.map(({ requestIndex, skuId, quantity, readyStockQty }) => ({ requestIndex, skuId, quantity, readyStockQty }));
    this.recalculateGoods();
  },

  createOrderWithReadyStockConfirmation: async function(orderData) {
    const expected = this.buildReadyStockExpectation();
    if (expected) orderData.expectedReadyStock = expected;
    while (!this._checkoutClosed) {
      try {
        return await api.post('/orders', orderData);
      } catch (error) {
        if (!error || error.code !== 'READY_STOCK_CHANGED') throw error;
        const details = error.details || {};
        const shortages = details.shortages;
        const current = details.currentReadyStock;
        if (!Array.isArray(shortages) || !shortages.length || !Array.isArray(current) || !current.length
            || current.some(line => !line || !line.skuId || !Number.isInteger(line.readyStockQty) || line.readyStockQty < 0))
          throw new Error('现货核对结果无效，请刷新结算页面后重试');
        this.updateReadyStockQuote(current);
        if (this._checkoutClosed) return null;
        wx.hideLoading();
        const confirmed = await new Promise(resolve => wx.showModal({
          ...readyStockPrompt(shortages),
          success: result => resolve(!!result.confirm), fail: () => resolve(false)
        }));
        if (!confirmed || this._checkoutClosed) return null;
        // 确认新件数后重新提交，服务端再次检查并在同一事务内锁定现货。
        orderData.expectedReadyStock = current;
        wx.showLoading({ title: '创建订单...', mask: true });
      }
    }
    return null;
  },

  refreshShippingQuote: async function(options = {}) {
    const revision = this._quoteRevision = (this._quoteRevision || 0) + 1;
    const refreshGoods = options.refreshGoods || !this._checkoutQuote;
    if (refreshGoods) this._checkoutQuote = null;
    this.recalculateGoods();
    const { address, itemQuantity } = this.data;
    this.setData({ shippingReady: false, shippingAllowed: false, shippingError: '', goodsQuoteReady: !refreshGoods, promotionExpanded: false,
      shippingFee: '0.00', totalPrice: this.data.goodsAmount });
    if (!itemQuantity) { this.setData({ shippingLoading: false }); return; }
    this.setData({ shippingLoading: true });
    try {
      let shipping = null;
      if (address) {
        shipping = await api.get('/orders/shipping-quote', { province: address.province, quantity: itemQuantity });
        if (revision !== this._quoteRevision) return;
        if (!Number.isFinite(Number(shipping.shippingFee)) || Number(shipping.shippingFee) < 0 || typeof shipping.allowed !== 'boolean')
          throw new Error('运费计算结果无效，请重试');
      }
      let quote = this._checkoutQuote;
      if (refreshGoods) {
        const matchReadyStock = this._matchReadyStockOnLoad === true;
        // 初次加载期间选地址，也复用同一笔商品报价，避免重复匹配现货。
        const request = this._goodsQuoteRequest || api.post('/orders/goods-quote', {
          items: this.buildQuoteItems(), includeReadyStock: matchReadyStock
        });
        this._goodsQuoteRequest = request;
        try { quote = await request; }
        catch (error) { if (this._goodsQuoteRequest === request) this._goodsQuoteRequest = null;throw error; }
        if (revision !== this._quoteRevision) return;
        if (this._goodsQuoteRequest === request) this._goodsQuoteRequest = null;
        let snapshot = this._checkoutReadyStock;
        if (matchReadyStock) {
          if (!quote || !Array.isArray(quote.items) || !quote.items.length || quote.items.some(line => !line || !line.skuId || !Number.isInteger(line.readyStockQty) || line.readyStockQty < 0 || line.readyStockQty > line.quantity))
            throw new Error('购物车现货匹配失败，请重试');
          snapshot = quote.items.map(({ requestIndex, skuId, quantity, readyStockQty }) => ({ requestIndex, skuId, quantity, readyStockQty }));
        }
        // 校验完整报价后才保存；失败重试仍需完成购物车的首次现货匹配。
        promotionDisplay.amountSummary(quote, Math.round(Number(this.data.originalGoodsAmount) * 100));
        const displayItems = promotionDisplay.checkoutItemPrices(this.data.checkoutItems, quote, snapshot);
        if (matchReadyStock && displayItems.some(item => item.readyStockQty == null || item.bundleConfig && item.bundleConfig.some(sub => sub.readyStockQty == null)))
          throw new Error('购物车现货匹配失败，请重试');
        this._checkoutQuote = quote;
        this._checkoutReadyStock = snapshot;
        this._matchReadyStockOnLoad = false;
        this.recalculateGoods();
      }
      const fee = Number(shipping && shipping.shippingFee || 0);
      if (!Number.isFinite(fee) || fee < 0) throw new Error('运费计算结果无效，请重试');
      this.setData({ goodsQuoteReady: true, shippingFee: fee.toFixed(2), shippingReady: !!address,
        shippingAllowed: !!(shipping && shipping.allowed), totalPrice: ((Math.round(Number(quote.goodsAmount) * 100) + Math.round(fee * 100)) / 100).toFixed(2) });
    } catch (error) {
      if (revision === this._quoteRevision) this.setData({ shippingError: getErrorMessage(error, '运费计算失败，请点击重试') });
    } finally {
      if (revision === this._quoteRevision) this.setData({ shippingLoading: false });
    }
  },

  togglePromotionDetails: function() {
    if (this.data.goodsQuoteReady) this.setData({ promotionExpanded: !this.data.promotionExpanded });
  },
  toggleShippingTip: function() { this.setData({ showShippingTip: !this.data.showShippingTip }); },
  closeShippingTip: function() { if (this.data.showShippingTip) this.setData({ showShippingTip: false }); },
  stopShippingTipTap: function() {},
  handleCustomerServiceContact: function(e) { customerServiceNavigation.openFromContact(e); },

  onUnload: function() { this._checkoutClosed = true; this._quoteRevision = (this._quoteRevision || 0) + 1; },

  // 输入商品备注
  onRemarkInput: function(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value;
    this.setData({
      ['checkoutItems[' + index + '].remark']: value,
      ['checkoutDisplayItems[' + index + '].remark']: value
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

  submitOrder: function() {
    return this.submitOrderInternal();
  },

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

    if (!this.data.shippingReady || !this.data.goodsQuoteReady || this.data.shippingLoading) {
      wx.showToast({ title: this.data.shippingError || '请等待运费计算完成', icon: 'none' }); return;
    }
    if (!this.data.shippingAllowed) {
      wx.showToast({ title: '请重新计算运费后提交', icon: 'none' }); return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '创建订单...', mask: true });
    let stage = 'auth';
    let createdOrderId = null;

    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!this.ensurePurchaseNoticeAgreed()) return;

      const orderItems = checkoutItems.map(item => {
        var orderItem = {
          skuId: item.skuId || 0,
          qty: item.count,
          salePrice: Number(item.finalPrice || item.price),
          pool: 'main',
          skuSpec: item.selectedColor || '默认',
          skuSize: item.selectedSize || '均码',
          productName: item.name,
          productImage: item.image || item.coverUrl
        };
        if (!this._localCheckout && item.id) orderItem.cartItemId = item.id;
        if (item.bundleConfig && item.bundleConfig.length > 0) {
          orderItem.bundleConfig = item.bundleConfig;
        }
        if (item.remark && item.remark.trim()) {
          orderItem.remark = item.remark.trim();
        }
        return orderItem;
      });

      const orderData = {
        items: orderItems,
        recipientName: address.recipient,
        recipientPhone: address.phone,
        recipientProvince: address.province,
        recipientCity: address.city,
        recipientDistrict: address.district,
        recipientDetail: address.detail,
        expectedShippingFee: this.data.shippingFee,
        expectedPayAmount: this.data.totalPrice
      };

      // 1. 创建订单
      stage = 'create';
      const orderRes = await this.createOrderWithReadyStockConfirmation(orderData);
      if (!orderRes) return;
      const orderId = orderRes.id;
      createdOrderId = orderId;
      this._createdOrderId = orderId;
      clearCheckoutDrafts(checkoutItems);
      this.setData({ orderCreated: true });
      wx.removeStorageSync('checkoutItems');
      wx.removeStorageSync('checkoutSource');
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
              wx.showModal({ title: '支付已取消', content: paymentTimeout.cancelPaymentMessage(orderRes), showCancel: false });
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
      if (err && err.code === 'SHIPPING_FEE_CHANGED') {
        await this.refreshShippingQuote();
        wx.showModal({ title: '运费已更新',
          content: getErrorMessage(err, '请核对地址、商品和金额后再次提交'), showCancel: false });
        return;
      }
      if (err && err.statusCode === 409 && stage === 'create' && !createdOrderId) {
        await this.refreshShippingQuote({ refreshGoods: true });
        wx.showModal({ title: '订单金额或状态已更新', content: getErrorMessage(err, '请核对最新金额后再次提交'), showCancel: false });return;
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
