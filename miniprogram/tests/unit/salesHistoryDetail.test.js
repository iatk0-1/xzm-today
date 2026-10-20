const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(get) {
  let config;
  const requests = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/adminSalesDetail/adminSalesDetail.js'), 'utf8'), {
    Page: value => { config = value; }, console: { error() {} },
    require: name => name.endsWith('/api') ? { get(url, params) { requests.push({ url, params }); return get(url, params); } }
      : name.endsWith('/error') ? { getErrorMessage: error => error.message } : {},
    wx: { showToast() {} }
  });
  const page = { ...config, data: structuredClone(config.data) };
  page.setData = patch => Object.assign(page.data, patch);
  page.setData({ productId: '9007199254740997', managerId: '9007199254740993', startDate: '2026-09-01', endDate: '2026-09-30' });
  return { page, requests };
}

test('SKU超过100组可以继续加载，同规格不同尺码保留独立行', async () => {
  const { page, requests } = harness(async (url, params) => ({
    content: params.page === 1 ? Array.from({ length: 100 }, (_, index) => ({ skuSpec: '红色', skuSize: String(index), salesCommission: '1.23' }))
      : [{ skuSpec: '红色', skuSize: '100', salesCommission: '2.34' }], totalElements: 101
  }));
  await page.loadSkus();
  assert.equal(page.data.skuHasMore, true);
  await page.loadMoreSkus();
  assert.equal(page.data.skus.length, 101);
  assert.equal(new Set(page.data.skus.map(row => row.skuKey)).size, 101);
  assert.equal(page.data.skuHasMore, false);
  assert.deepEqual(requests.map(r => r.params.page), [1, 2]);
  assert.ok(requests.every(r => r.url.includes('/managers/9007199254740993/') && r.params.startDate === '2026-09-01'));
});

test('订单和SKU下一页失败不推进页码，再次加载重试同一页', async () => {
  for (const kind of ['orders', 'skus']) {
    let attempts = 0;
    const { page, requests } = harness(async () => {
      attempts += 1;
      if (attempts === 2) throw new Error('暂时断网');
      return { content: [{ orderId: String(attempts), skuSpec: '红色', skuSize: String(attempts) }], totalElements: 2 };
    });
    const load = kind === 'orders' ? () => page.loadOrders(true) : () => page.loadSkus();
    const more = kind === 'orders' ? () => page.loadMoreOrders() : () => page.loadMoreSkus();
    await load(); await more(); await more();
    assert.deepEqual(requests.map(r => r.params.page), [1, 2, 2]);
    assert.equal(page.data[kind].length, 2);
  }
});

test('日期切换后概览、SKU和订单都忽略旧日期的慢响应', async () => {
  const old = [];
  const { page } = harness((url, params) => {
    if (params.startDate === '2026-09-01') return new Promise(resolve => old.push(resolve));
    return Promise.resolve({ soldQty: 7, afterSaleQty: 3, afterSaleCount: 99, pendingReviewQty: 2,
      content: [{ orderId: 'new', skuSpec: '新规格', skuSize: 'M' }], totalElements: 1 });
  });
  const pending = page.loadAll();
  page.setData({ startDate: '2026-10-01', endDate: '2026-10-20' });
  await page.loadAll();
  old.forEach(resolve => resolve({ soldQty: 999, afterSaleQty: 999, content: [{ orderId: 'old', skuSpec: '旧规格' }], totalElements: 1 }));
  await pending;
  assert.equal(page.data.overview.soldQty, 7);
  assert.equal(page.data.overview.afterSaleQty, 3);
  assert.equal(page.data.overview.pendingReviewQty, 2);
  assert.equal(page.data.orders[0].orderId, 'new');
  assert.equal(page.data.skus[0].skuSpec, '新规格');
});
