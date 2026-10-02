const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const finance = require('../../utils/managerFinance');

function pageHarness(file, { get, post, put, manager = false } = {}) {
  let definition;
  const calls = [];
  const api = {
    get: async (url, data) => { calls.push({ method: 'get', url, data }); return get ? get(url, data) : {}; },
    post: async (url, data) => { calls.push({ method: 'post', url, data }); return post ? post(url, data) : {}; },
    put: async (url, data) => { calls.push({ method: 'put', url, data }); return put ? put(url, data) : {}; },
    request: async options => { calls.push({ method: options.method.toLowerCase(), url: options.url, data: options.data, idempotencyKey: options.idempotencyKey }); return post ? post(options.url, options.data) : {}; }
  };
  const storage = new Map();
  const wx = {
    showToast() {}, showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
    showModal(options) { options.success({ confirm: true }); },
    getStorageSync(key) { return storage.get(key); }, setStorageSync(key, value) { storage.set(key, value); }, removeStorageSync(key) { storage.delete(key); }, disableAlertBeforeUnload() {}, enableAlertBeforeUnload() {}
  };
  const auth = {
    ensureAuthenticated: async () => {}, isAdmin: () => !manager, isStallManager: () => manager,
    getUserInfo: () => ({ userId: '42' })
  };
  const cache = new Map();
  const runModule = filename => {
    const target = path.resolve(__dirname, filename);
    if (cache.has(target)) return cache.get(target);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(target, 'utf8'), {
      module, exports: module.exports, Page(value) { definition = value; },
      wx, console, setTimeout: () => 0, clearTimeout() {},
      require(name) {
        if (name.endsWith('/api') || name === './api') return api;
        if (name.endsWith('/auth') || name === './auth') return auth;
        if (name.endsWith('/managerFinance') || name === './managerFinance') {
          return runModule('../../utils/managerFinance.js');
        }
        if (name.endsWith('/productPricing')) return runModule('../../utils/productPricing.js');
        if (name.endsWith('/stock')) return { UNLIMITED_THRESHOLD: 999999999 };
        if (name.endsWith('/config')) return {};
        if (name.endsWith('/draft')) return { loadDraft: async () => null, removeDraft: async () => {} };
        return {};
      }
    }, { filename: target });
    cache.set(target, module.exports);
    return module.exports;
  };
  runModule(file);
  const page = {
    ...definition, data: structuredClone(definition.data),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { if (!target[part]) target[part] = {}; target = target[part]; });
        target[parts[parts.length - 1]] = value;
      }
      if (callback) callback();
    }
  };
  page._authorized = true;
  return { page, calls, wx, auth, storage };
}

test('金额零值仅佣金允许，成本和提现严格大于零且精确到分', () => {
  assert.equal(finance.money('0', true), '0.00');
  assert.equal(finance.money('12.3'), '12.30');
  for (const input of ['0', '-1', '0.001', '1e3', 'NaN', '99999999999']) {
    assert.throws(() => finance.money(input));
  }
});

test('边界点击互补且变更分界点同步相邻区间', () => {
  const segments = [
    { lower: 0, upper: 100, lowerInclusive: false, upperInclusive: true, formula: 'x' },
    { lower: 100, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x' }
  ];
  const changed = finance.toggleBoundary(segments, 0);
  assert.equal(changed[0].upperInclusive, false);
  assert.equal(changed[1].lowerInclusive, true);
  assert.equal(finance.toggleBoundary(changed, 0)[0].upperInclusive, true);
  const moved = finance.changeBoundary(segments, 0, '50.50');
  assert.equal(moved[0].upper, 50.5);
  assert.equal(moved[1].lower, 50.5);
  assert.throws(() => finance.changeBoundary(segments, 0, '0'));
});

test('分账状态独立于历史转账，未知或处理中不能视为到账', () => {
  assert.equal(finance.profitSharingRow({ status: 'PROCESSING' }).terminal, false);
  assert.equal(finance.profitSharingRow({ status: 'NEW_STATE' }).terminal, false);
  assert.equal(finance.profitSharingRow({ status: 'SUCCESS' }).terminal, true);
  assert.equal(finance.profitSharingRow({ status: 'CLOSED' }).terminal, true);
  assert.match(finance.profitSharingStatus('NEW_STATE'), /待查询/);
  assert.equal(typeof finance.confirmTransfer, 'undefined');
});

test('负责人列表第一页为1，只有后续页追加', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagers/stallManagers.js', {
    get: async (_, params) => ({ content: [{ userId: String(params.page) }], totalPages: 2 })
  });
  await page.load(true);
  await page.load(false);
  assert.deepEqual(calls.map(call => call.data.page), [1, 2]);
  assert.equal(page.data.managers.length, 2);
  assert.equal(page.data.hasNext, false);
});

test('批量佣金全筛选收集所有页并保持雪花ID字符串', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', {
    get: async (url, params) => url.endsWith('commission-products')
      ? { content: [{ productId: params.page === 1 ? '9007199254740993' : '9007199254740995' }], totalPages: 2, totalElements: 2 } : {},
    put: async () => {}
  });
  page.setData({ userId: '42', tab: 'products', unitCommission: '3.00' });
  page.refresh = async () => {};
  await page.selectFiltered();
  assert.deepEqual(Array.from(page.data.selectedProducts), ['9007199254740993', '9007199254740995']);
  await page.setCommission();
  const call = calls.find(item => item.method === 'put');
  assert.equal(call.data.unitCommission, '3.00');
  assert.deepEqual(Array.from(call.data.productIds), ['9007199254740993', '9007199254740995']);
});

test('历史缺创建人需确认；任职时间区间包含下单；套装传明确套数与完整ID', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  page.setData({
    userId: '42',
    historyForm: {
      orderItemId: '101', createdAt: '2026-09-01T09:00:00+08:00',
      eligible: true, reason: '历史凭证', unitCommission: '3', creatorConfirmed: false,
      assignmentStartedAt: '2026-08-01T00:00:00+08:00', assignmentEndedAt: '',
      activeStartedAt: '2026-08-01T00:00:00+08:00', activeEndedAt: '',
      isBundle: true, bundleProductName: null, saleUnits: '2', memberIds: '101,102'
    }
  });
  page.refresh = async () => {};
  await page.confirmHistory();
  assert.equal(calls.length, 0);
  assert.match(page.data.error, /创建/);
  page.setData({ 'historyForm.creatorConfirmed': true });
  await page.confirmHistory();
  const item = calls[0].data.items[0];
  assert.equal(item.creatorUserId, '42');
  assert.equal(item.saleUnits, 2);
  assert.deepEqual(Array.from(item.memberOrderItemIds), ['101', '102']);
});

test('分账原交易与历史转账独立查询，无旧转账申请或姓名', async () => {
  const { page, calls, wx } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  wx.requestMerchantTransfer = () => { throw new Error('不应调用旧转账'); };
  page.refresh = async () => {};
  await page.query({ currentTarget: { dataset: { id: '9007199254740993', channel: 'PROFIT_SHARING' } } });
  await page.query({ currentTarget: { dataset: { id: '999', channel: 'LEGACY_TRANSFER' } } });
  assert.deepEqual(calls.map(call => call.url), ['/stall-managers/profit-sharing/mine/9007199254740993', '/stall-managers/withdrawals/mine/999']);
  assert.equal(calls.every(call => call.method === 'get'), true);
  assert.equal(typeof page.withdraw, 'undefined');
  assert.equal(typeof page.confirm, 'undefined');
  assert.equal(Object.hasOwn(page.data, 'realName'), false);
});

test('历史待确认转账只确认已有原单且客户端成功后仍查原单，不新增转账', async () => {
  let queries = 0, confirmation;
  const { page, calls, wx } = pageHarness('../../pages/managerIncome/managerIncome.js', {
    manager: true, get: async () => {
      queries += 1;
      return queries === 1 ? { status: 'WAIT_USER_CONFIRM', mchId: 'old-mch', appId: 'old-app', packageInfo: 'old-package' }
        : { status: 'PROCESSING' };
    }
  });
  page.refresh = async () => {};
  wx.requestMerchantTransfer = options => { confirmation = options; options.success({}); };
  const event = { currentTarget: { dataset: { id: '9007199254740993' } } };
  page.setData({ tab: 'sharing' });
  await page.confirmLegacyTransfer(event);
  assert.equal(calls.length, 0);
  page.setData({ tab: 'withdrawals' });
  await page.confirmLegacyTransfer(event);
  assert.equal(confirmation.mchId, 'old-mch');
  assert.equal(confirmation.package, 'old-package');
  assert.equal(calls.length, 2);
  assert.equal(calls.every(call => call.method === 'get' && call.url === '/stall-managers/withdrawals/mine/9007199254740993'), true);
  assert.equal(page.data.busy, false);
});

test('商品编辑按管理接口读取成本，SKU输入拦截手工改价', async () => {
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    get: async url => url.includes('/products/') ? {
      product: { id: '10', name: '测试', stallIds: [], bannerImages: [], relateTagIds: [] },
      skus: [{ id: '20', spec: '白', size: '均码', retailPrice: '15', costPrice: '10', stockMain: 1 }],
      costPrice: '10', pricingRuleId: '30', pricingRuleName: '基础', pricingRuleVersion: 1,
      pricingRuleSegments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }]
    } : [],
    post: async () => ({ price: '15.00' })
  });
  page.checkDraft = async () => {};
  page.refreshGrid = () => {};
  await page.loadProductForEdit('10');
  assert.equal(calls[0].url, '/products/10?manage=true');
  assert.equal(page.data.costPrice, '10');
  assert.equal(page.data.skuList[0].costPrice, '10.00');
  const original = page.data.skuList[0].price;
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'price' } }, detail: { value: '1' } });
  assert.equal(page.data.skuList[0].price, original);
});

test('单档口选择替换，默认成本不会覆盖已有SKU成本，规则重算整个套装', async () => {
  const { page } = pageHarness('../../pages/admin/admin.js', {
    get: async () => null,
    post: async (_, data) => ({ price: (Number(data.cost) + 5).toFixed(2) })
  });
  page._markDirty = () => {};
  page.useStallPricing = async () => {};
  page.setData({ selectedStalls: [{ id: '1' }] });
  await page.selectStall({ currentTarget: { dataset: { item: { id: '2', name: '档口二' } } } });
  assert.equal(page.data.selectedStalls.length, 1);
  assert.equal(page.data.selectedStalls[0].id, '2');
  page.setData({
    costPrice: '10', pricingRuleId: '30', pricingRuleSegments: [
      { lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }
    ],
    isBundleMode: true, activeGroupIndex: 0,
    skuList: [{ costPrice: '20', price: '999', color: '白', size: '均码' }],
    bundleGroups: [{ id: '7', skuList: [] }, { id: '8', skuList: [{ costPrice: '30', price: '999' }] }]
  });
  await page.recalculatePricing(true);
  assert.equal(page.data.bundleGroups[0].skuList[0].price, '25.00');
  assert.equal(page.data.bundleGroups[1].skuList[0].price, '35.00');
  assert.equal(page.data.skuList[0].costPrice, '20.00');
  const draft = page.collectDraftData();
  assert.equal(draft.costPrice, '10');
  assert.equal(draft.pricingRuleId, '30');
  assert.equal(draft.bundleGroups[1].skuList[0].costPrice, '30.00');
});

test('发布套装编辑提交平铺SKU成本/分组/ID，复制商品清理旧SKU身份', async () => {
  let request;
  const { page } = pageHarness('../../pages/admin/admin.js', {
    get: async () => ({
      id: '30', name: '基础', enabled: true, currentVersion: 1,
      segments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }]
    }),
    post: async (url, body) => url === '/pricing-rules/preview' ? { price: (Number(body.cost) + 5).toFixed(2) } : {},
    put: async (_, body) => { request = body; return {}; }
  });
  page._markDirty = () => {};
  page._saveLastStallSelection = () => {};
  page.clearDraft = async () => {};
  page.uploadMediaList = async () => ['https://example.com/cover.jpg'];
  page.uploadImageList = async () => [];
  page.uploadSkuImages = async rows => rows.map(sku => sku.image || null);
  page.setData({
    editId: '10', title: '套装', selectedStalls: [{ id: '2' }],
    mediaList: [{ url: 'https://example.com/cover.jpg' }], costPrice: '10',
    pricingRuleId: '30', isBundleMode: true, activeGroupIndex: 0,
    skuList: [{ skuId: '20', costPrice: '10', price: '15', stock: 0, image: 'https://example.com/top' }],
    bundleGroups: [{ id: '7', name: '上衣', skuList: [] }, { id: '8', name: '裤子', skuList: [{ skuId: '21', costPrice: '20', price: '25', stock: '3', image: 'https://example.com/trousers' }] }]
  });
  await page.submitProduct();
  assert.equal(request.skus[0].id, '20');
  assert.equal(request.skus[0].bundleGroupId, '7');
  assert.equal(request.skus[0].costPrice, '10.00');
  assert.equal(request.skus[0].retailPrice, 15);
  assert.equal(request.skus[0].stockMain, 0);
  assert.equal(request.skus[0].isUnlimitedStock, false);
  assert.equal(request.skus[0].imageUrl, 'https://example.com/top');
  assert.equal(request.skus[1].imageUrl, 'https://example.com/trousers');
  assert.equal(request.skus[1].bundleGroupId, '8');
  page.copyCurrentProduct();
  assert.equal(page.data.editId, null);
  assert.equal(page.data.skuList[0].skuId, null);
  assert.equal(page.data.skuList[0].costPrice, '10.00');
});

test('管理员手动结算逐条分配总额，凭证、付款时间和冲正原因传后端', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  page.refresh = async () => {};
  page.setData({
    userId: '42', income: { settleableIncome: '100' }, allocations: { '9007199254740993': '20', '2': '15' },
    settlementTotal: '35.00', paidAt: '2026-10-02T09:00:00+08:00',
    paymentMethod: '银行转账', voucher: '凭证123', settlementReason: '核对已付款'
  });
  await page.settleOffline();
  assert.equal(calls[0].url, '/stall-managers/42/offline-settlements');
  assert.equal(calls[0].data.amount, '35.00');
  assert.equal(calls[0].data.allocations[1].recordId, '9007199254740993');
  await page.reverseSettlement({ currentTarget: { dataset: { id: '10' } } });
  assert.equal(calls[1].url, '/stall-managers/42/offline-settlements/10/reverse');
  assert.equal(calls[1].data.reason, '核对已付款');
});

test('管理员冻结表单和所有请求入口取消，历史审计与线下结算保留', () => {
  const { page } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  for (const method of ['freezeAmount', 'toggleWithdrawalBlock', 'releaseFreeze', 'loadFreezes']) assert.equal(typeof page[method], 'undefined');
  assert.equal(typeof page.settleOffline, 'function');
  assert.equal(typeof page.reverseSettlement, 'function');
  const template = fs.readFileSync(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.wxml'), 'utf8');
  assert.doesNotMatch(template, /bindtap="(freezeAmount|toggleWithdrawalBlock|releaseFreeze)"|data-tab="freeze"/);
  assert.match(template, /财务审计/);
});

test('未知微信提现人工核验完整发送账单依据和原单绑定信息', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  page.refresh = async () => {};
  page.setData({
    userId: '42', reconciliation: { id: '88' }, reconciliationStatus: 'CANCELLED',
    verifiedMerchantBillNo: 'SM123', verifiedOpenId: 'openid', verifiedAmount: '12.34',
    proof: '商户资金账单凭证123', reconciliationReason: '核验确定未付款'
  });
  await page.reconcileWithdrawal();
  assert.equal(calls[0].url, '/stall-managers/42/withdrawals/88/reconciliation');
  assert.equal(calls[0].data.status, 'CANCELLED');
  assert.equal(calls[0].data.verifiedMerchantBillNo, 'SM123');
  assert.equal(calls[0].data.proof, '商户资金账单凭证123');
});

test('管理员新建规则先账号偏好后档口，主动选其他规则再按成本重算', async () => {
  const preferred = {
    id: '30', name: '上次规则', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }]
  };
  const assigned = { ...preferred, id: '40', name: '档口规则' };
  const { page } = pageHarness('../../pages/admin/admin.js', {
    get: async url => {
      if (url === '/pricing-rules') return [preferred, assigned];
      if (url.endsWith('/preference/mine')) return { ruleId: '30' };
      if (url.endsWith('/pricing-rule')) return assigned;
      return [];
    },
    post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) })
  });
  page.refreshGrid = () => {};
  page.loadRecentStallsAndTags = () => {};
  page.loadSizeCategories = () => {};
  page._loadLastStallSelection = () => page.setData({ selectedStalls: [{ id: '2', name: '档口二' }] });
  page.checkDraft = async () => {};
  page._markDirty = () => {};
  page.setData({ costPrice: '10' });
  await page.onLoad({});
  assert.equal(page.data.pricingRuleId, '40');
  await page.choosePricingRule({ detail: { value: 0 } });
  assert.equal(page.data.pricingRuleId, '30');
  assert.equal(page.data.defaultPrice, '15.00');
});

test('负责人已下线显示状态并禁止新商品保存', async () => {
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    manager: true,
    get: async url => url === '/stall-managers/mine' ? { active: false } : []
  });
  page.refreshGrid = () => {};
  page.loadSizeCategories = () => {};
  page.checkDraft = async () => {};
  page._loadLastStallSelection = () => {};
  await page.onLoad({});
  assert.equal(page.data.managerInactive, true);
  await page.submitProduct();
  assert.equal(calls.filter(call => call.method === 'post').length, 0);
});

module.exports = { pageHarness };


test('收入与负责人详情慢请求切页不会把旧佣金写入提现页', async () => {
  for (const file of ['../../pages/managerIncome/managerIncome.js', '../../pages/stallManagerDetail/stallManagerDetail.js']) {
    let finishOld;
    const old = new Promise(resolve => { finishOld = resolve; });
    const { page } = pageHarness(file, {
      get: async url => url.includes('commission-records') ? old : { content: [{ id: 'withdrawal1', status: 'PROCESSING' }], totalPages: 1 }
    });
    page.setData({ userId: '42', tab: 'records' });
    const pending = page.loadList(true);
    await page.changeTab({ currentTarget: { dataset: { tab: 'withdrawals' } } });
    assert.equal(page.data.rows[0].id, 'withdrawal1');
    finishOld({ content: [{ id: 'oldCommission' }], totalPages: 1 });
    await pending;
    assert.equal(page.data.rows[0].id, 'withdrawal1');
    assert.equal(page.data.tab, 'withdrawals');
  }
});

test('直播编辑读取管理成本保留零库存和全套装，提交创建结构且售价禁止手填', async () => {
  const rule = { id: '30', name: '基础', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }] };
  const sku = { id: '20', spec: '白', size: '均码', costPrice: '10', retailPrice: '15', stockMain: 0, unlimitedStock: false };
  const { page, calls } = pageHarness('../../pages/liveRoomPublish/publish.js', {
    get: async url => {
      if (url.startsWith('/products/')) return { product: { name: '直播套装', coverUrl: 'https://example.com/cover', stallIds: ['2'] },
        skus: [sku], bundleGroups: [{ name: '上衣', skus: [sku] }, { name: '裤子', skus: [{ ...sku, id: '21', costPrice: '20', retailPrice: '25' }] }],
        costPrice: '10', pricingRuleId: '30', pricingRuleName: '基础', pricingRuleVersion: 1, pricingRuleSegments: rule.segments };
      if (url === '/stalls/all') return [{ id: '2', name: '档口' }];
      if (url === '/pricing-rules/30') return rule;
      return [];
    },
    post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) })
  });
  page.refreshGrid = () => {};
  page.checkDraft = async () => {};
  page.uploadMediaList = async rows => rows.map(row => row.url);
  page.uploadSkuImages = async rows => rows.map(row => row.image || null);
  page.setData({ productId: '10', editMode: true, sessionId: '9' });
  await page.loadProductForEdit('10');
  assert.equal(calls[0].url, '/products/10?manage=true');
  assert.equal(page.data.skuList[0].stock, '0');
  assert.equal(page.data.bundleGroups[1].skuList[0].price, '25.00');
  page.onSkuInput({ currentTarget: { dataset: { field: 'price', index: 0 } }, detail: { value: '999' } });
  assert.equal(page.data.skuList[0].price, '15.00');
  const draft = page.collectDraftData();
  assert.equal(draft.costPrice, '10');
  assert.equal(draft.bundleGroups[1].skuList[0].costPrice, '20.00');
  await page.submitProduct();
  const request = calls.find(call => call.method === 'put' && call.url === '/live-products/10').data;
  assert.equal(request.costPrice, '10.00');
  assert.equal(request.pricingRuleId, '30');
  assert.equal(request.skus.length, 0);
  assert.equal(request.bundleGroups[0].skus[0].stockMain, 0);
  assert.equal(request.bundleGroups[0].skus[0].isUnlimitedStock, false);
  assert.equal(request.bundleGroups[1].skus[0].costPrice, '20.00');
  assert.equal(request.bundleGroups[1].skus[0].retailPrice, 25);
});

test('直播转普通商品保留成本规则及所有分组并清除旧SKU身份', async () => {
  const rule = { lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' };
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    get: async url => url.startsWith('/products/') ? {
      product: { name: '直播套装' }, skus: [], costPrice: '10', pricingRuleId: '30',
      pricingRuleName: '基础', pricingRuleVersion: 1, pricingRuleSegments: [rule],
      bundleGroups: [{ id: '7', name: '上衣', skus: [{ id: '20', costPrice: '10', retailPrice: '15', stockMain: 0 }] }]
    } : [],
    post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) })
  });
  page.refreshGrid = () => {};
  page.checkDraft = async () => {};
  await page.loadLiveProductForConvert('10');
  assert.equal(calls[0].url, '/products/10?manage=true');
  assert.equal(page.data.pricingRuleId, '30');
  assert.equal(page.data.bundleGroups[0].id, null);
  assert.equal(page.data.skuList[0].skuId, null);
  assert.equal(page.data.skuList[0].stock, '0');
  assert.equal(page.data.skuList[0].costPrice, '10.00');
  assert.equal(page.data.skuList[0].price, '15.00');
});


test('逐交易资格数组完整显示不自动分账原因，不伪造分页或发资金请求', async () => {
  for (const [file, prefix] of [['../../pages/managerIncome/managerIncome.js', '/stall-managers/profit-sharing/eligibility/mine'], ['../../pages/stallManagerDetail/stallManagerDetail.js', '/stall-managers/42/profit-sharing/eligibility']]) {
    const { page, calls } = pageHarness(file, { get: async () => [
      { orderId: '1', transactionId: null, availableAmount: '10', eligible: false, blockedReason: '原微信支付未启用分账' },
      { orderId: '2', transactionId: 'wx2', availableAmount: '20', eligible: false, blockedReason: '超过普通分账30天期限，需线下结算' },
      { orderId: '3', transactionId: 'test3', availableAmount: '30', eligible: false, blockedReason: '不是已验签确认的真实微信支付' }
    ] });
    page.setData({ userId: '42', tab: 'eligibility' });
    await page.loadList(true);
    assert.equal(calls[0].url, prefix);
    assert.equal(page.data.rows.length, 3);
    assert.equal(page.data.rows[1].eligible, false);
    assert.match(page.data.rows[1].blockedReason, /30天/);
    assert.equal(page.data.hasNext, false);
    assert.equal(calls.every(call => call.method === 'get'), true);
  }
});

test('自动分账记录一基分页和历史通道独立，管理员查原单不生成新单', async () => {
  const { page, calls } = pageHarness('../../pages/managerIncome/managerIncome.js', { get: async (_, params) => ({
    content: [{ id: String(params.page), status: 'PROCESSING', transactionId: 'wx1' }], totalPages: 2
  }) });
  page.setData({ tab: 'sharing' });
  await page.loadList(true);
  await page.loadList(false);
  assert.deepEqual(calls.map(call => call.data.page), [1, 2]);
  assert.equal(page.data.rows[0].channel, 'PROFIT_SHARING');
  assert.equal(page.data.rows[0].terminal, false);
  assert.match(page.data.rows[0].statusLabel, /分账/);
  const admin = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  admin.page.setData({ userId: '42' });
  admin.page.refresh = async () => {};
  await admin.page.querySharing({ currentTarget: { dataset: { id: '9007199254740993' } } });
  assert.equal(admin.calls[0].method, 'get');
  assert.equal(admin.calls[0].url, '/stall-managers/42/profit-sharing/9007199254740993');
});

test('分账接收关系没有员工默认，必须本人实际核验、CUSTOM限10字符、无需姓名openid输入', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  page.setData({ userId: '42', receiverReason: '已核实合同' });
  page.refresh = async () => {};
  await page.saveReceiver();
  assert.equal(calls.length, 0);
  assert.match(page.data.error, /先选择/);
  page.receiverTypeChange({ detail: { value: 9 } });
  page.setData({ customRelation: '档口合作方' });
  await page.saveReceiver();
  assert.equal(calls.length, 0);
  page.receiverVerification({ detail: { value: true } });
  page.setData({ customRelation: '一二三四五六七八九十一' });
  await page.saveReceiver();
  assert.equal(calls.length, 0);
  assert.match(page.data.error, /10/);
  page.setData({ customRelation: '档口合作方' });
  await page.saveReceiver();
  assert.equal(calls[0].url, '/stall-managers/42/profit-sharing/receiver');
  assert.equal(calls[0].method, 'put');
  assert.equal(calls[0].data.relationType, 'CUSTOM');
  assert.equal(calls[0].data.customRelation, '档口合作方');
  assert.equal(Object.hasOwn(calls[0].data, 'realName'), false);
  assert.equal(Object.hasOwn(calls[0].data, 'openId'), false);
  assert.equal(page.data.receiverVerified, false);
  assert.equal(page.data.receiverTypeIndex, -1);
});

test('收入页面说明手动提现与功能未开启，取消旧转账及冻结不混淆余额', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../../pages/managerIncome/managerIncome.wxml'), 'utf8');
  assert.match(template, /分账提现功能未开启/);
  assert.match(template, /income.manualWithdrawalAvailable/);
  assert.match(template, /income.profitSharingUnavailable/);
  assert.match(template, /income.profitSharingSettled/);
  assert.match(template, /income.legacyTransferHeld/);
  assert.match(template, /income.legacyTransferSettled/);
  assert.match(template, /item.debtOffsetAmount/);
  assert.match(template, /现金已付/);
  assert.match(template, /退款欠款抵扣/);
  assert.doesNotMatch(template, /income.withdrawalHeld|income.wechatSettled/);
  assert.match(template, /历史商家转账/);
  assert.doesNotMatch(template, /bindtap="withdraw"|bindtap="confirm"|realName|data-field="realName"/);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../../utils/managerFinance.js'), 'utf8'), /requestMerchantTransfer/);
});


test('管理员异常分账账单核验绑定原支付与接收人，不能套用历史转账CANCELLED', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', {
    get: async () => ({ id: '77', transactionId: 'wxT', outOrderNo: 'PS77', amount: '12.00', openId: 'mp本人', status: 'PROCESSING' })
  });
  page.setData({ userId: '42' });
  page.refresh = async () => {};
  await page.openReconciliation({ currentTarget: { dataset: { id: '77', channel: 'PROFIT_SHARING' } } });
  assert.equal(calls[0].url, '/stall-managers/42/profit-sharing/77/reconciliation');
  assert.equal(page.data.reconciliationKind, 'PROFIT_SHARING');
  page.setData({ reconciliationStatus: 'CANCELLED', verifiedMerchantBillNo: 'PS77', verifiedOpenId: 'mp本人',
    verifiedAmount: '12', verifiedTransactionId: 'wxT', proof: '商户原支付分账账单本人未到账凭证', reconciliationReason: '核对该接收人未付款' });
  await page.reconcileWithdrawal();
  assert.equal(calls.length, 1);
  assert.match(page.data.error, /通道/);
  page.setData({ reconciliationStatus: 'CLOSED' });
  await page.reconcileWithdrawal();
  const req = calls[1];
  assert.equal(req.method, 'post');
  assert.equal(req.url, '/stall-managers/42/profit-sharing/77/reconciliation');
  assert.equal(req.data.status, 'CLOSED');
  assert.equal(req.data.transactionId, 'wxT');
  assert.equal(req.data.outOrderNo, 'PS77');
  assert.equal(req.data.openId, 'mp本人');
  assert.equal(req.data.amount, '12.00');
  assert.equal(Object.hasOwn(req.data, 'verifiedMerchantBillNo'), false);
});


const manualPath = '/stall-managers/profit-sharing/withdrawals/mine';
function pendingWithdrawal(key, overrides = {}) {
  return { id: '9007199254740993', requestKey: key, status: 'PROCESSING', requestedAmount: '20', settledAmount: '0', heldAmount: '20', unpaidAmount: '20',
    items: [{ id: '1', orderId: '2', transactionId: 'wx2', snapshotAmount: '20', status: 'WAITING' }], ...overrides };
}
function readyToWithdraw(page) {
  page.setData({ profile: { userId: '42', active: false }, income: { profitSharingEnabled: true, manualWithdrawalAvailable: '20' } });
  page.restoreRequestPointer();
}

test('未点击和刷新返回只GET恢复原申请，订单完成或负责人下线都不自动POST', async () => {
  const key = 'mw_cached_key_1234567890';
  const { page, calls, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', {
    manager: true, get: async url => {
      if (url === '/stall-managers/mine') return { userId: '42', active: false };
      if (url === '/stall-managers/income/mine') return { profitSharingEnabled: true, manualWithdrawalAvailable: '20' };
      if (url.includes('/by-key/')) return pendingWithdrawal(key);
      return { content: [], totalPages: 1 };
    }
  });
  storage.set('managerWithdrawalRequest:42', { requestKey: key });
  await page.onLoad();
  await page.onShow();
  assert.equal(calls.every(call => call.method === 'get'), true);
  assert.equal(page.data.pendingRequestKey, key);
  assert.equal(page.data.currentRequest.status, 'PROCESSING');
  assert.equal(page.data.profile.active, false);
});

test('一键提现全部仅明确确认POST，双击只发一次，body和幂等头同key不输入任意金额', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const { page, calls, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true, post: async () => pending });
  readyToWithdraw(page);
  page.refresh = async () => {};
  const first = page.withdrawAll();
  await Promise.resolve(); await Promise.resolve();
  await page.withdrawAll();
  const posts = calls.filter(call => call.method === 'post');
  assert.equal(posts.length, 1);
  const key = posts[0].data.requestKey;
  assert.match(key, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(posts[0].idempotencyKey, key);
  assert.equal(Object.keys(posts[0].data).length, 1);
  assert.equal(storage.get('managerWithdrawalRequest:42').requestKey, key);
  complete(pendingWithdrawal(key)); await first;
  assert.equal(page.data.currentRequest.status, 'PROCESSING');
  assert.equal(page.data.pendingRequestKey, key);
});

test('用户取消确认不POST不存申请，存储失败也不能先发资金请求', async () => {
  const { page, calls, wx, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  readyToWithdraw(page);
  wx.showModal = options => options.success({ confirm: false });
  await page.withdrawAll();
  assert.equal(calls.length, 0); assert.equal(storage.size, 0);
  wx.showModal = options => options.success({ confirm: true });
  wx.setStorageSync = () => { throw new Error('本地持久化不可用'); };
  await page.withdrawAll();
  assert.equal(calls.length, 0); assert.match(page.data.error, /持久化/);
});

test('POST超时保留原key，查询404后仅再次用户确认才同key提交，不因刷新生成新申请', async () => {
  let count = 0;
  const { page, calls, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', {
    manager: true, get: async () => { throw { statusCode: 404 }; },
    post: async (_, body) => { count++; if (count === 1) throw new Error('timeout'); return pendingWithdrawal(body.requestKey); }
  });
  readyToWithdraw(page); page.refresh = async () => {};
  await page.withdrawAll();
  const key = page.data.pendingRequestKey;
  assert.ok(key); assert.equal(page.data.requestUncertain, true);
  await page.recoverRequest();
  assert.equal(page.data.requestMissing, true);
  assert.equal(calls.filter(call => call.method === 'post').length, 1);
  await page.withdrawAll();
  const posts = calls.filter(call => call.method === 'post');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].data.requestKey, posts[1].data.requestKey);
  assert.equal(posts[0].idempotencyKey, posts[1].idempotencyKey);
  assert.equal(storage.get('managerWithdrawalRequest:42').requestKey, key);
});

test('提交返回丢失而by-key已有单时重试只查原申请，unknown与held不清持久key', async () => {
  let key;
  const { page, calls } = pageHarness('../../pages/managerIncome/managerIncome.js', {
    manager: true, get: async () => pendingWithdrawal(key, { status: 'FUTURE_STATE' }),
    post: async (_, body) => { key = body.requestKey; throw new Error('connection lost'); }
  });
  readyToWithdraw(page); page.refresh = async () => {};
  await page.withdrawAll(); await page.withdrawAll();
  assert.equal(calls.filter(call => call.method === 'post').length, 1);
  assert.equal(page.data.pendingRequestKey, key);
  assert.equal(page.data.currentRequest.terminal, false);
  assert.match(page.data.currentRequest.statusLabel, /待查询/);
});

test('后台SUCCESS到账才展示到账，PARTIAL分清已付和未付，终态才清key且不触发下一次申请', async () => {
  const { page, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  readyToWithdraw(page);
  const key = 'mw_terminal_key_123456789';
  page.rememberRequest(key);
  page.acceptRequest(pendingWithdrawal(key, { status: 'PARTIAL', settledAmount: '5', heldAmount: '0', unpaidAmount: '15' }));
  assert.equal(page.data.currentRequest.statusLabel, '部分到账，请核对快照差额');
  assert.equal(page.data.currentRequest.settledAmount, '5');
  assert.equal(page.data.currentRequest.unpaidAmount, '15');
  assert.equal(page.data.pendingRequestKey, '');
  assert.equal(storage.get('managerWithdrawalRequest:42'), null);
  const success = finance.withdrawalRequestRow(pendingWithdrawal(key, { status: 'SUCCESS', heldAmount: '0', settledAmount: '20', unpaidAmount: '0' }));
  assert.equal(success.statusLabel, '全部到账');
  assert.equal(finance.withdrawalRequestRow(pendingWithdrawal(key, { status: 'SUCCESS', heldAmount: '1' })).terminal, false);
});

test('本地申请仅profile.userId字符串scope，切账号不承接另一用户key，旧profile禁止POST', async () => {
  const { page, calls, auth, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  readyToWithdraw(page);
  page.rememberRequest('mw_owner42_key_123456789');
  auth.getUserInfo = () => ({ userId: '43' });
  await page.withdrawAll(); assert.equal(calls.length, 0);
  assert.match(page.data.error, /账号已经变化/);
  page.setData({ profile: { userId: '43' } }); page.restoreRequestPointer();
  assert.equal(page.data.pendingRequestKey, '');
  assert.equal(storage.get('managerWithdrawalRequest:42').requestKey, 'mw_owner42_key_123456789');
});


test('by-key查询网络失败不会POST也不换key，不同POST返回key保留原提交待核对', async () => {
  const key = 'mw_queryfail_key_123456789';
  const lookup = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true, get: async () => { throw new Error('network'); } });
  readyToWithdraw(lookup.page); lookup.page.rememberRequest(key);
  await lookup.page.withdrawAll();
  assert.equal(lookup.calls.filter(call => call.method === 'post').length, 0);
  assert.equal(lookup.page.data.pendingRequestKey, key);
  assert.equal(lookup.page.data.requestUncertain, true);
  const mismatch = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true,
    post: async () => pendingWithdrawal('mw_mismatch_key_123456789', { status: 'SUCCESS', heldAmount: '0' }) });
  readyToWithdraw(mismatch.page);
  await mismatch.page.withdrawAll();
  const posted = mismatch.calls.find(call => call.method === 'post').data.requestKey;
  assert.equal(mismatch.page.data.pendingRequestKey, posted);
  assert.equal(mismatch.storage.get('managerWithdrawalRequest:42').requestKey, posted);
  assert.match(mismatch.page.data.error, /不一致/);
});

test('申请记录一基分页和逐单状态只来自服务器，管理页无代本人提现按钮', async () => {
  const { page, calls } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true,
    get: async (_, params) => ({ content: [pendingWithdrawal('mw_list_key_123456789', { id: String(params.page) })], totalPages: 2 }) });
  page.setData({ tab: 'requests' });
  await page.loadList(true); await page.loadList(false);
  assert.deepEqual(calls.map(call => call.data.page), [1, 2]);
  assert.equal(page.data.rows[0].statusLabel, '提现处理中');
  assert.equal(page.data.rows[0].items[0].statusLabel, '申请已记录，等待处理');
  assert.equal(page.data.rows[0].settledAmount, '0');
  const own = fs.readFileSync(path.resolve(__dirname, '../../pages/managerIncome/managerIncome.wxml'), 'utf8');
  assert.match(own, /bindtap="withdrawAll"/);
  assert.match(own, /currentRequest.items/);
  assert.match(own, /快照未到账/);
  assert.match(own, /不代表仍然应付/);
  assert.doesNotMatch(own, /data-field="amount"|data-field="openId"|data-field="realName"/);
  const admin = fs.readFileSync(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.wxml'), 'utf8');
  assert.doesNotMatch(admin, /bindtap="withdrawAll"/);
  assert.match(admin, /本人点击提现/);
  assert.doesNotMatch(admin, /自动分账会|自动分账功能/);
});
