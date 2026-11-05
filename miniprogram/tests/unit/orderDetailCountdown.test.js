const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  let definition, sequence = 0, resolveOrder;
  const intervals = new Map(), timeouts = new Map(), reads = [], loading = [];
  const order = { id: '123', status: 'pending', createdAt: new Date(Date.now() - 31 * 60000).toISOString(), items: [] };
  const filename = path.resolve(__dirname, '../../pages/orderDetail/orderDetail.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) { definition = value; }, console,
    wx: { showLoading(options) { loading.push(options.title); }, hideLoading() {}, showToast() {} },
    setInterval(fn) { intervals.set(++sequence, fn); return sequence; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { timeouts.set(++sequence, fn); return sequence; },
    clearTimeout(id) { timeouts.delete(id); },
    require(name) {
      if (name.endsWith('/pageSync')) return { wrap: value => value };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => false };
      if (name.endsWith('/api')) return { get: async url => {
        reads.push(url);
        if (url === '/after-sales/query') return { content: [] };
        if (url.endsWith('/change-requests')) return [];
        if (resolveOrder) return new Promise(resolveOrder);
        return structuredClone(order);
      } };
      return require(path.resolve(path.dirname(filename), name));
    }
  });
  const page = { ...definition, data: { ...structuredClone(definition.data), order: structuredClone(order) },
    setData(patch) { Object.assign(this.data, patch); } };
  return { page, order, reads, loading, intervals, timeouts,
    deferOrder(callback) { resolveOrder = callback; },
    async fireTimeouts() {
      const callbacks = [...timeouts.values()]; timeouts.clear();
      for (const callback of callbacks) await callback();
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}

test('超时订单仍为待付款时只静默核对一次，不循环请求或弹加载框', async () => {
  const env = setup();
  env.page.startCountdown(env.order.createdAt);
  assert.equal(env.intervals.size, 0, '已经超时不再启动每秒倒计时');
  await env.fireTimeouts();
  await env.fireTimeouts();
  assert.deepEqual(env.reads, ['/orders/123', '/after-sales/query', '/orders/123/change-requests']);
  assert.equal(env.timeouts.size, 0);
  assert.equal(env.intervals.size, 0);
  assert.deepEqual(env.loading, []);
});

test('详情隐藏或退出时取消超时刷新，返回列表不再发请求', async () => {
  for (const lifecycle of ['onHide', 'onUnload']) {
    const env = setup();
    env.page.startCountdown(env.order.createdAt);
    assert.equal(env.timeouts.size, 1);
    env.page[lifecycle]();
    await env.fireTimeouts();
    assert.equal(env.intervals.size, 0);
    assert.equal(env.timeouts.size, 0);
    assert.deepEqual(env.reads, []);
    assert.deepEqual(env.loading, []);
  }
});

test('从客服返回详情时恢复倒计时，并根据实际时间核对超时状态', async () => {
  const env = setup();
  env.page.data.order.createdAt = new Date().toISOString();
  env.page.startCountdown(env.page.data.order.createdAt);
  assert.equal(env.intervals.size, 1);
  env.page.onHide();
  assert.equal(env.intervals.size, 0);
  env.page.onShow();
  assert.equal(env.intervals.size, 1);
  env.page.onHide();
  env.page.data.order.createdAt = env.order.createdAt;
  env.page.onShow();
  await env.fireTimeouts();
  assert.deepEqual(env.reads, ['/orders/123', '/after-sales/query', '/orders/123/change-requests']);
  env.page.onHide(); env.page.onShow();
  await env.fireTimeouts();
  assert.equal(env.reads.length, 3, '同一次超时不因切回前台重复核对三个接口');
});

test('超时核对请求在后台返回时不重启计时器', async () => {
  const env = setup();
  let finish;
  env.deferOrder(resolve => { finish = resolve; });
  env.page.startCountdown(env.order.createdAt);
  const pending = env.fireTimeouts();
  await new Promise(resolve => setImmediate(resolve));
  env.page.onHide();
  finish(structuredClone(env.order));
  await pending;
  assert.equal(env.intervals.size, 0);
  assert.equal(env.timeouts.size, 0);
  assert.deepEqual(env.loading, []);
});
