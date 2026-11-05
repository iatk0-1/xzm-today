const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const timeout = require('../../utils/orderPaymentTimeout');
const copy = value => JSON.parse(JSON.stringify(value));

function changed(quantity, shortages) {
  return { statusCode: 409, code: 'READY_STOCK_CHANGED', message: '商品现货不足，请确认是否继续下单', details: {
    shortages: shortages || [{ skuId: '11', productName: '羽绒服', color: '黑色', size: 'M', expectedReadyStockQty: 2, readyStockQty: quantity }],
    currentReadyStock: [{ skuId: '11', readyStockQty: quantity }]
  } };
}
function harness({ create, confirm = true, modal, paymentSuccess = false, ready = 1 } = {}) {
  let definition;
  const calls = [], modals = [], drafts = [], removed = [], payments = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/checkout/checkout.js'), 'utf8'), {
    Page(value) { definition = value; }, console: { error() {} }, setTimeout() {},
    require(name) {
      if (name.endsWith('/api')) return { post: async (url, body) => {
        calls.push({ url, body: body && copy(body) });
        if (url === '/orders') return create ? create(body, calls.filter(call => call.url === '/orders').length)
          : { id: '90071992547409933', items: [{ readyStockQty: ready }] };
        return { package: 'prepay_id=test', timeStamp: '1', nonceStr: 'test', paySign: 'test' };
      } };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/skuSelectionDraft')) return { clearCheckoutDrafts: items => drafts.push(items) };
      if (name.endsWith('/skuPromotionDisplay')) return require('../../utils/skuPromotionDisplay');
      if (name.endsWith('/orderPaymentTimeout')) return timeout;
      if (name.endsWith('/error')) return require('../../utils/error');
      return {};
    },
    wx: { showLoading() {}, hideLoading() {}, showToast() {}, redirectTo() {}, reLaunch() {},
      removeStorageSync: key => removed.push(key),
      showModal(options) { modals.push(options);if (modal) modal(options);else if (options.success) options.success({ confirm }); },
      requestPayment(options) { payments.push(options);if (paymentSuccess) options.success({});else options.fail({ errMsg: 'requestPayment:fail cancel' });options.complete(); }
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  Object.assign(page.data, { checkoutItems: [{ skuId: '11', name: '羽绒服', selectedColor: '黑色', selectedSize: 'M', price: 10, count: 3 }],
    address: { recipient: '买家', phone: '13800000000', province: '上海市', city: '上海市', district: '浦东新区', detail: '测试地址' },
    purchaseNoticeReady: true, purchaseNoticeAgreed: true, shippingReady: true, shippingAllowed: true, goodsQuoteReady: true });
  page._localCheckout = true;
  page._checkoutQuote = { originalGoodsAmount: 30, goodsAmount: 30, discountAmount: 0, items: [
    { requestIndex: 0, skuId: '11', quantity: 3, readyStockQty: 2, settlementAmount: 30 }
  ] };
  page.recalculateGoods();
  return { page, calls, modals, drafts, removed, payments };
}

test('含现货下单携带结算预期，取消支付按服务端订单提示保留3分钟', async () => {
  const env = harness();await env.page.submitOrder();
  assert.deepEqual(env.calls[0].body.expectedReadyStock, [{ skuId: '11', readyStockQty: 2 }]);
  assert.equal(env.drafts.length, 1);assert.equal(env.payments.length, 1);
  assert.equal(env.calls[1].url, '/orders/90071992547409933/pay/wechat');
  assert.equal(env.modals.length, 1);assert.equal(env.modals[0].title, '支付已取消');
  assert.equal(env.modals[0].content, '含现货的订单只保留3分钟，到期将自动取消订单，请尽快支付哦~');
});

test('现货被其他订单锁住时先提示商品规格，确认剩余件数后自动重试并拉起支付', async () => {
  const env = harness({ create(body, attempt) { if (attempt === 1) throw changed(1);return { id: '12', items: [{ readyStockQty: 1 }] }; } });
  await env.page.submitOrder();
  assert.equal(env.modals[0].title, '现货不足');assert.match(env.modals[0].content, /羽绒服.*黑色 \/ M.*只剩现货1件/);
  assert.equal(env.modals[0].confirmText, '继续下单');
  assert.deepEqual(env.calls[1].body.expectedReadyStock, [{ skuId: '11', readyStockQty: 1 }]);
  assert.equal(env.page.data.checkoutDisplayItems[0].readyStockQty, 1);assert.equal(env.payments.length, 1);
  assert.equal(env.page._createdOrderId, '12');await env.page.submitOrder();
  assert.equal(env.calls.filter(call => call.url === '/orders').length, 2);
});

test('现货变零选择暂不下单时不重试、不清缓存、不支付，并恢复提交按钮', async () => {
  const env = harness({ create() { throw changed(0); }, confirm: false });await env.page.submitOrder();
  assert.match(env.modals[0].content, /只剩现货0件/);assert.equal(env.calls.length, 1);
  assert.equal(env.payments.length, 0);assert.equal(env.drafts.length, 0);assert.equal(env.removed.length, 0);
  assert.equal(env.page.data.orderCreated, false);assert.equal(env.page.data.submitting, false);
  assert.equal(env.page.data.checkoutDisplayItems[0].readyStockQty, 0);
});

test('确认期间现货再次减少需再次确认，接受全部备货后取消支付提示30分钟', async () => {
  const env = harness({ create(body, attempt) { if (attempt < 3) throw changed(attempt === 1 ? 1 : 0);return { id: '13', items: [{ readyStockQty: 0 }] }; } });
  await env.page.submitOrder();assert.equal(env.modals.filter(modal => modal.title === '现货不足').length, 2);
  assert.deepEqual(env.calls.slice(0, 3).map(call => call.body.expectedReadyStock[0].readyStockQty), [2, 1, 0]);
  assert.equal(env.payments.length, 1);assert.equal(env.drafts.length, 1);
  assert.equal(env.modals[2].content, '订单只保留30分钟，到期将自动取消订单，请尽快支付哦~');
});

test('付款成功不弹二次现货提示，也不显示取消支付保留时间提示', async () => {
  const env = harness({ paymentSuccess: true });await env.page.submitOrder();
  assert.equal(env.payments.length, 1);assert.equal(env.modals.length, 0);
});

test('普通、混合和套装订单按实际下单现货快照判断3分钟或30分钟', () => {
  for (const value of [undefined, null, 0]) assert.equal(timeout.paymentTimeoutMinutes({ items: [{ readyStockQty: value }] }), 30);
  assert.equal(timeout.paymentTimeoutMinutes({ items: [{ readyStockQty: 0 }, { readyStockQty: 1 }] }), 3);
  assert.equal(timeout.paymentTimeoutMinutes({ items: [{ bundleConfig: [{ readyStockQty: 1 }] }] }), 3);
});

test('同SKU多行及套装按真实子项合并预期，更新报价时不重复计算现货', () => {
  const { page } = harness();page.data.checkoutItems = [
    { skuId: '11', price: 10, count: 2 },
    { skuId: '11', price: 30, count: 2, bundleConfig: [{ skuId: '11', price: 10, count: 2 }, { skuId: '22', price: 10, count: 1 }] }
  ];
  Object.assign(page._checkoutQuote, { originalGoodsAmount: 80, goodsAmount: 80 });
  page._checkoutQuote.items = [
    { requestIndex: 0, skuId: '11', quantity: 2, readyStockQty: 2, settlementAmount: 20 },
    { requestIndex: 1, skuId: '11', quantity: 4, readyStockQty: 1, settlementAmount: 40 },
    { requestIndex: 1, skuId: '22', quantity: 2, readyStockQty: 1, settlementAmount: 20 }
  ];
  assert.deepEqual(copy(page.buildReadyStockExpectation()), [{ skuId: '11', readyStockQty: 3 }, { skuId: '22', readyStockQty: 1 }]);
  page.updateReadyStockQuote([{ skuId: '11', readyStockQty: 1 }, { skuId: '22', readyStockQty: 0 }]);
  assert.deepEqual(copy(page._checkoutQuote.items.map(line => line.readyStockQty)), [1, 0, 0]);
});

test('多个规格同时不足一并提示，确认期间重复点击不多单，离开页面后不重试', async () => {
  let pending;
  const env = harness({ create() { throw changed(1, [
    { productName: '羽绒服', color: '黑色', size: 'M', readyStockQty: 1 },
    { productName: '衬衣', color: '图片色', size: '均码', readyStockQty: 0 }
  ]); }, modal(options) { pending = options; } });
  const submitting = env.page.submitOrder();await new Promise(resolve => setImmediate(resolve));
  assert.match(pending.content, /羽绒服.*黑色 \/ M/);assert.match(pending.content, /衬衣.*图片色 \/ 均码.*0件/);
  await env.page.submitOrder();assert.equal(env.calls.length, 1);
  env.page.onUnload();pending.success({ confirm: true });await submitting;
  assert.equal(env.calls.length, 1);assert.equal(env.payments.length, 0);
});

test('现货确认后金额变化沿用原核对流程，异常现货响应也不绕过确认', async () => {
  const env = harness({ create(body, attempt) { if (attempt === 1) throw changed(1);throw { statusCode: 409, message: '金额已变化' }; } });
  let refreshed = 0;env.page.refreshShippingQuote = async () => { refreshed++; };
  await env.page.submitOrder();assert.equal(refreshed, 1);assert.equal(env.payments.length, 0);
  assert.equal(env.modals[1].title, '订单金额或状态已更新');
  const invalid = harness({ create() { throw { code: 'READY_STOCK_CHANGED', details: {} }; } });
  await invalid.page.submitOrder();assert.equal(invalid.calls.length, 1);assert.equal(invalid.payments.length, 0);
  assert.match(invalid.modals[0].content, /现货核对结果无效/);
});

test('订单详情倒计时与下单时限一致，重新加载清除旧定时器且不从取消支付时重计', () => {
  let page;const cleared = [], deadlines = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/orderDetail/orderDetail.js'), 'utf8'), {
    Page(value) { page = value; },
    require(name) {
      if (name.endsWith('/pageSync')) return { wrap: value => value };
      if (name.endsWith('/date')) return require('../../utils/date');
      if (name.endsWith('/orderPaymentTimeout')) return timeout;
      return {};
    }, setInterval() { return 7; },clearInterval(id) { cleared.push(id); }
  });
  const created = '2026-11-05T10:00:00+08:00';page.data.order = { items: [{ readyStockQty: 1 }] };
  page.updateCountdown = deadline => deadlines.push(deadline);page.countdownTimer = 6;
  page.startCountdown(created);assert.equal(deadlines[0], Date.parse(created) + 180000);assert.deepEqual(cleared, [6]);
  page.data.order.items = [{ readyStockQty: 0 }];page.startCountdown(created);
  assert.equal(deadlines[1], Date.parse(created) + 1800000);assert.deepEqual(cleared, [6, 7]);
});
