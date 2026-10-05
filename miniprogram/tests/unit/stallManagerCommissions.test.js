const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const finance = require('../../utils/managerFinance');

function harness({ get, put, confirm = true } = {}) {
  let config;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.js'), 'utf8'), {
    Page: value => { config = value; },
    require: name => name.endsWith('/api') ? {
      async get(url, params) { calls.push({ method: 'get', url, params }); return get(url, params); },
      async put(url, body) { calls.push({ method: 'put', url, body }); return put && put(url, body); }
    } : name.endsWith('/managerFinance') ? { ...finance, confirmAction: async () => confirm } : {},
    wx: { showToast() {}, stopPullDownRefresh() {} }, console
  });
  const page = { ...config, data: structuredClone(config.data), _authorized: true };
  page.setData = patch => Object.assign(page.data, patch);
  page.setData({ userId: '42', tab: 'products' });
  return { page, calls };
}
const event = (id, value) => ({ currentTarget: { dataset: { id } }, detail: { value } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('档口选择器只提供已分配档口，标签选择器排除删除项，所有筛选一起传到后端', async () => {
  const { page, calls } = harness({ get: url => url === '/tags/all'
    ? [{ id: '8', name: '女装' }, { id: '9', name: '旧标签', deleted: true }]
    : { content: [], totalPages: 0, totalElements: 0 } });
  page.applyProfile({ stallIds: ['2'] }, [{ id: '2', name: '二号档口' }, { id: '3', name: '三号档口' }]);
  assert.deepEqual(Array.from(page.data.stallOptions, item => item.value), ['', '2']);
  await page.loadProductTags();
  assert.deepEqual(Array.from(page.data.tagOptions, item => item.value), ['', '8']);
  page.setData({ keyword: ' 棉袄 ', stallFilter: '2', tagFilter: '8', productStatus: 'sold_out', commissionFilter: 'no' });
  await page.search();
  const params = calls[1].params;
  assert.equal(params.keyword, '棉袄');
  assert.equal(params.stallId, '2');
  assert.equal(params.tagId, '8');
  assert.equal(params.status, 'sold_out');
  assert.equal(params.commissionSet, false);
});

test('选择器改变清空选择并重新查第一页，全部状态和全部佣金不传过滤参数', async () => {
  const { page, calls } = harness({ get: () => ({ content: [], totalElements: 0, totalPages: 0 }) });
  page.setData({ selectedProducts: ['old'], allProductsSelected: true, page: 3 });
  await page.changeProductFilter({ currentTarget: { dataset: { filter: 'status' } }, detail: { value: 2 } });
  assert.equal(calls[0].params.status, 'off');
  assert.equal(calls[0].params.page, 1);
  assert.equal(page.data.selectedProducts.length, 0);
  await page.changeProductFilter({ currentTarget: { dataset: { filter: 'status' } }, detail: { value: 0 } });
  assert.equal(Object.hasOwn(calls[1].params, 'status'), false);
  assert.equal(Object.hasOwn(calls[1].params, 'commissionSet'), false);
});

test('关键词尚未提交时分页和全选保持当前结果的筛选，跨页全选能切换取消全选', async () => {
  const { page, calls } = harness({ get: (url, params) => ({
    content: [{ productId: params.page === 1 ? '9007199254740993' : '9007199254740995', name: '商品' }],
    totalElements: '2', totalPages: 2
  }) });
  page.setData({ keyword: '棉袄', tagFilter: '8', productStatus: 'on', commissionFilter: 'yes' });
  await page.search();
  page.setData({ keyword: '未提交的新词' });
  await page.loadList(false);
  await page.selectFiltered();
  assert.equal(page.data.allProductsSelected, true);
  assert.equal(page.data.selectedProducts.length, 2);
  calls.forEach(call => {
    assert.equal(call.params.keyword, '棉袄');
    assert.equal(call.params.tagId, '8');
    assert.equal(call.params.commissionSet, true);
  });
  page.productChange({ detail: { value: ['9007199254740993'] } });
  assert.equal(page.data.allProductsSelected, false);
  await page.selectFiltered();
  assert.equal(page.data.allProductsSelected, true);
  const requestCount = calls.length;
  await page.selectFiltered();
  assert.equal(page.data.allProductsSelected, false);
  assert.equal(page.data.selectedProducts.length, 0);
  assert.equal(calls.length, requestCount);
});

test('筛选请求后来先返回时旧结果不会覆盖当前结果，也不会提前解除加载状态', async () => {
  const first = deferred(), second = deferred();
  const { page } = harness({ get: (url, params) => params.keyword === '旧' ? first.promise : second.promise });
  page.setData({ keyword: '旧' });
  const oldRequest = page.search();
  page.setData({ keyword: '新' });
  const newRequest = page.search();
  first.resolve({ content: [{ productId: 'old' }], totalElements: 1, totalPages: 1 });
  await oldRequest;
  assert.equal(page.data.listLoading, true);
  second.resolve({ content: [{ productId: 'new', soldOut: true, coverUrl: 'cover' }], totalElements: 1, totalPages: 1 });
  await newRequest;
  assert.equal(page.data.rows[0].productId, 'new');
  assert.equal(page.data.rows[0].soldOut, true);
  assert.equal(page.data.rows[0].coverUrl, 'cover');
  assert.equal(page.data.listLoading, false);
});

test('全选超过1000件或中途请求失败不保留半截结果', async () => {
  const { page } = harness({ get: (url, params) => params.page === 1
    ? { content: [{ productId: '1' }], totalElements: 2, totalPages: 2 } : Promise.reject(new Error('第二页失败')) });
  page.setData({ rows: [{ productId: 'old' }], selectedProducts: ['old'] });
  await page.selectFiltered();
  assert.deepEqual(Array.from(page.data.selectedProducts), ['old']);
  assert.equal(page.data.busy, false);
  assert.equal(page.data.error, '第二页失败');
  const large = harness({ get: () => ({ content: [], totalElements: 1001, totalPages: 11 }) });
  await large.page.selectFiltered();
  assert.match(large.page.data.error, /1000/);
  assert.equal(large.calls.length, 1);
});

test('单件佣金允许0、保留雪花ID且不修改其他商品或勾选状态', async () => {
  const { page, calls } = harness();
  page.setData({ rows: [{ productId: '9007199254740993', name: '商品甲', unitCommission: null }, { productId: 'other', unitCommission: '2.00' }],
    selectedProducts: ['other'], totalElements: 2 });
  page.refresh = async () => {};
  page.editCommission(event('9007199254740993'));
  assert.equal(page.data.singleCommission, '');
  page.setData({ singleCommission: '0' });
  await page.saveSingleCommission();
  assert.equal(calls[0].url, '/stall-managers/42/commissions');
  assert.deepEqual(Array.from(calls[0].body.productIds), ['9007199254740993']);
  assert.equal(calls[0].body.unitCommission, '0.00');
  assert.equal(page.data.rows[0].unitCommission, '0.00');
  assert.equal(page.data.rows[1].unitCommission, '2.00');
  assert.deepEqual(Array.from(page.data.selectedProducts), ['other']);
  assert.equal(page.data.commissionEdit, null);
});

test('单独修改比例商品后切为固定佣金并清除全局配置来源', async () => {
  const { page } = harness();
  page.setData({ rows: [{ productId: '1', name: '比例商品', unitCommission: null, profitPercent: '10.00', commissionConfigId: '8' }] });
  page.refresh = async () => {};
  page.editCommission(event('1'));
  page.setData({ singleCommission: '3' });
  await page.saveSingleCommission();
  assert.equal(page.data.rows[0].unitCommission, '3.00');
  assert.equal(page.data.rows[0].profitPercent, null);
  assert.equal(page.data.rows[0].commissionConfigId, null);
});

test('单件佣金非法金额和取消确认不请求接口，保存失败保留表单且禁止重复提交', async () => {
  const pending = deferred();
  const { page, calls } = harness({ put: () => pending.promise });
  page.setData({ rows: [{ productId: '1', name: '商品', unitCommission: '2.00' }] });
  page.editCommission(event('1'));
  page.setData({ singleCommission: '0.001' });
  await page.saveSingleCommission();
  assert.equal(calls.length, 0);
  assert.match(page.data.commissionError, /两位小数/);
  page.setData({ singleCommission: '3.25' });
  const request = page.saveSingleCommission();
  await new Promise(resolve => setImmediate(resolve));
  page.closeCommission();
  await page.saveSingleCommission();
  assert.equal(calls.length, 1);
  pending.reject(new Error('保存失败'));
  await request;
  assert.equal(page.data.singleCommission, '3.25');
  assert.equal(page.data.commissionError, '保存失败');
  assert.equal(page.data.rows[0].unitCommission, '2.00');
  const cancelled = harness({ confirm: false });
  cancelled.page.setData({ rows: [{ productId: '1', unitCommission: '0.00' }] });
  cancelled.page.editCommission(event('1'));
  await cancelled.page.saveSingleCommission();
  assert.equal(cancelled.calls.length, 0);
  assert.ok(cancelled.page.data.commissionEdit);
});

test('批量佣金更新所有选中商品并清空选择，0仍是合法已配置佣金', async () => {
  const { page, calls } = harness();
  page.setData({ rows: [{ productId: '1' }, { productId: '2' }], totalElements: 2, unitCommission: '0' });
  page.updateProductSelection(['1', '2']);
  page.refresh = async () => {};
  await page.setCommission();
  assert.deepEqual(Array.from(calls[0].body.productIds), ['1', '2']);
  assert.equal(calls[0].body.unitCommission, '0.00');
  assert.equal(page.data.selectedProducts.length, 0);
  assert.equal(page.data.allProductsSelected, false);
});
