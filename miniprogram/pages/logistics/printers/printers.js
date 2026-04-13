// miniprogram/pages/logistics/printers/printers.js
const api = require('../../../utils/api');
const auth = require('../../../utils/auth');

Page({
  data: {
    printers: [],        // 已绑定的打印员 OpenID 列表
    accounts: [],        // 已绑定的物流账号列表
    currentOpenid: '',   // 当前用户 OpenID
    isPrinter: false     // 当前用户是否已是打印员
  },

  onLoad: function() {
    this.loadPrinters();
    this.loadBoundAccounts();
    this.loadCurrentPrinterInfo();
  },

  // 加载打印员列表
  loadPrinters: async function() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await api.get('/logistics/printers');
      this.setData({
        printers: res || []
      });
    } catch (err) {
      console.error('加载打印员列表失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 加载绑定的物流账号
  loadBoundAccounts: async function() {
    try {
      const res = await api.get('/logistics/bound-accounts');
      // 后端返回：[{bizId, deliveryId, statusCode, alias, quotaNum}, ...]
      // 需要再调用快递公司列表获取名称
      const accounts = (res || []).map(acc => ({
        ...acc,
        deliveryName: this.getDeliveryName(acc.deliveryId)
      }));
      this.setData({ accounts });
    } catch (err) {
      console.error('加载物流账号失败:', err);
    }
  },

  // 加载当前用户打印员信息
  loadCurrentPrinterInfo: async function() {
    try {
      const res = await api.get('/logistics/current-printer');
      this.setData({
        currentOpenid: res.openid || '未知',
        isPrinter: res.isPrinter || false
      });
    } catch (err) {
      console.error('加载当前用户信息失败:', err);
      this.setData({
        currentOpenid: '加载失败',
        isPrinter: false
      });
    }
  },

  // 获取快递公司名称（需要缓存快递公司列表）
  getDeliveryName: function(deliveryId) {
    const deliveryMap = {
      'ZTO': '中通快递',
      'YTO': '圆通速递',
      'YD': '韵达速递',
      'STO': '申通快递',
      'SF': '顺丰速运',
      'JD': '京东物流',
      'EMS': 'EMS',
      'BEST': '百世快递',
      'YUNDA': '韵达快递'
    };
    return deliveryMap[deliveryId] || deliveryId;
  },

  // 绑定当前用户为打印员
  bindSelf: async function() {
    wx.showModal({
      title: '确认绑定',
      content: '确定要将自己绑定为打印员吗？',
      confirmColor: '#1890ff',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '绑定中...', mask: true });
          try {
            await api.post('/logistics/bind-current-printer');
            wx.hideLoading();
            wx.showToast({ title: '绑定成功', icon: 'success' });
            // 刷新状态
            this.loadCurrentPrinterInfo();
            this.loadPrinters();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: err.message || '绑定失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 解绑当前用户
  unbindSelf: async function() {
    wx.showModal({
      title: '确认解绑',
      content: '确定要解绑打印员身份吗？',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '解绑中...', mask: true });
          try {
            await api.post('/logistics/unbind-current-printer');
            wx.hideLoading();
            wx.showToast({ title: '解绑成功', icon: 'success' });
            // 刷新状态
            this.loadCurrentPrinterInfo();
            this.loadPrinters();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: err.message || '解绑失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 解绑其他打印员
  unbindPrinter: async function(e) {
    const openid = e.currentTarget.dataset.openid;

    wx.showModal({
      title: '确认解绑',
      content: '确定要解绑打印员 ' + openid + ' 吗？',
      confirmColor: '#1890ff',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '解绑中...', mask: true });
          try {
            await api.post('/logistics/printers/bind', {
              openid: openid,
              bind: false
            });
            wx.hideLoading();
            wx.showToast({ title: '解绑成功', icon: 'success' });
            this.loadPrinters();
            // 如果解绑的是自己，刷新状态
            if (openid === this.data.currentOpenid) {
              this.loadCurrentPrinterInfo();
            }
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: err.message || '解绑失败', icon: 'none' });
          }
        }
      }
    });
  }
});
