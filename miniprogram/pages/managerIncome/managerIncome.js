const { getErrorMessage } = require('../../utils/error');
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const finance = require('../../utils/managerFinance');
const customerServiceNavigation = require('../../utils/customerServiceNavigation');
const REQUEST_PATH = '/stall-managers/profit-sharing/withdrawals/mine';
const LIST_PATHS = {
  requests: REQUEST_PATH,
  records: '/stall-managers/commission-records/mine',
  eligibility: '/stall-managers/profit-sharing/eligibility/mine',
  sharing: '/stall-managers/profit-sharing/mine',
  withdrawals: '/stall-managers/withdrawals/mine'
};
Page({
  data: {
    accessState: 'checking', profile: null, income: {}, tab: 'records', rows: [], page: 1, hasNext: false,
    busy: false, loading: false, error: '', statusFilter: '',
    currentRequest: null, pendingRequestKey: '', requestMissing: false, requestUncertain: false
  },
  async onLoad() {
    this._visible = true;
    await this.refresh();
  },
  async onShow() { this._visible = true; await this.refresh(); },
  onHide() { this._visible = false; this.clearAccess('checking'); },
  onUnload() { this._visible = false; this.clearAccess('checking'); },
  currentOwner() {
    const account = auth.getUserInfo() || {};
    return auth.isStallManager() ? String(account.userId || account.id || '') : '';
  },
  clearAccess(accessState, error = '') {
    this._authorized = false;
    this._authorizedOwner = '';
    this._accessVersion = (this._accessVersion || 0) + 1;
    this._listSequence = (this._listSequence || 0) + 1;
    this._requestOwner = '';
    // 只清理页面状态；原申请编号仍按账号保留在本地，返回后继续核对原申请。
    this.setData({ accessState, error, profile: null, income: {}, rows: [], page: 1, hasNext: false,
      loading: false, busy: false, currentRequest: null, pendingRequestKey: '', requestMissing: false, requestUncertain: false });
    return this._accessVersion;
  },
  accessContext() { return { version: this._accessVersion, owner: this._authorizedOwner }; },
  isCurrent(context) {
    if (!context || context.version !== this._accessVersion || this._visible === false || !this._authorized) return false;
    if (!context.owner || context.owner !== this.currentOwner()) {
      this.clearAccess('denied', '账号或操作身份已变化，请返回个人中心切换身份后重试');
      return false;
    }
    return true;
  },
  async refresh() {
    if (this._visible === false) return;
    const account = auth.getUserInfo() || {};
    const actor = String(account.userId || account.id || '') + ':' + account.role;
    if (this._refreshTask && this._refreshActor === actor && this._refreshVersion === this._accessVersion) return this._refreshTask;
    const version = this.clearAccess('checking');
    this._refreshActor = actor;
    this._refreshVersion = version;
    const task = this.verifyAndLoad(version);
    this._refreshTask = task;
    try { await task; }
    finally { if (this._refreshTask === task) this._refreshTask = null; }
  },
  async verifyAndLoad(version) {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (version !== this._accessVersion || this._visible === false) return;
      const expectedOwner = this.currentOwner();
      if (!expectedOwner) {
        this.clearAccess('denied', '本页仅供已授权的档口负责人使用，请返回个人中心选择对应身份');
        return;
      }
      const [profile, income] = await Promise.all([
        api.get('/stall-managers/mine'), api.get('/stall-managers/income/mine')
      ]);
      if (version !== this._accessVersion || this._visible === false) return;
      if (this.currentOwner() !== expectedOwner) {
        this.clearAccess('denied', '账号或操作身份已变化，请返回个人中心切换身份后重试');
        return;
      }
      if (!profile || String(profile.userId) !== expectedOwner) throw new Error('负责人身份与当前账号不一致，请重新登录');
      if (!income || typeof income !== 'object') throw new Error('佣金账户未加载，请稍后重试');
      this._authorized = true;
      this._authorizedOwner = expectedOwner;
      const context = this.accessContext();
      this.setData({ accessState: 'ready', profile, income: finance.incomeSummary(income), error: '' });
      this.restoreRequestPointer();
      await this.recoverRequest();
      if (this.isCurrent(context)) await this.loadList(true);
    } catch (error) {
      if (version !== this._accessVersion || this._visible === false) return;
      this.clearAccess([401, 403, 404].includes(error.statusCode) ? 'denied' : 'error', getErrorMessage(error, '身份及佣金账户验证失败，请稍后重试'));
    }
  },
  onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasNext) this.loadList(false); },
  async changeTab(event) {
    if (!this.isCurrent(this.accessContext())) return;
    const tab = event.currentTarget.dataset.tab;
    if (!LIST_PATHS[tab]) return;
    this._listSequence = (this._listSequence || 0) + 1;
    this.setData({ tab, rows: [], page: 1, hasNext: false, loading: false, error: '' });
    await this.loadList(true);
  },
  async loadList(reset) {
    const context = this.accessContext();
    if (!this.isCurrent(context) || this.data.loading) return;
    const tab = this.data.tab;
    const sequence = (this._listSequence || 0) + 1;
    this._listSequence = sequence;
    this.setData({ loading: true });
    try {
      const page = reset ? 1 : this.data.page + 1;
      const params = { page, size: 20 };
      if (tab === 'records' && this.data.statusFilter) params.status = this.data.statusFilter;
      const result = await api.get(LIST_PATHS[tab], params);
      if (!this.isCurrent(context) || sequence !== this._listSequence || tab !== this.data.tab) return;
      const content = Array.isArray(result) ? result : (result.content || []);
      const rows = content.map(row => tab === 'requests' ? finance.withdrawalRequestRow(row)
        : tab === 'records' ? finance.incomeRecordRow(row)
        : tab === 'eligibility' ? finance.incomeEligibilityRow(row)
        : tab === 'sharing' ? finance.profitSharingRow(row)
        : tab === 'withdrawals' ? finance.legacyTransferRow(row)
          : row);
      this.setData({ rows: reset ? rows : this.data.rows.concat(rows), page,
        hasNext: !Array.isArray(result) && page < result.totalPages });
    } catch (error) {
      if (this.isCurrent(context) && sequence === this._listSequence && tab === this.data.tab) this.fail(error);
    } finally {
      if (this.isCurrent(context) && sequence === this._listSequence) this.setData({ loading: false });
    }
  },
  productImageError(event) {
    const { index, detailIndex } = event.currentTarget.dataset;
    if (!this.data.rows[index]) return;
    const key = detailIndex == null ? `rows[${index}].productImage` : `rows[${index}].items[${detailIndex}].productImage`;
    this.setData({ [key]: '' });
  },
  assertRequestOwner() {
    if (!this.isCurrent(this.accessContext()) || !this.data.profile || String(this.data.profile.userId) !== this.currentOwner()) throw new Error('账号或身份已经变化，请刷新本人佣金账户后再操作');
  },
  requestStorageKey() {
    const profile = this.data.profile;
    if (!profile || profile.userId == null) throw new Error('负责人身份未加载，请刷新后再提现');
    return 'managerWithdrawalRequest:' + String(profile.userId);
  },
  restoreRequestPointer() {
    if (!this.data.profile || this.data.profile.userId == null) return;
    const owner = String(this.data.profile.userId);
    if (this._requestOwner !== owner) {
      this._requestOwner = owner;
      this.setData({ pendingRequestKey: '', currentRequest: null, requestMissing: false, requestUncertain: false });
    }
    const stored = wx.getStorageSync(this.requestStorageKey());
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored.requestKey || '')) {
      this.setData({ pendingRequestKey: stored.requestKey, requestUncertain: true });
    }
  },
  rememberRequest(requestKey, id) {
    wx.setStorageSync(this.requestStorageKey(), { requestKey, id: id == null ? null : String(id) });
    this.setData({ pendingRequestKey: requestKey });
  },
  acceptRequest(row) {
    if (!row || row.id == null || !row.requestKey) throw new Error('提现申请返回不完整，请保留原申请编号并查询');
    if (this.data.pendingRequestKey && row.requestKey !== this.data.pendingRequestKey) throw new Error('提现申请编号与原请求不一致，请查询原申请');
    const currentRequest = finance.withdrawalRequestRow(row);
    if (currentRequest.terminal) {
      wx.setStorageSync(this.requestStorageKey(), null);
      this.setData({ pendingRequestKey: '' });
    } else this.rememberRequest(row.requestKey, row.id);
    this.setData({ currentRequest, requestMissing: false, requestUncertain: false });
  },
  async recoverRequest() {
    const context = this.accessContext();
    if (!this.isCurrent(context)) return;
    const key = this.data.pendingRequestKey;
    if (!key) return;
    const owner = String(this.data.profile.userId);
    try {
      this.assertRequestOwner();
      const row = await api.get(REQUEST_PATH + '/by-key/' + encodeURIComponent(key));
      if (!this.isCurrent(context) || !this.data.profile || String(this.data.profile.userId) !== owner || this.data.pendingRequestKey !== key) return;
      this.assertRequestOwner();
      this.acceptRequest(row);
    } catch (error) {
      if (!this.isCurrent(context)) return;
      if ([401, 403].includes(error.statusCode)) { this.fail(error); return; }
      if (error.statusCode === 404) this.setData({ requestMissing: true, requestUncertain: false });
      else {
        this.setData({ requestUncertain: true });
        this.fail(new Error('原提现申请结果暂不确定，请继续查询原申请，不能重新生成申请'));
      }
    }
  },
  async withdrawAll() {
    const context = this.accessContext();
    if (!this.isCurrent(context) || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      this.assertRequestOwner();
      if (this.data.pendingRequestKey) {
        await this.recoverRequest();
        if (!this.isCurrent(context)) return;
        if (this.data.requestUncertain || !this.data.requestMissing) {
          await this.loadList(true);
          return;
        }
      } else {
        if (this.data.income.selfWithdrawalEnabled !== true) throw new Error('管理员未开启自助提现，请联系管理员办理佣金提现');
        if (!this.data.income.profitSharingEnabled) throw new Error('微信分账提现功能未开启');
        finance.money(this.data.income.manualWithdrawalAvailable);
      }
      const retry = !!this.data.pendingRequestKey;
      if (this.data.income.selfWithdrawalEnabled !== true) throw new Error('管理员未开启自助提现，请联系管理员办理佣金提现');
      if (!await finance.confirmAction(retry ? '重试同一提现申请' : '确认提现全部合格佣金',
        retry ? '将沿用原申请编号提交，不能重复生成付款。最终金额按原申请快照核对。'
          : '本次申请全部当前合格、未付的已完成佣金，预计 ¥' + finance.money(this.data.income.manualWithdrawalAvailable)
            + '。系统按原微信支付分账到本人微信零钱；超30天等不合格佣金保留线下结算。到账以服务端逐订单结果为准。')) return;
      if (!this.isCurrent(context)) return;
      this.assertRequestOwner();
      const requestOwner = String(this.data.profile.userId);
      const key = this.data.pendingRequestKey || finance.newWithdrawalRequestKey();
      this.rememberRequest(key);
      this.setData({ requestMissing: false, requestUncertain: true, tab: 'requests' });
      const row = await api.request({ url: REQUEST_PATH, method: 'POST', data: { requestKey: key }, idempotencyKey: key });
      if (!this.isCurrent(context)) return;
      this.assertRequestOwner();
      if (String(this.data.profile.userId) !== requestOwner) throw new Error('账号已经变化，请查询该账号的原申请');
      this.acceptRequest(row);
      await this.refresh();
    } catch (error) {
      if (!this.isCurrent(context)) return;
      if ([401, 403].includes(error.statusCode)) { this.fail(error); return; }
      this.setData({ requestUncertain: !!this.data.pendingRequestKey });
      this.fail(new Error(getErrorMessage(error, '提现提交结果暂不确定，请查询或使用同一申请编号重试')));
    } finally { if (this.isCurrent(context)) this.setData({ busy: false }); }
  },
  async queryRequest(event) {
    const context = this.accessContext();
    if (!this.isCurrent(context) || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      this.assertRequestOwner();
      const owner = String(this.data.profile.userId);
      const id = event && event.currentTarget.dataset.id;
      let viewed = null;
      if (id) {
        const row = await api.get(REQUEST_PATH + '/' + encodeURIComponent(String(id)));
        if (!this.isCurrent(context) || !this.data.profile || String(this.data.profile.userId) !== owner) return;
        this.assertRequestOwner();
        if (!this.data.pendingRequestKey || row.requestKey === this.data.pendingRequestKey) this.acceptRequest(row);
        viewed = finance.withdrawalRequestRow(row);
      } else await this.recoverRequest();
      if (!this.isCurrent(context)) return;
      const refreshTask = this.refresh();
      const refreshVersion = this._accessVersion;
      await refreshTask;
      if (viewed && refreshVersion === this._accessVersion && this.isCurrent(this.accessContext()) && this.data.profile && String(this.data.profile.userId) === owner) this.setData({ currentRequest: viewed });
    } catch (error) { if (this.isCurrent(context)) this.fail(error); }
    finally { if (this.isCurrent(context)) this.setData({ busy: false }); }
  },
  async query(event) {
    const context = this.accessContext();
    if (!this.isCurrent(context) || this.data.busy) return;
    const channel = event.currentTarget.dataset.channel;
    if (!['PROFIT_SHARING', 'LEGACY_TRANSFER'].includes(channel)) return;
    const id = encodeURIComponent(String(event.currentTarget.dataset.id));
    this.setData({ busy: true, error: '' });
    try {
      const path = channel === 'PROFIT_SHARING'
        ? '/stall-managers/profit-sharing/mine/' : '/stall-managers/withdrawals/mine/';
      await api.get(path + id);
      if (this.isCurrent(context)) await this.refresh();
    } catch (error) { if (this.isCurrent(context)) this.fail(error); }
    finally { if (this.isCurrent(context)) this.setData({ busy: false }); }
  },
  async confirmLegacyTransfer(event) {
    const context = this.accessContext();
    if (!this.isCurrent(context) || this.data.busy || this.data.tab !== 'withdrawals') return;
    const id = encodeURIComponent(String(event.currentTarget.dataset.id));
    this.setData({ busy: true, error: '' });
    try {
      const row = await api.get('/stall-managers/withdrawals/mine/' + id);
      if (!this.isCurrent(context)) return;
      if (row.status !== 'WAIT_USER_CONFIRM') { await this.refresh(); return; }
      if (!row.mchId || !row.appId || !row.packageInfo) throw new Error('原转账单收款参数不完整，请联系管理员核验');
      if (typeof wx.requestMerchantTransfer !== 'function') throw new Error('当前微信版本不支持原转账单确认，请更新微信');
      await new Promise((resolve, reject) => wx.requestMerchantTransfer({
        mchId: row.mchId, appId: row.appId, package: row.packageInfo,
        success: resolve, fail: reject
      }));
      if (!this.isCurrent(context)) return;
      // 客户端确认不是到账结果，继续查询同一笔历史转账，不新增付款。
      await api.get('/stall-managers/withdrawals/mine/' + id);
      if (this.isCurrent(context)) await this.refresh();
    } catch (error) { if (this.isCurrent(context)) this.fail(error); }
    finally { if (this.isCurrent(context)) this.setData({ busy: false }); }
  },
  goToUser() { wx.switchTab({ url: '/pages/user/user' }); },
  handleCustomerServiceContact(event) { customerServiceNavigation.openFromContact(event); },
  fail(error) {
    const message = getErrorMessage(error, '加载佣金结算信息失败');
    if ([401, 403].includes(error.statusCode)) this.clearAccess('denied', message);
    else this.setData({ error: message });
  }
});
