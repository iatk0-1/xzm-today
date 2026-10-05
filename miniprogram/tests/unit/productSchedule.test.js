const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scheduleUtils = require('../../utils/productSchedule');

test('北京时间与手机时区无关，跨年仍正确转换为带东八区的执行时间', () => {
  assert.deepEqual(scheduleUtils.beijingParts(Date.parse('2026-12-31T16:05:00Z')),
    { date: '2027-01-01', time: '00:05' });
  const schedule = scheduleUtils.buildSchedule('2027-01-01', '00:05', 'on', Date.parse('2026-12-31T15:00:00Z'));
  assert.equal(schedule.executeAt, '2027-01-01T00:05:00+08:00');
  assert.equal(Date.parse(schedule.executeAt), Date.parse('2026-12-31T16:05:00Z'));
});

test('过去时间、无效日期和动作均不能创建定时任务', () => {
  const now = Date.parse('2026-10-06T12:00:00+08:00');
  for (const [date, time, action] of [
    ['2026-10-06', '12:00', 'on'], ['2026-10-05', '23:59', 'off'],
    ['2027-02-30', '12:00', 'on'], ['2027-10-06', '25:00', 'on'],
    ['2027-10-06', '12:00', 'delete']
  ]) assert.throws(() => scheduleUtils.buildSchedule(date, time, action, now));
});

test('弹窗回显北京时间、动作和取消事件，保存中不接受重复操作', () => {
  let definition;
  const events = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../components/productSchedule/index.js'), 'utf8'), {
    Component(value) { definition = value; }, Date,
    require: () => scheduleUtils,
    wx: { showToast() {} }
  });
  const component = { ...definition.methods, data: { ...definition.data, busy: false,
    schedule: { executeAt: '2099-10-06T07:05:00Z', status: 'off', state: 'pending' } },
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, value) { events.push({ name, value }); } };
  definition.observers.visible.call(component, true);
  assert.equal(component.data.date, '2099-10-06');
  assert.equal(component.data.time, '15:05');
  assert.equal(component.data.status, 'off');
  component.confirm();
  assert.equal(events[0].value.executeAt, '2099-10-06T15:05:00+08:00');
  component.cancelSchedule();
  assert.equal(events[1].value.cancelled, true);
  component.data.busy = true;
  component.confirm(); component.cancelSchedule(); component.close();
  component.selectStatus({ currentTarget: { dataset: { status: 'on' } } });
  assert.equal(events.length, 2);
  assert.equal(component.data.status, 'off');
});

function loadPage(name, { fail = false, detail = {}, get } = {}) {
  let definition;
  const requests = [];
  const toasts = [];
  const modals = [];
  const timers = [];
  const write = async (method, url, data) => {
    requests.push({ method, url, data: JSON.parse(JSON.stringify(data)) });
    if (fail) throw new Error('模拟保存失败');
    return { product: { id: '9007199254740993123' } };
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../../pages/${name}/${name}.js`), 'utf8'), {
    Page(value) { definition = value; }, console: { log() {}, warn() {}, error() {} },
    setTimeout(fn, delay) { timers.push({ fn, delay, cancelled: false }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cancelled = true; }, Date, Set,
    wx: { showToast(value) { toasts.push(value.title); }, showLoading() {}, hideLoading() {}, showModal(value) { modals.push(value); } },
    require(moduleName) {
      if (moduleName.endsWith('/api')) return {
        get: async (url, params) => get ? get(url, params) : detail, put: (url, data) => write('put', url, data),
        post: (url, data) => write('post', url, data)
      };
      if (moduleName.endsWith('/auth')) return { isStallManager: () => false, ensureAuthenticated: async () => {} };
      if (moduleName.endsWith('/productSchedule')) return scheduleUtils;
      if (moduleName.endsWith('/purchaseNotice')) return require('../../utils/purchaseNotice');
      if (moduleName.endsWith('/productPricing')) return { integrateProductPricing(page) {
        page.canManuallyPrice = () => true;
        page.productCost = () => null;
        page.skuCost = () => null;
      } };
      if (moduleName.endsWith('/autoSearch')) return { wrap: page => page };
      if (moduleName.endsWith('/stock')) return require('../../utils/stock');
      if (moduleName.endsWith('/managerFinance')) return require('../../utils/managerFinance');
      return {};
    }
  });
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); } };
  page.refreshGrid = () => {};
  page.checkDraft = async () => {};
  page.clearDraft = () => {};
  page._saveLastStallSelection = () => {};
  page.uploadMediaList = async () => ['https://example.com/cover.jpg'];
  page.uploadImageList = async () => [];
  page.uploadSkuImages = async () => ({});
  return { page, requests, toasts, modals, timers };
}

function validProduct(page) {
  Object.assign(page.data, { title: '定时商品', mediaList: [{ url: 'https://example.com/cover.jpg' }],
    skuList: [{ color: '红色', size: 'M', price: '100', stock: '10' }] });
}

test('新增页确认弹窗只改本地，保存商品时才一起提交定时设置', async () => {
  const { page, requests } = loadPage('admin');
  validProduct(page);
  const schedule = { executeAt: '2099-10-06T15:00:00+08:00', status: 'on' };
  page.confirmProductSchedule({ detail: schedule });
  assert.equal(requests.length, 0);
  assert.equal(page.data.productScheduleDirty, true);
  assert.match(page.data.productScheduleSummary, /15:00 定时上架/);
  await page.submitProduct();
  assert.deepEqual(requests[0].data.schedule, schedule);
  assert.equal(requests[0].url, '/products');
});

test('编辑页回显任务，未改定时设置时省略字段，取消任务跟商品保存一起提交', async () => {
  const schedule = { executeAt: '2099-10-06T15:00:00+08:00', status: 'off', state: 'pending' };
  const { page, requests } = loadPage('admin', { detail: {
    product: { id: '9007199254740993123', name: '商品', status: 'off' }, skus: [], schedule
  } });
  await page.loadProductForEdit('9007199254740993123');
  assert.deepEqual(page.data.productSchedule, schedule);
  assert.equal(page.data.productScheduleDirty, false);
  validProduct(page);
  page.data.editId = '9007199254740993123';
  await page.submitProduct();
  assert.equal('schedule' in requests[0].data, false);
  page.confirmProductSchedule({ detail: { cancelled: true } });
  await page.submitProduct();
  assert.deepEqual(requests[1].data.schedule, { cancelled: true });
});

test('定时设置保存到草稿并恢复，失败时保留未保存设置', async () => {
  const { page, requests } = loadPage('admin', { fail: true });
  validProduct(page);
  const schedule = { executeAt: '2099-10-06T15:00:00+08:00', status: 'on' };
  page.confirmProductSchedule({ detail: schedule });
  const draft = page.collectDraftData();
  assert.deepEqual(draft.productSchedule, schedule);
  assert.equal(draft.productScheduleDirty, true);
  page.setData({ productSchedule: null, productScheduleDirty: false });
  page.restoreDraft(draft);
  assert.deepEqual(page.data.productSchedule, schedule);
  assert.equal(page.data.productScheduleDirty, true);
  await page.submitProduct();
  assert.equal(requests.length, 1);
  assert.deepEqual(page.data.productSchedule, schedule);
  assert.equal(page.data.productScheduleDirty, true);
  assert.equal(page._submitted, undefined);
});

test('批量任务保存选中ID的快照且不提前改变商品上下架状态', async () => {
  const { page, requests } = loadPage('adminProduct');
  page.data.products = [{ id: '9007199254740993123', status: 'off' }];
  page.data.selectedProductIds = ['9007199254740993123'];
  page.data.selectedCount = 1;
  page.openBatchSchedule();
  page.data.selectedProductIds = ['9007199254740993999'];
  const schedule = { executeAt: '2099-10-06T15:00:00+08:00', status: 'on' };
  await page.confirmBatchSchedule({ detail: schedule });
  assert.deepEqual(requests[0].data, { productIds: ['9007199254740993123'], schedule });
  assert.equal(requests[0].url, '/products/schedule/batch');
  assert.equal(page.data.products[0].status, 'off');
  assert.equal(page.data.products[0].hasSchedule, true);
  assert.equal(page.data.products[0].scheduleAction, '上架');
  assert.equal(page.data.showProductSchedule, false);
});

function scheduledProduct(id, status = 'off', action = 'on') {
  return { id, status, name: '定时商品', stallIds: [], relateTagIds: [],
    schedule: { executeAt: '2099-10-06T07:05:00Z', status: action, state: 'pending' } };
}

test('已定时筛选独立于商品上下架和库存，列表回显完整北京时间及动作', async () => {
  const queries = [];
  const { page } = loadPage('adminProduct', { get: async (url, query) => {
    if (url !== '/products/query') return [];
    queries.push(query);
    return { content: [scheduledProduct('1'), scheduledProduct('2', 'on', 'off')], hasNext: true };
  } });
  page.data.activeStatus = 'scheduled';
  page.data.searchKeyword = '定时';
  page.data.selectedStall = '42';
  page.data.selectedTag = '43';
  await page.loadProducts();
  assert.equal(queries[0].status, 'scheduled');
  assert.equal(queries[0].stallId, '42');
  assert.equal(queries[0].tagId, '43');
  assert.equal(page.data.products[0].scheduleTimeStr, '2099-10-06 15:05');
  assert.equal(page.data.products[1].scheduleAction, '下架');
  page.data.selectedStall = ''; page.data.selectedTag = '';
  for (const product of page.data.products) assert.equal(page.productMatchesFilters(product), true);
  assert.equal(page.productMatchesFilters({ ...scheduledProduct('3'), schedule: null }), false);
  assert.equal(page.productMatchesFilters({ ...scheduledProduct('4'), schedule: { ...scheduledProduct('4').schedule, state: 'executed' } }), false);
});

test('单件取消先弹二次确认，返回不提交，确认后清理卡片且不改变上下架状态', async () => {
  const { page, requests, modals } = loadPage('adminProduct');
  page.data.products = [page.normalizeProduct(scheduledProduct('9007199254740993123'))];
  const event = { currentTarget: { dataset: { id: '9007199254740993123' } } };
  page.cancelProductSchedule(event);
  assert.equal(modals.length, 1);
  assert.equal(requests.length, 0);
  page.cancelProductSchedule(event);
  assert.equal(modals.length, 1);
  await modals[0].success({ confirm: false });
  assert.equal(requests.length, 0);
  assert.equal(page.data.products[0].hasSchedule, true);
  page.cancelProductSchedule(event);
  await modals[1].success({ confirm: true });
  assert.deepEqual(requests[0].data, { productIds: ['9007199254740993123'], schedule: { cancelled: true } });
  assert.equal(page.data.products[0].schedule, null);
  assert.equal(page.data.products[0].status, 'off');
  assert.equal(page.data.batchOperating, false);
});

test('已定时列表取消任务立即移除卡片，保留其他已选商品', async () => {
  const { page, modals } = loadPage('adminProduct', { get: async url => url === '/products/query'
    ? { content: [scheduledProduct('2')], hasNext: false } : [] });
  page.data.activeStatus = 'scheduled';
  page.data.products = ['1', '2'].map(id => page.normalizeProduct(scheduledProduct(id)));
  page.refreshSelectionState(page.data.products, ['1', '2']);
  page.cancelProductSchedule({ currentTarget: { dataset: { id: '1' } } });
  await modals[0].success({ confirm: true });
  assert.deepEqual(Array.from(page.data.products, item => item.id), ['2']);
  assert.deepEqual(Array.from(page.data.selectedProductIds), ['2']);
  assert.equal(page._scheduleListNeedsRefill, false);
});

test('批量取消使用确认前选中ID快照，取消失败保留任务和多选状态', async () => {
  const { page, requests, modals } = loadPage('adminProduct', { fail: true });
  page.data.products = ['9007199254740993123', '9007199254740993999'].map(id => page.normalizeProduct(scheduledProduct(id)));
  page.refreshSelectionState(page.data.products, ['9007199254740993123']);
  page.batchCancelSchedules();
  page.data.selectedProductIds = ['9007199254740993999'];
  await modals[0].success({ confirm: true });
  assert.deepEqual(requests[0].data.productIds, ['9007199254740993123']);
  assert.equal(page.data.products.every(item => item.hasSchedule), true);
  assert.deepEqual(page.data.selectedProductIds, ['9007199254740993999']);
  assert.equal(page.data.batchOperating, false);
});

test('批量取消清除任务和选择，未选商品的定时任务保持原样', async () => {
  const { page, modals } = loadPage('adminProduct');
  page.data.products = ['1', '2', '3'].map(id => page.normalizeProduct(scheduledProduct(id)));
  page.refreshSelectionState(page.data.products, ['1', '2']);
  page.batchCancelSchedules();
  await modals[0].success({ confirm: true });
  assert.equal(page.data.products[0].hasSchedule, false);
  assert.equal(page.data.products[1].hasSchedule, false);
  assert.equal(page.data.products[2].hasSchedule, true);
  assert.equal(page.data.selectedCount, 0);
});

test('任务到点后刷新已加载各页，已定时列表补齐前移商品且保留有效选择', async () => {
  const pages = [];
  const { page } = loadPage('adminProduct', { get: async (url, query) => {
    if (url !== '/products/query') return [];
    pages.push(query.page);
    return { content: query.page === 1 ? [scheduledProduct('2')] : [scheduledProduct('3')], hasNext: query.page === 1 };
  } });
  page.data.activeStatus = 'scheduled'; page.data.page = 3;
  page.data.products = ['1', '2'].map(id => page.normalizeProduct(scheduledProduct(id)));
  page.refreshSelectionState(page.data.products, ['1', '2']);
  await page.refreshDueScheduleProducts();
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(Array.from(page.data.products, item => item.id), ['2', '3']);
  assert.deepEqual(Array.from(page.data.selectedProductIds), ['2']);
  assert.equal(page.data.page, 3);
  assert.equal(page.data.hasMore, false);
});

test('到点刷新更新商品状态并清理时间，旧响应不能覆盖刚取消的任务', async () => {
  let resolveQuery;
  const { page } = loadPage('adminProduct', { get: async url => url === '/products/query'
    ? new Promise(resolve => { resolveQuery = resolve; }) : [] });
  page.data.page = 2;
  page.data.products = [page.normalizeProduct(scheduledProduct('1'))];
  const refresh = page.refreshDueScheduleProducts();
  await Promise.resolve();
  page.applyScheduleChanges(['1'], null);
  resolveQuery({ content: [scheduledProduct('1')], hasNext: false });
  await refresh;
  assert.equal(page.data.products[0].hasSchedule, false);
  const completed = page.refreshDueScheduleProducts();
  await Promise.resolve();
  resolveQuery({ content: [{ ...scheduledProduct('1', 'on'), schedule: null }], hasNext: false });
  await completed;
  assert.equal(page.data.products[0].status, 'on');
  assert.equal(page.data.products[0].scheduleTimeStr, '');
});

test('页面隐藏后停止定时刷新，返回后重新安排到期检查', () => {
  const { page, timers } = loadPage('adminProduct');
  page.data.products = [page.normalizeProduct(scheduledProduct('1'))];
  page.onShow();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 60000);
  page.onHide();
  assert.equal(timers[0].cancelled, true);
  page.onShow();
  assert.equal(timers.length, 2);
  page.onUnload();
  assert.equal(timers[1].cancelled, true);
});

test('取消任务造成分页前移后，继续加载先补齐旧页再请求下一页，避免漏商品', async () => {
  const requests = [];
  const { page } = loadPage('adminProduct', { get: async (url, query) => {
    if (url !== '/products/query') return [];
    requests.push(query.page);
    return { content: (query.page === 1 ? ['2', '3'] : ['4', '5']).map(id => scheduledProduct(id)),
      hasNext: query.page === 1 };
  } });
  page.data.activeStatus = 'scheduled'; page.data.pageSize = 2; page.data.page = 2;
  page.data.products = [page.normalizeProduct(scheduledProduct('2'))];
  page._scheduleListNeedsRefill = true;
  await page.loadMore();
  assert.deepEqual(requests, [1, 2]);
  assert.deepEqual(Array.from(page.data.products, item => item.id), ['2', '3', '4', '5']);
  assert.equal(page._scheduleListNeedsRefill, false);
});

test('分页补齐请求失败时保留卡片并暂停追加，避免按旧偏移漏掉商品', async () => {
  const requests = [];
  const { page } = loadPage('adminProduct', { get: async (url, query) => {
    if (url !== '/products/query') return [];
    requests.push(query.page);
    throw new Error('模拟刷新失败');
  } });
  page.data.activeStatus = 'scheduled'; page.data.page = 2;
  page.data.products = [page.normalizeProduct(scheduledProduct('2'))];
  page._scheduleListNeedsRefill = true;
  await page.loadMore();
  assert.deepEqual(requests, [1]);
  assert.equal(page._scheduleListNeedsRefill, true);
  assert.equal(page.data.page, 2);
  assert.deepEqual(Array.from(page.data.products, item => item.id), ['2']);
});

test('刷新超过200个已加载商品时分批查询负责人，保留每张卡片的负责人名称', async () => {
  const batchSizes = [];
  const { page } = loadPage('adminProduct', { get: async (url, query) => {
    assert.equal(url, '/stall-managers/products/owners');
    const ids = query.ids.split(',');
    batchSizes.push(ids.length);
    return ids.map(productId => ({ productId, nickname: `负责人${productId}` }));
  } });
  const products = Array.from({ length: 201 }, (_, index) => scheduledProduct(String(index + 1)));
  await page.loadProductOwners(products);
  assert.deepEqual(batchSizes, [200, 1]);
  assert.equal(products[200].managerName, '负责人201');
});

test('批量保存失败保留选择和弹窗，重复确认及超量选择不会再发请求', async () => {
  const { page, requests, toasts } = loadPage('adminProduct', { fail: true });
  page.openBatchSchedule();
  assert.equal(page.data.showProductSchedule, false);
  page.data.selectedCount = 201;
  page.openBatchSchedule();
  assert.match(toasts.at(-1), /200/);
  page.data.selectedCount = 1;
  page.data.selectedProductIds = ['1'];
  page.openBatchSchedule();
  await page.confirmBatchSchedule({ detail: { executeAt: '2099-10-06T15:00:00+08:00', status: 'on' } });
  assert.equal(page.data.showProductSchedule, true);
  assert.deepEqual(page.data.selectedProductIds, ['1']);
  page.data.batchOperating = true;
  await page.confirmBatchSchedule({ detail: {} });
  assert.equal(requests.length, 1);
});
