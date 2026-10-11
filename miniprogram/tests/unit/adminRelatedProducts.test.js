const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = value => JSON.parse(JSON.stringify(value));
const tap = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
function setup(manager = false) {
  let definition;
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const controls = { get: async url => url === '/products/query' ? { content: [], hasNext: false } : [] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/admin/admin.js'), 'utf8'), {
    Page: value => { definition = value; }, console, Set,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    wx: { showToast() {}, disableAlertBeforeUnload() {} },
    require(name) {
      if (name.endsWith('/api')) return { get: async (url, params) => { calls.push({ url, params }); return controls.get(url, params); } };
      if (name.endsWith('/auth')) return { isStallManager: () => manager };
      if (name.endsWith('/error')) return { getErrorMessage: (err, fallback) => err.message || fallback };
      if (name.endsWith('/productPricing')) return { integrateProductPricing() {} };
      return {};
    }
  });
  const page = { ...definition, data: plain(definition.data) };
  page.setData = update => Object.assign(page.data, update);
  page._markDirty = () => {};
  return { page, calls, controls, timers };
}
const product = id => ({ id, name: '商品' + id, coverUrl: 'cover.jpg' });

test('商品关联使用后端联合搜索，档口负责人仅加载负责档口，支持翻页', async () => {
  const { page, calls, controls } = setup(true);
  controls.get = async url => url === '/products/query' ? { content: [product('1')], hasNext: true } : [];
  await page.openRelatedModal();
  page.setData({ searchKeyword: '  外套  ' });
  await page.selectRelatedStall(tap('stall', '3'));
  await page.selectRelatedTag(tap('tag', '4'));
  await page.loadMoreRelatedProducts();
  assert.deepEqual(plain(calls.at(-1)), { url: '/products/query', params: {
    page: 2, size: 20, status: 'all', manage: true, keyword: '外套', stallId: '3', tagId: '4'
  } });
  assert.equal(calls.some(call => call.url === '/stall-managers/stalls/mine'), true);
  assert.equal(calls.some(call => call.url === '/stalls/all'), false);
  await page.selectRelatedStall(tap('stall', 'all'));
  assert.equal('stallId' in calls.at(-1).params, false);
  assert.equal(calls.at(-1).params.tagId, '4');
});

test('已有关联和跨筛选多选保留，排除商品本身，确认后才更新表单', async () => {
  const { page, controls } = setup();
  page.setData({ editId: '5', manualRelated: [product('99')] });
  controls.get = async url => url === '/products/query' ? { content: [product('5'), product('1')], hasNext: true } : [];
  await page.openRelatedModal();
  assert.deepEqual(plain(page.data.filteredProducts.map(item => item.id)), ['1']);
  page.toggleRelated(tap('id', '1'));
  controls.get = async () => ({ content: [product('2')], hasNext: false });
  await page.selectRelatedTag(tap('tag', '8'));
  page.toggleRelated(tap('id', '2'));
  assert.deepEqual(plain(page.data.manualRelated.map(item => item.id)), ['99']);
  controls.get = async () => ({ content: [product('1')], hasNext: false });
  await page.selectRelatedTag(tap('tag', 'all'));
  assert.equal(page.data.filteredProducts[0].selected, true);
  page.confirmRelated();
  assert.deepEqual(plain(page.data.manualRelated.map(item => item.id)), ['99', '1', '2']);
  assert.equal(page.data.showRelatedModal, false);
});

test('取消窗口丢弃临时勾选，重新打开恢复已保存关联', async () => {
  const { page, controls } = setup();
  page.setData({ manualRelated: [product('99')] });
  controls.get = async url => url === '/products/query' ? { content: [product('1')], hasNext: false } : [];
  await page.openRelatedModal();
  page.toggleRelated(tap('id', '1'));
  page.closeRelatedModal();
  assert.deepEqual(plain(page.data.manualRelated.map(item => item.id)), ['99']);
  await page.openRelatedModal();
  assert.deepEqual(plain(page.data.relatedSelection.map(item => item.id)), ['99']);
  assert.equal(page.data.filteredProducts[0].selected, false);
});

test('搜索停顿前不追加分页，晚返回的旧请求不覆盖新筛选', async () => {
  const { page, controls, calls, timers } = setup();
  page.setData({ showRelatedModal: true });
  let resolveOld;
  controls.get = () => new Promise(resolve => { resolveOld = resolve; });
  const old = page.loadRelatedProducts(true);
  page.onSearchInput({ detail: { value: '新商品' } });
  const count = calls.length;
  await page.loadMoreRelatedProducts();
  assert.equal(calls.length, count);
  controls.get = async () => ({ content: [product('new')], hasNext: false });
  await page.searchRelatedProducts();
  resolveOld({ content: [product('old')], hasNext: true });
  await old;
  assert.deepEqual(plain(page.data.filteredProducts.map(item => item.id)), ['new']);
  assert.equal(timers.size, 0);
});

test('关闭窗口和页面卸载废弃请求、清理搜索计时器', async () => {
  const { page, controls, timers } = setup();
  page.setData({ showRelatedModal: true });
  let resolveOld;
  controls.get = () => new Promise(resolve => { resolveOld = resolve; });
  const task = page.loadRelatedProducts(true);
  page.closeRelatedModal();
  resolveOld({ content: [product('old')], hasNext: false });
  await task;
  assert.deepEqual(plain(page.data.filteredProducts), []);
  page.onSearchInput({ detail: { value: '衣服' } });
  page.onUnload();
  assert.equal(timers.size, 0);
  assert.equal(page.data.relatedLoading, false);
});

test('分页失败允许重试且不丢失已勾选商品', async () => {
  const { page, controls } = setup();
  controls.get = async url => url === '/products/query' ? { content: [product('1')], hasNext: true } : [];
  await page.openRelatedModal();
  page.toggleRelated(tap('id', '1'));
  controls.get = async () => { throw new Error('查询失败'); };
  await page.loadMoreRelatedProducts();
  assert.equal(page.data.relatedError, '查询失败');
  assert.equal(page.data.relatedPage, 2);
  controls.get = async () => ({ content: [product('1')], hasNext: false });
  await page.searchRelatedProducts();
  assert.equal(page.data.filteredProducts[0].selected, true);
  page.confirmRelated();
  assert.deepEqual(plain(page.data.manualRelated.map(item => item.id)), ['1']);
});
