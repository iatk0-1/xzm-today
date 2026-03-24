// miniprogram/pages/adminOrder/adminOrder.js
const api = require('../../utils/api');

// 状态映射（前端中文 -> 后端英文）
const STATUS_MAP = {
  '待发货': 'paid',
  '已发货': 'shipped',
  '全部订单': null
};

Page({
  data: {
    tabs: ['待发货', '已发货', '全部订单'],
    currentTab: '待发货',
    orders: [],
    isLoading: true
  },

  onShow: function() {
    this.loadOrders();
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab }, () => {
      this.loadOrders();
    });
  },

  // 改造：从后端 API 加载订单列表
  loadOrders: async function() {
    this.setData({ isLoading: true, orders: [] });
    wx.showLoading({ title: '扫描订单中...' });

    try {
      const backendStatus = STATUS_MAP[this.data.currentTab];
      const params = {
        page: 1,
        size: 100
      };
      if (backendStatus) {
        params.status = backendStatus;
      }

      const res = await api.get('/admin/orders', params);

      // 转换后端数据格式到前端格式
      const orders = (res.items || []).map(order => ({
        ...order,
        // 确保有 items 数组用于商品列表
        items: order.items || []
      }));

      this.setData({ orders, isLoading: false }, () => {
        wx.hideLoading();
      });
    } catch (err) {
      this.setData({ isLoading: false }, () => {
        wx.hideLoading();
        wx.showToast({ title: '读取失败', icon: 'none' });
      });
      console.error(err);
    }
  },

  // 改造：发货
  shipOrder: async function(e) {
    const orderId = e.currentTarget.dataset.id;

    wx.showModal({
      title: '填写快递单号',
      editable: true,
      placeholderText: '例如：顺丰 SF123456789',
      confirmColor: '#111111',
      success: async (res) => {
        if (res.confirm && res.content) {
          wx.showLoading({ title: '同步物流中...' });

          try {
            // 创建发货单
            await api.post(`/orders/${orderId}/shipments`, {
              expressCode: res.content,
              expressCompany: '',
              note: ''
            });

            wx.hideLoading();
            wx.showToast({ title: '发货成功!', icon: 'success' });
            this.loadOrders();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '发货失败', icon: 'none' });
            console.error(err);
          }
        }
      }
    });
  },

  // 复制客户地址
  copyAddress: function(e) {
    const order = e.currentTarget.dataset.order;
    // 根据后端返回的订单结构，地址可能在 recipientAddress 字段
    const address = order.recipientAddress || order.address || '';
    const recipient = order.recipientName || order.recipient || '';
    const phone = order.recipientPhone || order.phone || '';

    const text = `${recipient} ${phone} ${address}`;
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '客户地址已复制', icon: 'success' });
      }
    });
  },

  // 进入订单详情页
  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/orderDetail/orderDetail?id=${id}`
    });
  }
});
