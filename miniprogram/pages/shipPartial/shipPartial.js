// miniprogram/pages/shipPartial/shipPartial.js
const api = require('../../utils/api');

Page({
  data: {
    orderId: null,
    orderIds: [],      // 支持多个订单（合并发货）
    shipmentId: null,  // 发货单 ID（如果是合并发货）
    mergeGroupId: null, // 合并组 ID（新合并组逻辑）
    isMerge: false,    // 是否为合并发货模式
    fromInventory: false, // 是否从库存发货模式
    fromSkuId: null,   // 从库存发货时的 SKU ID
    fromSkuName: '',   // 从库存发货时的 SKU 名称
    mode: null,        // 'electronic' 或 'manual'，用户选择商品后才设置
    expressNo: '',
    expressCodes: [],   // 快递公司名称列表（从后端动态加载）
    expressCodeList: [], // 快递公司完整数据 [{code, name}]
    expressCode: '',    // 当前选中的快递公司编码
    expressCodeIndex: 0,
    items: [],           // 可发货的商品列表
    totalShipQty: 0,
    isSubmitting: false,
    hasSelectedShipping: false  // 是否已选择发货方式
  },

  onLoad: async function(options) {
    // 从库存发货模式
    const fromInventory = options.fromInventory === 'true';
    const fromSkuId = options.skuId ? parseInt(options.skuId) : null;
    const fromSkuName = options.skuName ? decodeURIComponent(options.skuName) : '';

    if (fromInventory) {
      this.setData({
        fromInventory: fromInventory,
        fromSkuId: fromSkuId,
        fromSkuName: fromSkuName
      });
      wx.setNavigationBarTitle({ title: '从库存发货' });
    } else {
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
    }

    // 加载快递公司列表
    await this.loadDeliveryCompanies();

    // 加载商品
    this.loadOrderItems();
  },

  // 加载快递公司列表
  loadDeliveryCompanies: async function() {
    try {
      const res = await api.get('/logistics/delivery-companies');
      if (res && res.length > 0) {
        // 后端返回：[{deliveryId, deliveryName}, ...]
        const expressCodeList = res.map(item => ({
          code: item.deliveryId,
          name: item.deliveryName
        }));
        this.setData({
          expressCodeList,
          expressCodes: expressCodeList.map(e => e.name),
          expressCode: expressCodeList[0].code // 默认选中第一个
        });
      } else {
        // 如果后端没有数据，使用默认列表
        const defaultList = [
          { code: 'ZTO', name: '中通快递' },
          { code: 'YTO', name: '圆通速递' },
          { code: 'YD', name: '韵达速递' },
          { code: 'STO', name: '申通快递' },
          { code: 'SF', name: '顺丰速运' },
          { code: 'JD', name: '京东物流' },
          { code: 'EMS', name: 'EMS' }
        ];
        this.setData({
          expressCodeList: defaultList,
          expressCodes: defaultList.map(e => e.name),
          expressCode: defaultList[0].code
        });
      }
    } catch (err) {
      console.error('加载快递公司列表失败:', err);
      // 使用默认列表
      const defaultList = [
        { code: 'ZTO', name: '中通快递' },
        { code: 'YTO', name: '圆通速递' },
        { code: 'YD', name: '韵达速递' },
        { code: 'STO', name: '申通快递' },
        { code: 'SF', name: '顺丰速运' },
        { code: 'JD', name: '京东物流' },
        { code: 'EMS', name: 'EMS' }
      ];
      this.setData({
        expressCodeList: defaultList,
        expressCodes: defaultList.map(e => e.name),
        expressCode: defaultList[0].code
      });
    }
  },

  // 加载订单商品（支持多订单、从库存发货）
  loadOrderItems: async function() {
    wx.showLoading({ title: '加载中...' });

    try {
      let allItems = [];

      // 从库存发货模式
      if (this.data.fromInventory) {
        await this.loadFromInventoryItems();
        return;
      }

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
            maxShipQty: item.qty - (item.shippedQty || 0),  // 可发货数量 = 总数量 - 已发数量
            shipQty: 0,  // 本次发货数量，默认 0
            shippedQty: item.shippedQty || 0,  // 已发货数量
            canShip: (item.shippedQty || 0) < item.qty  // 已发货的商品不可再发
          }));
          allItems.push(...orderItems);
        }

        this.setData({ items: allItems, orderIds: orderIds });
      } else if (this.data.shipmentId) {
        // 合并发货且有发货单 ID
        const orderIds = this.data.orderIds.map(id => parseInt(id));

        // 获取所有订单的商品（从订单详情读取，以保证 shippedQty 正确）
        for (const orderId of orderIds) {
          const detail = await api.get(`/orders/${orderId}`);

          const orderItems = detail.items.map(item => ({
            ...item,
            id: item.id,
            orderId: orderId,
            maxShipQty: item.qty - (item.shippedQty || 0),
            shipQty: 0,
            shippedQty: item.shippedQty || 0,
            canShip: (item.shippedQty || 0) < item.qty
          }));
          allItems.push(...orderItems);
        }

        this.setData({ items: allItems });
      } else {
        // 单订单发货
        const detail = await api.get(`/orders/${this.data.orderId}`);

        if (detail.shipmentId) {
          // 已有关联的发货单，从发货单加载所有商品（包括已发货和未发货）
          const shipmentItems = await api.get(`/shipments/${detail.shipmentId}/items`);
          const orderItems = shipmentItems.items.map(item => ({
            ...item,
            id: item.orderItemId,
            orderId: this.data.orderId,
            maxShipQty: item.canShipQty,
            shipQty: 0,
            shippedQty: item.shippedQty,
            canShip: item.canShip
          }));
          allItems = orderItems;
        } else {
          // 没有发货单，所有商品都可发货（但需要读取后端的 shippedQty）
          const orderItems = detail.items.map(item => ({
            ...item,
            id: item.id,
            orderId: this.data.orderId,
            maxShipQty: item.qty - (item.shippedQty || 0),
            shipQty: 0,
            shippedQty: item.shippedQty || 0,
            canShip: (item.shippedQty || 0) < item.qty
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

  // 从库存发货模式：加载包含指定 SKU 的未发货订单
  loadFromInventoryItems: async function() {
    try {
      const { fromSkuId } = this.data;
      
      // 获取当前 SKU 的库存数量
      const inventory = await api.get(`/sku-inventory/${fromSkuId}`);
      const availableQty = inventory.qty || 0;
      
      if (availableQty <= 0) {
        wx.hideLoading();
        wx.showModal({
          title: '库存不足',
          content: `当前 SKU 库存为 ${availableQty}，无法发货`,
          showCancel: false
        });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      // 调用后端接口查询包含指定 SKU 的未发货订单
      const ordersRes = await api.get(`/orders/by-sku?skuId=${fromSkuId}&limit=20`);
      const orders = ordersRes || [];
      
      if (orders.length === 0) {
        wx.hideLoading();
        wx.showModal({
          title: '无待发货订单',
          content: '当前没有包含该 SKU 的待发货订单',
          showCancel: false
        });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }
      
      // 转换为前端格式
      const allItems = orders.map(item => ({
        id: item.itemId,
        orderId: item.orderId,
        orderNo: item.outTradeNo || item.orderId,
        skuId: item.skuId,
        maxShipQty: item.canShipQty,
        shipQty: 0,  // 默认不勾选，由管理员手动输入
        shippedQty: item.shippedQty || 0,
        canShip: true,
        availableInventory: availableQty,  // 显示总库存
        createdAt: this.formatTime(item.createdAt)
      }));
      
      this.setData({ 
        items: allItems,
        availableInventory: availableQty
      });
      
      wx.hideLoading();
      wx.showToast({ 
        title: `库存：${availableQty}，可发${allItems.length}个订单`, 
        icon: 'none',
        duration: 2000
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
      console.error('loadFromInventoryItems error:', err);
    }
  },

  // 格式化时间
  formatTime: function(timeStr) {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
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

  // 全选（只全选可发货的商品）
  selectAll: function() {
    const items = this.data.items.map(item => ({
      ...item,
      shipQty: item.canShip ? item.maxShipQty : 0
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
    const selectedCompany = this.data.expressCodeList[index];
    this.setData({
      expressCodeIndex: index,
      expressCode: selectedCompany.code
    });
  },

  // 提交发货 - 第一步：检查商品选择，然后选择发货方式
  submitShipment: async function() {
    if (this.data.isSubmitting) return;

    // 只筛选可以发货且选择了数量的商品
    const shippingItems = this.data.items.filter(item => item.canShip && item.shipQty > 0);

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
    // 从库存发货模式
    if (this.data.fromInventory) {
      await this.doSubmitFromInventory();
      return;
    }

    // 只筛选可以发货且选择了数量的商品
    const shippingItems = this.data.items.filter(item => item.canShip && item.shipQty > 0);

    if (shippingItems.length === 0) {
      wx.showToast({ title: '请选择至少一件商品', icon: 'none' });
      this.setData({ isSubmitting: false });
      return;
    }

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

        // 保存 shipmentId 用于打印
        this.setData({ shipmentId: shipmentRes.id });

        wx.hideLoading();

        // 询问用户是否需要立即打印面单
        await this.showPrintConfirm(shipmentRes);
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

        // 保存 shipmentId 用于打印
        this.setData({ shipmentId: shipmentRes.id });

        wx.hideLoading();

        // 询问用户是否需要立即打印面单
        await this.showPrintConfirm(shipmentRes);
      }

      // 注意：返回逻辑已移到 showPrintConfirm 中
      // 如果用户选择打印，打印完成后会返回
      // 如果用户选择不打印，直接返回

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

  // 显示打印确认弹窗
  showPrintConfirm: function(shipmentRes) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '发货成功',
        content: '运单号：' + shipmentRes.expressNo + '\n是否要立即打印面单？',
        confirmText: '立即打印',
        confirmColor: '#1890ff',
        cancelText: '暂不打印',
        success: (res) => {
          if (res.confirm) {
            // 跳转到蓝牙打印页面
            this.goToBluetoothPrint();
          } else {
            // 返回上一页并刷新
            this.navigateBackAndRefresh();
          }
          resolve();
        }
      });
    });
  },

  // 返回上一页并刷新
  navigateBackAndRefresh: function() {
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (prevPage) {
      // 刷新订单列表页
      if (prevPage.loadOrders) {
        prevPage.loadOrders();
      }
      // 刷新订单详情页（通过onShow生命周期自动触发）
      if (prevPage.loadOrderDetail && prevPage.orderId) {
        prevPage.loadOrderDetail(prevPage.orderId);
      }
    }
    wx.navigateBack();
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

  // 跳转到蓝牙打印页面
  goToBluetoothPrint: function() {
    const shipmentId = this.data.shipmentId;
    const mergeGroupId = this.data.mergeGroupId;
    const isMerge = this.data.isMerge;

    if (!shipmentId && !mergeGroupId) {
      wx.showToast({ title: '没有可打印的面单', icon: 'none' });
      return;
    }

    // 构建参数
    let params = [];
    if (shipmentId) {
      params.push(`shipmentId=${shipmentId}`);
    }
    if (mergeGroupId) {
      params.push(`mergeGroupId=${mergeGroupId}`);
    }
    if (isMerge) {
      params.push(`isMerge=true`);
    }

    const url = `/pages/bluetoothPrint/bluetoothPrint?${params.join('&')}`;
    wx.navigateTo({
      url: url,
      fail: (err) => {
        console.error('跳转到蓝牙打印失败:', err);
        wx.showToast({ title: '跳转失败', icon: 'none' });
      }
    });
  },

  // 从库存发货：提交发货
  doSubmitFromInventory: async function() {
    // 筛选可以发货且选择了数量的商品
    const shippingItems = this.data.items.filter(item => item.canShip && item.shipQty > 0);

    if (shippingItems.length === 0) {
      wx.showToast({ title: '请选择至少一件商品', icon: 'none' });
      this.setData({ isSubmitting: false });
      return;
    }

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '发货中...', mask: true });

    try {
      // 准备提交的数据
      const submitItems = shippingItems.map(item => ({
        orderItemId: item.id,
        qty: item.shipQty,
        skuId: this.data.fromSkuId  // 传递 SKU ID 用于扣减库存
      }));

      // 准备请求数据
      const requestData = {
        expressCode: this.data.expressCode,
        expressNo: this.data.expressNo,
        items: submitItems,
        fromInventory: true,  // 标记为从库存发货
        skuId: this.data.fromSkuId
      };

      // 收集所有订单 ID
      const orderIds = [...new Set(shippingItems.map(item => item.orderId))];
      requestData.orderIds = orderIds;

      // 调用后端发货接口
      const shipmentRes = await api.post('/shipments', requestData);

      wx.hideLoading();
      wx.showToast({ title: '发货成功', icon: 'success' });

      // 返回库存管理页面
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 1500);

    } catch (err) {
      wx.hideLoading();
      console.error('从库存发货失败:', err);
      wx.showToast({ title: err?.message || '发货失败', icon: 'none' });
      this.setData({ isSubmitting: false });
    }
  }
});
