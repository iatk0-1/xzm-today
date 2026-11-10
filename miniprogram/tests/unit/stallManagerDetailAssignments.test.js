const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(name, { get, put, canManage = true } = {}) {
  let definition;
  const calls = [], navigations = [];
  const api = {
    async get(url, params) { calls.push({ method: 'get', url, params }); return get ? get(url, params) : {}; },
    async put(url, body) { calls.push({ method: 'put', url, body }); return put(url, body); }
  };
  const finance = { requireText: value => String(value), confirmAction: async () => true };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../../pages/${name}/${name}.js`), 'utf8'), {
    Page: config => { definition = config; },
    require: module => module.endsWith('/error') ? require('../../utils/error') : module.endsWith('/api') ? api : module.endsWith('/auth')
      ? { ensureAuthenticated: async () => {}, isAdmin: () => true, getUserInfo: () => ({ userId: '7' }), canAccessMenu: () => canManage }
      : module.endsWith('/autoSearch') ? { wrap: config => config } : finance,
    wx: { showToast() {}, stopPullDownRefresh() {}, navigateTo: ({ url }) => navigations.push(url) },
    console
  });
  const page = { ...definition, data: structuredClone(definition.data), _authorized: true };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return { page, calls, navigations };
}

const stalls = [{ id: 2, name: '二号档口' }, { id: 3, name: '三号档口' }, { id: 4, name: '四号档口' }];
const profile = ids => ({ userId: 42, nickname: '负责人甲', active: true, stallIds: ids });
const event = id => ({ currentTarget: { dataset: { id } } });

test('分账关系未登记点击打开空表单，已登记显示中文并回填，取消不修改登记', () => {
  const { page, calls } = harness('stallManagerDetail');
  page.applyReceiver({ registered: false, relationType: null });
  assert.equal(page.data.receiverSummary, '未登记');
  assert.equal(page.data.receiverVisible, false);
  page.openReceiver();
  assert.equal(page.data.receiverVisible, true);
  assert.equal(page.data.receiverTypeIndex, -1);
  page.closeReceiver();
  page.applyReceiver({ registered: true, relationType: 'PARTNER', customRelation: null, reason: '已核实合作协议' });
  assert.equal(page.data.receiverSummary, '已登记 · 合作伙伴');
  page.openReceiver();
  assert.equal(page.data.receiverTypeLabel, '合作伙伴');
  assert.equal(page.data.receiverReason, '已核实合作协议');
  assert.equal(page.data.receiverVerified, false);
  page.receiverTypeChange({ detail: { value: 1 } });
  page.closeReceiver();
  assert.equal(page.data.receiverSummary, '已登记 · 合作伙伴');
  assert.equal(calls.length, 0);
  page.openReceiver();
  assert.equal(page.data.receiverTypeLabel, '合作伙伴');
  page.applyReceiver({ registered: true, relationType: 'CUSTOM', customRelation: '档口合作方', reason: '合同依据' });
  assert.equal(page.data.receiverSummary, '已登记 · 档口合作方');
  page.openReceiver();
  assert.equal(page.data.customRelation, '档口合作方');
});

test('弹窗保存分账关系成功后关闭并立即更新摘要，刷新失败也保留保存结果', async () => {
  const { page, calls } = harness('stallManagerDetail', {
    put: (url, body) => ({ registered: true, ...body }),
    get: () => { throw new Error('刷新失败'); }
  });
  page.data.userId = '42';
  page.openReceiver();
  page.receiverTypeChange({ detail: { value: 3 } });
  page.setData({ receiverReason: '合作协议', receiverVerified: true });
  await page.saveReceiver();
  assert.equal(calls[0].url, '/stall-managers/42/profit-sharing/receiver');
  assert.equal(calls[0].body.relationType, 'PARTNER');
  assert.equal(calls[0].body.reason, '合作协议');
  assert.equal(page.data.receiverVisible, false);
  assert.equal(page.data.receiverSummary, '已登记 · 合作伙伴');
  assert.equal(page.data.error, '刷新失败');
});

test('弹窗校验和保存失败保留输入及已登记摘要，保存期间禁止重复提交和关闭', async () => {
  let reject;
  const { page, calls } = harness('stallManagerDetail', {
    put: () => new Promise((resolve, fail) => { reject = fail; })
  });
  page.applyReceiver({ registered: true, relationType: 'PARTNER', reason: '旧依据' });
  page.openReceiver();
  await page.saveReceiver();
  assert.equal(calls.length, 0);
  assert.match(page.data.receiverError, /核实/);
  page.receiverTypeChange({ detail: { value: 1 } });
  page.setData({ receiverReason: '新合同', receiverVerified: true });
  const pending = page.saveReceiver();
  await new Promise(resolve => setImmediate(resolve));
  page.closeReceiver();
  await page.saveReceiver();
  assert.equal(calls.length, 1);
  assert.equal(page.data.receiverVisible, true);
  reject(new Error('登记失败'));
  await pending;
  assert.equal(page.data.receiverVisible, true);
  assert.equal(page.data.receiverTypeLabel, '员工');
  assert.equal(page.data.receiverReason, '新合同');
  assert.equal(page.data.receiverSummary, '已登记 · 合作伙伴');
  assert.equal(page.data.receiverError, '登记失败');
  assert.equal(page.data.busy, false);
});

test('新增多选立即保存并保留原分配，移除只提交剩余档口且空说明自动记录原因', async () => {
  const { page, calls } = harness('stallManagerDetail', { put: (url, body) => profile(body.stallIds) });
  page.data.userId = '42';
  page.applyProfile(profile([2]), stalls);
  page.refresh = async () => {};
  page.openAssignments();
  assert.deepEqual(Array.from(page.data.availableStalls, item => item.id), [3, 4]);
  page.assignmentChange({ detail: { value: ['2', '3', '4'] } });
  await page.addAssignments();
  assert.deepEqual(Array.from(calls[0].body.stallIds), ['2', '3', '4']);
  assert.match(calls[0].body.reason, /新增分配档口：三号档口、四号档口/);
  assert.equal(page.data.assignmentVisible, false);
  await page.removeAssignment(event(3));
  assert.equal(calls[1].method, 'put');
  assert.equal(calls[1].url, '/stall-managers/42/assignments');
  assert.deepEqual(Array.from(calls[1].body.stallIds), ['2', '4']);
  assert.match(calls[1].body.reason, /移除分配档口：三号档口/);
  assert.deepEqual(Array.from(page.data.assignedStalls, item => item.id), [2, 4]);
});

test('移除最后一个档口发送空列表，保存失败保留原分配与弹层选择', async () => {
  const { page, calls } = harness('stallManagerDetail', { put: () => { throw new Error('保存失败'); } });
  page.data.userId = '42';
  page.applyProfile(profile([2]), stalls);
  await page.removeAssignment(event(2));
  assert.equal(calls[0].body.stallIds.length, 0);
  assert.deepEqual(Array.from(page.data.assignmentIds), ['2']);
  page.openAssignments();
  page.assignmentChange({ detail: { value: ['3'] } });
  await page.addAssignments();
  assert.equal(page.data.assignmentVisible, true);
  assert.deepEqual(Array.from(page.data.newAssignmentIds), ['3']);
  assert.equal(page.data.busy, false);
  assert.equal(page.data.error, '保存失败');
});

test('保存期间重复移除不重复请求，负责人身份调整转到用户授权页面', async () => {
  let resolve;
  const { page, calls } = harness('stallManagerDetail', { put: () => new Promise(done => { resolve = done; }) });
  page.data.userId = '42';
  page.applyProfile(profile([2, 3]), stalls);
  page.refresh = async () => {};
  const pending = page.removeAssignment(event(2));
  await page.removeAssignment(event(3));
  assert.equal(calls.length, 1);
  resolve(profile([3]));
  await pending;
  const identity = harness('stallManagerDetail');
  identity.page.data.userId = '42';
  identity.page.applyProfile(profile([2]), stalls);
  identity.page.toggleActive();
  assert.equal(identity.calls.length, 0);
  assert.equal(identity.navigations[0], '/pages/permissionMembers/index?userId=42');
  assert.equal(identity.page.data.profile.active, true);
});

test('只有负责人财务菜单的岗位不能调整角色或档口，新增负责人使用统一用户授权入口', async () => {
  const reader = harness('stallManagerDetail', { canManage: false });
  reader.page.data.userId = '42';
  reader.page.applyProfile(profile([2]), stalls);
  reader.page.openAssignments();
  await reader.page.removeAssignment(event(2));
  reader.page.toggleActive();
  assert.equal(reader.calls.length, 0);
  assert.equal(reader.navigations.length, 0);
  const manager = harness('stallManagers');
  manager.page.searchUsers();
  assert.equal(manager.navigations[0], '/pages/permissionMembers/index');
  assert.equal(manager.calls.length, 0);
});

test('档口预览按负责人和档口查询，迟到的预览不会复活已移除的档口', async () => {
  let resolve;
  const { page, calls } = harness('stallManagerDetail', { get: () => new Promise(done => { resolve = done; }) });
  page.data.userId = '42';
  page.applyProfile(profile([2]), stalls);
  const pending = page.loadStallPreviews();
  assert.equal(calls[0].url, '/stall-managers/42/commission-products');
  assert.equal(calls[0].params.stallId, 2);
  assert.equal(calls[0].params.size, 4);
  page.applyProfile(profile([]));
  resolve({ content: [{ productId: 8 }], totalElements: 1 });
  await pending;
  assert.equal(page.data.assignedStalls.length, 0);
});

test('保存前发出的刷新迟到时不能覆盖已成功保存的分配', async () => {
  let resolve;
  const { page } = harness('stallManagerDetail', {
    get: url => url === '/stall-managers/42' ? new Promise(done => { resolve = done; })
      : url === '/stalls/all' ? stalls : {},
    put: (url, body) => profile(body.stallIds)
  });
  page.data.userId = '42';
  page.applyProfile(profile([2]), stalls);
  const pending = page.refresh();
  page.refresh = async () => {};
  await page.removeAssignment(event(2));
  resolve(profile([2]));
  await pending;
  assert.equal(page.data.assignmentIds.length, 0);
});

test('负责人档口在本页筛选商品，不依赖档口管理菜单，商品跳转进入详情', async () => {
  const { page, calls, navigations } = harness('stallManagerDetail', {
    get: url => url === '/tags/all' ? [] : { content: [], totalElements: 0, totalPages: 0 }
  });
  page.data.userId = '42';
  page.applyProfile(profile([2]), stalls);
  await page.openStall(event(2));
  assert.equal(page.data.tab, 'products');
  assert.equal(page.data.stallFilter, '2');
  const query = calls.find(call => call.url === '/stall-managers/42/commission-products');
  assert.equal(query.params.stallId, '2');
  assert.equal(navigations.length, 0);
  page.openProduct(event(9));
  assert.equal(navigations[0], '/pages/detail/detail?id=9');
});

test('负责人档口列表搜索、状态和分页始终走负责人接口，末页停止加载', async () => {
  const { page, calls, navigations } = harness('adminCatalogProducts', {
    get: (url, params) => ({ content: [{ productId: params.page, name: '商品', retailPrice: '12.00' }], totalPages: 2 })
  });
  page.setData({ managerId: '42', managerName: '负责人甲', groupId: '2', keyword: '棉袄', status: 'off' });
  await page.loadProducts(true);
  await page.loadProducts(false);
  await page.loadProducts(false);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, '/stall-managers/42/commission-products');
    assert.equal(call.params.stallId, '2');
    assert.equal(call.params.keyword, '棉袄');
    assert.equal(call.params.status, 'off');
  }
  assert.deepEqual(Array.from(calls, call => call.params.page), [1, 2]);
  assert.deepEqual(Array.from(page.data.products, item => item.id), [1, 2]);
  assert.equal(page.data.hasMore, false);
  page.toggleProduct(event(2));
  assert.equal(navigations[0], '/pages/detail/detail?id=2');
  page.renameGroup();
  assert.equal(page.data.renameVisible, false);
});
