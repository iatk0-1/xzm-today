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
    stalls: [], assignedStalls: [], assignmentIds: [], reason: '', income: {}, activeChecked: false,
    assignmentVisible: false, availableStalls: [], newAssignmentIds: [],
    rows: [], page: 1, hasNext: false, totalElements: 0,
    keyword: '', filterStatus: '', commissionFilter: '', stallFilter: '',
    tagFilter: '', productStatus: '', stallOptions: [{ value: '', label: '全部档口' }], stallFilterIndex: 0,
    tagOptions: [{ value: '', label: '全部标签' }], tagFilterIndex: 0,
    statusOptions: [{ value: '', label: '全部状态' }, { value: 'on', label: '上架' }, { value: 'off', label: '下架' }, { value: 'sold_out', label: '售罄' }], statusFilterIndex: 0,
    commissionOptions: [{ value: '', label: '全部佣金配置' }, { value: 'yes', label: '已配置' }, { value: 'no', label: '未配置' }], commissionFilterIndex: 0,
    selectedProducts: [], unitCommission: '', allProductsSelected: false, listLoading: false,
    commissionEdit: null, singleCommission: '', commissionError: '',
    allocations: {}, settlementTotal: '0.00', paidAt: '', paymentMethod: '',
    voucher: '', settlementReason: '',
    receiver: null, receiverTypeIndex: -1, customRelation: '', receiverReason: '', receiverVerified: false,
    receiverVisible: false, receiverSummary: '未登记', receiverError: '',
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

  onShow() {
    if (this._refreshOnShow && this._authorized) {
      this._refreshOnShow = false;
      this.refresh();
    }
  },

  applyProfile(profile, stalls = this.data.stalls) {
    this._previewSequence = (this._previewSequence || 0) + 1;
    const ids = (profile.stallIds || []).map(String);
    const previous = new Map(this.data.assignedStalls.map(stall => [String(stall.id), stall]));
    const assignedStalls = stalls.filter(stall => ids.includes(String(stall.id)))
      .map(stall => ({ previewError: true, ...previous.get(String(stall.id)), ...stall, previewLoading: false }));
    const stallOptions = [{ value: '', label: '全部档口' }].concat(assignedStalls.map(stall => ({ value: String(stall.id), label: stall.name })));
    const stallFilterIndex = Math.max(0, stallOptions.findIndex(item => item.value === this.data.stallFilter));
    this.setData({
      profile, activeChecked: !!profile.active, stalls, assignmentIds: ids, assignedStalls,
      stallOptions, stallFilterIndex, stallFilter: stallOptions[stallFilterIndex].value,
      availableStalls: stalls.filter(stall => !ids.includes(String(stall.id)))
        .map(stall => ({ ...stall, selected: false })), newAssignmentIds: []
    });
  },

  async loadStallPreviews() {
    const sequence = (this._previewSequence || 0) + 1;
    this._previewSequence = sequence;
    const stalls = this.data.assignedStalls;
    this.setData({ assignedStalls: stalls.map(stall => ({ ...stall, previewLoading: true })) });
    const previews = await Promise.all(stalls.map(async stall => {
      try {
        const result = await api.get(this.base('commission-products'), { stallId: stall.id, page: 1, size: 4 });
        return { ...stall, previewProducts: result.content || [], productCount: result.totalElements || 0, previewLoading: false, previewError: false };
      } catch (error) {
        return { ...stall, previewLoading: false, previewError: true };
      }
    }));
    if (sequence === this._previewSequence) this.setData({ assignedStalls: previews });
  },

  async refresh() {
    if (!this._authorized) return;
    const sequence = (this._refreshSequence || 0) + 1;
    this._refreshSequence = sequence;
    try {
      const results = await Promise.all([
        api.get(this.base()), api.get(this.base('income')), api.get('/stalls/all'),
        api.get(this.base('profit-sharing/receiver'))
      ]);
      if (sequence !== this._refreshSequence) return;
      this.applyProfile(results[0], (results[2] || []).filter(stall => !stall.deletedAt && !stall.deleted));
      this.applyReceiver(results[3]);
      this.setData({
        income: results[1], error: ''
      });
      await this.loadStallPreviews();
      if (this.data.tab !== 'profile') await this.loadList(true);
    } catch (error) {
      if (sequence === this._refreshSequence) this.fail(error);
    }
  },

  onPullDownRefresh() {
    if (this.data.busy) { wx.stopPullDownRefresh(); return; }
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasNext) this.loadList(false);
  },

  input(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  async changeTab(event) {
    if (this.data.busy) return;
    const tab = event.currentTarget.dataset.tab;
    this._listSequence = (this._listSequence || 0) + 1;
    this._listLoading = false;
    this.setData({ tab, rows: [], page: 1, hasNext: false, error: '', filterStatus: '', listLoading: false,
      selectedProducts: [], allProductsSelected: false });
    if (tab === 'products') await this.loadProductTags();
    if (tab !== this.data.tab) return;
    if (tab !== 'profile' && LIST_PATHS[tab]) await this.loadList(true);
  },

  openAssignments() {
    if (this.data.busy || !this.data.profile) return;
    this.setData({ assignmentVisible: true, newAssignmentIds: [], error: '',
      availableStalls: this.data.availableStalls.map(stall => ({ ...stall, selected: false })) });
  },

  closeAssignments() {
    if (!this.data.busy) this.setData({ assignmentVisible: false });
  },

  noop() {},

  assignmentChange(event) {
    const available = new Set(this.data.availableStalls.map(stall => String(stall.id)));
    const ids = event.detail.value.map(String).filter(id => available.has(id));
    this.setData({
      newAssignmentIds: ids,
      availableStalls: this.data.availableStalls.map(stall => ({ ...stall, selected: ids.includes(String(stall.id)) }))
    });
  },

  async addAssignments() {
    if (!this.data.newAssignmentIds.length) return;
    const ids = [...new Set(this.data.assignmentIds.concat(this.data.newAssignmentIds))];
    const names = this.data.availableStalls.filter(stall => this.data.newAssignmentIds.includes(String(stall.id)))
      .map(stall => stall.name).join('、');
    await this.updateAssignments(ids, '新增分配档口：' + names);
  },

  async removeAssignment(event) {
    const id = String(event.currentTarget.dataset.id);
    const stall = this.data.assignedStalls.find(item => String(item.id) === id);
    if (!stall) return;
    await this.updateAssignments(this.data.assignmentIds.filter(value => value !== id), '移除分配档口：' + stall.name);
  },

  async updateAssignments(ids, action) {
    await this.mutate('更新档口分配', async () => {
      const profile = await api.put(this.base('assignments'), {
        stallIds: ids,
        reason: this.data.reason.trim() || action.slice(0, 1000)
      });
      this.applyProfile(profile);
      this.setData({ assignmentVisible: false });
    });
  },

  openStall(event) {
    const stall = this.data.assignedStalls.find(item => String(item.id) === String(event.currentTarget.dataset.id));
    if (!stall) return;
    this._refreshOnShow = true;
    wx.navigateTo({ url: '/pages/adminCatalogProducts/adminCatalogProducts?type=stall&id=' + encodeURIComponent(String(stall.id))
      + '&name=' + encodeURIComponent(stall.name) + '&managerId=' + encodeURIComponent(this.data.userId)
      + '&managerName=' + encodeURIComponent(this.data.profile.nickname || this.data.userId) });
  },

  openProduct(event) {
    this._refreshOnShow = true;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(String(event.currentTarget.dataset.id)) });
  },

  async toggleActive(event) {
    if (!this.data.profile) return;
    const active = !!event.detail.value;
    this.setData({ activeChecked: active });
    await this.mutate(active ? '负责人上线' : '负责人下线', async () => {
      const profile = await api.put(this.base('active'), {
        active,
        reason: this.data.reason.trim() || (active ? '管理员通过开关将负责人上线' : '管理员通过开关将负责人下线')
      });
      this.applyProfile(profile);
    });
    this.setData({ activeChecked: !!this.data.profile.active });
  },

  async loadList(reset) {
    const tab = this.data.tab;
    const path = LIST_PATHS[tab];
    if (!this._authorized || !path || (!reset && (this._listLoading || !this.data.hasNext))) return;
    this._listLoading = true;
    this.setData({ listLoading: true });
    const sequence = (this._listSequence || 0) + 1;
    this._listSequence = sequence;
    try {
      const page = reset ? 1 : this.data.page + 1;
      const params = { page, size: 20 };
      let productQuery;
      if (this.data.tab === 'products') {
        productQuery = reset ? this.productParams() : this._productQuery || this.productParams();
        Object.assign(params, productQuery);
      }
      if (this.data.tab === 'history') params.historical = true;
      if (this.data.tab === 'records' && this.data.filterStatus) params.status = this.data.filterStatus;
      const result = await api.get(this.base(path), params);
      if (sequence !== this._listSequence || tab !== this.data.tab) return;
      if (tab === 'products') this._productQuery = productQuery;
      const content = Array.isArray(result) ? result : (result.content || []);
      const items = content.map(row => ({
        ...row, channel: tab === 'sharing' ? 'PROFIT_SHARING' : 'LEGACY_TRANSFER',
        statusLabel: tab === 'sharing' ? finance.profitSharingStatus(row.status) : finance.transferStatus(row.status),
        selected: this.data.selectedProducts.includes(String(row.productId))
      }));
      this.setData({
        rows: reset ? items : this.data.rows.concat(items),
        page, hasNext: !Array.isArray(result) && page < result.totalPages, totalElements: Array.isArray(result) ? result.length : Number(result.totalElements || 0),
        error: ''
      });
      if (tab === 'products') this.updateProductSelection(this.data.selectedProducts);
    } catch (error) {
      if (sequence === this._listSequence && tab === this.data.tab) this.fail(error);
    } finally {
      if (sequence === this._listSequence) { this._listLoading = false; this.setData({ listLoading: false }); }
    }
  },

  search() {
    if (this.data.busy) return;
    this.updateProductSelection([]);
    return this.loadList(true);
  },

  async loadProductTags() {
    if (this._tagsLoaded) return;
    try {
      const tags = await api.get('/tags/all');
      this.setData({ tagOptions: [{ value: '', label: '全部标签' }].concat((Array.isArray(tags) ? tags : [])
        .filter(tag => !tag.deleted && !tag.deletedAt).map(tag => ({ value: String(tag.id), label: tag.name }))) });
      this._tagsLoaded = true;
    } catch (error) { this.fail(error); }
  },

  productParams() {
    const params = { keyword: this.data.keyword.trim() };
    if (this.data.stallFilter) params.stallId = this.data.stallFilter;
    if (this.data.tagFilter) params.tagId = this.data.tagFilter;
    if (this.data.productStatus) params.status = this.data.productStatus;
    if (this.data.commissionFilter) params.commissionSet = this.data.commissionFilter === 'yes';
    return params;
  },

  changeProductFilter(event) {
    if (this.data.busy) return;
    const fields = {
      stall: ['stallOptions', 'stallFilter', 'stallFilterIndex'], tag: ['tagOptions', 'tagFilter', 'tagFilterIndex'],
      status: ['statusOptions', 'productStatus', 'statusFilterIndex'], commission: ['commissionOptions', 'commissionFilter', 'commissionFilterIndex']
    };
    const config = fields[event.currentTarget.dataset.filter];
    const index = Number(event.detail.value);
    if (!config || !this.data[config[0]][index]) return;
    this.setData({ [config[1]]: this.data[config[0]][index].value, [config[2]]: index });
    return this.search();
  },

  updateProductSelection(ids) {
    const selectedProducts = [...new Set(ids.map(String))];
    this.setData({ selectedProducts,
      rows: this.data.rows.map(row => ({ ...row, selected: selectedProducts.includes(String(row.productId)) })),
      allProductsSelected: this.data.totalElements > 0 && selectedProducts.length === this.data.totalElements
        && this.data.rows.every(row => selectedProducts.includes(String(row.productId)))
    });
  },

  productChange(event) {
    if (this.data.busy) return;
    const ids = event.detail.value.map(String);
    const visible = new Set(this.data.rows.map(row => String(row.productId)));
    const selected = this.data.selectedProducts.filter(id => !visible.has(id)).concat(ids);
    this.updateProductSelection(selected);
  },

  async selectFiltered() {
    if (this.data.busy || this.data.listLoading) return;
    if (this.data.allProductsSelected) { this.updateProductSelection([]); return; }
    this.setData({ busy: true });
    try {
      const ids = [];
      let page = 1;
      let totalPages = 1;
      do {
        const params = { ...(this._productQuery || this.productParams()), page, size: 100 };
        const result = await api.get(this.base('commission-products'), params);
        (result.content || []).forEach(row => ids.push(String(row.productId)));
        totalPages = result.totalPages;
        if (page === 1) this.setData({ totalElements: Number(result.totalElements || 0) });
        if (ids.length > 1000 || result.totalElements > 1000) {
          throw new Error('单次最多1000件商品，请缩小筛选范围');
        }
        page += 1;
      } while (page <= totalPages);
      this.updateProductSelection(ids);
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
      this.updateProductSelection([]);
    });
  },

  editCommission(event) {
    if (this.data.busy) return;
    const row = this.data.rows.find(item => String(item.productId) === String(event.currentTarget.dataset.id));
    if (!row) return;
    this.setData({ commissionEdit: { productId: String(row.productId), name: row.name },
      singleCommission: row.unitCommission == null ? '' : String(row.unitCommission), commissionError: '' });
  },

  closeCommission() {
    if (!this.data.busy) this.setData({ commissionEdit: null, commissionError: '' });
  },

  async saveSingleCommission() {
    if (!this.data.commissionEdit) return;
    await this.mutate('修改商品佣金', async () => {
      const amount = finance.money(this.data.singleCommission, true);
      const productId = this.data.commissionEdit.productId;
      if (!await finance.confirmAction('确认修改每件佣金', this.data.commissionEdit.name + '：每件佣金 ¥' + amount + '，仅影响后续下单，全部SKU统一。')) return false;
      await api.put(this.base('commissions'), { productIds: [productId], unitCommission: amount });
      this.setData({ rows: this.data.rows.map(row => String(row.productId) === productId ? { ...row, unitCommission: amount } : row),
        commissionEdit: null, singleCommission: '', commissionError: '' });
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

  applyReceiver(receiver) {
    const type = this.data.receiverTypes.find(item => item.value === (receiver || {}).relationType);
    const label = type && type.value === 'CUSTOM' ? receiver.customRelation || type.label : type && type.label;
    this.setData({ receiver, receiverSummary: receiver && receiver.registered
      ? '已登记' + (label ? ' · ' + label : '') : '未登记' });
  },

  openReceiver() {
    if (!this._authorized || this.data.busy) return;
    const receiver = this.data.receiver || {};
    const index = receiver.registered ? this.data.receiverTypes.findIndex(type => type.value === receiver.relationType) : -1;
    const type = this.data.receiverTypes[index];
    this.setData({
      receiverVisible: true, receiverError: '', receiverVerified: false,
      receiverTypeIndex: index, receiverTypeLabel: type ? type.label : '请选择已核实的实际关系',
      receiverRelationType: type ? type.value : '',
      customRelation: type && type.value === 'CUSTOM' ? receiver.customRelation || '' : '',
      receiverReason: receiver.registered ? receiver.reason || '' : ''
    });
  },

  closeReceiver() {
    if (!this.data.busy) this.setData({ receiverVisible: false, receiverError: '' });
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
      const receiver = await api.put(this.base('profit-sharing/receiver'), body);
      this.applyReceiver(receiver);
      this.setData({ receiverVisible: false, receiverError: '', receiverVerified: false, receiverReason: '', customRelation: '',
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
    this._refreshSequence = (this._refreshSequence || 0) + 1;
    this.setData({ busy: true, error: '', receiverError: '', commissionError: '' });
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
    this.setData({ [this.data.commissionEdit ? 'commissionError' : this.data.receiverVisible ? 'receiverError' : 'error']: error.message || error.errMsg || '操作失败' });
  }
});
