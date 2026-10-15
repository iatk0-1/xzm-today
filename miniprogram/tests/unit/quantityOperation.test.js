const test = require('node:test');
const assert = require('node:assert/strict');
const operation = require('../../utils/quantityOperation');
let storage;
test.beforeEach(() => {
  storage = new Map();
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
    removeStorageSync: key => storage.delete(key)
  };
});
test('网络结果未知后重试沿用原请求号，返回成功才清掉待确认记录', async () => {
  const calls = [];
  const api = { post: async (path, payload) => { calls.push({ path, payload }); if (calls.length === 1) throw { source: 'network' }; return '已入库'; } };
  await assert.rejects(operation.run(api, '/sku-inventory', { skuId: '9007199254740993', qty: 3, source: 'history' }));
  const first = operation.pending();
  assert.ok(first.payload.requestId);
  const result = await operation.retry(api);
  assert.equal(result.result, '已入库');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(operation.pending(), null);
});
test('结果待确认时不能改数量或改成另一笔报单', async () => {
  let calls = 0;
  const api = { post: async () => { calls++; throw { source: 'network' }; } };
  await assert.rejects(operation.run(api, '/sku-inventory', { skuId: '11', qty: 2 }));
  await assert.rejects(operation.run(api, '/sku-inventory', { skuId: '11', qty: 3 }), /原操作/);
  await assert.rejects(operation.run(api, '/picking-list/order', { items: [] }), /原操作/);
  assert.equal(calls, 1);
});
test('业务明确拒绝后可以修正参数重新提交', async () => {
  const api = { post: async () => { throw { statusCode: 400 }; } };
  await assert.rejects(operation.run(api, '/sku-inventory', { qty: 2 }));
  assert.equal(operation.pending(), null);
  api.post = async () => '成功';
  assert.equal(await operation.run(api, '/sku-inventory', { qty: 1 }), '成功');
});
test('服务端异常保留请求，重复点确认用同一个业务号', async () => {
  const calls = [];
  const api = { post: async (path, payload) => { calls.push(payload.requestId); throw { statusCode: 500 }; } };
  await assert.rejects(operation.run(api, '/sku-inventory', { qty: 2 }));
  await assert.rejects(operation.run(api, '/sku-inventory', { qty: 2 }));
  assert.equal(calls[0], calls[1]);
  assert.ok(operation.pending());
});
test('正在提交的同一请求不会并发写入两遍', async () => {
  let finish;
  let calls = 0;
  const api = { post: () => { calls++; return new Promise(resolve => { finish = resolve; }); } };
  const first = operation.run(api, '/sku-inventory', { qty: 2 });
  await assert.rejects(operation.run(api, '/sku-inventory', { qty: 2 }), /还在提交/);
  finish('成功');
  await first;
  assert.equal(calls, 1);
});
