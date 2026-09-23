const api = require('../../utils/api');
const auth = require('../../utils/auth');

const STATUS_MAP = {
  all: '',
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected'
};

const ORDER_STATUS_DISPLAY = {
  pending: '待付款',
  stocking: '备货中',
  paid: '待发货',
  partial_shipped: '部分发货',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已关闭'
};

function firstValue() {
  const values = Array.prototype.slice.call(arguments);
  return values.find(value => value !== undefined && value !== null && value !== '') || '';
}

function normalizeOrderItem(item) {
  return {
    ...item,
    productName: firstValue(item.productName, item.name, '商品'),
    productImage: firstValue(item.productImage, item.imageUrl),
    skuImageUrl: firstValue(item.skuImageUrl, item.skuImage),
    skuSpec: firstValue(item.skuSpec, item.productSpec, item.spec, '图片色'),
    skuSize: firstValue(item.skuSize, item.productSize, item.size, '均码')
  };
}

function getOrderItems(item) {
  const orderItems = Array.isArray(item.orderItems) ? item.orderItems : item.items;
  return Array.isArray(orderItems) ? orderItems.map(normalizeOrderItem) : [];
}

function findOrderItem(orderItems, orderItemId) {
  return orderItems.find(goods => String(goods.id) === String(orderItemId));
}

function buildRequestItemRemarks(request, orderItems) {
  return (request.itemRemarks || []).map(remark => {
    const orderItem = findOrderItem(orderItems, remark.orderItemId);
    return {
      ...remark,
      productName: orderItem ? orderItem.productName : '',
      skuSpec: orderItem ? orderItem.skuSpec : '',
      skuSize: orderItem ? orderItem.skuSize : '',
      qty: orderItem ? orderItem.qty : '',
      beforeRemark: orderItem ? orderItem.remark : request.beforeItemRemark || ''
    };
  });
}

Page({
  data: {
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'pending', label: '待审批' },
      { key: 'approved', label: '已通过' },
      { key: 'rejected', label: '已拒绝' }
    ],
    currentTab: 'pending',
    requests: [],
    isLoading: false
  },

  onLoad: function() {
    this.loadRequests();
  },

  onPullDownRefresh: async function() {
    await this.loadRequests();
    wx.stopPullDownRefresh();
  },

  switchTab: function(e) {
    const currentTab = e.currentTarget.dataset.key;
    this.setData({ currentTab }, () => this.loadRequests());
  },

  loadRequests: async function() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const params = { page: 1, size: 100 };
      const status = STATUS_MAP[this.data.currentTab];
      if (status) params.status = status;
      const result = await api.get('/admin/orders-manage/change-requests', params);
      const detailRequests = new Map();
      const loadFallbackOrderItems = (orderId) => {
        const key = String(orderId);
        if (!detailRequests.has(key)) {
          detailRequests.set(key, api.get(`/admin/orders-manage/orders/${orderId}`)
            .then(order => getOrderItems(order || {}))
            .catch(() => []));
        }
        return detailRequests.get(key);
      };

      const requests = await Promise.all((result || []).map(async item => {
        const request = item.request || item;
        let orderItems = getOrderItems(item);
        const needsOrderDetail = orderItems.length === 0
          || orderItems.some(goods => !goods.productImage && !goods.skuImageUrl);
        if (needsOrderDetail) {
          orderItems = await loadFallbackOrderItems(request.orderId);
        }
        return {
          ...request,
          ...item,
          requestTypeText: request.requestType === 'recipient' ? '收件信息修改' : '商品备注修改',
          statusText: request.status === 'pending' ? '待审批' : (request.status === 'approved' ? '已通过' : '已拒绝'),
          orderStatusText: ORDER_STATUS_DISPLAY[item.orderStatus] || item.orderStatus || '未知状态',
          orderStatusClass: item.orderStatus || 'unknown',
          beforeRecipientAddress: [request.beforeRecipientProvince, request.beforeRecipientCity,
            request.beforeRecipientDistrict, request.beforeRecipientDetail].filter(Boolean).join(''),
          requestedRecipientAddress: [request.recipientProvince, request.recipientCity,
            request.recipientDistrict, request.recipientDetail].filter(Boolean).join(''),
          currentRecipientAddress: [item.currentRecipientProvince, item.currentRecipientCity,
            item.currentRecipientDistrict, item.currentRecipientDetail].filter(Boolean).join(''),
          orderItems,
          itemRemarks: buildRequestItemRemarks(request, orderItems)
        };
      }));
      this.setData({ requests });
    } catch (err) {
      wx.showToast({ title: err.message || '加载申请失败', icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  approveRequest: function(e) {
    this.handleRequest(e.currentTarget.dataset.id, 'approve');
  },

  rejectRequest: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '拒绝申请',
      editable: true,
      placeholderText: '可填写拒绝原因',
      success: async (result) => {
        if (!result.confirm) return;
        await this.handleRequest(id, 'reject', { reason: result.content || '' });
      }
    });
  },

  viewOrder: function(e) {
    const orderId = e.currentTarget.dataset.orderId;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/adminOrderDetail/adminOrderDetail?id=${orderId}` });
  },

  handleRequest: async function(id, action, body) {
    wx.showLoading({ title: action === 'approve' ? '审批中...' : '处理中...' });
    try {
      const path = `/admin/orders-manage/change-requests/${id}/${action === 'approve' ? 'approve' : 'reject'}`;
      await api.post(path, body || {});
      wx.showToast({ title: action === 'approve' ? '申请已通过' : '申请已拒绝', icon: 'success' });
      await this.loadRequests();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
