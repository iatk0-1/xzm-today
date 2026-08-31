// miniprogram/pages/checkout/checkout.js
const api = require('../../utils/api');
const {
  buildSplitOrderData,
  groupCheckoutItems
} = require('../../utils/order-checkout');

function confirmSplitPayment(orderCount) {
  if (orderCount <= 1) return Promise.resolve(true);
  return new Promise(resolve => {
    wx.showModal({
      title: '确认分开结算',
      content: '所选商品将拆成 ' + orderCount + ' 笔订单，并逐笔唤起支付。',
      confirmText: '继续支付',
      success: res => resolve(Boolean(res.confirm)),
      fail: () => resolve(false)
    });
  });
}

function requestWechatPayment(payRes) {
  if (payRes && payRes.paid === true) return Promise.resolve();
  const packageValue = payRes && (payRes.package || payRes.packageValue);
  if (!packageValue) return Promise.reject(new Error('未能获取支付参数'));

  return new Promise((resolve, reject) => {
    wx.requestPayment({
      timeStamp: payRes.timeStamp.toString(),
      nonceStr: payRes.nonceStr,
      package: packageValue,
      signType: payRes.signType || 'RSA',
      paySign: payRes.paySign,
      success: resolve,
      fail: reject
    });
  });
}

Page({
  data: {
    address: null,
    checkoutItems: [],
    checkoutGroups: [],
    orderCount: 0,
    totalPrice: 0,
    submitting: false
  },

  onLoad: async function() {
    // 优先从本地存储获取（立即购买模式），如果没有则从后端获取（购物车结算模式）
    let localItems = wx.getStorageSync('checkoutItems') || [];

    if (localItems && localItems.length > 0) {
      // 立即购买模式，使用本地数据
      this.loadLocalCheckoutItems(localItems);
    } else {
      // 购物车结算模式，从后端获取选中商品
      await this.loadCartSelectedItems();
    }
  },

  // 加载本地结算商品（立即购买模式）
  loadLocalCheckoutItems: function(items) {
    let total = 0;
    items.forEach(item => {
      let currentPrice = Number(item.finalPrice || item.price || 0);
      total += (currentPrice * item.count);
    });

    this.setCheckoutItems(items, total);
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
        merchantId: item.merchantId,
        distributionSellerId: item.distributionSellerId,
        shopCode: item.shopCode,
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
        bundleConfig: item.bundleConfig || null,
        fromCart: true
      }));

      let total = 0;
      checkoutItems.forEach(item => {
        let currentPrice = Number(item.finalPrice || item.price || 0);
        total += (currentPrice * item.count);
      });

      this.setCheckoutItems(checkoutItems, total);
    } catch (err) {
      wx.hideLoading();
      console.error('加载结算商品失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  setCheckoutItems: function(items, total) {
    if (total == null) {
      total = items.reduce(function(sum, item) {
        return sum + Number(item.finalPrice || item.price || 0) * Number(item.count || 0);
      }, 0);
    }
    const groups = groupCheckoutItems(items);
    this.setData({
      checkoutItems: items,
      checkoutGroups: groups,
      orderCount: groups.length,
      totalPrice: Number(total).toFixed(2)
    });
  },

  // 输入商品备注
  onRemarkInput: function(e) {
    const index = e.currentTarget.dataset.sourceIndex;
    const groupIndex = e.currentTarget.dataset.groupIndex;
    const itemIndex = e.currentTarget.dataset.itemIndex;
    const value = e.detail.value;
    this.setData({
      ['checkoutItems[' + index + '].remark']: value,
      ['checkoutGroups[' + groupIndex + '].items[' + itemIndex + '].remark']: value
    });
  },

  // 选择收货地址
  chooseAddress: function() {
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
      },
      fail: (err) => {
        console.error('获取地址失败或取消', err);
      }
    });
  },

  // 提交订单 & 拉起微信支付
  submitOrder: function() {
    if (this.data.submitting) return;
    this.submitOrderInternal();
  },

  removeCreatedCartItems: async function(items) {
    const cartItemIds = Array.from(new Set(items
      .filter(item => item.fromCart && item.id != null)
      .map(item => item.id)));
    await Promise.all(cartItemIds.map(itemId =>
      api.delete('/cart/items/' + itemId).catch(err => {
        console.warn('移除已建单购物车项失败:', itemId, err);
      })
    ));
  },

  persistUncreatedItems: function(splitOrders, createdCount) {
    const remainingItems = splitOrders.slice(createdCount).reduce(function(items, group) {
      return items.concat(group.items.map(function(item) {
        const copy = Object.assign({}, item);
        delete copy.sourceIndex;
        return copy;
      }));
    }, []);
    if (remainingItems.length > 0) {
      wx.setStorageSync('checkoutItems', remainingItems);
    } else {
      wx.removeStorageSync('checkoutItems');
    }
    return remainingItems;
  },

  openPendingOrders: function() {
    wx.redirectTo({ url: '/pages/orderList/orderList?status=pay' });
  },

  // 内部提交订单方法
  submitOrderInternal: async function() {
    const { address, checkoutItems } = this.data;

    if (!address) {
      wx.showToast({ title: '请先选择收货地址', icon: 'none' });
      return;
    }

    if (!checkoutItems || checkoutItems.length === 0) {
      wx.showToast({ title: '购物车为空', icon: 'none' });
      return;
    }

    let splitOrders;
    try {
      splitOrders = buildSplitOrderData(checkoutItems, address);
    } catch (err) {
      wx.showToast({ title: err.message || '结算数据无效', icon: 'none' });
      return;
    }

    if (!await confirmSplitPayment(splitOrders.length)) return;

    this.setData({ submitting: true });
    const createdOrders = [];
    try {
      for (let index = 0; index < splitOrders.length; index++) {
        wx.showLoading({ title: '创建订单 ' + (index + 1) + '/' + splitOrders.length });
        const group = splitOrders[index];
        const orderRes = await api.post('/orders', group.orderData);
        if (!orderRes || orderRes.id == null) {
          throw new Error('创建订单未返回订单编号');
        }
        createdOrders.push({ id: orderRes.id, group: group });
        await this.removeCreatedCartItems(group.items);
        this.persistUncreatedItems(splitOrders, createdOrders.length);
      }
    } catch (err) {
      wx.hideLoading();
      const remainingItems = this.persistUncreatedItems(splitOrders, createdOrders.length);
      this.setCheckoutItems(remainingItems);
      this.setData({ submitting: false });
      console.error('拆单创建失败:', err);
      const hasCreatedOrder = createdOrders.length > 0;
      wx.showModal({
        title: hasCreatedOrder ? '部分订单创建失败' : '订单创建失败',
        content: hasCreatedOrder
          ? '已创建 ' + createdOrders.length + ' 笔，剩余商品仍在购物车。已创建订单可到订单列表继续支付。'
          : (err.message || '请稍后重试，商品仍在购物车。'),
        confirmText: hasCreatedOrder ? '查看订单' : '知道了',
        showCancel: hasCreatedOrder,
        cancelText: '继续结算',
        success: res => { if (res.confirm && hasCreatedOrder) this.openPendingOrders(); }
      });
      return;
    }

    let paidCount = 0;
    try {
      for (let index = 0; index < createdOrders.length; index++) {
        wx.showLoading({ title: '准备支付 ' + (index + 1) + '/' + createdOrders.length });
        const orderId = createdOrders[index].id;
        const payRes = await api.post('/orders/' + orderId + '/pay/wechat');
        wx.hideLoading();
        await requestWechatPayment(payRes);
        paidCount++;
      }
      wx.showToast({ title: '支付成功', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1200);
    } catch (err) {
      wx.hideLoading();
      const cancelled = err && err.errMsg === 'requestPayment:fail cancel';
      console.error(cancelled ? '用户取消支付:' : '支付失败:', err);
      wx.showModal({
        title: cancelled ? '支付已取消' : '支付未完成',
        content: '已支付 ' + paidCount + ' 笔，其余订单已保存，可在订单列表继续支付。',
        showCancel: false,
        confirmText: '查看订单',
        success: () => this.openPendingOrders()
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
