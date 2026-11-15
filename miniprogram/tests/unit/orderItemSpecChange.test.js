const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../../utils/api');
const handlers = require('../../utils/orderItemSpecChange');
const event = { currentTarget: { dataset: { index: 0 } } };
let calls, toast;
function page() {
  calls = []; toast = '';
  global.wx = { showLoading() {}, hideLoading() {}, showToast: value => { toast = value.title; },
    showModal: value => value.success({ confirm: true }) };
  const instance = { ...handlers, data: { canManageOrders: true, orderId: '9007199254740999',
    order: { items: [{ id: '100', skuId: '200', qty: 5, productName: '上衣', shippedQty: 0 }] } },
    setData(value) { Object.assign(this.data, value); }, async loadOrderDetail() { calls.push('reload'); } };
  api.get = async () => [{ skuId: '201', spec: '蓝', size: 'L', availableQty: 3, readyQty: 1 },
    { skuId: '202', availableQty: 0 }];
  api.post = async (url, body) => { calls.push({ url, body }); };
  return instance;
}
test('管理员打开同商品可售规格，过滤无库存规格', async () => {
  const p = page(); await p.openSpecChange(event);
  assert.equal(p.data.specChange.options.length, 1);
  assert.match(p.data.specChange.options[0].label, /可售3.*现货1/);
  assert.equal(p.data.specChange.maxQty, 5);
});
test('非管理员和已发货商品不能打开变更入口', async () => {
  const p = page(); p.data.canManageOrders = false; await p.openSpecChange(event);
  assert.equal(p.data.specChange, undefined);
  p.data.canManageOrders = true; p.data.order.items[0].shippedQty = 1; await p.openSpecChange(event);
  assert.equal(p.data.specChange, undefined);
});
test('超量、小数、负数不能提交', async () => {
  const p = page(); await p.openSpecChange(event);
  for (const qty of ['4', '0', '-1', '1.5', '']) {
    p.onSpecChangeQty({ detail: { value: qty } }); await p.saveSpecChange();
    assert.equal(calls.length, 0); assert.match(toast, /数量须大于0/);
  }
});
test('部分数量提交保留长ID、原规格和数量，成功后刷新订单', async () => {
  const p = page(); await p.openSpecChange(event);
  p.onSpecChangeQty({ detail: { value: '2' } }); await p.saveSpecChange();
  assert.equal(calls[0].url, '/admin/orders-manage/orders/9007199254740999/items/100/change-spec');
  assert.equal(calls[0].body.expectedSkuId, '200'); assert.equal(calls[0].body.targetSkuId, '201');
  assert.equal(calls[0].body.qty, 2); assert.ok(calls[0].body.requestId);
  assert.equal(p.data.specChange, null); assert.equal(p.data.specSaving, false); assert.equal(calls[1], 'reload');
});
test('网络失败重试复用业务请求编号，避免重复拆分', async () => {
  const p = page(); await p.openSpecChange(event);
  api.post = async (url, body) => { calls.push(body); throw new Error('网络异常'); };
  await p.saveSpecChange(); await p.saveSpecChange();
  assert.equal(calls[0].requestId, calls[1].requestId); assert.ok(p.data.specChange);
  assert.equal(p.data.specSaving, false);
});
