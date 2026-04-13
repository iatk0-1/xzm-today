// miniprogram/pages/logistics/printers/printers.js
const api = require('../../../utils/api');

Page({
  data: {
    printers: [],        // 已绑定的打印员 OpenID 列表
    accounts: [],        // 已绑定的物流账号列表
    inputOpenid: ''      // 输入框中的 OpenID
  },

  onLoad: function() {
    this.loadPrinters();
    this.loadBoundAccounts();
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

  // 输入框输入
  onInput: function(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [field]: value });
  },

  // 绑定打印员
  bindPrinter: async function() {
    const openid = this.data.inputOpenid.trim();
    if (!openid) {
      wx.showToast({ title: '请输入 OpenID', icon: 'none' });
      return;
    }

    // 检查是否已经绑定
    if (this.data.printers.includes(openid)) {
      wx.showToast({ title: '该打印员已绑定', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '绑定中...', mask: true });
    try {
      await api.post('/logistics/printers/bind', {
        openid: openid,
        bind: true
      });
      wx.hideLoading();
      wx.showToast({ title: '绑定成功', icon: 'success' });
      this.setData({ inputOpenid: '' });
      this.loadPrinters();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '绑定失败', icon: 'none' });
    }
  },

  // 解绑打印员
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
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: err.message || '解绑失败', icon: 'none' });
          }
        }
      }
    });
  }
});
