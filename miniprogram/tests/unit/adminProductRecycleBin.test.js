const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function fixture({ list = [], preview = { selectionRequired: false, skus: [] }, post, confirm = true } = {}) {
  let config;
  const calls = [], toasts = [], published = [];
  global.Page = value => { config = value; };
  global.wx = {
    showLoading() {}, hideLoading() {},
    showToast(value) { toasts.push(value); },
    showModal(value) { value.success({ confirm }); }
  };
  const original = Module._load;
  Module._load = function(request, ...args) {
    if (request.endsWith('utils/api')) return {
      get: async (url, params) => { calls.push({ method: 'get', url, params }); return url.endsWith('/restore-preview') ? await preview : list; },
      post: async (url, body) => { calls.push({ method: 'post', url, body }); return post ? post(url, body) : { product: { status: 'on' } }; }
    };
    if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
    if (request.endsWith('utils/autoSearch')) return { wrap: value => value };
    if (request.endsWith('utils/pageSync')) return { wrap: value => value, publish: (...args) => published.push(args) };
    return original.call(this, request, ...args);
  };
  const path = require.resolve('../../pages/adminProductRecycleBin/adminProductRecycleBin.js');
  delete require.cache[path];
  try { require(path); } finally { Module._load = original; }
  const page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return { page, calls, toasts, published };
}
const tap = id => ({ currentTarget: { dataset: { id } } });
const posts = calls => calls.filter(call => call.method === 'post');

test('回收站使用真实删除时间，不把创建时间或历史显示字段冒充删除时间', async () => {
  const { page } = fixture({ list: [
    { id: '1', createdAt: '2020-01-01T00:00:00', deletedAt: '2026-10-05T12:34:00' },
    { id: '2', createdAt: '2020-01-01T00:00:00', deleteTimeStr: '旧值' },
    { id: '3', deletedAt: '无效日期' }
  ] });
  await page.loadProducts();
  assert.equal(page.data.products[0].deleteTimeStr, '2026-10-05 12:34');
  assert.equal(page.data.products[1].deleteTimeStr, '未知');
  assert.equal(page.data.products[2].deleteTimeStr, '未知');
});

test('有删除记录时按批次恢复，保留雪花ID并修正分页偏移和同步其他页面', async () => {
  const id = '90071992547409931';
  const { page, calls, published } = fixture();
  page.data.products = [{ id }, { id: '2' }]; page.data.offset = 20;
  await page.restoreProduct(tap(id));
  assert.deepEqual(posts(calls), [{ method: 'post', url: `/products/deleted/${id}/restore`, body: {} }]);
  assert.deepEqual(page.data.products.map(row => row.id), ['2']);
  assert.equal(page.data.offset, 19);
  assert.deepEqual(published, [['products', id]]);
  assert.equal(page.data.restoreBusy, false);
});

test('旧回收站先展示款式且不默认全选，管理员明确选择后才恢复', async () => {
  const first = '90071992547409932', second = '90071992547409933';
  const { page, calls, toasts } = fixture({
    preview: { selectionRequired: true, skus: [{ id: first, spec: '红色', bundleGroupName: '上衣' }, { id: second, spec: '蓝色' }] },
    post: async () => ({ product: { status: 'off' } })
  });
  page.data.products = [{ id: '1' }]; page.data.offset = 1;
  await page.restoreProduct(tap('1'));
  assert.equal(posts(calls).length, 0);
  assert.deepEqual(page.data.restoreSkuIds, []);
  await page.confirmLegacyRestore();
  assert.equal(posts(calls).length, 0);
  assert.match(page.data.restoreError, /选择/);
  page.changeRestoreSelection({ detail: { value: [first, '伪造ID'] } });
  assert.deepEqual(page.data.restoreSkuIds, [first]);
  await page.confirmLegacyRestore();
  assert.deepEqual(posts(calls)[0].body, { skuIds: [first] });
  assert.equal(page.data.restoreTarget, '');
  assert.equal(page.data.offset, 0);
  assert.equal(toasts.at(-1).title, '已恢复，请核对后上架');
});

test('取消普通恢复或关闭旧款式核对不会发送恢复请求', async () => {
  const normal = fixture({ confirm: false });
  await normal.page.restoreProduct(tap('1'));
  assert.equal(posts(normal.calls).length, 0);
  const legacy = fixture({ preview: { selectionRequired: true, skus: [{ id: '2' }] } });
  await legacy.page.restoreProduct(tap('1'));
  legacy.page.closeRestoreSelection();
  assert.equal(legacy.page.data.restoreTarget, '');
  assert.equal(posts(legacy.calls).length, 0);
});

test('恢复失败保留旧款式选择和商品列表，展示后端中文原因', async () => {
  const { page, calls } = fixture({ preview: { selectionRequired: true, skus: [{ id: '2' }] }, post: async () => { throw new Error('套装分组异常'); } });
  page.data.products = [{ id: '1' }];
  await page.restoreProduct(tap('1'));
  page.changeRestoreSelection({ detail: { value: ['2'] } });
  await page.confirmLegacyRestore();
  assert.equal(posts(calls).length, 1);
  assert.equal(page.data.restoreError, '套装分组异常');
  assert.deepEqual(page.data.restoreSkuIds, ['2']);
  assert.equal(page.data.products.length, 1);
  assert.equal(page.data.restoreBusy, false);
});

test('普通恢复失败展示具体原因并保留列表', async () => {
  const { page, toasts } = fixture({ post: async () => { throw new Error('商品尚未删除'); } });
  page.data.products = [{ id: '1' }];
  await page.restoreProduct(tap('1'));
  assert.equal(page.data.products.length, 1);
  assert.equal(toasts.at(-1).title, '商品尚未删除');
  assert.equal(page.data.restoreBusy, false);
});

test('预览加载或恢复提交期间双击只发一次请求', async () => {
  let resolvePreview;
  const preview = new Promise(resolve => { resolvePreview = resolve; });
  const { page, calls } = fixture({ preview });
  const first = page.restoreProduct(tap('1'));
  await page.restoreProduct(tap('1'));
  assert.equal(calls.length, 1);
  resolvePreview({ selectionRequired: false, skus: [] });
  await first;
  assert.equal(posts(calls).length, 1);
});

test('旧款式提交期间不允许改选择或关闭弹窗', async () => {
  let resolvePost;
  const { page, calls } = fixture({ preview: { selectionRequired: true, skus: [{ id: '2' }] }, post: () => new Promise(resolve => { resolvePost = resolve; }) });
  await page.restoreProduct(tap('1'));
  page.changeRestoreSelection({ detail: { value: ['2'] } });
  const pending = page.confirmLegacyRestore();
  await page.confirmLegacyRestore();
  page.changeRestoreSelection({ detail: { value: [] } }); page.closeRestoreSelection();
  assert.equal(page.data.restoreTarget, '1');
  assert.deepEqual(page.data.restoreSkuIds, ['2']);
  assert.equal(posts(calls).length, 1);
  resolvePost({ product: { status: 'off' } });
  await pending;
  assert.equal(page.data.restoreBusy, false);
});
