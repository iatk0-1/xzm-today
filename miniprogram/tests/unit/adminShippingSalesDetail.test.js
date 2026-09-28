const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
const requests = [];
const navigations = [];
let responses = [];
global.Page = config => { pageConfig = config; };
global.wx = {
  showToast() {}, setNavigationBarTitle() {},
  navigateTo({ url }) { navigations.push(url); }
};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return { get(url, params) {
    requests.push({ url, params });
    return responses.shift() || Promise.resolve({ content: [], totalElements: 0 });
  } };
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminShippingSalesDetail/adminShippingSalesDetail.js');
Module._load = originalLoad;

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return page;
}

test('商品详情同一日期下加载概览、SKU 和关联订单，订单可进管理详情', async () => {
  requests.length = 0; navigations.length = 0;
  responses = [
    Promise.resolve({ sold_qty: 8, pending_qty: 3, shipped_qty: 5,
      after_sale_qty: 1, pending_review_qty: 1 }),
    Promise.resolve({ content: [{ skuId: 9, soldQty: 8, pendingQty: 3, shippedQty: 5,
      afterSaleQty: 1, pendingReviewQty: 1 }], totalElements: 1 }),
    Promise.resolve({ content: [{ orderId: 42, status: 'paid', items: [] }], totalElements: 1 })
  ];
  const page = createPage();
  await page.onLoad({ productId: '7', productName: encodeURIComponent('裙子'),
    startDate: '2026-09-01', endDate: '2026-09-28' });
  assert.deepEqual(page.data.overview, { soldQty: 8, pendingQty: 3, shippedQty: 5,
    afterSaleQty: 1, pendingReviewQty: 1 });
  assert.equal(page.data.skus[0].pendingReviewQty, 1);
  assert.equal(page.data.skus[0].afterSaleQty, 1);
  assert.equal(page.data.orders[0].statusDisplay, '待发货');
  assert.deepEqual(requests.map(r => r.url), [
    '/admin/sales/shipping/products/7/overview',
    '/admin/sales/shipping/query',
    '/admin/sales/shipping/products/7/orders'
  ]);
  assert.ok(requests.every(r => r.params.startDate === '2026-09-01'
    && r.params.endDate === '2026-09-28'));
  assert.equal(requests[1].params.productId, '7');
  page.goToOrder({ currentTarget: { dataset: { id: 42 } } });
  assert.equal(navigations[0], '/pages/adminOrderDetail/adminOrderDetail?id=42');
});

test('部分退款待审核和退款成功后的数量分别显示', async () => {
  requests.length = 0;
  responses = [
    Promise.resolve({ sold_qty: 2, pending_qty: 2, shipped_qty: 0,
      after_sale_qty: 0, pending_review_qty: 1 }),
    Promise.resolve({ content: [{ skuId: 9, soldQty: 2, pendingQty: 2, shippedQty: 0,
      afterSaleQty: 0, pendingReviewQty: 1 }], totalElements: 1 }),
    Promise.resolve({ content: [], totalElements: 0 })
  ];
  const page = createPage();
  page.data.productId = '7';
  await page.loadAll();
  assert.equal(page.data.overview.soldQty, 2);
  assert.equal(page.data.overview.pendingQty, 2);
  assert.equal(page.data.overview.afterSaleQty, 0);
  assert.equal(page.data.overview.pendingReviewQty, 1);
  assert.equal(page.data.skus[0].pendingReviewQty, 1);
  page.onShow();

  responses = [
    Promise.resolve({ sold_qty: 1, pending_qty: 1, shipped_qty: 0,
      after_sale_qty: 1, pending_review_qty: 0 }),
    Promise.resolve({ content: [{ skuId: 9, soldQty: 1, pendingQty: 1, shippedQty: 0,
      afterSaleQty: 1, pendingReviewQty: 0 }], totalElements: 1 }),
    Promise.resolve({ content: [], totalElements: 0 })
  ];
  await page.onShow();
  assert.equal(page.data.overview.soldQty, 1);
  assert.equal(page.data.overview.pendingQty, 1);
  assert.equal(page.data.overview.pendingReviewQty, 0);
  assert.equal(page.data.overview.afterSaleQty, 1);
  assert.equal(page.data.skus[0].soldQty, 1);
  assert.equal(page.data.skus[0].afterSaleQty, 1);
});

test('日期切换后的旧 SKU 响应不会覆盖新结果', async () => {
  requests.length = 0;
  let finishOld;
  responses = [
    new Promise(resolve => { finishOld = resolve; }),
    Promise.resolve({ content: [{ skuId: 2 }], totalElements: 1 })
  ];
  const page = createPage();
  page.data.productId = '7';
  const oldRequest = page.loadSkus(true);
  page.data.startDate = '2026-09-28';
  await page.loadSkus(true);
  finishOld({ content: [{ skuId: 1 }], totalElements: 1 });
  await oldRequest;
  assert.equal(page.data.skus[0].skuId, 2);
  assert.equal(requests[1].params.startDate, '2026-09-28');
});
