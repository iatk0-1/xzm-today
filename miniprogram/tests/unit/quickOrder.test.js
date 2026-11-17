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
  let claim = { name: '专属商品', spec: '图片色', size: '均码', coverUrl: 'cover.jpg', subscription: { enabled: true, templateId: 'shipping' }, preview };
  const storage = new Map([['checkoutItems', [{ skuId: 'ordinary', price: 999, count: 3 }]]]);
  const runtime = {
    requestSubscribeMessage(options) { events.push('subscribe'); options.success({ shipping: 'reject' }); },
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    hideShareMenu() {},
    requestPayment(options) { events.push('pay'); if (paymentError) options.fail(new Error('取消支付')); else options.success({}); },
    redirectTo(options) { redirects.push(options.url); }, showToast() {}, showModal(options) { modals.push(options); }
  };
  const api = {
    async post(url, data) {
      calls.push({ url, data }); events.push(url);
      if (url.endsWith('/claim')) return claim;
      if (url.endsWith('/orders')) return { id: '11', requiresPayment: Number(fee) > 0 };
      if (url.endsWith('/pay/wechat')) return { paid: false, timeStamp: '1', nonceStr: 'nonce', package: 'prepay_id=fee', paySign: 'sig' };
    },
    async get() { return { allowed: true, shippingFee: fee }; }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/checkout/checkout.js'), 'utf8'), {
    Page: value => { definition = value; }, wx: runtime, console,
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/error')) return { getErrorMessage: (error, fallback) => error.message || fallback };
      if (name.endsWith('/quickOrder')) return quick;
      return require(path.resolve(__dirname, '../../pages/checkout', name));
    }
  });
  const page = { ...definition, data: { ...definition.data, quickOrderMode: true, quickPreview: preview, checkoutItems: [{ id: 'quick', count: 1 }], itemQuantity: 1, shippingAllowed: true, shippingFee: fee, shippingReady: true,
    address: { recipient: '张三', phone: '13800138000', province: '辽宁省', city: '沈阳市', district: '和平区', detail: '测试1号' },
    shippingSubscription: { enabled: true, templateId: 'shipping' } }, _quickToken: 'token',
    setData(values) { Object.assign(this.data, values); } };
  return { page, calls, events, redirects, modals, api, storage, setClaim: value => { claim = value; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('专属链接使用正常结算页，只认领对应商品，不读取或清理普通购物车结算记录', async () => {
  const env = checkoutHarness();
  await env.page.onLoad({ token: 'private-token' });
  assert.equal(env.page.data.quickOrderMode, true);
  assert.equal(env.calls[0].url, '/quick-orders/private-token/claim');
  assert.equal(env.page.data.checkoutItems.length, 1);
  assert.equal(env.page.data.checkoutItems[0].name, '专属商品');
  assert.equal('price' in env.page.data.checkoutItems[0], false);
  assert.equal('productId' in env.page.data.checkoutItems[0], false);
  assert.ok(!env.calls.some(call => /goods-quote|products|cart/.test(call.url)));
  assert.equal(env.storage.get('checkoutItems')[0].skuId, 'ordinary');
});

test('专属链接已下单则进入原订单，已被他人领取的链接显示错误且无法提交', async () => {
  const env = checkoutHarness();
  env.setClaim({ orderId: 'existing', preview: false });
  await env.page.onLoad({ token: 'private' });
  assert.equal(env.redirects[0], '/pages/orderDetail/orderDetail?id=existing');
  const denied = checkoutHarness();
  denied.api.post = async () => { throw new Error('链接已被其他用户领取'); };
  await denied.page.onLoad({ token: 'private' });
  assert.equal(denied.page.data.quickError, '链接已被其他用户领取');
  await denied.page.submitOrder();
  assert.equal(denied.events.includes('pay'), false);
});

test('旧分享卡片转到相同结算页，不再展示独立的快捷单结算页面', () => {
  let page;
  const redirects = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/quickCheckout/quickCheckout.js'), 'utf8'), {
    Page: value => { page = value; }, wx: { hideShareMenu() {}, redirectTo: value => redirects.push(value.url) }
  });
  page.onLoad({ token: 'old-token' });
  assert.equal(redirects[0], '/pages/checkout/checkout?token=old-token');
});

test('免运费不调用支付接口，订阅拒绝后仍下单，连点只建一单', async () => {
  const env = checkoutHarness();
  env.page.submitOrder(); env.page.submitOrder();
  assert.equal(env.events[0], 'subscribe');
  await settle();
  assert.equal(env.calls.filter(call => call.url === '/quick-orders/token/orders').length, 1);
  assert.equal(env.calls.some(call => call.url.includes('/pay/')), false);
  assert.equal(env.events.includes('pay'), false);
  assert.equal(env.redirects[0], '/pages/orderDetail/orderDetail?id=11');
  await env.page.submitOrder();
  assert.equal(env.calls.filter(call => call.url === '/quick-orders/token/orders').length, 1);
});

test('有运费时只提交地址和运费，再拉起微信支付', async () => {
  const env = checkoutHarness({ fee: '8.00' });
  env.page.submitOrder(); await settle();
  assert.equal(env.events.includes('subscribe'), false);
  assert.equal(env.calls[0].data.expectedShippingFee, '8.00');
  assert.equal('salePrice' in env.calls[0].data, false);
  assert.equal(env.events.includes('pay'), true);
});

test('商家预览不能创建订单，运费尚未确认也不能提交', async () => {
  const env = checkoutHarness({ preview: true });
  env.page.submitOrder(); await settle(); assert.equal(env.calls.length, 0);
  env.page.data.quickPreview = false; env.page.data.shippingReady = false;
  env.page.submitOrder(); await settle(); assert.equal(env.calls.length, 0);
});

test('取消运费支付保留原订单并提供返回订单处理入口', async () => {
  const env = checkoutHarness({ fee: '8.00', paymentError: true });
  env.page.submitOrder(); await settle();
  assert.equal(env.modals.length, 1); env.modals[0].success();
  assert.equal(env.redirects[0], '/pages/orderDetail/orderDetail?id=11');
});

test('地址快速切换时只采用最后一次运费报价', async () => {
  const env = checkoutHarness(); const responses = [];
  env.api.get = () => new Promise(resolve => responses.push(resolve));
  const first = env.page.refreshShippingQuote(); const second = env.page.refreshShippingQuote();
  responses[1]({ allowed: true, shippingFee: 8 }); await second;
  responses[0]({ allowed: true, shippingFee: 0 }); await first;
  assert.equal(env.page.data.shippingFee, '8.00');
  assert.equal(env.page.data.shippingReady, true);
});

test('统一结算页快捷单运费报价失败或地区不可配送时禁止下单', async () => {
  const env = checkoutHarness();
  env.api.get = async () => ({ allowed: false, shippingFee: 8 });
  await env.page.refreshShippingQuote();
  await env.page.submitOrder();
  assert.equal(env.calls.length, 0);
  env.api.get = async () => { throw new Error('运费计算失败'); };
  await env.page.refreshShippingQuote();
  await env.page.submitOrder();
  assert.equal(env.page.data.shippingReady, false);
  assert.equal(env.page.data.shippingError, '运费计算失败');
  assert.equal(env.calls.length, 0);
});
