const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

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
    const hasBeforeRemarkSnapshot = request.beforeItemRemark !== undefined
      && request.beforeItemRemark !== null;
    const beforeRemark = hasBeforeRemarkSnapshot
      ? request.beforeItemRemark
      : (request.status === 'pending' && orderItem ? orderItem.remark : '');
    return {
      ...remark,
      productName: orderItem ? orderItem.productName : '',
      skuSpec: orderItem ? orderItem.skuSpec : '',
      skuSize: orderItem ? orderItem.skuSize : '',
      qty: orderItem ? orderItem.qty : '',
      beforeRemark
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
    searchKeyword: '',
    requests: [],
    isLoading: false,
    isLoadingMore: false,
    page: 1,
    pageSize: 20,
    hasMore: true,
    scrollTop: 0
  },

  onLoad: function() {
    this.loadRequests(true);
  },

  onPullDownRefresh: async function() {
    await this.loadRequests(true);
    wx.stopPullDownRefresh();
  },

  switchTab: function(e) {
    const currentTab = e.currentTarget.dataset.key;
    this.setData({ currentTab }, () => this.loadRequests(true));
  },

  onSearchInput: function(e) {
    this.setData({ searchKeyword: e.detail.value });
  },

  onSearchConfirm: function() {
    this.loadRequests(true);
  },

  onScrollToLower: function() {
    return this.loadRequests(false);
  },

  copyOrderNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.orderNo, '订单号');
  },

  copyRecipientInfo: function(e) {
    clipboard.copyRecipient({
      recipientName: e.currentTarget.dataset.name,
      recipientPhone: e.currentTarget.dataset.phone,
      recipientAddress: e.currentTarget.dataset.address
    });
  },

  loadRequests: async function(isRefresh) {
    if (isRefresh === undefined) isRefresh = true;
    if (isRefresh && (this.data.isLoading || this.data.isLoadingMore)) return;
    if (!isRefresh && (this.data.isLoading || this.data.isLoadingMore || !this.data.hasMore)) return;

    const targetPage = isRefresh ? 1 : this.data.page + 1;
    this.setData(isRefresh
      ? { isLoading: true, page: 1, hasMore: true, scrollTop: 0 }
      : { isLoadingMore: true });
    try {
      await auth.ensureAuthenticated({ silent: true });
      const params = { page: targetPage, size: this.data.pageSize };
      const status = STATUS_MAP[this.data.currentTab];
      if (status) params.status = status;
      const keyword = (this.data.searchKeyword || '').trim();
      if (keyword) params.keyword = keyword;
      const result = await api.get('/admin/orders-manage/change-requests', params);
      const resultList = Array.isArray(result)
        ? result
        : ((result && (result.content || result.items)) || []);
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

      const requests = await Promise.all(resultList.map(async item => {
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
          displayOrderNo: firstValue(item.outTradeNo, request.orderId),
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
      const allRequests = isRefresh ? requests : this.data.requests.concat(requests);
      const rawTotal = result && !Array.isArray(result)
        ? Number(result.totalElements !== undefined ? result.totalElements : result.total)
        : NaN;
      const hasMore = Number.isFinite(rawTotal)
        ? allRequests.length < rawTotal
        : requests.length === this.data.pageSize;
      this.setData({
        requests: allRequests,
        page: targetPage,
        hasMore,
        isLoading: false,
        isLoadingMore: false
      });
    } catch (err) {
      wx.showToast({ title: err.message || '加载申请失败', icon: 'none' });
      this.setData({ isLoading: false, isLoadingMore: false });
    } finally {
      this.setData({ isLoading: false, isLoadingMore: false });
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
      const updated = await api.post(path, body || {});
      wx.showToast({ title: action === 'approve' ? '申请已通过' : '申请已拒绝', icon: 'success' });
      const status = updated.status || (action === 'approve' ? 'approved' : 'rejected');
      this.setData({ requests: this.data.requests.flatMap(item => {
        if (String(item.id) !== String(id)) return [item];
        if (STATUS_MAP[this.data.currentTab] && STATUS_MAP[this.data.currentTab] !== status) return [];
        return [{ ...item, ...updated, status, statusText: status === 'approved' ? '已通过' : '已拒绝' }];
      }) });
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
