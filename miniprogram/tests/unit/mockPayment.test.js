const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(name, response) {
  let definition;
  const calls = { payments: [], toasts: [], modals: [], redirects: [], requests: [], refreshes: [] };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages', name, name + '.js'), 'utf8'), {
    Page(value) { definition = value; },
    console: { error() {} }, setTimeout() {},
    require(moduleName) {
      if (moduleName.endsWith('/pageSync')) return { wrap: value => value };
      if (moduleName.endsWith('/api')) return { post: async url => { calls.requests.push(url); return response; } };
      if (moduleName.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (moduleName.endsWith('/skuSelectionDraft')) return { clearCheckoutDrafts() {} };
      if (moduleName.endsWith('/error')) return require('../../utils/error');
      return {};
    },
    wx: {
      showLoading() {}, hideLoading() {}, removeStorageSync() {},
      showToast(value) { calls.toasts.push(value); },
      showModal(value) { calls.modals.push(value); },
      redirectTo(value) { calls.redirects.push(value); },
      requestPayment(value) { calls.payments.push(value); value.success({}); if (value.complete) value.complete(); }
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  page.data.order = { id: '90071992547409933' };
  page.loadOrderDetail = id => calls.refreshes.push(id);
  page.refreshOrder = id => calls.refreshes.push(id);
  return { page, calls };
}

test('普通结算收到模拟支付已入账结果后跳转原订单，不拉起微信支付也不误报失败', async () => {
  const { page, calls } = harness('checkout', { mode: 'mock', paid: true, package: null });
  Object.assign(page.data, {
    address: { recipient: '测试买家', phone: '13000000000', province: '浙江省', city: '杭州市', district: '钱塘区', detail: '测试地址' },
    checkoutItems: [{ skuId: '11', price: 10, count: 1 }],
    shippingReady: true, goodsQuoteReady: true, shippingAllowed: true
  });
  page.ensurePurchaseNoticeAgreed = () => true;
  page.createOrderWithStockCheck = async () => ({ id: '90071992547409933' });
  await page.submitOrderInternal();
  assert.deepEqual(calls.requests, ['/orders/90071992547409933/pay/wechat']);
  assert.equal(calls.payments.length, 0);
  assert.equal(calls.modals.length, 0);
  assert.equal(calls.toasts[0].title, '支付成功!');
  assert.equal(calls.redirects[0].url, '/pages/orderDetail/orderDetail?id=90071992547409933');
  assert.equal(page.data.submitting, false);
  assert.equal(page.data.orderCreated, true);
});

for (const name of ['orderList', 'orderDetail']) {
  test(`${name} 继续支付收到已入账结果时刷新原订单，不依赖支付参数`, async () => {
    const { page, calls } = harness(name, { mode: 'mock', paid: true, package: null });
    await page.payOrder({ currentTarget: { dataset: { id: '90071992547409933' } } });
    assert.equal(calls.payments.length, 0);
    assert.equal(calls.modals.length, 0);
    assert.equal(calls.toasts[0].title, '支付成功');
    assert.deepEqual(calls.refreshes, ['90071992547409933']);
  });
  test(`${name} 未入账且有真实支付参数时继续拉起微信支付`, async () => {
    const { page, calls } = harness(name, { mode: 'real', paid: false, package: 'prepay_id=test', timeStamp: '1', nonceStr: 'test', paySign: 'test' });
    await page.payOrder({ currentTarget: { dataset: { id: '90071992547409933' } } });
    assert.equal(calls.payments.length, 1);
    assert.equal(calls.payments[0].package, 'prepay_id=test');
    assert.deepEqual(calls.refreshes, ['90071992547409933']);
  });
}
