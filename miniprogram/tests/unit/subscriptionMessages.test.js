const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const subscriptions = require('../../utils/subscriptionMessages');

function runtime(choice = 'accept') {
  const store = new Map(), calls = [];
  const wx = {
    getStorageSync: key => store.get(key), setStorageSync: (key, value) => store.set(key, value),
    requestSubscribeMessage(options) {
      calls.push(options);
      if (choice === 'fail') options.fail({ errCode: 10005 });
      else options.success(Object.fromEntries(options.tmplIds.map(id => [id, choice])));
    }
  };
  return { wx, calls, store };
}

test('点击立即申请两个售后模板，不申请购物动态和1410', async () => {
  const env = runtime();
  const attempt = subscriptions.request(env.wx);
  assert.equal(env.calls.length, 1);
  assert.deepEqual(env.calls[0].tmplIds, Object.values(subscriptions.DEFAULT_CONFIG.templates));
  assert.deepEqual(await attempt.result, { review: 'accept', refund: 'accept' });
  assert.match(attempt.requestId, /^[A-Za-z0-9_-]{16,64}$/);
});
test('订阅回调成功不代表每个模板都同意', async () => {
  const env = runtime();
  env.wx.requestSubscribeMessage = options => options.success({
    [options.tmplIds[0]]: 'accept', [options.tmplIds[1]]: 'reject', errMsg: 'requestSubscribeMessage:ok'
  });
  assert.deepEqual(await subscriptions.request(env.wx).result, { review: 'accept', refund: 'reject' });
});
test('拒绝、接口失败和旧客户端缺少接口都正常返回，不抛出业务异常', async () => {
  assert.deepEqual(await subscriptions.request(runtime('reject').wx).result, { review: 'reject', refund: 'reject' });
  assert.deepEqual(await subscriptions.request(runtime('fail').wx).result, {});
  assert.deepEqual(await subscriptions.request({}).result, {});
});
test('服务端关闭功能时不调用微信，补订阅可只申请退款', async () => {
  const env = runtime();
  await subscriptions.request(env.wx, { enabled: false, templates: subscriptions.DEFAULT_CONFIG.templates }).result;
  assert.equal(env.calls.length, 0);
  assert.deepEqual(await subscriptions.request(env.wx, undefined, ['refund']).result, { refund: 'accept' });
});
test('售后创建失败没有ID时不上传任何订阅绑定', async () => {
  const env = runtime(), writes = [];
  await subscriptions.persist({ post: async (...args) => writes.push(args) }, env.wx, null, subscriptions.request(env.wx));
  assert.equal(writes.length, 0);
});
test('绑定成功创建的售后单，即使本地存储不可用也上传', async () => {
  const env = runtime(), writes = [];
  env.wx.setStorageSync = () => { throw new Error('存储失败'); };
  await subscriptions.persist({ post: async (...args) => writes.push(args) }, env.wx, '9007199254740993', subscriptions.request(env.wx));
  assert.equal(writes[0][0], '/after-sales/9007199254740993/subscriptions');
  assert.deepEqual(writes[0][1].results, { review: 'accept', refund: 'accept' });
});
test('上传失败保留绑定，后续重试沿用同一个请求标识，成功后清理', async () => {
  const env = runtime(), writes = [], attempt = subscriptions.request(env.wx);
  await subscriptions.persist({ post: async () => { throw new Error('网络异常'); } }, env.wx, '9', attempt);
  await subscriptions.flush({ post: async (...args) => writes.push(args) }, env.wx);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].requestId, attempt.requestId);
  await subscriptions.flush({ post: async (...args) => writes.push(args) }, env.wx);
  assert.equal(writes.length, 1);
});

function pageHarness(choice = 'accept') {
  const env = runtime(choice), events = [], modals = [], toasts = [], writes = [];
  let definition, resolveAuth;
  const authentication = new Promise(resolve => { resolveAuth = resolve; });
  env.wx.showLoading = () => {}; env.wx.hideLoading = () => {};
  env.wx.showModal = value => modals.push(value); env.wx.showToast = value => toasts.push(value);
  const requestSubscribe = env.wx.requestSubscribeMessage;
  env.wx.requestSubscribeMessage = value => { events.push('subscribe'); requestSubscribe(value); };
  const api = { post: async (url, data) => { writes.push({ url, data }); return { id: '9' }; } };
  const filename = path.resolve(__dirname, '../../pages/afterSaleApply/afterSaleApply.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; }, wx: env.wx, console, setTimeout, clearTimeout,
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { ensureAuthenticated: () => { events.push('auth'); return authentication; } };
      return require(path.resolve(path.dirname(filename), name));
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  page.data.orderId = '1';
  page.data.selectedItems = [{ orderItemId: '2', productId: '3', selectedQty: 1, inputAmount: 10, type: 'refund' }];
  page.data.splitItems = [{ orderItemId: '2', type: 'refund', qty: 1, maxRefundAmount: 10, salePrice: 10 }];
  return { ...env, page, api, writes, modals, toasts, events, resolveAuth };
}
test('提交点击在登录和网络等待之前请求订阅，连续点击只提交一次', async () => {
  const env = pageHarness();
  const submit = env.page.submitAfterSale();
  assert.deepEqual(env.events, ['subscribe', 'auth']);
  await env.page.submitAfterSale();
  assert.equal(env.calls.length, 1);
  env.resolveAuth(); await submit;
  assert.equal(env.writes.filter(value => value.url === '/after-sales').length, 1);
  assert.equal(env.writes[1].url, '/after-sales/9/subscriptions');
  assert.equal(env.modals[0].title, '提交成功');
});
test('本地数量校验失败时既不弹订阅也不提交', async () => {
  const env = pageHarness(); env.page.data.selectedItems[0].selectedQty = 99;
  await env.page.submitAfterSale();
  assert.equal(env.calls.length, 0); assert.equal(env.writes.length, 0);
});
for (const choice of ['reject', 'fail']) {
  test(`用户${choice}后售后照常成功，提交状态恢复`, async () => {
    const env = pageHarness(choice); env.resolveAuth(); await env.page.submitAfterSale();
    assert.equal(env.writes[0].url, '/after-sales'); assert.equal(env.modals[0].title, '提交成功');
    assert.equal(env.page.data.isSubmitting, false);
  });
}
test('售后接口失败不绑定订阅，也不误显示提交成功', async () => {
  const env = pageHarness(); env.api.post = async (url) => { env.writes.push({ url }); throw new Error('提交失败'); };
  env.resolveAuth(); await env.page.submitAfterSale();
  assert.equal(env.writes.length, 1); assert.equal(env.modals.length, 0);
  assert.equal(env.page.data.isSubmitting, false);
});
