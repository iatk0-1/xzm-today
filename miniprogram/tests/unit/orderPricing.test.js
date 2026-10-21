const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../../utils/orderPricing');

function draft(patch = {}) {
  return { peerOrder: true, onlineAmount: '0.01', offlineAmount: '99.99', shippingFee: '0',
    offlineMethod: '微信转账', offlineConfirmed: true, reason: '同行拿货', ...patch };
}
test('线上一分钱加线下收款按成交总额校验，运费允许为0', () => {
  assert.deepEqual(pricing.preview(draft(), '80.00', true), { total: '100.00', goods: '100.00', error: '', valid: true });
});
test('同行可以全部线上付款，线下为0时不要求确认或收款方式', () => {
  assert.equal(pricing.preview(draft({ onlineAmount: '100', offlineAmount: '0', offlineMethod: '', offlineConfirmed: false }), '80', true).valid, true);
});
test('扣除运费后达到成本即可，运费不能掩盖低于成本的商品成交额', () => {
  assert.equal(pricing.preview(draft({ onlineAmount: '90', offlineAmount: '0', shippingFee: '10' }), '80', true).valid, true);
  assert.match(pricing.preview(draft({ onlineAmount: '80', offlineAmount: '0', shippingFee: '0.01' }), '80', true).error, /不能低于/);
});
test('缺成本、负数、多位小数、空输入和未到账都禁止提交', () => {
  assert.equal(pricing.preview(draft(), '80', false).valid, false);
  for (const value of ['', '-1', '0.001', 'NaN', '10000000']) assert.equal(pricing.cents(value), null);
  assert.equal(pricing.preview(draft({ onlineAmount: '0' }), '80', true).valid, false);
  assert.equal(pricing.preview(draft({ offlineConfirmed: false }), '80', true).valid, false);
  assert.equal(pricing.preview(draft({ peerOrder: false }), '80', true).valid, false);
});
test('线上线下金额以分计算，不发生字符串拼接或小数误差', () => {
  assert.equal(pricing.preview(draft({ onlineAmount: '0.1', offlineAmount: '0.2' }), '0.30', true).total, '0.30');
  assert.equal(pricing.total({ payAmount: '0.01', offlinePaidAmount: '99.99' }), '100.00');
});

const Module = require('node:module');
const calls = [];
const api = { patch: async (url, body) => { calls.push({ url, body }); }, get: async () => ({}) };
let config;
global.Page = value => { config = value; };
global.wx = { showToast() {}, showModal() {}, showLoading() {}, hideLoading() {} };
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return api;
  if (request.endsWith('utils/auth')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminOrderDetail/adminOrderDetail');
Module._load = originalLoad;
function page() {
  const result = { ...config, data: { ...config.data, orderId: '123',
    pricing: { costAmount: '80', costComplete: true, peerOrder: false }, priceDraft: draft({ revision: '2' }) } };
  result.setData = patch => Object.assign(result.data, patch);
  result.loadOrderDetail = async () => {};
  return result;
}
test('管理员保存实际线上金额、线下金额、免运费和版本号，避免默认强制一分钱', async () => {
  calls.length = 0;
  const value = page();
  value.data.priceDraft = draft({ revision: '2', onlineAmount: '100', offlineAmount: '0', shippingFee: '0' });
  await value.savePrice();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/admin/orders-manage/orders/123/pricing');
  assert.equal(calls[0].body.onlineAmount, 100);
  assert.equal(calls[0].body.offlineAmount, 0);
  assert.equal(calls[0].body.shippingFee, 0);
  assert.equal(calls[0].body.revision, '2');
  assert.equal(calls[0].body.peerOrder, true);
  assert.equal(value.data.showPricePanel, false);
});
test('低于成本或正在保存时，不发送第二次改价请求', async () => {
  calls.length = 0;
  const value = page();
  value.data.priceDraft = draft({ onlineAmount: '1', offlineAmount: '0' });
  await value.savePrice();
  value.data.priceDraft = draft();value.data.priceSaving = true;
  await value.savePrice();
  assert.equal(calls.length, 0);
});

test('退款按成交小计和原购买数量算上限，整行退款尾差不丢失', () => {
  const item = { settlementAmount: '100.00', orderQty: 3, salePrice: '60.00' };
  assert.equal(pricing.refundQtyAmount(item, 3), 100);
  assert.equal(pricing.refundQtyAmount(item, 1), 33.34);
  assert.equal(pricing.refundQtyAmount({ salePrice: '60' }, 1), 60);
});

test('免运费同步减少线上应付，商品成交额不被抬高', () => {
  const value = page();
  value.data.priceDraft = draft({ onlineAmount: '110', offlineAmount: '0', shippingFee: '10' });
  value.waivePriceShipping();
  assert.equal(value.data.priceDraft.shippingFee, '0.00');
  assert.equal(value.data.priceDraft.onlineAmount, '100.00');
  assert.equal(value.data.pricePreview.goods, '100.00');
});
test('运费输入暂时清空后仍正确扣减；不足扣减时要求重填且不自动修改线下款', () => {
  const value = page();
  value.data.priceDraft = draft({ onlineAmount: '110', offlineAmount: '0', shippingFee: '10' });
  value.changePriceShipping('');value.changePriceShipping('0');
  assert.equal(value.data.priceDraft.onlineAmount, '100.00');
  value.data.priceDraft = draft({ onlineAmount: '0.01', offlineAmount: '109.99', shippingFee: '10' });
  value.waivePriceShipping();
  assert.equal(value.data.priceDraft.onlineAmount, '');
  assert.equal(value.data.priceDraft.offlineAmount, '109.99');
  assert.equal(value.data.pricePreview.valid, false);
});
