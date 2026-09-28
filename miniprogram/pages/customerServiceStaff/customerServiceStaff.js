const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: { staff: [], phone: '', loading: true },
  onShow() { this.load(); },
  async load() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      const staff = await api.get('/wechat/customer-service/staff');
      this.setData({ staff: staff || [], loading: false });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: (err && err.message) || '加载客服失败', icon: 'none' });
    }
  },
  onPhone(e) { this.setData({ phone: e.detail.value }); },
  async add() {
    const phone = (this.data.phone || '').trim();
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入已注册用户的手机号', icon: 'none' }); return;
    }
    try {
      await api.post('/wechat/customer-service/staff', { phone });
      this.setData({ phone: '' });
      await this.load();
      wx.showToast({ title: '已开通客服权限', icon: 'none' });
    } catch (err) { wx.showToast({ title: (err && err.message) || '开通失败', icon: 'none' }); }
  },
  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '撤销客服权限', content: '该客服正在接待的会话会退回待接入。', success: async res => {
      if (!res.confirm) return;
      try {
        await api.delete('/wechat/customer-service/staff/' + id);
        await this.load();
      } catch (err) { wx.showToast({ title: (err && err.message) || '撤销失败', icon: 'none' }); }
    } });
  }
});
