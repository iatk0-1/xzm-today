const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

let config;
let handler;
let measure;
const requests = [];
const toasts = [];
const modals = [];
global.Page = value => { config = value; };
global.wx = {
  showLoading() {}, hideLoading() {}, showToast: value => toasts.push(value.title),
  showModal: value => modals.push(value),
  nextTick: callback => callback(),
  createSelectorQuery() {
    const selectors = [];
    let rectCallback;
    return {
      in() { return this; },
      select(value) { selectors.push(value); return this; },
      selectAll(value) { selectors.push(value); return this; },
      boundingClientRect(callback) { rectCallback = callback; return this; },
      exec(callback) {
        if (selectors[0] === '.batch-bar') rectCallback({ height: 140 });
        else measure(callback);
      }
    };
  }
};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return { get: async (url, params) => {
    if (url !== '/products/query') return [];
    requests.push({ ...params });
    return handler(params);
  } };
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {}, isStallManager: () => false };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminProduct/adminProduct');
Module._load = originalLoad;

const product = id => ({ id, name: '棉袄', status: 'on', stallIds: [], relateTagIds: [], skuMatrix: [{ stock: 2 }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
function page() {
  requests.length = 0; toasts.length = 0; modals.length = 0;
  const instance = { ...config, data: structuredClone(config.data) };
  instance.patches = [];
  instance.setData = (patch, callback) => {
    instance.patches.push(patch);
    Object.assign(instance.data, patch);
    if (callback) callback();
  };
  instance.planScheduleRefresh = () => {};
  instance.loadProductTags = () => {};
  measure = callback => callback([{ top: 570, height: 60 }, instance.data.products.map(item => ({
    dataset: { selectionKey: item.id }, bottom: 500, height: 100
  }))]);
  return instance;
}

test('全选从第一页查齐当前筛选商品，跨页去重、保留长ID，并支持取消全选', async () => {
  const instance = page();
  instance.setData({ activeStatus: 'on', selectedStall: '8', selectedTag: '9', searchKeyword: ' 棉袄 ' });
  handler = () => ({ content: [product('9007199254740993')], hasNext: true });
  await instance.loadProducts();
  instance.toggleSelectMode();
  await instance.selectLoadedItems();
  assert.equal(instance.data.allSelected, false);
  instance.data.searchKeyword = '尚未确认的新关键词';
  handler = params => ({ content: params.page === 1 ? [product('9007199254740993')]
    : params.page === 2 ? [product('2')] : [product('2'), product('3')], hasNext: params.page < 3 });
  await instance.toggleSelectAllLoaded();
  assert.deepEqual(requests.map(value => value.page), [1, 1, 2, 3]);
  assert.ok(requests.every(value => value.keyword === '棉袄' && value.stallId === '8'
    && value.tagId === '9' && value.status === 'on' && value.manage === true));
  assert.deepEqual(instance.data.selectedProductIds, ['9007199254740993', '2', '3']);
  assert.equal(instance.data.selectedCount, 3);
  assert.equal(instance.data.products.length, 3);
  assert.equal(instance.data.allSelected, true);
  assert.equal(instance.data.selectingAll, false);
  assert.equal(instance.data.hasMore, false);
  assert.equal(instance.data.page, 4);
  await instance.toggleSelectAllLoaded();
  assert.equal(instance.data.selectedCount, 0);
  assert.equal(requests.length, 4);
});

test('后续页失败保留原列表和勾选，重试查齐后再统一替换并选中', async () => {
  const instance = page();
  handler = () => ({ content: [product('1')], hasNext: true });
  await instance.loadProducts();
  instance.toggleSelectMode();
  instance.toggleProductId('1');
  handler = params => {
    if (params.page === 2) throw new Error('分页失败');
    return { content: [product('2')], hasNext: true };
  };
  await instance.toggleSelectAllLoaded();
  assert.deepEqual(instance.data.products.map(item => item.id), ['1']);
  assert.deepEqual(instance.data.selectedProductIds, ['1']);
  assert.equal(instance.data.page, 2);
  assert.equal(instance.data.allSelected, false);
  assert.equal(instance.data.selectingAll, false);
  assert.equal(toasts.length, 1);
  handler = params => ({ content: [product(String(params.page))], hasNext: params.page < 2 });
  await instance.toggleSelectAllLoaded();
  assert.deepEqual(instance.data.selectedProductIds, ['1', '2']);
  assert.equal(instance.data.allSelected, true);
});

test('查询期间重复点击、触底和批量操作不会发出额外请求', async () => {
  const instance = page();
  handler = () => ({ content: [product('1')], hasNext: true });
  await instance.loadProducts();
  instance.toggleSelectMode();
  instance.toggleProductId('1');
  let finish;
  handler = () => new Promise(resolve => { finish = resolve; });
  const pending = instance.toggleSelectAllLoaded();
  await tick();
  await instance.toggleSelectAllLoaded();
  await instance.loadMore();
  await instance.selectLoadedItems();
  instance.toggleProductId('1');
  instance.batchDelete();
  instance.batchSetStatus({ currentTarget: { dataset: { status: 'on' } } });
  instance.openBatchSchedule();
  instance.batchCancelSchedules();
  assert.equal(modals.length, 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(instance.data.selectedProductIds, ['1']);
  finish({ content: [product('1'), product('2')], hasNext: false });
  await pending;
  assert.equal(instance.data.selectedCount, 2);
});

test('查询期间换筛选，旧结果不会覆盖新列表或重新进入多选', async () => {
  const instance = page();
  handler = () => ({ content: [product('1')], hasNext: true });
  await instance.loadProducts();
  instance.toggleSelectMode();
  let finish;
  handler = () => new Promise(resolve => { finish = resolve; });
  const pending = instance.toggleSelectAllLoaded();
  await tick();
  handler = () => ({ content: [product('9')], hasNext: false });
  instance.data.selectedStall = '新档口';
  await instance.loadProducts();
  finish({ content: [product('2')], hasNext: false });
  await pending;
  assert.deepEqual(instance.data.products.map(item => item.id), ['9']);
  assert.equal(instance.data.selectedCount, 0);
  assert.equal(instance.data.selectMode, false);
  assert.equal(instance.data.selectingAll, false);
});

test('退出多选会取消进行中的全选，重新进入后不会被旧响应勾选', async () => {
  const instance = page();
  handler = () => ({ content: [product('1')], hasNext: true });
  await instance.loadProducts();
  instance.toggleSelectMode();
  let finish;
  handler = () => new Promise(resolve => { finish = resolve; });
  const pending = instance.toggleSelectAllLoaded();
  await tick();
  instance.toggleSelectMode();
  instance.toggleSelectMode();
  finish({ content: [product('1'), product('2')], hasNext: false });
  await pending;
  assert.equal(instance.data.selectMode, true);
  assert.equal(instance.data.selectedCount, 0);
  assert.equal(instance.data.selectingAll, false);
});

test('悬浮线只新增线上方商品，包含屏幕外上方，跨线和线下不新选且保留已有选择', async () => {
  const instance = page();
  handler = () => ({ content: ['1', '2', '3', '4'].map(product), hasNext: true });
  await instance.loadProducts();
  instance.toggleSelectMode();
  assert.equal(instance.data.batchBarHeight, 140);
  instance.toggleProductId('4');
  measure = callback => callback([{ top: 570, height: 60 }, instance.data.products.map((item, index) => ({
    dataset: { selectionKey: item.id }, height: 100, bottom: [-20, 590, 620, 900][index]
  }))]);
  await instance.selectLoadedItems();
  assert.deepEqual(instance.data.selectedProductIds, ['4', '1', '2']);
  assert.equal(instance.data.allSelected, false);
  assert.equal(requests.length, 1);
});

test('回顶重复更新内部列表 scroll-top，并展开收起的筛选区', () => {
  const instance = page();
  instance.data.toolbarCollapseHeight = 200;
  instance._toolbarSectionHeights = [200];
  instance.onToolbarScroll({ detail: { scrollTop: 350 } });
  instance.backToTop();
  assert.equal(instance.data.toolbarCollapseOffset, 0);
  assert.equal(instance.data.productScrollTop, 0);
  instance.onToolbarScroll({ detail: { scrollTop: 0 } });
  instance.onToolbarScroll({ detail: { scrollTop: 500 } });
  instance.backToTop();
  assert.deepEqual(instance.patches.filter(patch => 'productScrollTop' in patch).map(patch => patch.productScrollTop), [350, 0, 500, 0]);
});

test('回顶入口控制内部列表，虚线仅多选显示，全选文案使用新范围', () => {
  const template = fs.readFileSync(path.join(__dirname, '../../pages/adminProduct/adminProduct.wxml'), 'utf8');
  assert.match(template, /scroll-top="\{\{productScrollTop\}\}"/);
  assert.match(template, /class="back-to-top" bindtap="backToTop"/);
  assert.match(template, /id="selection-divider"[^>]*wx:if="\{\{selectMode/);
  assert.ok(!template.includes('全选当前列表'));
});
