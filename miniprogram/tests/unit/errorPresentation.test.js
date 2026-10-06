const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const errors = require('../../utils/error');

const fallback = '订单创建失败，请稍后重试';

test('截图错误只展示 message，HTTP 状态、业务码和参数明细继续留给程序', () => {
  for (const [statusCode, code, message] of [
    [500, 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试'],
    [400, 'BAD_REQUEST', '可用库存不足，available=0']
  ]) {
    const response = Object.freeze({ code, message, errors: [{ field: 'qty', message: '数量无效' }] });
    const result = errors.normalizeApiError(response, { statusCode, source: 'http' });
    assert.equal(errors.getErrorMessage(result, fallback), message);
    assert.equal(result.statusCode, statusCode);
    assert.equal(result.code, code);
    assert.equal(response.statusCode, undefined);
    assert.notEqual(result, response);
    assert.equal(JSON.stringify(result).includes('cause'), false);
  }
});

test('上传/普通接口 JSON 字符串及兼容 data.message 只取文字', () => {
  for (const input of [
    '{"code":"BAD_REQUEST","message":"库存不足"}',
    { message: '{"code":"BAD_REQUEST","message":"库存不足"}' },
    { data: { message: '库存不足' } },
    JSON.stringify(JSON.stringify({ message: '库存不足' }))
  ]) assert.equal(errors.getErrorMessage(input, fallback), '库存不足');
});

test('标准后端 message 保留英文字段和英文业务文字，对象 message 不递归当协议', () => {
  assert.equal(errors.getErrorMessage({ code: 'BAD_REQUEST', message: 'Insufficient stock, available=0' }, fallback), 'Insufficient stock, available=0');
  assert.equal(errors.getErrorMessage({ code: 'BAD_REQUEST', message: 'SQL 目录中的库存不足' }, fallback), 'SQL 目录中的库存不足');
  assert.equal(errors.getErrorMessage({ message: { message: '对象中的文字不属于协议' } }, fallback), fallback);
});

test('异常格式、网关正文、技术错误和循环对象均用中文兜底且不抛二次异常', () => {
  const cyclic = {}; cyclic.data = cyclic; cyclic.message = cyclic;
  for (const input of [null, undefined, [], {}, cyclic,
    { message: [] }, { message: {} }, { message: '   ' }, { message: null }, { message: 'null' }, { message: 'undefined' },
    { code: 'INTERNAL_ERROR' }, { error: 'UNAUTHORIZED' },
    '<html><h1>网关错误</h1></html>', '{"code":"BAD_REQUEST"}',
    { message: '[object Object]' }, new TypeError('Cannot read properties of undefined'),
    new TypeError('无法读取对象中的商品属性'),
    { message: '微信失败，uri=https://example.com?secret=test' },
    { message: '数据库错误 SQL SELECT secret FROM test' }
  ]) assert.equal(errors.getErrorMessage(input, fallback), fallback, String(input && input.message));
});

test('网络和超时映射中文，支付/扫码 SDK 原文使用场景兜底', () => {
  assert.equal(errors.getErrorMessage({ errMsg: 'request:fail timeout' }, fallback), '请求超时，请稍后重试');
  assert.equal(errors.getErrorMessage({ errMsg: 'request:fail socket closed' }, fallback), '网络连接异常，请检查网络后重试');
  assert.equal(errors.getErrorMessage({ errMsg: 'requestPayment:fail error -1' }, '支付失败，请核对订单状态'), '支付失败，请核对订单状态');
  assert.equal(errors.getErrorMessage({ errMsg: 'scanCode:fail' }, '扫码失败，请重新扫描'), '扫码失败，请重新扫描');
  assert.equal(errors.getErrorMessage(new Error('请填写收货地址'), fallback), '请填写收货地址');
});

test('正常响应的单项失败原因只取公开文字，机器码不直接展示', () => {
  assert.equal(errors.getBusinessFailureMessage('商品库存不足', '发货失败，请核查后重试'), '商品库存不足');
  assert.equal(errors.getBusinessFailureMessage('{"message":"运单已取消","code":"CONFLICT"}', fallback), '运单已取消');
  assert.equal(errors.getBusinessFailureMessage('SYSTEM_ERROR', '退款状态暂未确定，请查询原申请'), '退款状态暂未确定，请查询原申请');
});

function apiHarness(handler, { upload, auth } = {}) {
  const calls = [];
  const store = { token: 'access-old', refreshToken: 'refresh-old', userInfo: { selectedRole: 'user' } };
  const config = { API_BASE_URL: 'https://test.invalid/api/v1', TOKEN_KEY: 'token', REFRESH_TOKEN_KEY: 'refreshToken', USER_INFO_KEY: 'userInfo', TOKEN_EXPIRES_AT_KEY: 'expiry', REFRESH_TOKEN_EXPIRES_AT_KEY: 'refreshExpiry' };
  const module = { exports: {} };
  const deliver = (fn, opts) => { calls.push(opts); Promise.resolve().then(() => fn(opts, store, calls)).then(opts.success, opts.fail); };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/api.js'), 'utf8'), {
    module, exports: module.exports, console, setTimeout, clearTimeout,
    require(name) {
      if (name === './config') return config;
      if (name === './error') return errors;
      if (name === './media') return { compressImage: async p => ({ path: p }) };
      if (name === './auth') return auth || { ensureAuthenticated: async () => {} };
      if (name === './pageSync') return { recordMutation() {} };
      throw new Error('未配置测试模块：' + name);
    },
    wx: {
      getStorageSync: key => store[key], setStorageSync: (key, value) => { store[key] = value; }, removeStorageSync: key => { delete store[key]; },
      request: opts => deliver(handler, opts), uploadFile: opts => deliver(upload || handler, opts)
    }
  });
  return { api: module.exports, calls, store };
}

test('普通请求和上传错误行为一致，403/5xx 不清会话、不重试写请求', async () => {
  for (const statusCode of [400, 403, 500, 502]) {
    const message = statusCode === 400 ? '可用库存不足，available=0' : '服务暂时不可用，请稍后重试';
    const env = apiHarness(() => ({ statusCode, data: JSON.stringify({ code: 'BAD_REQUEST', message }) }));
    await assert.rejects(env.api.post('/orders', {}), e => e.statusCode === statusCode && e.message === message);
    assert.equal(env.calls.length, 1);
    assert.equal(env.store.token, 'access-old');
    await assert.rejects(env.api.uploadFile('/admin/files/upload', '/test.jpg', {}, { compress: false, useCos: false }), e => e.statusCode === statusCode && e.message === message);
  }
});

test('HTML 上传错误与网络失败不透传 SDK/网关正文', async () => {
  const env = apiHarness(() => { throw { errMsg: 'request:fail timeout' }; }, { upload: () => ({ statusCode: 502, data: '<html>网关错误</html>' }) });
  await assert.rejects(env.api.get('/products'), e => e.message === '请求超时，请稍后重试');
  await assert.rejects(env.api.uploadFile('/admin/files/upload', '/test.jpg', {}, { compress: false, useCos: false }), e => e.statusCode === 502 && e.message === '上传失败，请重新选择文件');
  assert.equal(env.store.token, 'access-old');
});

test('401 最多恢复一次，写操作和上传复用幂等 key，最终401清会话', async () => {
  for (const isUpload of [false, true]) {
    let recoveries = 0;
    const env = apiHarness(() => ({ statusCode: 401, data: '{"code":"UNAUTHORIZED","message":"登录已过期，请重新登录"}' }), {
      auth: { ensureAuthenticated: async opts => { if (opts && opts.force) recoveries++; } }
    });
    const action = isUpload ? env.api.uploadFile('/admin/files/upload', '/test.jpg', {}, { compress: false, useCos: false }) : env.api.post('/orders', { qty: 1 });
    await assert.rejects(action, e => e.statusCode === 401 && e.code === 'UNAUTHORIZED');
    assert.equal(recoveries, 1);
    assert.equal(env.calls.length, 2);
    assert.equal(env.calls[0].header['Idempotency-Key'], env.calls[1].header['Idempotency-Key']);
    assert.ok(env.calls[0].header['Idempotency-Key']);
    assert.equal(env.store.token, undefined);
  }
});

test('刷新凭证遇到网络/5xx/403保留会话，正常成功响应结构保持原样', async () => {
  for (const statusCode of [403, 500]) {
    const env = apiHarness(() => ({ statusCode, data: { message: '服务暂时不可用，请稍后重试' } }));
    await assert.rejects(env.api.refreshSession(), e => e.statusCode === statusCode);
    assert.equal(env.store.token, 'access-old');
    assert.equal(env.store.refreshToken, 'refresh-old');
  }
  const env = apiHarness(() => { throw { errMsg: 'request:fail' }; });
  await assert.rejects(env.api.refreshSession(), e => e.message === '网络连接异常，请检查网络后重试');
  assert.equal(env.store.token, 'access-old');
  const body = { results: [{ success: false, error: '运单已取消' }], id: '90071992547409933' };
  const success = apiHarness(() => ({ statusCode: 200, data: body }));
  assert.equal(await success.api.get('/logistics/batch-cancel'), body);
});
