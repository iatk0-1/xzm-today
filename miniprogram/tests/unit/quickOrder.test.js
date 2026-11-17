const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const quick = require('../../utils/quickOrder');

test('按档口限制的岗位没有快捷开单入口', () => {
  const auth = { isAdmin: () => true, canAccessMenu: () => true,
    getPermissionSnapshot: () => ({ currentRole: { stallScoped: true } }) };
  assert.equal(quick.canManageQuickOrder(auth), false);
  auth.getPermissionSnapshot = () => ({ currentRole: { stallScoped: false } });
  assert.equal(quick.canManageQuickOrder(auth), true);
});

test('快捷开单限制图片和金额，支持一次上传九张', () => {
  const draft = { name: '上衣', articleNo: 'A1', costPrice: '50', price: '100.01' };
  assert.equal(quick.validateQuickProduct(draft, Array(9).fill('image')), '');
  assert.match(quick.validateQuickProduct(draft, Array(10).fill('image')), /1至9/);
  assert.match(quick.validateQuickProduct(draft, []), /1至9/);
  assert.match(quick.validateQuickProduct({ ...draft, price: '0' }, ['image']), /大于0/);
  assert.match(quick.validateQuickProduct({ ...draft, costPrice: '1.001' }, ['image']), /两位/);
});

test('发货订阅在点击同步申请，拒绝或微信接口失败都正常返回', async () => {
  let called = false;
  const attempt = quick.requestShippingSubscription({ requestSubscribeMessage(options) {
    called = true; options.success({ shipping: 'reject' });
  } }, { enabled: true, templateId: 'shipping' });
  assert.equal(called, true);
  assert.equal((await attempt).result, 'reject');
  assert.equal(await quick.requestShippingSubscription({}, { enabled: true, templateId: 'shipping' }), null);
  assert.equal(await quick.requestShippingSubscription({ requestSubscribeMessage: () => assert.fail() }, { enabled: false }), null);
});

test('订阅存储故障不影响成功订单，仍直接上传本次授权', async () => {
  const calls = [];
  await quick.saveSubscription({ post: async (...args) => calls.push(args) }, {
    getStorageSync() { throw new Error('存储失败'); }, setStorageSync() { throw new Error('存储失败'); }
  }, '9007199254740993', { requestId: 'subscription', result: 'accept', templateId: 'shipping' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/quick-orders/orders/9007199254740993/subscriptions');
});

test('订阅上报失败可在重进页面时沿用请求号补报', async () => {
  let saved;
  const runtime = { getStorageSync: () => saved, setStorageSync: (_, value) => { saved = value; } };
  const grant = { requestId: 'subscription', result: 'accept', templateId: 'shipping' };
  await quick.saveSubscription({ post: async () => { throw new Error('网络失败'); } }, runtime, '10', grant);
  assert.equal(saved.length, 1);
  const calls = [];
  await quick.flushSubscriptions({ post: async (...args) => calls.push(args) }, runtime);
  assert.equal(calls[0][1].requestId, grant.requestId);
  assert.equal(saved.length, 0);
});

function checkoutHarness({ fee = '0.00', paymentError = false, preview = false } = {}) {
  let definition;
  const calls = [], events = [], redirects = [], modals = [];
  const runtime = {
    requestSubscribeMessage(options) { events.push('subscribe'); options.success({ shipping: 'reject' }); },
    getStorageSync: () => [], setStorageSync: () => {},
    requestPayment(options) { events.push('pay'); if (paymentError) options.fail(new Error('取消支付')); else options.success({}); },
    redirectTo(options) { redirects.push(options.url); }, showToast() {}, showModal(options) { modals.push(options); }
  };
  const api = {
    async post(url, data) {
      calls.push({ url, data }); events.push(url);
      if (url.endsWith('/orders')) return { id: '11', requiresPayment: Number(fee) > 0 };
      if (url.endsWith('/pay/wechat')) return { paid: false, timeStamp: '1', nonceStr: 'nonce', package: 'prepay_id=fee', paySign: 'sig' };
    },
    async get() { return { allowed: true, shippingFee: fee }; }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/quickCheckout/quickCheckout.js'), 'utf8'), {
    Page: value => { definition = value; }, wx: runtime, console,
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/error')) return { getErrorMessage: (error, fallback) => error.message || fallback };
      if (name.endsWith('/quickOrder')) return quick;
      throw new Error(name);
    }
  });
  const page = { ...definition, data: { ...definition.data, product: { preview }, shippingFee: fee, shippingReady: true,
    address: { userName: '张三', telNumber: '13800138000', provinceName: '辽宁省', cityName: '沈阳市', countyName: '和平区', detailInfo: '测试1号' },
    subscription: { enabled: true, templateId: 'shipping' } }, _token: 'token',
    setData(values) { Object.assign(this.data, values); } };
  return { page, calls, events, redirects, modals, api };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('免运费不调用支付接口，订阅拒绝后仍下单，连点只建一单', async () => {
  const env = checkoutHarness();
  env.page.submit(); env.page.submit();
  assert.equal(env.events[0], 'subscribe');
  await settle();
  assert.equal(env.calls.filter(call => call.url === '/quick-orders/token/orders').length, 1);
  assert.equal(env.calls.some(call => call.url.includes('/pay/')), false);
  assert.equal(env.events.includes('pay'), false);
  assert.equal(env.redirects[0], '/pages/orderDetail/orderDetail?id=11');
});

test('有运费时只提交地址和运费，再拉起微信支付', async () => {
  const env = checkoutHarness({ fee: '8.00' });
  env.page.submit(); await settle();
  assert.equal(env.events.includes('subscribe'), false);
  assert.equal(env.calls[0].data.expectedShippingFee, '8.00');
  assert.equal('salePrice' in env.calls[0].data, false);
  assert.equal(env.events.includes('pay'), true);
});

test('商家预览不能创建订单，运费尚未确认也不能提交', async () => {
  const env = checkoutHarness({ preview: true });
  env.page.submit(); await settle(); assert.equal(env.calls.length, 0);
  env.page.data.product.preview = false; env.page.data.shippingReady = false;
  env.page.submit(); await settle(); assert.equal(env.calls.length, 0);
});

test('取消运费支付保留原订单并提供返回订单处理入口', async () => {
  const env = checkoutHarness({ fee: '8.00', paymentError: true });
  env.page.submit(); await settle();
  assert.equal(env.modals.length, 1); env.modals[0].success();
  assert.equal(env.redirects[0], '/pages/orderDetail/orderDetail?id=11');
});

test('地址快速切换时只采用最后一次运费报价', async () => {
  const env = checkoutHarness(); const responses = [];
  env.api.get = () => new Promise(resolve => responses.push(resolve));
  const first = env.page.refreshShipping(); const second = env.page.refreshShipping();
  responses[1]({ allowed: true, shippingFee: 8 }); await second;
  responses[0]({ allowed: true, shippingFee: 0 }); await first;
  assert.equal(env.page.data.shippingFee, '8.00');
  assert.equal(env.page.data.shippingReady, true);
});
