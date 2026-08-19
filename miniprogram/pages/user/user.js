// miniprogram/pages/user/user.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const config = require('../../utils/config');

Page({
  data: {
    isAdmin: false,
    navTop: 0,
    navHeight: 0,
    userInfo: null,
    avatarUrl: null,
    phone: null,
    isPhoneBound: false,
    phoneBinding: false // 手机号绑定中状态，防止重复点击
  },

  onLoad: function() {
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    this.setData({
      navTop: menuButtonInfo.top,
      navHeight: menuButtonInfo.height
    });
    this.checkAdmin();
    this.loadUserInfo();
  },

  onShow: function() {
    // 每次显示页面时检查管理员状态
    this.checkAdmin();
    this.loadUserInfo();
  },

  // 加载用户信息
  loadUserInfo: function() {
    // 从 storage 重新读取最新用户信息
    const userInfo = auth.getUserInfo();
    if (userInfo) {
      this.setData({
        userInfo: userInfo,
        avatarUrl: userInfo.avatarUrl || null,
        phone: userInfo.phone || null,
        isPhoneBound: userInfo.isPhoneBound || false
      });
    } else {
      // 如果没有本地缓存，从后端获取
      this.refreshUserInfoFromServer();
    }
  },

  // 从后端刷新用户信息
  refreshUserInfoFromServer: async function() {
    try {
      const res = await api.get('/users/me');
      const userInfo = auth.getUserInfo();
      if (userInfo) {
        userInfo.phone = res.phone;
        userInfo.isPhoneBound = res.isPhoneBound;
        userInfo.nickname = res.nickname;
        userInfo.avatarUrl = res.avatarUrl;
        wx.setStorageSync(config.USER_INFO_KEY, userInfo);
        this.setData({
          userInfo: userInfo,
          avatarUrl: res.avatarUrl || null,
          phone: res.phone || null,
          isPhoneBound: res.isPhoneBound || false
        });
      }
    } catch (err) {
      console.error('刷新用户信息失败:', err);
    }
  },

  // 检查是否为主理人
  checkAdmin: function() {
    if (auth.isAdmin()) {
      this.setData({ isAdmin: true });
    } else {
      this.setData({ isAdmin: false });
    }
  },

  // 跳转到编辑资料页面
  goToEditProfile: function() {
    wx.navigateTo({
      url: '/pages/editProfile/editProfile'
    });
  },

  // 请求手机号授权（已绑定用户点击）
  requestPhoneAuth: function() {
    wx.showModal({
      title: '手机号已绑定',
      content: `当前绑定的手机号为：${this.data.phone}，如需修改请联系客服`,
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#000'
    });
  },

  // 阻止事件冒泡
  stopPropagation: function() {
    // 空函数，仅用于阻止事件冒泡
  },

  // 获取手机号（微信官方回调）
  onGetPhoneNumber: async function(e) {
    const errMsg = e.detail.errMsg || '';

    // ── 用户取消或拒绝授权 ──
    if (errMsg !== 'getPhoneNumber:ok') {
      this.setData({ phoneBinding: false });

      // 区分不同的失败原因，给予针对性引导
      if (errMsg.includes('fail user deny') || errMsg.includes('fail cancel')) {
        // 用户主动点击了"拒绝"
        wx.showModal({
          title: '需授权手机号',
          content: '您拒绝了手机号授权。微信有短暂的冷却时间，请稍候几秒后重试；或前往「设置」手动开启授权。',
          confirmText: '前往设置',
          cancelText: '稍后重试',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          }
        });
      } else if (errMsg.includes('too frequently')) {
        // 微信频率限制 —— 上一个请求的 resolve() 未被正确调用时会触发
        wx.showModal({
          title: '操作过于频繁',
          content: '由于微信平台限制，请稍候 10 秒后再点击授权按钮。',
          showCancel: false,
          confirmText: '知道了'
        });
      } else if (errMsg.includes('privacy permission is not authorized')) {
        // 隐私协议未授权
        wx.showModal({
          title: '需同意隐私协议',
          content: '请先同意隐私协议后才能获取手机号。请前往设置开启。',
          confirmText: '前往设置',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          }
        });
      } else {
        // 其他未知错误
        wx.showToast({ title: '授权失败，请稍后重试', icon: 'none', duration: 3000 });
      }
      return;
    }

    // ── 授权成功，开始绑定 ──
    this.setData({ phoneBinding: true });

    const { code } = e.detail;
    wx.showLoading({ title: '绑定中...', mask: true });

    try {
      const res = await api.post('/users/me/phone/bind', {
        code: code
      });

      wx.hideLoading();

      // 更新本地用户信息
      const userInfo = auth.getUserInfo();
      if (userInfo) {
        userInfo.phone = res.phone;
        userInfo.isPhoneBound = true;
        wx.setStorageSync(config.USER_INFO_KEY, userInfo);
      }

      this.setData({
        phone: res.phone,
        isPhoneBound: true,
        phoneBinding: false
      });

      wx.showToast({ title: '绑定成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.setData({ phoneBinding: false });
      console.error('绑定手机号失败:', err);

      // 后端返回的错误（如手机号已被绑定等）
      wx.showModal({
        title: '绑定失败',
        content: auth.getPhoneBindErrorMessage(err),
        showCancel: false,
        confirmText: '知道了'
      });
    }
  },

  // 跳转订单列表
  goToOrderList: function(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.navigateTo({
      url: `/pages/orderList/orderList?status=${status}`
    });
  },

  // 基础工具跳转
  goToAddress: function() {
    wx.chooseAddress({
      success: () => {
        wx.showToast({ title: '地址已同步', icon: 'success' });
      }
    });
  },

  // 底部 Tab 导航
  goToIndex: function() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
  goToMarket: function() {
    wx.reLaunch({ url: '/pages/market/market' });
  },
  goToMessage: function() {
    wx.navigateTo({ url: '/pages/messages/messages' });
  },

  // 老板专属入口
  goToAdmin: function() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '无权限', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['发布新商品', '商品上下架管理', '库存管理', '拣货推荐', '订单管理', '订单发货管理'],
      itemColor: '#111111',
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/admin/admin' });
        } else if (res.tapIndex === 1) {
          wx.navigateTo({ url: '/pages/adminProduct/adminProduct' });
        } else if (res.tapIndex === 2) {
          wx.navigateTo({ url: '/pages/skuInventory/skuInventory' });
        } else if (res.tapIndex === 3) {
          wx.navigateTo({ url: '/pages/pickingList/pickingList' });
        } else if (res.tapIndex === 4) {
          wx.navigateTo({ url: '/pages/adminOrderManage/adminOrderManage' });
        } else if (res.tapIndex === 5) {
          wx.navigateTo({ url: '/pages/adminOrder/adminOrder' });
        }
      }
    });
  },

  // 跳转到打印员管理页面
  goToPrinters: function() {
    wx.navigateTo({
      url: '/pages/logistics/printers/printers'
    });
  },

  // 跳转到快递批量管理页面
  goToExpressBatch: function() {
    wx.navigateTo({
      url: '/pages/logistics/expressBatchManage/expressBatchManage'
    });
  },

  // 跳转到售后管理页面（管理员专属）
  goToAdminAfterSale: function() {
    wx.navigateTo({
      url: '/pages/adminAfterSaleList/adminAfterSaleList'
    });
  },

  goToSales: function() {
    wx.navigateTo({
      url: '/pages/adminSales/adminSales'
    });
  }
});
