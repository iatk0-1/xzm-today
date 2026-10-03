const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(name, { get, put } = {}) {
  let definition;
  const calls = [], navigations = [];
  const api = {
    async get(url, params) { calls.push({ method: 'get', url, params }); return get ? get(url, params) : {}; },
    async put(url, body) { calls.push({ method: 'put', url, body }); return put(url, body); }
  };
  const finance = { requireText: value => String(value) };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../../pages/${name}/${name}.js`), 'utf8'), {
    Page: config => { definition = config; },
    require: module => module.endsWith('/api') ? api : module.endsWith('/auth')
      ? { ensureAuthenticated: async () => {}, isAdmin: () => true }
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

test('保存期间重复移除不重复请求，上下线失败开关回到服务端状态', async () => {
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
  const failed = harness('stallManagerDetail', { put: () => { throw new Error('下线失败'); } });
  failed.page.applyProfile(profile([2]), stalls);
  await failed.page.toggleActive({ detail: { value: false } });
  assert.equal(failed.calls[0].body.active, false);
  assert.equal(failed.page.data.activeChecked, true);
  assert.equal(failed.page.data.profile.active, true);
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

test('档口跳转保留负责人筛选，商品跳转进入商品详情', () => {
  const { page, navigations } = harness('stallManagerDetail');
  page.data.userId = '42';
  page.applyProfile(profile([2]), stalls);
  page.openStall(event(2));
  const query = new URL('https://miniapp.test' + navigations[0]).searchParams;
  assert.equal(query.get('id'), '2');
  assert.equal(query.get('managerId'), '42');
  assert.equal(query.get('name'), '二号档口');
  page.openProduct(event(9));
  assert.equal(navigations[1], '/pages/detail/detail?id=9');
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
