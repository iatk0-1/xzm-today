// miniprogram/pages/manualShip/manualShip.js
const api = require('../../utils/api');

// 快递单号正则模式库 — 按匹配优先级排序
const COURIER_PATTERNS = [
  { code: 'SF',   name: '顺丰速运', pattern: /^SF\d{10,14}$/ },
  { code: 'JD',   name: '京东物流', pattern: /^JD[A-Z]?\d{9,15}$/ },
  { code: 'YTO',  name: '圆通速递', pattern: /^YT\d{10,16}$/ },
  { code: 'BEST', name: '百世快递', pattern: /^BEST\d{8,14}$/ },
  { code: 'EMS',  name: 'EMS',       pattern: /^[A-Z]{2}\d{9}[A-Z]{2}$|^1\d{12}$/ },
  { code: 'ZTO',  name: '中通快递',  pattern: /^7\d{11,13}$|^\d{12}$/ },
  { code: 'STO',  name: '申通快递',  pattern: /^33\d{10,12}$|^\d{12,14}$/ },
  { code: 'YD',   name: '韵达速递',  pattern: /^4\d{11,14}$|^\d{13,14}$/ },
];

Page({
  data: {
    orderId: null,
    orderNo: '',
    recipientName: '',
    recipientPhone: '',
    recipientAddress: '',
    orderStatus: '',

    // 快递表单
    expressCodeList: [],
    expressCodeIndex: 0,
    expressCode: 'ZTO',
    expressNo: '',
    detectedCourier: null,
    manualCourierSelected: false,
    expressNoUsed: false,        // 单号已被使用
    expressNoChecking: false,    // 正在检查
    expressNoUsageInfo: '',      // 已使用提示

    // 商品列表
    items: [],
    totalShipQty: 0,
    isSubmitting: false,

    // 统计
    totalQty: 0,
    shippedQty: 0,
    unshippedQty: 0,
  },

  onLoad: function(options) {
    const orderId = options.orderId;
    if (!orderId) {
      wx.showToast({ title: '缺少订单参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.setData({ orderId: orderId });
    this.loadDeliveryCompanies();
    this.loadOrderDetail(orderId);
  },

  // 加载快递公司列表
  loadDeliveryCompanies: async function() {
    try {
      const res = await api.get('/logistics/delivery-companies');
      if (res && res.length > 0) {
        const list = res.map(item => ({ code: item.deliveryId, name: item.deliveryName }));
        this.setData({
          expressCodeList: list,
          expressCodes: list.map(e => e.name),
          expressCode: list[0].code,
          expressCodeIndex: 0
        });
      } else {
        this.setDefaultCouriers();
      }
    } catch (err) {
      console.error('加载快递公司列表失败:', err);
      this.setDefaultCouriers();
    }
  },

  setDefaultCouriers: function() {
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
      expressCode: defaultList[0].code,
      expressCodeIndex: 0
    });
  },

  // 加载订单详情
  loadOrderDetail: async function(orderId) {
    wx.showLoading({ title: '加载中...' });
    try {
      const order = await api.get(`/orders/${orderId}`);

      let totalQty = 0;
      let shippedQty = 0;
      const items = (order.items || []).map(item => {
        const shipped = item.shippedQty || 0;
        const qty = item.qty || 0;
        const unshipped = qty - shipped;
        totalQty += qty;
        shippedQty += shipped;
        return {
          id: item.id,
          productId: item.productId,
          productName: item.productName || '',
          productImage: item.productImage || '',
          skuImageUrl: item.skuImageUrl || item.productImage || '',
          productSpec: item.productSpec || '图片色',
          productSize: item.productSize || '均码',
          qty: qty,
          shippedQty: shipped,
          unshippedQty: unshipped,
          maxShipQty: unshipped,
          shipQty: unshipped,  // 默认填满未发数量
          canShip: shipped < qty,
          bundleConfig: item.bundleConfig || null
        };
      });

      const unshippedQty = totalQty - shippedQty;

      this.setData({
        orderNo: order.outTradeNo || '',
        recipientName: order.recipientName || '',
        recipientPhone: order.recipientPhone || '',
        recipientAddress: this.buildAddress(order),
        orderStatus: order.status || '',
        items: items,
        totalQty: totalQty,
        shippedQty: shippedQty,
        unshippedQty: unshippedQty
      }, () => {
        this.updateTotalShipQty();
      });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      console.error('加载订单详情失败:', err);
      wx.showModal({
        title: '加载失败',
        content: '无法加载订单信息',
        showCancel: false,
        success: () => wx.navigateBack()
      });
    }
  },

  buildAddress: function(order) {
    return [order.recipientProvince, order.recipientCity, order.recipientDistrict, order.recipientDetail]
      .filter(s => s).join('');
  },

  // 快递公司选择
  onExpressCodeChange: function(e) {
    const index = e.detail.value;
    const selected = this.data.expressCodeList[index];
    this.setData({
      expressCodeIndex: index,
      expressCode: selected.code,
      manualCourierSelected: true  // 手动选择后不再自动覆盖
    });
  },

  // 快递单号输入（含自动检测）
  onExpressNoInput: function(e) {
    const expressNo = e.detail.value.trim().toUpperCase();
    this.setData({ expressNo, expressNoUsed: false, expressNoUsageInfo: '' });

    // 自动检测快递公司（仅在用户未手动选择时）
    if (!this.data.manualCourierSelected && expressNo.length >= 8) {
      const matched = COURIER_PATTERNS.find(c => c.pattern.test(expressNo));
      if (matched) {
        const idx = this.data.expressCodeList.findIndex(c => c.code === matched.code);
        if (idx >= 0) {
          this.setData({
            detectedCourier: matched,
            expressCodeIndex: idx,
            expressCode: matched.code
          });
          return;
        }
      }
    }
    this.setData({ detectedCourier: null });
  },

  // 快递单号输入完成（失焦时检查是否重复）
  onExpressNoBlur: function() {
    const expressNo = this.data.expressNo.trim();
    if (!expressNo || expressNo.length < 4) return;

    this.setData({ expressNoChecking: true });
    api.get(`/shipments/check-express-no?expressNo=${encodeURIComponent(expressNo)}`)
      .then(res => {
        if (res && res.used) {
          const orderNos = res.usages.map(u => u.outTradeNo).join('、');
          this.setData({
            expressNoUsed: true,
            expressNoUsageInfo: `该运单号已用于订单 ${orderNos}，请确认无误后再提交`
          });
        } else {
          this.setData({ expressNoUsed: false, expressNoUsageInfo: '' });
        }
      })
      .catch(() => {
        // 检查失败不阻塞操作
      })
      .finally(() => {
        this.setData({ expressNoChecking: false });
      });
  },

  // 数量控制
  decreaseQuantity: function(e) {
    const index = e.currentTarget.dataset.index;
    const items = [...this.data.items];
    const item = items[index];
    if (item.shipQty > 0) {
      item.shipQty--;
      this.setData({ items }, () => this.updateTotalShipQty());
    }
  },

  increaseQuantity: function(e) {
    const index = e.currentTarget.dataset.index;
    const items = [...this.data.items];
    const item = items[index];
    if (item.shipQty < item.maxShipQty) {
      item.shipQty++;
      this.setData({ items }, () => this.updateTotalShipQty());
    }
  },

  selectAll: function() {
    const items = this.data.items.map(item => ({
      ...item,
      shipQty: item.canShip ? item.maxShipQty : 0
    }));
    this.setData({ items }, () => this.updateTotalShipQty());
  },

  clearAll: function() {
    const items = this.data.items.map(item => ({
      ...item,
      shipQty: 0
    }));
    this.setData({ items }, () => this.updateTotalShipQty());
  },

  updateTotalShipQty: function() {
    const total = this.data.items.reduce((sum, item) => sum + (item.canShip ? item.shipQty : 0), 0);
    this.setData({ totalShipQty: total });
  },

  // 提交发货
  submitShipment: async function() {
    if (this.data.isSubmitting) return;

    const expressNo = this.data.expressNo.trim();
    if (!expressNo) {
      wx.showToast({ title: '请输入快递单号', icon: 'none' });
      return;
    }

    const shippingItems = this.data.items.filter(item => item.canShip && item.shipQty > 0);
    if (shippingItems.length === 0) {
      wx.showToast({ title: '请选择至少一件商品', icon: 'none' });
      return;
    }

    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '发货中...', mask: true });

    try {
      const res = await api.post('/shipments', {
        expressCode: this.data.expressCode,
        expressNo: expressNo,
        items: shippingItems.map(item => ({
          orderItemId: item.id,
          qty: item.shipQty
        })),
        orderIds: [parseInt(this.data.orderId)]
      });

      wx.hideLoading();
      wx.showModal({
        title: '发货成功',
        content: `运单号：${res.expressNo}\n是否立即打印面单？`,
        confirmText: '立即打印',
        cancelText: '稍后再说',
        success: (modalRes) => {
          if (modalRes.confirm) {
            wx.navigateTo({
              url: `/pages/bluetoothPrint/bluetoothPrint?shipmentId=${res.id}`
            });
          } else {
            this.navigateBackAndRefresh();
          }
        }
      });
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

  navigateBackAndRefresh: function() {
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (prevPage && prevPage.loadOrders) {
      prevPage.loadOrders();
    }
    wx.navigateBack();
  },
});
