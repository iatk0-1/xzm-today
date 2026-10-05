const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let captured;
global.Page = config => { captured = config; };
const requests = [];
const toasts = [];
let getHandler;
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {
    get: async (url, params) => getHandler(url, params),
    post: async (url, data) => { requests.push({ url, data }); return {}; }
  };
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  if (request.endsWith('utils/clipboard')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminAfterSaleDetail/adminAfterSaleDetail.js');
const reviewConfig = captured;
require('../../pages/afterSaleApply/afterSaleApply.js');
const applyConfig = captured;
Module._load = originalLoad;

function page(config) {
  const value = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
  value.setData = (patch, callback) => {
    for (const [key, next] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = value.data;
      for (const part of parts.slice(0, -1)) target = target[part];
      target[parts.at(-1)] = next;
    }
    if (callback) callback();
  };
  return value;
}

function reviewPage(shippedQty = 0, type = 'refund', qty = 1, orderQty = 2) {
  const review = page(reviewConfig);
  review.data.afterSaleId = '365599949821317120';
  review.data.afterSale = review.formatAfterSaleDetail({
    id: review.data.afterSaleId, status: 'pending', type,
    items: [{ id: '365599949825511424', orderItemId: '23', status: 'pending', afterSaleType: type,
      qty, requestedQty: qty, requestedRefundAmount: (0.01 * qty).toFixed(2), refundAmount: (0.01 * qty).toFixed(2),
      salePrice: '0.01', shippedQty: type === 'return_refund' ? qty : 0, unshippedQty: type === 'refund' ? qty : 0 }],
    orderDetail: { status: shippedQty === 0 ? 'paid' : 'partial_shipped', items: [{ id: '23', qty: orderQty, shippedQty, salePrice: '0.01' }] }
  });
  review.loadAfterSaleDetail = () => {};
  review.showReviewModal();
  return review;
}

test.beforeEach(() => {
  requests.length = 0; toasts.length = 0;
  global.wx = { showLoading() {}, hideLoading() {}, showToast: value => toasts.push(value.title) };
});

test('待发货商品不能改成退货退款，返回报单选项保留，按仅退款提交剩余一件', async () => {
  const review = reviewPage();
  assert.equal(review.data.reviewItems[0].reviewReturnQtyLimit, 0);
  review.chooseReviewType({ currentTarget: { dataset: { index: 0, type: 'return_refund' } } });
  assert.equal(review.data.reviewItems[0].reviewType, 'refund');
  assert.match(toasts[0], /尚未发货/);
  review.changeReturnPurchaseOrder({ detail: { value: ['return'] } });
  await review.submitReview();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].data, {
    decision: 'approve', rejectReason: null, returnPurchaseOrder: true,
    itemResults: [{ afterSaleItemId: '365599949825511424', orderItemId: '23', decision: 'approve',
      rejectReason: null, qty: 1, refundAmount: '0.01', afterSaleType: 'refund' }]
  });
});

test('提交时再次拦截未发货退货退款，兼容旧售后单手动改回仅退款', async () => {
  const review = reviewPage(0, 'return_refund');
  await review.submitReview();
  assert.equal(requests.length, 0);
  assert.match(toasts[0], /尚未发货/);
  review.chooseReviewType({ currentTarget: { dataset: { index: 0, type: 'refund' } } });
  await review.submitReview();
  assert.equal(requests[0].data.itemResults[0].afterSaleType, 'refund');
});

test('部分发货切换退货退款时只允许已发数量，并按新数量调整金额', async () => {
  const review = reviewPage(1, 'refund', 2, 3);
  review.chooseReviewType({ currentTarget: { dataset: { index: 0, type: 'return_refund' } } });
  const item = review.data.reviewItems[0];
  assert.equal(item.reviewQtyLimit, 1);
  assert.equal(item.reviewQty, '1');
  assert.equal(item.reviewAmount, '0.01');
  review.increaseReviewQty({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(item.reviewQty, '1');
  await review.submitReview();
  assert.equal(requests[0].data.itemResults[0].afterSaleType, 'return_refund');
  assert.equal(requests[0].data.itemResults[0].qty, 1);
});

test('全部已发商品只允许退货退款，当前发货信息缺失时阻止审核', async () => {
  const review = reviewPage(2, 'return_refund', 1, 2);
  assert.equal(review.data.reviewItems[0].reviewRefundQtyLimit, 0);
  review.chooseReviewType({ currentTarget: { dataset: { index: 0, type: 'refund' } } });
  assert.equal(review.data.reviewItems[0].reviewType, 'return_refund');
  await review.submitReview();
  assert.equal(requests.length, 1);
  requests.length = 0;
  review.showReviewModal();
  review.data.reviewItems[0].currentShippedQty = null;
  review.data.reviewItems[0].currentUnshippedQty = null;
  await review.submitReview();
  assert.equal(requests.length, 0);
  assert.match(toasts.at(-1), /发货信息缺失/);
});

test('历史待发货订单已退款一件后，用户只能对剩余一件申请仅退款', async () => {
  getHandler = url => url.startsWith('/orders/')
    ? { status: 'paid', items: [{ id: '23', qty: 2, shippedQty: 0, salePrice: '0.01' }] }
    : { items: [{ status: 'refunded', items: [{ orderItemId: '23', status: 'refunded', qty: 1,
      shippedQty: 0, unshippedQty: 1, refundAmount: '0.01', afterSaleType: 'refund' }] }] };
  const application = page(applyConfig);
  await application.loadOrderDetail('10');
  assert.deepEqual(application.data.splitItems.map(item => [item.type, item.qty]), [['refund', 1]]);
});

test('部分发货的用户申请页按已发和未发拆分售后类型', async () => {
  getHandler = url => url.startsWith('/orders/')
    ? { status: 'partial_shipped', items: [{ id: '23', qty: 3, shippedQty: 1, salePrice: '0.01' }] }
    : { items: [] };
  const application = page(applyConfig);
  await application.loadOrderDetail('10');
  assert.deepEqual(application.data.splitItems.map(item => [item.type, item.qty]), [['return_refund', 1], ['refund', 2]]);
});
