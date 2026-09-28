const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
global.Page = page => { config = page; };
const navigations = [];
global.wx = { showToast() {}, stopPullDownRefresh() {},
  navigateTo({ url }) { navigations.push(url); } };
const requests = [];
let replies = [];
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {
    get(url, params) {
      requests.push({ url, params });
      return replies.shift() || Promise.resolve({ content: [], totalElements: 0 });
    }
  };
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminShippingSales/adminShippingSales.js');
Module._load = originalLoad;

function page() {
  const instance = Object.assign({}, config);
  instance.data = JSON.parse(JSON.stringify(config.data));
  instance.setData = (patch, callback) => {
    Object.assign(instance.data, patch);
    if (callback) callback();
  };
  return instance;
}

test('统计页默认按当天查询，并以商品为单位分页', async () => {
  requests.length = 0;
  replies = [
    Promise.resolve({ sold_qty: 12, pending_qty: 7, shipped_qty: 5,
      after_sale_qty: 1, pending_review_qty: 1 }),
    Promise.resolve({ content: [
      { productId: 1, productName: '裙子', soldQty: 8, pendingQty: 3,
        shippedQty: 5, afterSaleQty: 1, pendingReviewQty: 1 }
    ], totalElements: 2 }),
    Promise.resolve({ content: [
      { productId: 2, productName: '衬衫', soldQty: 4, pendingQty: 4, shippedQty: 0 }
    ], totalElements: 2 })
  ];
  const instance = page();
  await instance.onLoad();
  const today = instance.formatDate(new Date());
  assert.deepEqual(instance.data.overview, { soldQty: 12, pendingQty: 7, shippedQty: 5,
    afterSaleQty: 1, pendingReviewQty: 1, approvedQty: 0, receivedQty: 0, refundedQty: 0 });
  assert.equal(instance.data.quickSelect, '1day');
  assert.equal(requests[0].params.startDate, today);
  assert.equal(requests[1].url, '/admin/sales/shipping/products');
  assert.equal(requests[1].params.endDate, today);
  assert.equal(instance.data.items[0].productId, 1);
  assert.equal(instance.data.items[0].afterSaleQty, 1);
  assert.equal(instance.data.items[0].pendingReviewQty, 1);
  assert.equal(instance.data.hasMore, true);
  await instance.onReachBottom();
  assert.equal(requests[2].params.page, 2);
  assert.equal(instance.data.items.length, 2);
  assert.equal(instance.data.hasMore, false);
  instance.onShow();
  replies = [
    Promise.resolve({ sold_qty: 11, pending_qty: 6, shipped_qty: 5,
      after_sale_qty: 1, refunded_qty: 1 }),
    Promise.resolve({ content: [{ productId: 1, productName: '裙子', soldQty: 7,
      pendingQty: 2, shippedQty: 5, afterSaleQty: 1, refundedQty: 1 }], totalElements: 1 })
  ];
  await instance.onShow();
  assert.equal(instance.data.overview.refundedQty, 1);
  assert.equal(instance.data.items[0].soldQty, 7);
});

test('切换时间后丢弃旧商品列表响应，并把筛选范围带入详情', async () => {
  requests.length = 0;
  let resolveOld;
  replies = [
    new Promise(resolve => { resolveOld = resolve; }),
    Promise.resolve({ sold_qty: 2, pending_qty: 1, shipped_qty: 1 }),
    Promise.resolve({ content: [{ productId: 2, productName: '新商品' }], totalElements: 1 })
  ];
  const instance = page();
  const old = instance.loadItems(true);
  instance.showDateRangeSelector();
  instance.onStartDateChange({ detail: { value: '2026-09-01' } });
  instance.onEndDateChange({ detail: { value: '2026-09-28' } });
  instance.confirmDateRange();
  await new Promise(resolve => setImmediate(resolve));
  resolveOld({ content: [{ productId: 1 }], totalElements: 1 });
  await old;
  assert.equal(requests[2].params.startDate, '2026-09-01');
  assert.equal(instance.data.items[0].productId, 2);
  navigations.length = 0;
  instance.goToDetail({ currentTarget: { dataset: { item: instance.data.items[0] } } });
  assert.equal(navigations[0], '/pages/adminShippingSalesDetail/adminShippingSalesDetail?productId=2&productName=%E6%96%B0%E5%95%86%E5%93%81&startDate=2026-09-01&endDate=2026-09-28');
});
