const api = require('../../utils/api');
const auth = require('../../utils/auth');

const ORDER_STATUS_LABELS = {
  pending: '待付款', paid: '待发货', stocking: '备货中',
  partial_shipped: '部分发货', shipped: '已发货',
  completed: '已完成', cancelled: '已取消'
};

function formatOrderTime(raw) {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: { order: null, items: [], loading: true },
  async onLoad(options) {
    try {
      await auth.ensureAuthenticated({ silent: true });
      const data = await api.get('/wechat/customer-service/sessions/' + options.sessionId
        + '/orders/' + options.orderId);
      const order = data.order || {};
      this.setData({
        order: { ...order, statusDisplay: ORDER_STATUS_LABELS[order.status] || order.status,
          createdAtDisplay: formatOrderTime(order.createdAt) },
        items: data.items || [], loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: (err && err.message) || '订单加载失败', icon: 'none' });
    }
  }
});
