const api = require('../../utils/api');
const auth = require('../../utils/auth');
const finance = require('../../utils/managerFinance');

const LIST_PATHS = {
  products: 'commission-products', records: 'commission-records',
  history: 'commission-records', settlements: 'offline-settlements',
  withdrawals: 'withdrawals', sharing: 'profit-sharing', eligibility: 'profit-sharing/eligibility', audit: 'financial-audit'
};

Page({
  data: {
    userId: '', profile: null, tab: 'profile', busy: false, error: '',
    stalls: [], assignmentIds: [], reason: '', income: {},
    rows: [], page: 1, hasNext: false, totalElements: 0,
    keyword: '', filterStatus: '', commissionFilter: '', stallFilter: '',
    selectedProducts: [], unitCommission: '',
    allocations: {}, settlementTotal: '0.00', paidAt: '', paymentMethod: '',
    voucher: '', settlementReason: '',
    receiver: null, receiverTypeIndex: -1, customRelation: '', receiverReason: '', receiverVerified: false,
    receiverTypes: [
      { value: 'STORE', label: '门店' }, { value: 'STAFF', label: '员工' },
      { value: 'STORE_OWNER', label: '店主' }, { value: 'PARTNER', label: '合作伙伴' },
      { value: 'HEADQUARTER', label: '总部' }, { value: 'BRAND', label: '品牌方' },
      { value: 'DISTRIBUTOR', label: '分销商' }, { value: 'USER', label: '用户' },
      { value: 'SUPPLIER', label: '供应商' }, { value: 'CUSTOM', label: '自定义实际关系' }
    ], receiverTypeLabel: '请选择已核实的实际关系', receiverRelationType: '',
    historyForm: null, reconciliation: null, reconciliationKind: 'LEGACY_TRANSFER', verifiedTransactionId: '',
    reconciliationStatus: 'SUCCESS', verifiedMerchantBillNo: '', verifiedOpenId: '',
    verifiedAmount: '', proof: '', reconciliationReason: ''
  },

  async onLoad(options) {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) throw new Error('仅管理员可管理负责人');
      this._authorized = true;
      this.setData({ userId: finance.requireText(options.id, '负责人ID') });
      await this.refresh();
    } catch (error) {
      this.fail(error);
    }
  },

  base(suffix) {
    return '/stall-managers/' + encodeURIComponent(this.data.userId)
      + (suffix ? '/' + suffix : '');
  },

  async refresh() {
    if (!this._authorized) return;
    try {
      const results = await Promise.all([
        api.get(this.base()), api.get(this.base('income')), api.get('/stalls/all'),
        api.get(this.base('profit-sharing/receiver'))
      ]);
      const profile = results[0];
      this.setData({
        profile, income: results[1], receiver: results[3],
        stalls: (results[2] || []).filter(stall => !stall.deletedAt && !stall.deleted)
          .map(stall => ({ ...stall, selected: (profile.stallIds || []).some(id => String(id) === String(stall.id)) })),
        assignmentIds: (profile.stallIds || []).map(String), error: ''
      });
      if (this.data.tab !== 'profile') await this.loadList(true);
    } catch (error) {
      this.fail(error);
    }
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasNext) this.loadList(false);
  },

  input(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  async changeTab(event) {
    const tab = event.currentTarget.dataset.tab;
    this._listSequence = (this._listSequence || 0) + 1;
    this._listLoading = false;
    this.setData({ tab, rows: [], page: 1, hasNext: false, error: '', filterStatus: '' });
    if (tab !== 'profile' && LIST_PATHS[tab]) await this.loadList(true);
  },

  assignmentChange(event) {
    const ids = event.detail.value.map(String);
    this.setData({
      assignmentIds: ids,
      stalls: this.data.stalls.map(stall => ({ ...stall, selected: ids.includes(String(stall.id)) }))
    });
  },

  async saveAssignments() {
    await this.mutate('保存档口分配', async () => {
      await api.put(this.base('assignments'), {
        stallIds: this.data.assignmentIds,
        reason: finance.requireText(this.data.reason, '分配原因')
      });
    });
  },

  async toggleActive() {
    await this.mutate(this.data.profile.active ? '负责人下线' : '重新激活', async () => {
      await api.put(this.base('active'), {
        active: !this.data.profile.active,
        reason: finance.requireText(this.data.reason, '上下线原因')
      });
    });
  },

  async loadList(reset) {
    const tab = this.data.tab;
    const path = LIST_PATHS[tab];
    if (!this._authorized || !path || this._listLoading) return;
    this._listLoading = true;
    const sequence = (this._listSequence || 0) + 1;
    this._listSequence = sequence;
    try {
      const page = reset ? 1 : this.data.page + 1;
      const params = { page, size: 20 };
      if (this.data.tab === 'products') {
        params.keyword = this.data.keyword;
        if (this.data.stallFilter) params.stallId = this.data.stallFilter;
        if (this.data.filterStatus) params.status = this.data.filterStatus;
        if (this.data.commissionFilter) params.commissionSet = this.data.commissionFilter === 'yes';
      }
      if (this.data.tab === 'history') params.historical = true;
      if (this.data.tab === 'records' && this.data.filterStatus) params.status = this.data.filterStatus;
      const result = await api.get(this.base(path), params);
      if (sequence !== this._listSequence || tab !== this.data.tab) return;
      const content = Array.isArray(result) ? result : (result.content || []);
      const items = content.map(row => ({
        ...row, channel: tab === 'sharing' ? 'PROFIT_SHARING' : 'LEGACY_TRANSFER',
        statusLabel: tab === 'sharing' ? finance.profitSharingStatus(row.status) : finance.transferStatus(row.status),
        selected: this.data.selectedProducts.includes(String(row.productId))
      }));
      this.setData({
        rows: reset ? items : this.data.rows.concat(items),
        page, hasNext: !Array.isArray(result) && page < result.totalPages, totalElements: Array.isArray(result) ? result.length : result.totalElements || 0,
        error: ''
      });
    } catch (error) {
      if (sequence === this._listSequence && tab === this.data.tab) this.fail(error);
    } finally {
      if (sequence === this._listSequence) this._listLoading = false;
    }
  },

  search() {
    this.setData({ selectedProducts: [] });
    this.loadList(true);
  },

  productChange(event) {
    const ids = event.detail.value.map(String);
    const visible = new Set(this.data.rows.map(row => String(row.productId)));
    const selected = this.data.selectedProducts.filter(id => !visible.has(id)).concat(ids);
    this.setData({
      selectedProducts: selected,
      rows: this.data.rows.map(row => ({ ...row, selected: selected.includes(String(row.productId)) }))
    });
  },

  async selectFiltered() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const ids = [];
      let page = 1;
      let totalPages = 1;
      do {
        const params = { keyword: this.data.keyword, page, size: 100 };
        if (this.data.stallFilter) params.stallId = this.data.stallFilter;
        if (this.data.filterStatus) params.status = this.data.filterStatus;
        if (this.data.commissionFilter) params.commissionSet = this.data.commissionFilter === 'yes';
        const result = await api.get(this.base('commission-products'), params);
        (result.content || []).forEach(row => ids.push(String(row.productId)));
        totalPages = result.totalPages;
        if (ids.length > 1000 || result.totalElements > 1000) {
          throw new Error('单次最多1000件商品，请缩小筛选范围');
        }
        page += 1;
      } while (page <= totalPages);
      this.setData({
        selectedProducts: ids,
        rows: this.data.rows.map(row => ({ ...row, selected: ids.includes(String(row.productId)) }))
      });
    } catch (error) {
      this.fail(error);
    } finally {
      this.setData({ busy: false });
    }
  },

  async setCommission() {
    await this.mutate('批量设置佣金', async () => {
      const ids = this.data.selectedProducts;
      if (!ids.length) throw new Error('请先选择商品');
      const amount = finance.money(this.data.unitCommission, true);
      const accepted = await finance.confirmAction('批量设置每件佣金',
        '将修改 ' + ids.length + ' 件商品，每件佣金 ¥' + amount + '。仅影响后续下单，全部SKU统一。');
      if (!accepted) return false;
      await api.put(this.base('commissions'), { productIds: ids, unitCommission: amount });
      this.setData({ selectedProducts: [] });
    });
  },

  allocationInput(event) {
    try {
      const id = String(event.currentTarget.dataset.id);
      const allocations = { ...this.data.allocations, [id]: event.detail.value };
      const sum = Object.values(allocations).reduce((total, amount) => {
        return total + (amount ? finance.cents(amount) : 0);
      }, 0);
      this.setData({ allocations, settlementTotal: (sum / 100).toFixed(2) });
    } catch (error) {
      this.fail(error);
    }
  },

  async settleOffline() {
    await this.mutate('登记线下付款', async () => {
      const allocations = Object.entries(this.data.allocations)
        .filter(([, value]) => value && finance.cents(value) > 0)
        .map(([recordId, amount]) => ({ recordId, amount: finance.money(amount) }));
      if (!allocations.length) throw new Error('请为完成订单填写本次付款分配金额');
      const body = {
        allocations, amount: finance.money(this.data.settlementTotal),
        paidAt: finance.isoTime(this.data.paidAt, '实际付款时间'),
        paymentMethod: finance.requireText(this.data.paymentMethod, '付款方式'),
        voucher: finance.requireText(this.data.voucher, '付款凭证号或凭证说明'),
        reason: finance.requireText(this.data.settlementReason, '结算说明')
      };
      if (Number(body.amount) > Number(this.data.income.settleableIncome || 0)) {
        throw new Error('线下付款分配超过账户可结算余额');
      }
      const accepted = await finance.confirmAction('确认已经线下付款',
        '本次登记 ¥' + body.amount + '，系统不会转账。请确认关联订单与付款凭证正确。');
      if (!accepted) return false;
      await api.post(this.base('offline-settlements'), body);
      this.setData({ allocations: {}, settlementTotal: '0.00' });
    });
  },

  async reverseSettlement(event) {
    const id = event.currentTarget.dataset.id;
    await this.mutate('冲正线下结算', async () => {
      const reason = finance.requireText(this.data.settlementReason, '冲正原因');
      if (!await finance.confirmAction('冲正结算记录', '仅纠正登记，原付款记录和冲正原因将保留。')) return false;
      await api.post(this.base('offline-settlements/' + id + '/reverse'), { reason });
    });
  },

  openHistory(event) {
    const row = this.data.rows[Number(event.currentTarget.dataset.index)];
    if (!row || row.status !== 'UNCONFIRMED') return;
    this.setData({
      error: '', historyForm: {
        ...row, eligible: true, reason: '', unitCommission: '',
        creatorConfirmed: row.creatorUserId != null,
        assignmentStartedAt: '', assignmentEndedAt: '',
        activeStartedAt: '', activeEndedAt: '',
        saleUnits: '', memberIds: String(row.orderItemId)
      }
    });
  },

  historyInput(event) {
    this.setData({ ['historyForm.' + event.currentTarget.dataset.field]: event.detail.value });
  },

  historyEligible(event) {
    this.setData({ 'historyForm.eligible': event.detail.value });
  },

  creatorConfirmation(event) {
    this.setData({ 'historyForm.creatorConfirmed': event.detail.value });
  },

  async confirmHistory() {
    await this.mutate('确认历史佣金', async () => {
      const form = this.data.historyForm;
      const item = {
        orderItemId: String(form.orderItemId),
        unitCommission: form.eligible ? finance.money(form.unitCommission, true) : '0.00',
        eligible: form.eligible, reason: finance.requireText(form.reason, '历史核对依据')
      };
      if (form.eligible) {
        if (!form.creatorConfirmed) throw new Error('历史创建人缺失，请明确确认商品由本负责人创建');
        item.creatorUserId = String(form.creatorUserId || this.data.userId);
        item.assignmentStartedAt = finance.isoTime(form.assignmentStartedAt, '档口分配开始时间');
        item.assignmentEndedAt = finance.isoTime(form.assignmentEndedAt, '档口分配结束时间', true);
        item.activeStartedAt = finance.isoTime(form.activeStartedAt, '负责人激活开始时间');
        item.activeEndedAt = finance.isoTime(form.activeEndedAt, '负责人激活结束时间', true);
        const orderTime = Date.parse(form.createdAt);
        if (Date.parse(item.assignmentStartedAt) > orderTime || Date.parse(item.activeStartedAt) > orderTime
          || (item.assignmentEndedAt && Date.parse(item.assignmentEndedAt) <= orderTime)
          || (item.activeEndedAt && Date.parse(item.activeEndedAt) <= orderTime)) {
          throw new Error('任职区间必须包含下单时间，结束时间不包含');
        }
      }
      if (form.isBundle || form.bundleProductName) {
        const qty = Number(form.saleUnits);
        if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error('请核实并填写历史售出套数');
        item.saleUnits = qty;
        item.memberOrderItemIds = finance.requireText(form.memberIds, '完整套装子件明细ID')
          .split(/[,，\s]+/).filter(Boolean);
        if (!item.memberOrderItemIds.every(id => /^\d+$/.test(id))
          || !item.memberOrderItemIds.includes(String(form.orderItemId))) {
          throw new Error('子件ID须完整且包含当前明细ID');
        }
      }
      if (!await finance.confirmAction('确认历史记录', '应付佣金与已付款分开记录；确认后不能重复补算。')) return false;
      await api.post(this.base('history-confirm'), { items: [item] });
      this.setData({ historyForm: null });
    });
  },

  closeHistory() {
    this.setData({ historyForm: null });
  },

  receiverTypeChange(event) {
    const index = Number(event.detail.value);
    const type = this.data.receiverTypes[index];
    if (type) this.setData({ receiverTypeIndex: index, receiverTypeLabel: type.label,
      receiverRelationType: type.value, receiverVerified: false });
  },

  receiverVerification(event) { this.setData({ receiverVerified: event.detail.value }); },

  async saveReceiver() {
    await this.mutate('登记分账接收关系', async () => {
      const type = this.data.receiverTypes[this.data.receiverTypeIndex];
      if (!type) throw new Error('请先选择实际核实的收款关系，不能默认认定为员工');
      if (!this.data.receiverVerified) throw new Error('请确认已经核实负责人本人与商户的实际关系');
      const body = { relationType: type.value, reason: finance.requireText(this.data.receiverReason, '关系核验依据') };
      if (type.value === 'CUSTOM') {
        body.customRelation = finance.requireText(this.data.customRelation, '自定义实际关系');
        if ([...body.customRelation].length > 10) throw new Error('自定义关系最多10个字符');
      }
      if (!await finance.confirmAction('登记真实分账关系', '将按本人小程序身份登记“' + type.label + '”关系，负责人主动提现时会使用该接收关系。')) return false;
      await api.put(this.base('profit-sharing/receiver'), body);
      this.setData({ receiverVerified: false, receiverReason: '', customRelation: '',
        receiverTypeIndex: -1, receiverTypeLabel: '请选择已核实的实际关系', receiverRelationType: '' });
    });
  },

  async querySharing(event) {
    if (!this._authorized || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await api.get(this.base('profit-sharing/' + encodeURIComponent(String(event.currentTarget.dataset.id))));
      await this.refresh();
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },

  async openReconciliation(event) {
    try {
      const sharing = event.currentTarget.dataset.channel === 'PROFIT_SHARING';
      const row = await api.get(this.base((sharing ? 'profit-sharing/' : 'withdrawals/') + encodeURIComponent(String(event.currentTarget.dataset.id)) + '/reconciliation'));
      this.setData({
        error: '', reconciliation: row, reconciliationStatus: 'SUCCESS',
        reconciliationKind: sharing ? 'PROFIT_SHARING' : 'LEGACY_TRANSFER', verifiedTransactionId: '',
        verifiedMerchantBillNo: '', verifiedOpenId: '', verifiedAmount: '',
        proof: '', reconciliationReason: ''
      });
    } catch (error) {
      this.fail(error);
    }
  },

  reconciliationState(event) {
    this.setData({ reconciliationStatus: event.detail.value });
  },

  async reconcileWithdrawal() {
    await this.mutate('登记商户账单核验', async () => {
      const sharing = this.data.reconciliationKind === 'PROFIT_SHARING';
      const status = this.data.reconciliationStatus;
      if (!(sharing ? ['SUCCESS', 'CLOSED'] : ['SUCCESS', 'CANCELLED']).includes(status)) throw new Error('核验终态与原单结算通道不匹配');
      const body = {
        status, proof: finance.requireText(this.data.proof, '商户账单核验凭证'),
        reason: finance.requireText(this.data.reconciliationReason, '人工核验原因')
      };
      const outNo = finance.requireText(this.data.verifiedMerchantBillNo, '账单商户单号');
      const openId = finance.requireText(this.data.verifiedOpenId, '账单收款OpenID');
      const amount = finance.money(this.data.verifiedAmount);
      if (sharing) Object.assign(body, {
        transactionId: finance.requireText(this.data.verifiedTransactionId, '原微信支付交易号'),
        outOrderNo: outNo, openId, amount
      });
      else Object.assign(body, { verifiedMerchantBillNo: outNo, verifiedOpenId: openId, verifiedAmount: amount });
      if (!await finance.confirmAction('确认商户账单已经核验',
        body.status === 'SUCCESS' ? '将登记账单确认本人已收款并扣除占用余额。' : '将登记确定未付款并释放余额。超时、404或顶层已结束都不能作为本人未收款的凭证。')) return false;
      await api.post(this.base((sharing ? 'profit-sharing/' : 'withdrawals/') + this.data.reconciliation.id + '/reconciliation'), body);
      this.setData({ reconciliation: null });
    });
  },

  closeReconciliation() {
    this.setData({ reconciliation: null });
  },

  async mutate(title, operation) {
    if (!this._authorized || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const result = await operation();
      if (result !== false) {
        wx.showToast({ title: title + '成功', icon: 'none' });
        await this.refresh();
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.setData({ busy: false });
    }
  },

  fail(error) {
    this.setData({ error: error.message || error.errMsg || '操作失败' });
  }
});
