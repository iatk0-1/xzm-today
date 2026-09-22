const api = require('../../utils/api');
const auth = require('../../utils/auth');

const STATUS_MAP = {
  all: '',
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected'
};

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
      const requests = (result || []).map(item => ({
        ...item,
        requestTypeText: item.requestType === 'recipient' ? '收件信息修改' : '商品备注修改',
        statusText: item.status === 'pending' ? '待审批' : (item.status === 'approved' ? '已通过' : '已拒绝'),
        recipientAddress: [item.recipientProvince, item.recipientCity, item.recipientDistrict, item.recipientDetail]
          .filter(Boolean).join('')
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
