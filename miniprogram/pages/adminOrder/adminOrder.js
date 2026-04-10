// miniprogram/pages/adminOrder/adminOrder.js
const api = require('../../utils/api');

// 状态映射（前端中文 -> 后端英文）
const STATUS_MAP = {
  '待发货': 'paid',
  '已发货': 'shipped',
  '全部订单': null
};

// 快递公司编码列表
const EXPRESS_CODES = [
  { code: 'ZTO', name: '中通快递' },
  { code: 'YTO', name: '圆通速递' },
  { code: 'YD', name: '韵达速递' },
  { code: 'STO', name: '申通快递' },
  { code: 'SF', name: '顺丰速运' },
  { code: 'JD', name: '京东物流' },
  { code: 'EMS', name: 'EMS' }
];

Page({
  data: {
    tabs: ['待发货', '已发货', '全部订单'],
    currentTab: '待发货',
    orders: [],
    isLoading: true,
    // 多选合并发货相关
    selectedOrders: [],
    selectMode: false,
    canMerge: false,
    mergeError: ''
  },

  onShow: function() {
    // 从 shipPartial 页面返回时，清空选择状态
    if (this.data.selectMode || this.data.selectedOrders.length > 0) {
      const orders = this.data.orders.map(order => ({
        ...order,
        _selected: false
      }));
      this.setData({
        selectMode: false,
        selectedOrders: [],
        canMerge: false,
        orders: orders
      });
    }
    this.loadOrders();
  },

  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      currentTab: tab,
      selectMode: false,
      selectedOrders: [],
      canMerge: false
    }, () => {
      this.loadOrders();
    });
  },

  // 切换选择模式
  toggleSelectMode: function() {
    const newSelectMode = !this.data.selectMode;

    // 退出选择模式时，清空选中状态并重置订单的 _selected 字段
    if (newSelectMode === false) {
      const orders = this.data.orders.map(order => ({
        ...order,
        _selected: false
      }));
      this.setData({
        selectMode: false,
        selectedOrders: [],
        canMerge: false,
        orders: orders
      });
    } else {
      // 进入选择模式
      this.setData({
        selectMode: true,
        selectedOrders: [],
        canMerge: false
      });
    }
  },

  // 检查订单是否被选中
  isSelected: function(order) {
    // 聚合订单使用 orderIds[0] 作为标识
    const orderId = order.orderIds ? order.orderIds[0] : order.id;
    const orderIdStr = String(orderId);
    return this.data.selectedOrders.indexOf(orderIdStr) > -1;
  },

  // 勾选/取消勾选订单
  toggleOrderSelection: function(e) {
    const dataset = e.currentTarget.dataset;
    const order = dataset.order;
    const orderId = order.orderIds ? order.orderIds[0] : order.id;
    const orderIdStr = String(orderId);

    let selected = [...this.data.selectedOrders];
    const index = selected.indexOf(orderIdStr);

    if (index > -1) {
      selected.splice(index, 1);  // 取消选中
    } else {
      selected.push(orderIdStr);  // 选中
    }

    // 强制更新视图
    this.setData({
      selectedOrders: selected
    }, () => {
      // 手动触发视图更新
      const orders = this.data.orders.map(order => ({
        ...order,
        _selected: this.isSelected(order)
      }));
      this.setData({ orders: orders });
      this.checkMergeShipAvailable();
    });
  },

  // 检查选中的订单是否满足合并条件
  checkMergeShipAvailable: async function() {
    if (this.data.selectedOrders.length <= 1) {
      this.setData({ canMerge: false, mergeError: '' });
      return;
    }

    try {
      // 获取所有选中订单的详情，检查是否同一用户、同一地址
      const orderDetails = await Promise.all(
        this.data.selectedOrders.map(id => api.get(`/orders/${id}`))
      );

      const firstOrder = orderDetails[0];
      const sameUser = orderDetails.every(order => order.userId === firstOrder.userId);
      const sameAddress = orderDetails.every(order =>
        order.recipientName === firstOrder.recipientName &&
        order.recipientPhone === firstOrder.recipientPhone &&
        order.recipientAddress === firstOrder.recipientAddress
      );

      // 检查订单状态
      const validStatus = orderDetails.every(order =>
        order.status === 'paid' || order.status === 'shipped'
      );

      if (!validStatus) {
        this.setData({
          canMerge: false,
          mergeError: '选中的订单状态不支持合并发货（必须为已付款或已发货）'
        });
      } else if (!sameUser) {
        this.setData({
          canMerge: false,
          mergeError: '选中的订单必须属于同一用户'
        });
      } else if (!sameAddress) {
        this.setData({
          canMerge: false,
          mergeError: '选中的订单必须有相同的收货地址'
        });
      } else {
        this.setData({ canMerge: true, mergeError: '' });
      }
    } catch (err) {
      this.setData({ canMerge: false, mergeError: '检查失败：' + err.message });
    }
  },

  // 加载订单列表（后端按发货单聚合返回）
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

      // 后端已按发货单聚合返回数据
      // res.items 是 AggregatedOrderResponse 数组
      const orders = (res.items || []).map(order => ({
        ...order,
        _selected: false  // 选中状态标记
      }));

      this.setData({ orders: orders, isLoading: false }, () => {
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

  // 去发货（包括全部发货和分批发货）
  shipOrder: function(e) {
    const order = e.currentTarget.dataset.order;
    const orderId = order.orderIds ? order.orderIds[0] : order.id;

    // 如果是合并发货且有 shipmentId，跳转到合并发货页面
    if (order.type === 'merged' && order.shipmentId && order.shippedQty < order.totalQty) {
      wx.navigateTo({
        url: `/pages/shipPartial/shipPartial?shipmentId=${order.shipmentId}&orderIds=${order.orderIds.join(',')}&isMerge=true`
      });
    } else {
      // 单订单发货
      wx.navigateTo({
        url: `/pages/shipPartial/shipPartial?orderId=${orderId}`
      });
    }
  },

  // 合并发货
  mergeShipOrders: async function() {
    if (this.data.selectedOrders.length === 0) {
      wx.showToast({ title: '请选择订单', icon: 'none' });
      return;
    }

    // 检查选中的订单是否有共同的发货单
    const shipmentIds = new Set();
    for (const orderId of this.data.selectedOrders) {
      const order = this.data.orders.find(o => {
        const oid = o.orderIds ? o.orderIds[0] : o.id;
        return String(oid) === String(orderId);
      });
      if (order && order.shipmentId) {
        shipmentIds.add(order.shipmentId);
      }
    }

    // 如果有多个不同的发货单，不允许合并
    if (shipmentIds.size > 1) {
      wx.showModal({
        title: '无法合并',
        content: '选中的订单属于多个不同的发货单，不支持合并多个发货单',
        showCancel: false
      });
      return;
    }

    // 如果有共同的发货单，提示用户将新订单关联到已有发货单
    if (shipmentIds.size === 1) {
      const shipmentId = Array.from(shipmentIds)[0];
      wx.showModal({
        title: '确认合并发货',
        content: `选中的订单已关联到发货单 #${shipmentId}，将把未关联的订单添加到此发货单`,
        confirmText: '确认',
        success: (res) => {
          if (res.confirm) {
            this.doMergeShip(shipmentId);
          }
        }
      });
    } else {
      // 没有发货单，正常合并
      wx.showModal({
        title: '确认合并发货',
        content: `将合并 ${this.data.selectedOrders.length} 个订单，请选择要发货的商品`,
        confirmText: '确认',
        success: (res) => {
          if (res.confirm) {
            this.doMergeShip(null);
          }
        }
      });
    }
  },

  // 执行合并发货（跳转到分批发货页面，让用户选择每次发哪些商品）
  doMergeShip: function(shipmentId) {
    if (this.data.selectedOrders.length === 0) {
      wx.showToast({ title: '请选择订单', icon: 'none' });
      return;
    }

    // 直接跳转到 shipPartial 页面，不预先选择发货方式
    const orderIds = this.data.selectedOrders.join(',');
    let url = `/pages/shipPartial/shipPartial?orderIds=${orderIds}&isMerge=true`;
    if (shipmentId) {
      url += `&shipmentId=${shipmentId}`;
    }
    wx.navigateTo({
      url: url,
      fail: (err) => {
        console.error('navigateTo failed:', err);
        wx.showToast({ title: '跳转失败，请检查是否已在该页面', icon: 'none' });
      }
    });
  },

  // 显示面单预览
  showWaybillPreview: function(shipmentRes) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '面单已生成',
        content: '运单号：' + shipmentRes.expressNo + '，请点击确认打开面单打印',
        confirmText: '打印面单',
        success: (res) => {
          if (res.confirm) {
            wx.previewImage({
              urls: [shipmentRes.pdfShowUrl],
              success: () => {
                wx.showToast({ title: '请尽快打印面单', icon: 'none', duration: 2000 });
              }
            });
          }
          resolve();
        }
      });
    });
  },

  // 复制客户地址
  copyAddress: function(e) {
    const order = e.currentTarget.dataset.order;
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
  },

  // 进入解绑页面
  goToUnbind: function(e) {
    const shipmentId = e.currentTarget.dataset.shipmentId;
    wx.navigateTo({
      url: `/pages/unbindOrder/unbindOrder?shipmentId=${shipmentId}`
    });
  }
});
