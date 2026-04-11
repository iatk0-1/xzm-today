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
    mergeGroupId: null, // 合并组 ID（新合并组逻辑）
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
    const mergeGroupId = options.mergeGroupId ? parseInt(options.mergeGroupId) : null;

    this.setData({
      orderId: options.orderId,
      orderIds: orderIds,
      shipmentId: shipmentId,
      mergeGroupId: mergeGroupId,
      isMerge: isMerge
    });

    // 设置页面标题
    if (isMerge) {
      wx.setNavigationBarTitle({ title: `合并发货（${orderIds.length} 个订单）` });
    } else {
      wx.setNavigationBarTitle({ title: '分批发货' });
    }

    // 加载商品
    this.loadOrderItems();
  },

  // 加载订单商品（支持多订单）
  loadOrderItems: async function() {
    wx.showLoading({ title: '加载中...' });

    try {
      let allItems = [];

      // 如果有 mergeGroupId，从合并组加载所有订单的商品
      if (this.data.mergeGroupId) {
        // 获取合并组详情
        const mergeGroup = await api.get(`/merge-groups/${this.data.mergeGroupId}`);
        const orderIds = mergeGroup.orders.map(o => o.id);

        // 获取所有订单的商品
        for (const orderId of orderIds) {
          const detail = await api.get(`/orders/${orderId}`);

          const orderItems = detail.items.map(item => ({
            ...item,
            id: item.id,  // 订单项 ID
            orderId: orderId,
            maxShipQty: item.qty,  // 可发货数量
            shipQty: 0,  // 本次发货数量，默认 0
            shippedQty: item.shippedQty || 0,  // 已发货数量
            canShip: (item.shippedQty || 0) < item.qty  // 已发货的商品不可再发
          }));
          allItems.push(...orderItems);
        }

        this.setData({ items: allItems, orderIds: orderIds });
      } else if (this.data.shipmentId) {
        // 合并发货且有发货单 ID，从发货单加载
        const shipment = await api.get(`/shipments/${this.data.shipmentId}`);
        const orderIds = this.data.orderIds || [this.data.orderId];

        // 获取所有订单的商品
        for (const orderId of orderIds) {
          const detail = await api.get(`/orders/${orderId}`);

          // 筛选出该订单已关联到发货单的商品
          const shipmentItems = shipment.items.filter(item => item.orderId === orderId);
          const orderItems = shipmentItems.map(item => ({
            ...item,
            id: item.orderItemId,
            orderId: orderId,
            maxShipQty: item.canShipQty,
            shipQty: 0,
            shippedQty: item.shipQty,
            canShip: item.canShip
          }));
          allItems.push(...orderItems);
        }

        this.setData({ items: allItems });
      } else {
        // 单订单发货
        const detail = await api.get(`/orders/${this.data.orderId}`);

        if (detail.shipmentId) {
          // 已有关联的发货单，从发货单加载可发货商品
          const shipment = await api.get(`/shipments/${detail.shipmentId}`);
          const orderItems = shipment.items.map(item => ({
            ...item,
            id: item.orderItemId,
            orderId: this.data.orderId,
            maxShipQty: item.canShipQty,
            shipQty: 0,
            canShip: item.canShip
          }));
          allItems = orderItems;
        } else {
          // 没有发货单，所有商品都可发货
          const orderItems = detail.items.map(item => ({
            ...item,
            orderId: this.data.orderId,
            maxShipQty: item.qty,
            shipQty: 0,
            shippedQty: 0,
            canShip: true
          }));
          allItems = orderItems;
        }

        this.setData({ items: allItems });
      }
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
        // 统一使用 /shipments 接口
        const apiPath = '/shipments';

        // 准备请求数据
        const requestData = {
          expressCode: this.data.expressCode,
          expressNo: '',  // 空，由微信生成
          items: submitItems,
          useElectronicWaybill: true
        };

        // 传递订单 ID（单订单或多订单）
        if (this.data.orderId) {
          requestData.orderIds = [parseInt(this.data.orderId)];
        } else if (this.data.orderIds && this.data.orderIds.length > 0) {
          requestData.orderIds = this.data.orderIds.map(id => parseInt(id));
        }

        // 传递合并组 ID（如果有）
        if (this.data.mergeGroupId) {
          requestData.mergeGroupId = parseInt(this.data.mergeGroupId);
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
        // 统一使用 /shipments 接口
        const apiPath = '/shipments';

        // 准备请求数据
        const requestData = {
          expressCode: this.data.expressCode,
          expressNo: this.data.expressNo,
          items: submitItems
        };

        // 传递订单 ID（单订单或多订单）
        if (this.data.orderId) {
          requestData.orderIds = [parseInt(this.data.orderId)];
        } else if (this.data.orderIds && this.data.orderIds.length > 0) {
          requestData.orderIds = this.data.orderIds.map(id => parseInt(id));
        }

        // 传递合并组 ID（如果有）
        if (this.data.mergeGroupId) {
          requestData.mergeGroupId = parseInt(this.data.mergeGroupId);
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
