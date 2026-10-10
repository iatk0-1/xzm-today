const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const errors = require('../../utils/error');
const notices = require('../../utils/purchaseNotice');

function checkoutHarness({ failureAt, error, paymentError } = {}) {
  let definition;
  const calls = [], modals = [], toasts = [], redirects = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/checkout/checkout.js'), 'utf8'), {
    Page: value => { definition = value; }, console: { error() {} }, setTimeout() {},
    require(name) {
      if (name.endsWith('/error')) return errors;
      if (name.endsWith('/purchaseNotice')) return notices;
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/api')) return {
        post: async url => { calls.push(url); if (url === failureAt) throw error; return url === '/orders' ? { id: '90071992547409933' } : { package: 'prepay_id=test', timeStamp: '1' }; },
        delete: async () => {}
      };
      throw new Error('未配置测试模块：' + name);
    },
    wx: {
      showModal: value => { modals.push(value); if (value.success) value.success({ confirm: true }); },
      showToast: value => toasts.push(value), showLoading() {}, hideLoading() {},
      requestPayment: opts => { calls.push('wx.requestPayment'); if (paymentError) opts.fail(paymentError); opts.complete(); },
      redirectTo: opts => redirects.push(opts.url), getStorageSync: () => [], removeStorageSync() {}, reLaunch() {}
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  page.data.address = { recipient: '测试买家', phone: '13800000000', province: '测试省', city: '测试市', district: '测试区', detail: '测试地址' };
  page.data.checkoutItems = [{ skuId: '2', name: '上衣', count: 1, price: 20 }];
  page.data.purchaseNoticeReady = true;
  page.data.purchaseNoticeAgreed = true;
  page.data.shippingReady = true;
  page.data.shippingAllowed = true;
  return { page, calls, modals, toasts, redirects };
}

test('截图400/500创建订单弹窗正文严格等于后端message，提交状态归位', async () => {
  for (const [statusCode, code, message] of [[400, 'BAD_REQUEST', '可用库存不足，available=0'], [500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试']]) {
    const env = checkoutHarness({ failureAt: '/orders', error: { statusCode, code, message } });
    await env.page.submitOrderInternal();
    assert.equal(env.modals.length, 1);
    assert.equal(env.modals[0].title, '订单创建失败');
    assert.equal(env.modals[0].content, message);
    assert.equal(env.calls.length, 1);
    assert.equal(env.page.data.submitting, false);
    if (statusCode === 500) assert.equal(env.redirects[0], '/pages/orderList/orderList');
    else assert.equal(env.redirects.length, 0);
  }
});

test('订单已创建但预支付失败要跳已有订单，保持大整数编号且不重复创建', async () => {
  const message = '支付服务暂时不可用，请稍后重试';
  const env = checkoutHarness({ failureAt: '/orders/90071992547409933/pay/wechat', error: { statusCode: 500, message } });
  await env.page.submitOrderInternal();
  assert.equal(env.modals[0].title, '支付准备失败');
  assert.equal(env.modals[0].content, message);
  assert.equal(env.redirects[0], '/pages/orderDetail/orderDetail?id=90071992547409933');
  assert.equal(env.calls.filter(url => url === '/orders').length, 1);
  assert.equal(env.calls.includes('wx.requestPayment'), false);
});

test('微信支付取消保持取消反馈，原生支付失败不会展示errMsg', async () => {
  const cancel = checkoutHarness({ paymentError: { errMsg: 'requestPayment:fail cancel' } });
  await cancel.page.submitOrderInternal();
  assert.equal(cancel.modals.length, 0);
  assert.equal(cancel.toasts[0].title, '您手动取消了支付');
  const failure = checkoutHarness({ paymentError: { errMsg: 'requestPayment:fail system error' } });
  await failure.page.submitOrderInternal();
  assert.equal(failure.modals[0].title, '支付失败');
  assert.equal(failure.modals[0].content, '支付未完成，请在订单列表核对支付状态后继续支付');
});
