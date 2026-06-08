// miniprogram/pages/adminOrderManage/adminOrderManage.js
const api = require('../../utils/api');

// 状态映射（前端中文 -> 后端英文）
const STATUS_MAP = {
  '全部': null,
  '待付款': 'pending',
  '待发货': 'paid',
  '部分发货': 'partial_shipped',
  '已发货': 'shipped',
  '已完成': 'completed',
  '已关闭': 'cancelled'
};

// 后端状态 -> 前端中文显示
const STATUS_DISPLAY_MAP = {
  'pending': '待付款',
  'paid': '待发货',
  'partial_shipped': '部分发货',
  'shipped': '已发货',
  'completed': '已完成',
  'cancelled': '已关闭'
};

Page({
  data: {
    tabs: ['全部', '待付款', '待发货', '部分发货', '已发货', '已完成', '已关闭'],
    currentTab: '全部',
    orders: [],
    isLoading: true,
    
    // 搜索
    searchKeyword: '',
    
    // 时间范围
    dateRange: {
      startDate: '',
      endDate: '',
      quickSelect: ''
    },
    today: new Date().toISOString().split('T')[0],
    showDateModal: false
  },

  onLoad: function(options) {
    const statusMap = {
      'all': '全部',
      'pay': '待付款',
      'paid': '待发货',
      'shipped': '已发货',
      'completed': '已完成',
      'refund': '退款/售后',
      'closed': '已关闭'
    };

    if (options.status && statusMap[options.status]) {
      this.setData({ currentTab: statusMap[options.status] });
    }
    this.loadOrders();
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab }, () => {
      this.loadOrders();
    });
  },

  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/adminOrderDetail/adminOrderDetail?id=${id}`
    });
  },

  // 搜索
  onSearchInput: function(e) {
    const keyword = e.detail.value.trim();
    this.setData({ searchKeyword: keyword });
  },

  onSearchConfirm: function() {
    this.loadOrders();
  },

  // 时间范围选择
  showDateRangeSelector: function() {
    this.setData({ showDateModal: true });
  },

  closeDateModal: function() {
    this.setData({ showDateModal: false });
  },

  selectDateRange: function(e) {
    const type = e.currentTarget.dataset.type;
    const today = new Date();
    let startDate = '';
    let endDate = this.formatDate(today);

    switch(type) {
      case '7days':
        startDate = this.formatDate(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000));
        break;
      case '30days':
        startDate = this.formatDate(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));
        break;
      case 'month':
        startDate = this.formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
        break;
    }

    this.setData({
      'dateRange.startDate': startDate,
      'dateRange.endDate': endDate,
      'dateRange.quickSelect': type
    });
  },

  onStartDateChange: function(e) {
    this.setData({
      'dateRange.startDate': e.detail.value
    });
  },

  onEndDateChange: function(e) {
    this.setData({
      'dateRange.endDate': e.detail.value
    });
  },

  clearDateRange: function() {
    this.setData({
      'dateRange.startDate': '',
      'dateRange.endDate': '',
      'dateRange.quickSelect': ''
    });
    this.loadOrders();
  },

  confirmDateRange: function() {
    this.setData({ showDateModal: false });
    this.loadOrders();
  },

  // 加载订单
  loadOrders: async function() {
    this.setData({ isLoading: true, orders: [] });
    wx.showLoading({ title: '加载订单中...' });

    try {
      const backendStatus = STATUS_MAP[this.data.currentTab];
      
      // 构建参数对象，过滤掉 undefined 值
      const params = {};
      if (backendStatus) params.status = backendStatus;
      if (this.data.searchKeyword) params.keyword = this.data.searchKeyword;
      if (this.data.dateRange.startDate) params.startDate = this.data.dateRange.startDate;
      if (this.data.dateRange.endDate) params.endDate = this.data.dateRange.endDate;
      params.page = 1;
      params.size = 20;

      const res = await api.get('/admin/orders-manage/orders', params);

      const orders = (res || []).map(order => ({
        ...order,
        items: (order.items || []).map(item => ({
          ...item,
          skuImageUrl: item.productImage || ''
        }))
      }));

      wx.hideLoading();
      this.setData({ orders, isLoading: false });
    } catch (err) {
      wx.hideLoading();
      console.error('获取订单失败:', err);
      wx.showToast({ title: '获取订单失败', icon: 'none' });
    }
  },

  // 格式化地址
  formatAddress: function(province, city, district, detail) {
    return [province, city, district, detail].filter(s => s).join('');
  },

  // 去发货
  goToShip: function(e) {
    const order = e.currentTarget.dataset.order;

    wx.showActionSheet({
      itemList: ['手动发货', '快速发货（批量）'],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 手动发货 → 跳转新页面
          wx.navigateTo({
            url: `/pages/manualShip/manualShip?orderId=${order.id}`
          });
        } else if (res.tapIndex === 1) {
          // 快速发货 → 现有批量发货流程
          const item = order.items && order.items[0];
          if (!item) {
            wx.showToast({ title: '订单无商品', icon: 'none' });
            return;
          }
          wx.navigateTo({
            url: `/pages/adminOrder/adminOrder?productId=${item.productId}&skuIds=${item.skuId}`
          });
        }
      }
    });
  },

  // 取消运单
  cancelWaybill: async function(e) {
    const shipmentId = e.currentTarget.dataset.shipmentId;
    const orderNo = e.currentTarget.dataset.orderNo;

    wx.showModal({
      title: '取消运单',
      content: `确定要取消订单 ${orderNo} 的运单吗？\n\n取消后：\n1. 该运单将失效\n2. 已发货数量将回退\n3. 如果订单没有其他运单，订单状态将回退为"待发货"`,
      confirmText: '确认取消',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '取消中...' });
          try {
            await api.post(`/admin/orders-manage/orders/shipments/${shipmentId}/cancel-waybill`);
            wx.hideLoading();
            wx.showToast({ title: '运单已取消', icon: 'success' });
            this.loadOrders();
          } catch (err) {
            wx.hideLoading();
            wx.showModal({
              title: '取消失败',
              content: err.message || '取消运单失败',
              showCancel: false
            });
          }
        }
      }
    });
  },

  // 查看物流
  viewLogistics: function(e) {
    const expressCode = e.currentTarget.dataset.expressCode;
    const expressNo = e.currentTarget.dataset.expressNo;
    
    wx.navigateTo({
      url: `/pages/logistics/logistics?expressCode=${expressCode}&expressNo=${expressNo}`
    });
  },

  // 关闭订单
  cancelOrder: async function(e) {
    const orderId = e.currentTarget.dataset.id;

    wx.showModal({
      title: '关闭订单',
      content: '确定要关闭该订单吗？关闭后库存将释放',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' });
          try {
            await api.post(`/orders/${orderId}/cancel`);
            wx.hideLoading();
            wx.showToast({ title: '订单已关闭', icon: 'success' });
            this.loadOrders();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 格式化日期
  formatDate: function(date) {
    const d = new Date(date);
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
  }
});
