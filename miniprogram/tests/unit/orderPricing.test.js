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

test('开启同行默认线上收一分钱加运费，线下补足实际成交总额，原因填线下开单', () => {
  const value = pricing.peerDefaults(draft({ peerOrder: false, onlineAmount: '110.00', offlineAmount: '0', shippingFee: '10', reason: '', offlineConfirmed: true }));
  assert.deepEqual(value.patch, { peerOrder: true, onlineAmount: '10.01', offlineAmount: '99.99', reason: '线下开单', offlineConfirmed: false });
});
test('零运费和已有混合收款均保持当前成交总额，不使用成本价代替成交价', () => {
  assert.equal(pricing.peerDefaults(draft({ onlineAmount: '100', offlineAmount: '0', shippingFee: '0' })).patch.offlineAmount, '99.99');
  assert.deepEqual(pricing.peerDefaults(draft({ onlineAmount: '60', offlineAmount: '40', shippingFee: '5' })).patch,
    { peerOrder: true, onlineAmount: '5.01', offlineAmount: '94.99', reason: '线下开单', offlineConfirmed: false });
  assert.equal(pricing.peerDefaults(draft({ onlineAmount: '120', offlineAmount: '0', shippingFee: '10' })).patch.offlineAmount, '109.99');
});
test('拆分用整数分保留尾差，不能生成负的线下实收', () => {
  const value = pricing.peerDefaults(draft({ onlineAmount: '10.01', offlineAmount: '0', shippingFee: '10' }));
  assert.equal(value.patch.onlineAmount, '10.01');assert.equal(value.patch.offlineAmount, '0.00');
  assert.match(pricing.peerDefaults(draft({ onlineAmount: '10', offlineAmount: '0', shippingFee: '10' })).error, /成交总额/);
  assert.match(pricing.peerDefaults(draft({ onlineAmount: '', offlineAmount: '0' })).error, /有效/);
});
test('同行开关一次填好金额和原因，重新核实线下到账，同时保留已填收款方式', () => {
  const value = page();
  value.data.priceDraft = draft({ peerOrder: false, onlineAmount: '110', offlineAmount: '0', shippingFee: '10', reason: '旧原因', offlineMethod: '现金' });
  value.onPeerOrderChange({ detail: { value: true } });
  assert.equal(value.data.priceDraft.onlineAmount, '10.01');
  assert.equal(value.data.priceDraft.offlineAmount, '99.99');
  assert.equal(value.data.priceDraft.reason, '线下开单');
  assert.equal(value.data.priceDraft.offlineMethod, '现金');
  assert.equal(value.data.priceDraft.offlineConfirmed, false);
  assert.equal(value.data.pricePreview.total, '110.00');
});
test('开启同行后仍可手工改成全线上收款，重复开关事件和保存期间不覆盖修改', () => {
  const value = page();
  value.data.priceDraft = draft({ peerOrder: false, onlineAmount: '100', offlineAmount: '0', reason: '' });
  value.onPeerOrderChange({ detail: { value: true } });
  value.updatePriceDraft({ onlineAmount: '100', offlineAmount: '0', reason: '同行线上付款' });
  value.onPeerOrderChange({ detail: { value: true } });
  assert.equal(value.data.priceDraft.onlineAmount, '100');assert.equal(value.data.priceDraft.reason, '同行线上付款');
  value.data.priceSaving = true;
  value.onPeerOrderChange({ detail: { value: false } });
  assert.equal(value.data.priceDraft.peerOrder, true);
});
test('同行默认拆分后免运费线上回到一分钱，线下实收不自动改变', () => {
  const value = page();
  value.data.priceDraft = draft({ peerOrder: false, onlineAmount: '110', offlineAmount: '0', shippingFee: '10' });
  value.onPeerOrderChange({ detail: { value: true } });
  value.waivePriceShipping();
  assert.equal(value.data.priceDraft.onlineAmount, '0.01');
  assert.equal(value.data.priceDraft.offlineAmount, '99.99');
  assert.equal(value.data.pricePreview.total, '100.00');
});
test('金额无效时拒绝开启同行，保留原输入；已保存同行订单不能取消标记', () => {
  const value = page();
  value.data.priceDraft = draft({ peerOrder: false, onlineAmount: '', offlineAmount: '0' });
  value.onPeerOrderChange({ detail: { value: true } });
  assert.equal(value.data.priceDraft.peerOrder, false);
  assert.equal(value.data.priceDraft.onlineAmount, '');
  value.data.pricing.peerOrder = true;value.data.priceDraft = draft();
  value.onPeerOrderChange({ detail: { value: false } });
  assert.equal(value.data.priceDraft.peerOrder, true);
});
