const db = wx.cloud.database();

Page({
  data: {
    address: null,       // 用来装微信返回的收货地址
    checkoutItems: [],   // 从购物车传过来的商品
    totalPrice: 0        // 订单总价
  },

  onLoad: function() {
    let items = wx.getStorageSync('checkoutItems') || [];
    
    // 🚀 修复：像购物车那样，优先读取 finalPrice 并强制转换为数字
    let total = 0;
    items.forEach(item => {
      let currentPrice = Number(item.finalPrice || item.price || 0);
      total += (currentPrice * item.count);
    });

    this.setData({
      checkoutItems: items,
      totalPrice: total.toFixed(2) // 保留两位小数
    });
  },

  // ====== 核心魔法：一键呼出微信收货地址 ======
  chooseAddress: function() {
    wx.chooseAddress({
      success: (res) => {
        // 用户同意并选择了地址，存进我们的 data 里
        this.setData({
          address: {
            userName: res.userName,
            telNumber: res.telNumber,
            detailInfo: res.provinceName + res.cityName + res.countyName + res.detailInfo
          }
        });
      },
      fail: (err) => {
        console.error('获取地址失败或取消', err);
      }
    });
  },

  // ====== 终极提交订单 & 拉起微信支付 ======
  submitOrder: function() {
    const { address, checkoutItems, totalPrice } = this.data;

    if (!address) {
      wx.showToast({ title: '请先选择收货地址', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '正在呼叫微信支付...' });

    // 1. 先把订单写进我们的云端总账本
    db.collection('orders').add({
      data: {
        items: checkoutItems,
        address: address,
        totalPrice: totalPrice,
        status: '待付款', 
        createTime: db.serverDate()
      },
      success: res => {
        const orderId = res._id; 
        
        // 微信支付的金额单位是“分”，所以要把你的 159.00 乘以 100 变成 15900
        const totalFeeCents = parseInt(parseFloat(totalPrice) * 100);

        // 2. 呼叫我们刚才写好的云端收银员
        wx.cloud.callFunction({
          name: 'payOrder',
          data: {
            outTradeNo: 'an' + Date.now() + Math.floor(Math.random() * 1000),
            totalFee: totalFeeCents
          },
          success: payRes => {
            wx.hideLoading();
            console.log('云端收银员返回的数据:', payRes); // 内部测试用

            const result = payRes.result;
            
            // 拦截点 1：如果云端根本没生成支付参数（通常是因为商户号没授权完成）
            if (!result || !result.payment) {
               wx.showModal({
                 title: '云端下单失败',
                 content: result ? (result.returnMsg || result.errCodeDes || '未知错误') : '未能获取支付参数',
                 showCancel: false
               });
               return;
            }

            const payment = result.payment;
            
            // 3. 见证奇迹的时刻：真正在手机底部拉起密码键盘！
            wx.requestPayment({
              ...payment,
              success: (successRes) => {
                wx.showToast({ title: '支付成功！', icon: 'success' });
                db.collection('orders').doc(orderId).update({ data: { status: '待发货' } });
                wx.removeStorageSync('cart');
                wx.removeStorageSync('checkoutItems');
                setTimeout(() => { wx.switchTab({ url: '/pages/index/index' }); }, 1500);
              },
              fail: (err) => {
                // 拦截点 2：把真正的报错原因弹到你的手机屏幕上！
                if (err.errMsg === 'requestPayment:fail cancel') {
                  wx.showToast({ title: '您手动取消了支付', icon: 'none' });
                } else {
                  // 如果不是手动取消，绝对是底层参数报错，立刻弹窗显示！
                  wx.showModal({
                    title: '支付唤起失败',
                    content: err.errMsg,
                    showCancel: false
                  });
                }
              }
            })
          },
          fail: err => {
            wx.hideLoading();
            wx.showModal({ title: '网络呼叫失败', content: err.toString(), showCancel: false });
          }
        })
      },
      fail: err => {
        wx.hideLoading();
        wx.showToast({ title: '订单生成失败', icon: 'none' });
      }
    });
  }
  
})