// miniprogram/pages/checkout/checkout.js
const api = require('../../utils/api');

Page({
  data: {
    address: null,
    checkoutItems: [],
    totalPrice: 0
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

    this.setData({
      checkoutItems: items,
      totalPrice: total.toFixed(2)
    });
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
        coverUrl: item.productImage,
        selectedColor: item.color || '默认',
        selectedSize: item.size || '均码',
        price: Number(item.price),
        finalPrice: Number(item.price),
        count: item.count,
        selected: item.selected
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
    } catch (err) {
      wx.hideLoading();
      console.error('加载结算商品失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
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
  submitOrder: async function() {
    const { address, checkoutItems, totalPrice } = this.data;

    if (!address) {
      wx.showToast({ title: '请先选择收货地址', icon: 'none' });
      return;
    }

    if (!checkoutItems || checkoutItems.length === 0) {
      wx.showToast({ title: '购物车为空', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '创建订单...' });

    try {
      // 构造后端要求的订单格式（包含 SKU 快照数据）
      const orderItems = checkoutItems.map(item => {
        return {
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
      });

      // 构造收货地址
      const orderData = {
        items: orderItems,
        recipientName: address.recipient,
        recipientPhone: address.phone,
        recipientProvince: address.province,
        recipientCity: address.city,
        recipientDistrict: address.district,
        recipientDetail: address.detail
      };

      // 1. 创建订单
      const orderRes = await api.post('/orders', orderData);
      const orderId = orderRes.id;

      // 2. 调用微信支付预下单
      wx.showLoading({ title: '准备支付...' });
      const payRes = await api.post(`/orders/${orderId}/pay/wechat`);

      // 3. 拉起微信支付
      // 后端返回可能是 package (原始 JSON) 或 packageValue (JSON 序列化后)
      const packageValue = payRes.package || payRes.packageValue;
      if (payRes && packageValue) {
        wx.requestPayment({
          timeStamp: payRes.timeStamp.toString(),
          nonceStr: payRes.nonceStr,
          package: packageValue,
          signType: payRes.signType || 'RSA',
          paySign: payRes.paySign,
          success: (successRes) => {
            wx.showToast({ title: '支付成功!', icon: 'success' });
            // 清除本地结算数据
            wx.removeStorageSync('checkoutItems');
            // 清除购物车选中商品
            api.delete('/cart/selected').catch(() => {});
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
                content: err.errMsg,
                showCancel: false
              });
            }
          }
        });
      } else {
        wx.showModal({
          title: '支付准备失败',
          content: '未能获取支付参数',
          showCancel: false
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('订单创建失败:', err);
      wx.showModal({
        title: '订单创建失败',
        content: typeof err === 'object' ? JSON.stringify(err) : String(err),
        showCancel: false
      });
    }
  }
});
