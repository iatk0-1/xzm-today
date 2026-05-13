// miniprogram/pages/logistics/printers/printers.js
const api = require('../../../utils/api');
const auth = require('../../../utils/auth');

Page({
  data: {
    printers: [],        // 已绑定的打印员 OpenID 列表
    accounts: [],        // 已绑定的物流账号列表
    currentOpenid: '',   // 当前用户 OpenID
    isPrinter: false,    // 当前用户是否已是打印员
    hasPrinterAccount: false,  // 是否有打单软件账号
    printerAccount: null       // 打单软件账号信息 { username, password }
  },

  onLoad: function() {
    this.loadPrinters();
    this.loadBoundAccounts();
    this.loadCurrentPrinterInfo();
    this.loadPrinterAccount();
  },

  // 加载打单软件账号
  loadPrinterAccount: async function() {
    try {
      const res = await api.get('/printer-accounts/me');
      this.setData({
        hasPrinterAccount: true,
        printerAccount: {
          username: res.username,
          password: res.password
        }
      });
    } catch (err) {
      this.setData({
        hasPrinterAccount: false,
        printerAccount: null
      });
    }
  },

  // 创建打单软件账号
  createPrinterAccount: async function() {
    wx.showModal({
      title: '创建打单账号',
      content: '将为您创建一个专用打单软件账号，用于登录桌面打单软件。每个用户只能创建一个。',
      confirmText: '确认创建',
      confirmColor: '#1890ff',
      success: async (res) => {
        if (!res.confirm) return;

        wx.showLoading({ title: '创建中...', mask: true });
        try {
          const result = await api.post('/printer-accounts', {});
          wx.hideLoading();

          this.setData({
            hasPrinterAccount: true,
            printerAccount: {
              username: result.username,
              password: result.password
            }
          });

          wx.showModal({
            title: '创建成功',
            content: '请妥善保管账号密码！\n\n用户名：' + result.username + '\n密码：' + result.password,
            showCancel: false,
            confirmText: '我知道了',
            confirmColor: '#1890ff'
          });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({
            title: err.message || '创建失败',
            icon: 'none'
          });
        }
      }
    });
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
  },

  // 复制文本到剪贴板
  copyText: function(e) {
    const text = e.currentTarget.dataset.text;
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  }
});
