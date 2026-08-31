const api = require('../../utils/api');

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

Page({
  data: {
    merchantId: null,
    merchantName: '',
    overview: null,
    entries: [],
    page: 0,
    size: 20,
    hasMore: true,
    loading: false,
    startDate: '',
    endDate: '',
    status: ''
  },

  onLoad(options) {
    this.setData({ merchantId: options.merchantId, merchantName: options.merchantName || '' });
  },

  onShow() {
    if (this.data.merchantId) this.reload();
  },

  async reload() {
    this.setData({ entries: [], page: 0, hasMore: true });
    await Promise.all([this.loadOverview(), this.loadEntries(true)]);
  },

  buildParams(page) {
    const params = { page: page, size: this.data.size };
    if (this.data.status) params.status = this.data.status;
    if (this.data.startDate) params.startDate = this.data.startDate;
    if (this.data.endDate) params.endDate = this.data.endDate;
    return params;
  },

  async loadOverview() {
    try {
      const result = await api.get('/seller/merchants/' + this.data.merchantId + '/income/overview',
        this.buildParams(0));
      this.setData({ overview: Object.assign({}, result, {
        fixedText: money(result.fixedCommissionAmount),
        markupText: money(result.markupIncomeAmount),
        reversedText: money(result.reversedIncomeAmount),
        netText: money(result.netIncomeAmount)
      }) });
    } catch (err) {
      wx.showToast({ title: err.message || '收益汇总加载失败', icon: 'none' });
    }
  },

  async loadEntries(reset) {
    if (this.data.loading || (!reset && !this.data.hasMore)) return;
    const page = reset ? 0 : this.data.page;
    this.setData({ loading: true });
    try {
      const result = await api.get('/seller/merchants/' + this.data.merchantId + '/income/ledger',
        this.buildParams(page));
      const list = (result.content || []).map(item => Object.assign({}, item, {
        totalText: money(item.totalIncomeAmount),
        fixedText: money(item.fixedCommissionAmount),
        markupText: money(item.markupIncomeAmount),
        reversedText: money(Number(item.reversedFixedCommissionAmount || 0)
          + Number(item.reversedMarkupIncomeAmount || 0)),
        netText: money(item.netIncomeAmount),
        statusLabel: { PENDING: '待结算', AVAILABLE: '可结算', FROZEN: '已冻结',
          REVERSED: '已冲回', SETTLED: '已结算' }[item.status] || item.status
      }));
      this.setData({
        entries: reset ? list : this.data.entries.concat(list),
        page: page + 1,
        hasMore: result.hasNext !== undefined ? result.hasNext : list.length === this.data.size
      });
    } catch (err) {
      wx.showToast({ title: err.message || '收益明细加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onReachBottom() { this.loadEntries(false); },

  chooseStartDate(e) {
    this.setData({ startDate: e.detail.value });
    this.reload();
  },

  chooseEndDate(e) {
    this.setData({ endDate: e.detail.value });
    this.reload();
  },

  clearDates() {
    this.setData({ startDate: '', endDate: '' });
    this.reload();
  }
});
