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

      // 拆分商品：按发货状态拆分成独立行
      const splitItems = [];

      res.items.forEach(item => {
        const shippedQty = item.shippedQty || 0;
        const totalQty = item.qty;
        const unshippedQty = totalQty - shippedQty;

        // 已发货部分 → 只能选退货退款
        if (shippedQty > 0) {
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
            qty: shippedQty,
            shippedQty: shippedQty,
            unshippedQty: 0,
            type: 'return_refund',  // 已发货只能退货退款
            status: 'shipped',
            displayStatus: '已发货',
            maxRefundAmount: parseFloat((item.salePrice * shippedQty).toFixed(2)),
            selected: false
          });
        }

        // 未发货部分 → 只能选仅退款
        if (unshippedQty > 0) {
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
            qty: unshippedQty,
            shippedQty: 0,
            unshippedQty: unshippedQty,
            type: 'refund',  // 未发货只能仅退款
            status: 'unshipped',
            displayStatus: '未发货',
            maxRefundAmount: parseFloat((item.salePrice * unshippedQty).toFixed(2)),
            selected: false
          });
        }
      });

      if (splitItems.length === 0) {
        wx.showToast({ title: '没有可申请售后的商品', icon: 'none' });
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

    // 更新选中列表
    const selectedItems = splitItems.filter(i => i.selected);
    
    // 计算总金额
    const totalAmount = selectedItems.reduce((sum, item) => sum + item.maxRefundAmount, 0).toFixed(2);

    this.setData({
      splitItems,
      selectedItems,
      totalAmount
    });
  },

  // 全选/取消全选
  toggleSelectAll: function() {
    const allSelected = !this.data.selectedItems.length ||
                        this.data.selectedItems.length === this.data.splitItems.length;

    const splitItems = this.data.splitItems.map(item => ({
      ...item,
      selected: !allSelected
    }));

    const selectedItems = allSelected ? [] : splitItems;
    
    // 计算总金额
    const totalAmount = selectedItems.reduce((sum, item) => sum + item.maxRefundAmount, 0).toFixed(2);

    this.setData({
      splitItems,
      selectedItems,
      totalAmount
    });
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
          qty: item.qty,
          shippedQty: item.shippedQty,
          unshippedQty: item.unshippedQty,
          refundAmount: item.maxRefundAmount,
          afterSaleType: item.type
        }))
      };

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
