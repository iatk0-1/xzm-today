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
    const order = e.currentTarget.dataset.order;

    wx.showModal({
      title: '选择发货方式',
      editable: false,
      confirmText: '电子面单',
      confirmColor: '#111111',
      showCancel: true,
      cancelText: '手动填单',
      success: async (res) => {
        if (res.confirm) {
          // 电子面单模式 - 需要先在微信物流开放平台配置模板和网点
          await this.shipWithElectronicWaybill(orderId, order);
        } else if (res.cancel) {
          // 手动填单模式
          await this.shipWithManualWaybill(orderId);
        }
      }
    });
  },

  // 电子面单发货（微信分配运单号模式）
  shipWithElectronicWaybill: async function(orderId, order) {
    wx.showLoading({ title: '创建面单中...', mask: true });

    try {
      // 如果 order.items 不存在，先获取订单详情
      let items = order.items || [];
      if (items.length === 0) {
        const detailRes = await api.get(`/orders/${orderId}`);
        items = detailRes.items || [];
      }

      // 调用电子面单下单接口（微信分配运单号模式）
      const shipmentRes = await api.post(`/orders/${orderId}/shipments`, {
        expressCode: 'ZTO',        // 中通快递
        expressNo: '',             // 空，由微信分配
        items: items.map(item => ({
          orderItemId: item.id,
          qty: item.qty
        })),
        useElectronicWaybill: true  // 使用电子面单
      });

      wx.hideLoading();

      // 显示面单 PDF 预览
      if (shipmentRes.pdfShowUrl) {
        wx.showModal({
          title: '面单已生成',
          content: '运单号：' + shipmentRes.expressNo + '，请点击确认打开面单打印',
          confirmText: '打印面单',
          confirmColor: '#111111',
          success: (res) => {
            if (res.confirm) {
              // 预览 PDF 面单
              wx.previewImage({
                urls: [shipmentRes.pdfShowUrl],
                success: () => {
                  wx.showToast({ title: '请尽快打印面单', icon: 'none', duration: 2000 });
                }
              });
            }
          }
        });
      } else {
        wx.showToast({
          title: '发货成功！运单号：' + shipmentRes.expressNo,
          icon: 'success'
        });
      }

      this.loadOrders();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '发货失败',
        content: err.message || '电子面单下单失败',
        showCancel: false
      });
      console.error(err);
    }
  },

  // 手动填单发货
  shipWithManualWaybill: async function(orderId) {
    wx.showModal({
      title: '填写快递单号',
      editable: true,
      placeholderText: '中通快递单号，例如：755308483428',
      confirmColor: '#111111',
      success: async (res) => {
        if (res.confirm && res.content) {
          wx.showLoading({ title: '同步物流中...' });

          try {
            // 先获取订单详情获取商品项
            const detailRes = await api.get(`/orders/${orderId}`);
            const items = detailRes.items || [];

            // 创建发货单 - 固定使用中通快递
            await api.post(`/orders/${orderId}/shipments`, {
              expressCode: 'ZTO',        // 中通快递编码
              expressNo: res.content.trim(),  // 快递单号
              items: items.map(item => ({
                orderItemId: item.id,
                qty: item.qty
              }))
            });

            wx.hideLoading();
            wx.showToast({ title: '发货成功！物流信息已同步到微信', icon: 'success' });
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
