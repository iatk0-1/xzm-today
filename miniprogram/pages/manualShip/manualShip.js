// miniprogram/pages/manualShip/manualShip.js
const api = require('../../utils/api');
const clipboard = require('../../utils/clipboard');

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

    expressCodeList: [],
    expressCodeIndex: 0,
    expressCode: 'ZTO',
    expressNo: '',
    detectedCourier: null,
    manualCourierSelected: false,
    expressNoUsed: false,
    expressNoChecking: false,
    expressNoUsageInfo: '',

    items: [],
    selectedCount: 0,
    totalShipQty: 0,
    isSubmitting: false,

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

  copyOrderNo: function() {
    clipboard.copyText(this.data.orderNo, '订单号');
  },

  copyRecipientInfo: function() {
    clipboard.copyRecipient({
      recipientName: this.data.recipientName,
      recipientPhone: this.data.recipientPhone,
      recipientAddress: this.data.recipientAddress
    });
  },

  copyExpressNo: function() {
    clipboard.copyText(this.data.expressNo, '快递单号');
  },

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

  loadOrderDetail: async function(orderId) {
    wx.showLoading({ title: '加载中...' });
    try {
      const order = await api.get(`/orders/${orderId}?flat=true`);

      let totalQty = 0;
      let shippedQty = 0;
      let canShipCount = 0;
      let onlyItem = null;

      const items = (order.items || []).map(item => {
        const shipped = item.shippedQty || 0;
        const qty = item.qty || 0;
        const unshipped = qty - shipped;
        const canShip = shipped < qty;
        totalQty += qty;
        shippedQty += shipped;
        if (canShip) {
          canShipCount++;
          onlyItem = { idx: canShipCount === 1 ? null : null }; // placeholder
        }
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
          shipQty: 0,
          selected: false,
          canShip: canShip,
          bundleConfig: item.bundleConfig || null,
          bundleProductName: item.bundleProductName || null,
          bundleGroupName: item.bundleGroupName || null
        };
      });

      // 数出可发货的商品数，以及那个唯一的可发货商品
      canShipCount = 0;
      let soloItem = null;
      items.forEach(item => {
        if (item.canShip) {
          canShipCount++;
          soloItem = item;
        }
      });

      // 只有「仅一个商品可发 且 未发数量=1」才自动勾选
      if (canShipCount === 1 && soloItem && soloItem.maxShipQty === 1) {
        soloItem.selected = true;
        soloItem.shipQty = 1;
      }

      const unshippedQty = totalQty - shippedQty;

      this.setData({
        orderNo: order.outTradeNo || '',
        recipientName: order.recipientName || '',
        recipientPhone: order.recipientPhone || '',
        recipientAddress: order.recipientAddress || '',
        orderStatus: order.status || '',
        items: items,
        totalQty: totalQty,
        shippedQty: shippedQty,
        unshippedQty: unshippedQty
      }, () => {
        this.updateSummary();
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

  // ── 快递表单 ──

  onExpressCodeChange: function(e) {
    const index = e.detail.value;
    const selected = this.data.expressCodeList[index];
    this.setData({
      expressCodeIndex: index,
      expressCode: selected.code,
      manualCourierSelected: true
    });
  },

  onExpressNoInput: function(e) {
    const expressNo = this.normalizeExpressNo(e.detail.value);
    this.applyExpressNo(expressNo);
  },

  onExpressNoBlur: function() {
    const expressNo = this.data.expressNo.trim();
    this.checkExpressNoUsage(expressNo);
  },

  scanExpressNo: function() {
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['barCode', 'qrCode'],
      success: (res) => {
        const expressNo = this.normalizeExpressNo(res.result);
        if (!expressNo) {
          wx.showToast({ title: '未识别到单号', icon: 'none' });
          return;
        }
        this.applyExpressNo(expressNo, true);
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
          return;
        }
        wx.showToast({ title: '扫码失败', icon: 'none' });
      }
    });
  },

  normalizeExpressNo: function(value) {
    const lines = String(value || '')
      .split('\n')
      .map(item => item.trim());
    const firstValidLine = lines.find(Boolean);
    return firstValidLine ? firstValidLine.toUpperCase() : '';
  },

  applyExpressNo: function(expressNo, shouldCheckUsage) {
    const nextData = {
      expressNo,
      expressNoUsed: false,
      expressNoUsageInfo: '',
      detectedCourier: null
    };

    if (!this.data.manualCourierSelected && expressNo.length >= 8) {
      const matched = COURIER_PATTERNS.find(c => c.pattern.test(expressNo));
      if (matched) {
        const idx = this.data.expressCodeList.findIndex(c => c.code === matched.code);
        if (idx >= 0) {
          nextData.detectedCourier = matched;
          nextData.expressCodeIndex = idx;
          nextData.expressCode = matched.code;
        }
      }
    }

    this.setData(nextData, () => {
      if (shouldCheckUsage) {
        this.checkExpressNoUsage(expressNo);
      }
    });
  },

  checkExpressNoUsage: function(expressNo) {
    if (!expressNo || expressNo.length < 4) {
      this.setData({
        expressNoChecking: false,
        expressNoUsed: false,
        expressNoUsageInfo: ''
      });
      return;
    }

    this.expressNoCheckToken = expressNo;
    this.setData({ expressNoChecking: true });
    api.get(`/shipments/check-express-no?expressNo=${encodeURIComponent(expressNo)}`)
      .then(res => {
        if (this.expressNoCheckToken !== expressNo) {
          return;
        }

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
      .catch(() => {})
      .finally(() => {
        if (this.expressNoCheckToken === expressNo) {
          this.setData({ expressNoChecking: false });
        }
      });
  },

  // ── 勾选 ──

  toggleSelect: function(e) {
    const index = e.currentTarget.dataset.index;
    const items = [...this.data.items];
    const item = items[index];
    if (!item.canShip) return;
    item.selected = !item.selected;
    if (item.selected && item.shipQty === 0) {
      item.shipQty = item.maxShipQty;
    } else if (!item.selected) {
      item.shipQty = 0;
    }
    this.setData({ items }, () => this.updateSummary());
  },

  // ── 数量 ──

  decreaseQuantity: function(e) {
    const index = e.currentTarget.dataset.index;
    const items = [...this.data.items];
    const item = items[index];
    if (!item.canShip || !item.selected) return;
    if (item.shipQty > 1) {
      item.shipQty--;
      this.setData({ items }, () => this.updateSummary());
    }
  },

  increaseQuantity: function(e) {
    const index = e.currentTarget.dataset.index;
    const items = [...this.data.items];
    const item = items[index];
    if (!item.canShip || !item.selected) return;
    if (item.shipQty < item.maxShipQty) {
      item.shipQty++;
      this.setData({ items }, () => this.updateSummary());
    }
  },

  selectAll: function() {
    const items = this.data.items.map(item => ({
      ...item,
      selected: item.canShip,
      shipQty: item.canShip ? item.maxShipQty : 0
    }));
    this.setData({ items }, () => this.updateSummary());
  },

  clearAll: function() {
    const items = this.data.items.map(item => ({
      ...item,
      selected: false,
      shipQty: 0
    }));
    this.setData({ items }, () => this.updateSummary());
  },

  updateSummary: function() {
    let selectedCount = 0;
    let totalShipQty = 0;
    this.data.items.forEach(item => {
      if (item.canShip && item.selected) {
        selectedCount++;
        totalShipQty += item.shipQty;
      }
    });
    this.setData({ selectedCount, totalShipQty });
  },

  // ── 提交 ──

  submitShipment: async function() {
    if (this.data.isSubmitting) return;

    const expressNo = this.data.expressNo.trim();
    if (!expressNo) {
      wx.showToast({ title: '请输入快递单号', icon: 'none' });
      return;
    }

    const shippingItems = this.data.items.filter(
      item => item.canShip && item.selected && item.shipQty > 0
    );
    if (shippingItems.length === 0) {
      wx.showToast({ title: '请勾选并填写发货数量', icon: 'none' });
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
            this.goBack();
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

  goBack: function() {
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (prevPage && prevPage.loadOrders) {
      prevPage.loadOrders();
    }
    wx.navigateBack();
  },
});
