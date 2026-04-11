// miniprogram/pages/shipPartial/shipPartial.js
const api = require('../../utils/api');

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
    orderId: null,
    orderIds: [],      // 支持多个订单（合并发货）
    shipmentId: null,  // 发货单 ID（如果是合并发货）
    isMerge: false,    // 是否为合并发货模式
    mode: null,        // 'electronic' 或 'manual'，用户选择商品后才设置
    expressNo: '',
    expressCodes: EXPRESS_CODES.map(e => e.name),
    expressCode: 'ZTO',
    expressCodeIndex: 0,
    items: [],           // 可发货的商品列表
    totalShipQty: 0,
    isSubmitting: false,
    hasSelectedShipping: false  // 是否已选择发货方式
  },

  onLoad: function(options) {
    // 支持单订单和多订单（合并）两种模式
    const isMerge = options.isMerge === 'true';
    const orderIds = isMerge ? options.orderIds.split(',') : [options.orderId];
    const shipmentId = options.shipmentId ? parseInt(options.shipmentId) : null;

    this.setData({
      orderId: options.orderId,
      orderIds: orderIds,
      shipmentId: shipmentId,
      isMerge: isMerge
    });

    // 设置页面标题
    if (isMerge) {
      wx.setNavigationBarTitle({ title: `合并发货（${orderIds.length} 个订单）` });
    } else {
      wx.setNavigationBarTitle({ title: '分批发货' });
    }

    // 如果有 shipmentId 和 orderIds，先预关联订单，再加载商品
    if (this.data.shipmentId && this.data.orderIds && this.data.orderIds.length > 0) {
      this.linkOrdersAndLoadItems();
    } else {
      this.loadOrderItems();
    }
  },

  // 预关联订单并加载商品
  linkOrdersAndLoadItems: async function() {
    wx.showLoading({ title: '加载中...' });

    try {
      // 筛选出需要关联的订单（不在发货单中的订单）
      // 先获取发货单当前关联的订单
      const shipment = await api.get(`/shipments/${this.data.shipmentId}`);
      const existingOrderIds = shipment.orderIds || [];

      // 找出需要关联的订单
      const ordersToLink = this.data.orderIds
        .map(id => parseInt(id))
        .filter(id => !existingOrderIds.includes(id));

      // 如果有需要关联的订单，调用接口预关联
      if (ordersToLink.length > 0) {
        console.log('linkOrdersToShipment:', ordersToLink);
        await api.post(`/shipments/${this.data.shipmentId}/orders/link`, ordersToLink);
      }

      // 加载商品
      await this.loadOrderItems();
    } catch (err) {
      wx.showModal({
        title: '加载失败',
        content: err.message || '未知错误',
        showCancel: false
      });
    } finally {
      wx.hideLoading();
    }
  },

  // 加载订单商品（支持多订单）
  loadOrderItems: async function() {
    wx.showLoading({ title: '加载中...' });

    try {
      let allItems = [];

      // 如果有 shipmentId，从发货单加载所有商品（包括已发货的）
      if (this.data.shipmentId) {
        const res = await api.get(`/shipments/${this.data.shipmentId}/items`);
        allItems = res.items.map(item => ({
          ...item,
          id: item.orderItemId,  // 将 orderItemId 映射到 id，用于提交
          orderId: item.orderId,
          maxShipQty: item.canShipQty,  // 可发货数量
          shipQty: 0,  // 本次发货数量，默认 0
          canShip: item.canShip  // 是否可发货
        }));
      } else if (this.data.isMerge && this.data.orderIds.length > 0) {
        // 合并模式：先检查是否有现有的发货单
        // 取第一个订单 ID 查询是否有发货单
        const firstOrderId = parseInt(this.data.orderIds[0]);
        const firstOrderDetail = await api.get(`/orders/${firstOrderId}`);

        if (firstOrderDetail.shipmentId) {
          // 有发货单，从发货单加载所有商品
          const res = await api.get(`/shipments/${firstOrderDetail.shipmentId}/items`);
          allItems = res.items.map(item => ({
            ...item,
            id: item.orderItemId,  // 将 orderItemId 映射到 id，用于提交
            orderId: item.orderId,
            maxShipQty: item.canShipQty,  // 可发货数量
            shipQty: 0,  // 本次发货数量，默认 0
            canShip: item.canShip  // 是否可发货
          }));
        } else {
          // 没有发货单，获取所有订单的商品（都是可发货的）
          for (const orderId of this.data.orderIds) {
            const detail = await api.get(`/orders/${orderId}`);

            const orderItems = detail.items.map(item => ({
              ...item,
              orderId: orderId,  // 保留订单 ID 用于提交
              maxShipQty: item.qty,  // 可发货数量
              shipQty: 0,  // 本次发货数量，默认 0
              shippedQty: 0,  // 已发货数量
              canShip: true  // 可发货
            }));
            allItems.push(...orderItems);
          }
        }
      } else {
        // 单订单模式：获取订单的商品
        const detail = await api.get(`/orders/${this.data.orderId}`);

        // 检查订单是否已关联发货单
        if (detail.shipmentId) {
          // 有发货单，从发货单加载所有商品（包括已发货的）
          const res = await api.get(`/shipments/${detail.shipmentId}/items`);
          allItems = res.items.map(item => ({
            ...item,
            orderId: item.orderId,
            maxShipQty: item.canShipQty,  // 可发货数量
            shipQty: 0,  // 本次发货数量，默认 0
            canShip: item.canShip  // 是否可发货
          }));
        } else {
          // 没有发货单，所有商品都可发货
          const orderItems = detail.items.map(item => ({
            ...item,
            orderId: this.data.orderId,
            maxShipQty: item.qty,  // 可发货数量
            shipQty: 0,  // 本次发货数量，默认 0
            shippedQty: 0,  // 已发货数量
            canShip: true  // 可发货
          }));
          allItems = orderItems;
        }
      }

      this.setData({ items: allItems });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      console.error('loadOrderItems error:', err);
    } finally {
      wx.hideLoading();
    }
  },

  // 修改发货数量
  onQuantityChange: function(e) {
    const index = e.currentTarget.dataset.index;
    const value = parseInt(e.detail.value) || 0;

    const items = [...this.data.items];
    const item = items[index];
    const shipQty = Math.min(value, item.maxShipQty);
    items[index].shipQty = shipQty;

    this.setData({ items }, () => {
      this.updateTotalShipQty();
    });
  },

  // 减少数量
  decreaseQuantity: function(e) {
    const index = e.currentTarget.dataset.index;
    const items = [...this.data.items];
    const item = items[index];
    if (item.shipQty > 0) {
      item.shipQty--;
      this.setData({ items }, () => {
        this.updateTotalShipQty();
      });
    }
  },

  // 增加数量
  increaseQuantity: function(e) {
    const index = e.currentTarget.dataset.index;
    const items = [...this.data.items];
    const item = items[index];
    if (item.shipQty < item.maxShipQty) {
      item.shipQty++;
      this.setData({ items }, () => {
        this.updateTotalShipQty();
      });
    }
  },

  // 全选
  selectAll: function() {
    const items = this.data.items.map(item => ({
      ...item,
      shipQty: item.maxShipQty
    }));
    this.setData({ items }, () => {
      this.updateTotalShipQty();
    });
  },

  // 清空
  clearAll: function() {
    const items = this.data.items.map(item => ({
      ...item,
      shipQty: 0
    }));
    this.setData({ items }, () => {
      this.updateTotalShipQty();
    });
  },

  // 更新发货总数
  updateTotalShipQty: function() {
    const total = this.data.items.reduce((sum, item) => sum + item.shipQty, 0);
    this.setData({ totalShipQty: total });
  },

  // 切换快递公司
  onExpressCodeChange: function(e) {
    const index = e.detail.value;
    this.setData({
      expressCodeIndex: index,
      expressCode: EXPRESS_CODES[index].code
    });
  },

  // 提交发货 - 第一步：检查商品选择，然后选择发货方式
  submitShipment: async function() {
    if (this.data.isSubmitting) return;

    const shippingItems = this.data.items.filter(item => item.shipQty > 0);

    if (shippingItems.length === 0) {
      wx.showToast({ title: '请选择至少一件商品', icon: 'none' });
      return;
    }

    // 如果还没选择发货方式，先选择
    if (!this.data.hasSelectedShipping) {
      this.showShippingMethodSelection();
      return;
    }

    // 已选择发货方式，直接提交
    await this.doSubmitShipment();
  },

  // 显示发货方式选择对话框
  showShippingMethodSelection: function() {
    wx.showModal({
      title: '选择发货方式',
      confirmText: '电子面单',
      confirmColor: '#1890ff',
      showCancel: true,
      cancelText: '手动填单',
      success: (res) => {
        if (res.confirm) {
          // 电子面单模式 - 直接提交，由后端生成运单号
          this.setData({
            mode: 'electronic',
            hasSelectedShipping: true
          }, () => {
            this.doSubmitShipment();
          });
        } else if (res.cancel) {
          // 手动填单模式 - 先输入单号
          this.showManualWaybillInput();
        }
      }
    });
  },

  // 显示手动填单输入框
  showManualWaybillInput: function() {
    wx.showModal({
      title: '填写快递单号',
      editable: true,
      placeholderText: '中通快递单号，例如：755308483428',
      confirmText: '确认发货',
      success: (res) => {
        if (res.confirm && res.content && res.content.trim()) {
          this.setData({
            mode: 'manual',
            expressNo: res.content.trim(),
            hasSelectedShipping: true
          }, () => {
            this.doSubmitShipment();
          });
        } else if (res.confirm) {
          wx.showToast({ title: '请输入快递单号', icon: 'none' });
          this.showManualWaybillInput();  // 重新输入
        }
      }
    });
  },

  // 执行提交发货
  doSubmitShipment: async function() {
    const shippingItems = this.data.items.filter(item => item.shipQty > 0);

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '发货中...', mask: true });

    try {
      let shipmentRes;

      // 准备提交的数据
      const submitItems = shippingItems.map(item => ({
        orderItemId: item.id,
        qty: item.shipQty
      }));

      if (this.data.mode === 'electronic') {
        // 电子面单模式 - 自动生成运单号
        // 合并发货时，调用统一的 /shipments 接口
        const apiPath = this.data.isMerge ? '/shipments' : `/orders/${this.data.orderId}/shipments`;

        // 准备请求数据
        const requestData = {
          expressCode: this.data.expressCode,
          expressNo: '',  // 空，由微信生成
          items: submitItems,
          useElectronicWaybill: true
        };

        // 合并发货时，传递所有订单 ID（包括没有选中商品的订单）
        if (this.data.isMerge && this.data.orderIds && this.data.orderIds.length > 0) {
          // 转换为数字数组
          requestData.orderIds = this.data.orderIds.map(id => parseInt(id));
        }

        shipmentRes = await api.post(apiPath, requestData);

        wx.hideLoading();

        // 显示面单 PDF 预览
        if (shipmentRes.pdfShowUrl) {
          await this.showWaybillPreview(shipmentRes);
        } else {
          wx.showToast({
            title: '发货成功！运单号：' + shipmentRes.expressNo,
            icon: 'success'
          });
        }
      } else {
        // 手动填单模式
        const apiPath = this.data.isMerge ? '/shipments' : `/orders/${this.data.orderId}/shipments`;

        // 准备请求数据
        const requestData = {
          expressCode: this.data.expressCode,
          expressNo: this.data.expressNo,
          items: submitItems
        };

        // 合并发货时，传递所有订单 ID（包括没有选中商品的订单）
        if (this.data.isMerge && this.data.orderIds && this.data.orderIds.length > 0) {
          // 转换为数字数组
          requestData.orderIds = this.data.orderIds.map(id => parseInt(id));
        }

        shipmentRes = await api.post(apiPath, requestData);

        wx.hideLoading();
        wx.showToast({ title: '发货成功！', icon: 'success' });
      }

      // 返回上一页并刷新
      const pages = getCurrentPages();
      const prevPage = pages[pages.length - 2];
      if (prevPage) {
        // 如果是合并发货，刷新 adminOrder 页面
        if (this.data.isMerge && prevPage.loadOrders) {
          prevPage.loadOrders();
        } else if (prevPage.loadOrders) {
          prevPage.loadOrders();
        }
      }
      wx.navigateBack();

    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '发货失败',
        content: err.message || '未知错误',
        showCancel: false
      });
    } finally {
      this.setData({ isSubmitting: false });
    }
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
  }
});
