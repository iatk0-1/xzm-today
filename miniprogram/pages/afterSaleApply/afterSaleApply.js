// miniprogram/pages/afterSaleApply/afterSaleApply.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

const DEFAULT_AFTER_SALE_REASON = '不想要了';

// 售后原因选项
const REASON_OPTIONS = [
  DEFAULT_AFTER_SALE_REASON,
  '商品质量问题',
  '尺码不符',
  '颜色/款式不喜欢',
  '商品破损',
  '发错货',
  '少件/漏发',
  '商品描述不符',
  '其他'
];

Page({
  data: {
    orderId: null,
    order: null,
    // 拆分后的商品列表（按发货状态拆分）
    splitItems: [],
    // 用户选中的商品
    selectedItems: [],
    // 总金额
    totalAmount: '0.00',
    reason: '',
    reasonText: '',
    reasonOptions: REASON_OPTIONS,
    evidenceImages: [],
    evidenceUrls: '',
    isLoading: true
  },

  onLoad: function(options) {
    if (options.orderId) {
      this.setData({ orderId: options.orderId });
      this.loadOrderDetail(options.orderId);
    } else {
      wx.showToast({ title: '订单参数丢失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  copyOrderNo: function() {
    const order = this.data.order || {};
    clipboard.copyText(order.outTradeNo, '订单号');
  },

  // 加载订单详情并拆分商品
  loadOrderDetail: async function(orderId) {
    wx.showLoading({ title: '加载中...' });

    try {
      await auth.ensureAuthenticated({ silent: true });
      const res = await api.get(`/orders/${orderId}?flat=true`);
      wx.hideLoading();

      if (!res || !res.items || res.items.length === 0) {
        wx.showToast({ title: '订单无可售后商品', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      // 检查订单状态是否允许售后
      const allowedStatuses = ['stocking', 'paid', 'shipped', 'completed', 'partial_shipped'];
      if (!allowedStatuses.includes(res.status)) {
        wx.showToast({ title: '该订单状态无法申请售后', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      let afterSaleRes;
      try {
        afterSaleRes = await api.get('/after-sales', {
          orderId: orderId,
          page: 1,
          size: 100
        });
      } catch (err) {
        console.error('加载售后记录失败:', err);
        wx.showToast({ title: '售后记录加载失败，请稍后重试', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      const afterSaleLimits = this.buildAfterSaleLimits(afterSaleRes && afterSaleRes.items);

      // 拆分商品：按发货状态拆分成独立行，并扣除处理中售后占用的数量和金额。
      const splitItems = [];

      res.items.forEach(item => {
        const shippedQty = item.shippedQty || 0;
        const totalQty = item.qty;
        const unshippedQty = totalQty - shippedQty;
        const limits = afterSaleLimits[String(item.id)] || {};

        // 已发货部分 → 只能选退货退款
        if (shippedQty > 0) {
          const reservedQty = Math.min(shippedQty, Number(limits.shippedQty) || 0);
          const availableQty = Math.max(0, shippedQty - reservedQty);
          const reservedAmount = Number(limits.shippedAmount) || 0;
          const maxRefundAmount = Math.max(0, Math.min(
            Number(item.salePrice) * availableQty,
            Number((Number(item.salePrice) * shippedQty - reservedAmount).toFixed(2))
          ));

          if (availableQty > 0 && maxRefundAmount > 0) {
            splitItems.push({
              orderItemId: item.id,
              productId: item.productId,
              productName: item.productName,
              productImage: item.productImage || item.skuImageUrl,
              skuSpec: item.productSpec || '默认颜色',
              skuSize: item.productSize || '均码',
              bundleConfig: item.bundleConfig || null,
              bundleProductName: item.bundleProductName || null,
              bundleGroupName: item.bundleGroupName || null,
              salePrice: item.salePrice,
              qty: availableQty,
              shippedQty: availableQty,
              unshippedQty: 0,
              type: 'return_refund',  // 已发货只能退货退款
              status: 'shipped',
              displayStatus: '已发货',
              originalQty: shippedQty,
              reservedQty,
              reservedAmount: parseFloat(reservedAmount.toFixed(2)),
              maxRefundAmount: maxRefundAmount,
              itemKey: `${item.id || item.orderItemId}-return`,
              selectedQty: '',
              inputAmount: '',
              selected: false
            });
          }
        }

        // 未发货部分 → 只能选仅退款
        if (unshippedQty > 0) {
          const reservedQty = Math.min(unshippedQty, Number(limits.unshippedQty) || 0);
          const availableQty = Math.max(0, unshippedQty - reservedQty);
          const reservedAmount = Number(limits.unshippedAmount) || 0;
          const maxRefundAmount = Math.max(0, Math.min(
            Number(item.salePrice) * availableQty,
            Number((Number(item.salePrice) * unshippedQty - reservedAmount).toFixed(2))
          ));

          if (availableQty <= 0 || maxRefundAmount <= 0) {
            return;
          }

          splitItems.push({
            orderItemId: item.id,
            productId: item.productId,
            productName: item.productName,
            productImage: item.productImage || item.skuImageUrl,
            skuSpec: item.productSpec || '默认颜色',
            skuSize: item.productSize || '均码',
            bundleConfig: item.bundleConfig || null,
            bundleProductName: item.bundleProductName || null,
            bundleGroupName: item.bundleGroupName || null,
            salePrice: item.salePrice,
            qty: availableQty,
            shippedQty: 0,
            unshippedQty: availableQty,
            type: 'refund',  // 未发货只能仅退款
            status: 'unshipped',
            displayStatus: '未发货',
            originalQty: unshippedQty,
            reservedQty,
            reservedAmount: parseFloat(reservedAmount.toFixed(2)),
            maxRefundAmount: maxRefundAmount,
            itemKey: `${item.id || item.orderItemId}-refund`,
            selectedQty: '',
            inputAmount: '',
            selected: false
          });
        }
      });

      if (splitItems.length === 0) {
        wx.showToast({ title: '商品均在售后处理中，暂无可申请数量', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
        return;
      }

      this.setData({
        order: {
          ...res,
          statusDisplay: this.getStatusDisplay(res.status)
        },
        splitItems,
        isLoading: false
      });
    } catch (err) {
      wx.hideLoading();
      console.error('加载订单失败:', err);
      wx.showToast({ title: '加载订单失败', icon: 'none' });
    }
  },

  // 统计仍会占用退款额度的售后明细，和后端剩余数量/金额校验保持一致。
  buildAfterSaleLimits: function(records) {
    const activeStatuses = ['pending', 'approved', 'received', 'refunded'];
    const limits = {};

    (records || []).forEach(record => {
      (record.items || []).forEach(item => {
        if (!activeStatuses.includes(item.status || record.status)) {
          return;
        }

        const key = String(item.orderItemId);
        const current = limits[key] || {
          shippedQty: 0,
          unshippedQty: 0,
          shippedAmount: 0,
          unshippedAmount: 0
        };
        const shippedQty = Number(item.shippedQty) || 0;
        const unshippedQty = Number(item.unshippedQty) || 0;
        const refundAmount = Number(item.refundAmount) || 0;

        current.shippedQty += shippedQty;
        current.unshippedQty += unshippedQty;
        if (shippedQty > 0 && unshippedQty > 0) {
          const totalQty = shippedQty + unshippedQty;
          current.shippedAmount += refundAmount * shippedQty / totalQty;
          current.unshippedAmount += refundAmount * unshippedQty / totalQty;
        } else if (shippedQty > 0) {
          current.shippedAmount += refundAmount;
        } else {
          current.unshippedAmount += refundAmount;
        }

        limits[key] = current;
      });
    });

    Object.keys(limits).forEach(key => {
      limits[key].shippedAmount = Number(limits[key].shippedAmount.toFixed(2));
      limits[key].unshippedAmount = Number(limits[key].unshippedAmount.toFixed(2));
    });
    return limits;
  },

  getStatusDisplay: function(status) {
    const map = {
      'pending': '待付款',
      'stocking': '备货中',
      'paid': '待发货',
      'partial_shipped': '部分发货',
      'shipped': '已发货',
      'completed': '已完成',
      'cancelled': '已关闭'
    };
    return map[status] || status;
  },

  // 选择/取消选择商品
  toggleSelectItem: function(e) {
    const index = e.currentTarget.dataset.index;
    const splitItems = [...this.data.splitItems];
    const item = splitItems[index];

    item.selected = !item.selected;
    if (item.selected) {
      item.selectedQty = String(item.qty);
      item.inputAmount = item.maxRefundAmount.toFixed(2);
    } else {
      item.selectedQty = '';
      item.inputAmount = '';
    }

    // 更新选中列表
    const selectedItems = splitItems.filter(i => i.selected);
    
    // 计算总金额
    const totalAmount = selectedItems.reduce((sum, item) => sum + (Number(item.inputAmount) || 0), 0).toFixed(2);

    this.setData({
      splitItems,
      selectedItems,
      totalAmount
    });
  },

  // 全选/取消全选
  toggleSelectAll: function() {
    const allSelected = this.data.splitItems.length > 0 &&
                        this.data.selectedItems.length === this.data.splitItems.length;

    const splitItems = this.data.splitItems.map(item => ({
      ...item,
      selected: !allSelected,
      selectedQty: !allSelected ? String(item.qty) : '',
      inputAmount: !allSelected ? item.maxRefundAmount.toFixed(2) : ''
    }));

    const selectedItems = allSelected ? [] : splitItems;
    
    // 计算总金额
    const totalAmount = selectedItems.reduce((sum, item) => sum + (Number(item.inputAmount) || 0), 0).toFixed(2);

    this.setData({
      splitItems,
      selectedItems,
      totalAmount
    });
  },

  noop: function() {},

  updateRefundQty: function(index, nextQty) {
    const item = this.data.splitItems[index];
    if (!item) return;

    const maxQty = Math.max(1, Number(item.qty) || 1);
    const qty = Math.min(maxQty, Math.max(1, Number(nextQty) || 1));
    const amountLimit = Math.min(
      item.maxRefundAmount,
      Number(item.salePrice) * qty
    );
    // 数量变化时按商品单价重新计算，不沿用之前手动输入的金额比例。
    const amount = amountLimit.toFixed(2);
    const splitItems = [...this.data.splitItems];
    splitItems[index] = { ...item, selected: true, selectedQty: String(qty), inputAmount: amount };
    this.refreshSelection(splitItems);
  },

  decreaseRefundQty: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.splitItems[index];
    this.updateRefundQty(index, Number(item && item.selectedQty) - 1);
  },

  increaseRefundQty: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.splitItems[index];
    this.updateRefundQty(index, Number(item && item.selectedQty) + 1);
  },

  onRefundAmountInput: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    const splitItems = [...this.data.splitItems];
    const item = splitItems[index];
    const selectedQty = Math.max(1, Number(item && item.selectedQty) || 1);
    const amountLimit = Math.min(
      Number(item && item.maxRefundAmount) || 0,
      (Number(item && item.salePrice) || 0) * selectedQty
    );
    const rawValue = e.detail.value;
    const numericValue = Number(rawValue);
    const inputAmount = rawValue !== '' && Number.isFinite(numericValue) && numericValue > amountLimit
      ? amountLimit.toFixed(2)
      : rawValue;
    splitItems[index] = { ...item, selected: true, inputAmount };
    this.refreshSelection(splitItems);
  },

  refreshSelection: function(splitItems) {
    const selectedItems = splitItems.filter(item => item.selected);
    const totalAmount = selectedItems.reduce((sum, item) => sum + (Number(item.inputAmount) || 0), 0).toFixed(2);
    this.setData({ splitItems, selectedItems, totalAmount });
  },

  // 选择原因
  selectReason: function(e) {
    this.setData({
      reason: e.currentTarget.dataset.reason
    });
  },

  // 输入原因文本
  onReasonInput: function(e) {
    this.setData({
      reasonText: e.detail.value
    });
  },

  // 上传图片
  uploadImage: async function() {
    const maxCount = 9 - this.data.evidenceImages.length;
    wx.chooseMedia({
      count: maxCount,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        wx.showLoading({ title: '上传中...' });
        
        try {
          // 上传到服务器
          const uploadPromises = res.tempFiles.map(file => 
            api.uploadFile('/files/upload-wish', file.tempFilePath)
          );
          
          const results = await Promise.all(uploadPromises);
          const urls = results.map(r => r.url);
          
          this.setData({
            evidenceImages: [...this.data.evidenceImages, ...urls],
            evidenceUrls: [...this.data.evidenceImages, ...urls].join(',')
          });
          
          wx.hideLoading();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '上传失败', icon: 'none' });
          console.error('上传图片失败:', err);
        }
      }
    });
  },

  // 预览图片
  previewImage: function(e) {
    const index = e.currentTarget.dataset.index;
    wx.previewImage({
      current: this.data.evidenceImages[index],
      urls: this.data.evidenceImages
    });
  },

  // 删除图片
  deleteImage: function(e) {
    const index = e.currentTarget.dataset.index;
    const newImages = this.data.evidenceImages.filter((_, i) => i !== index);
    this.setData({
      evidenceImages: newImages,
      evidenceUrls: newImages.join(',')
    });
  },

  // 提交售后申请
  submitAfterSale: async function() {
    // 验证是否选择了商品
    if (this.data.selectedItems.length === 0) {
      wx.showToast({ title: '请选择要申请售后的商品', icon: 'none' });
      return;
    }

    const reason = this.data.reason || this.data.reasonText || DEFAULT_AFTER_SALE_REASON;

    wx.showLoading({ title: '提交中...', mask: true });

    try {
      await auth.ensureAuthenticated({ silent: true });
      const requestData = {
        orderId: this.data.orderId,
        reason: reason,
        evidenceUrls: this.data.evidenceUrls,
        items: this.data.selectedItems.map(item => ({
          orderItemId: item.orderItemId,
          productId: item.productId,
          qty: Number(item.selectedQty),
          // 发货数量由后端按订单记录重算，这两个字段只为兼容旧客户端保留。
          shippedQty: item.type === 'return_refund' ? Number(item.selectedQty) : 0,
          unshippedQty: item.type === 'refund' ? Number(item.selectedQty) : 0,
          refundAmount: Number(item.inputAmount),
          afterSaleType: item.type
        }))
      };

      const invalidItem = requestData.items.find(item => {
        const sourceItem = this.data.splitItems.find(splitItem =>
          splitItem.orderItemId === item.orderItemId && splitItem.type === item.afterSaleType
        );
        const maxQty = Number(sourceItem && sourceItem.qty) || 0;
        const maxAmount = Number(sourceItem && sourceItem.maxRefundAmount) || 0;
        const maxAmountByQty = Number(sourceItem && sourceItem.salePrice) * item.qty;
        return !Number.isInteger(item.qty) || item.qty < 1 || item.qty > maxQty
          || !Number.isFinite(item.refundAmount) || item.refundAmount <= 0
          || item.refundAmount > maxAmount
          || item.refundAmount > maxAmountByQty;
      });
      if (invalidItem) {
        wx.hideLoading();
        wx.showToast({ title: '请填写正确的数量和退款金额', icon: 'none' });
        return;
      }

      console.log('提交售后申请:', requestData);
      await api.post('/after-sales', requestData);

      wx.hideLoading();
      wx.showModal({
        title: '提交成功',
        content: '售后申请已提交，请等待审核',
        showCancel: false,
        confirmColor: '#111111',
        success: () => {
          wx.navigateBack();
        }
      });
    } catch (err) {
      wx.hideLoading();
      console.error('提交售后失败:', err);
      wx.showToast({
        title: err.message || '提交失败',
        icon: 'none',
        duration: 2000
      });
    }
  }
});
