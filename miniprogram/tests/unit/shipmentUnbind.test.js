const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load({ preview, post, modal } = {}) {
  const storage = new Map(), writes = [], reads = [], messages = [];
  const wx = {
    getStorageSync: k => storage.get(k),
    setStorageSync: (k, v) => storage.set(k, JSON.parse(JSON.stringify(v))),
    removeStorageSync: k => storage.delete(k),
    showLoading() {}, hideLoading() {}, showToast: o => messages.push(o),
    showModal: o => { messages.push(o); if (o.success) o.success(modal || { confirm: true, content: '平台取消记录已核实，实物已回仓' }); }
  };
  const opContext = { module: { exports: {} }, wx };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/quantityOperation.js'), 'utf8'), opContext);
  const operation = opContext.module.exports;
  const api = { get: async route => { reads.push(route); return preview; }, post: async (route, payload) => {
    writes.push(JSON.parse(JSON.stringify({ route, payload })));
    return post ? post(route, payload) : {};
  } };
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/adminOrderDetail/adminOrderDetail.js'), 'utf8'), {
    console, wx, Page: value => { definition = value; }, require: name => {
      if (name.endsWith('/adminProductArticleNo')) return require('../../utils/adminProductArticleNo');
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/quantityOperation')) return operation;
      if (name.endsWith('/pageSync')) return { wrap: v => v, publish() {} };
      if (name.endsWith('/error')) return { getErrorMessage: (e, fallback) => e.message || fallback };
      if (name.endsWith('/expressCompany')) return { getExpressName: () => '中通' };
      return {};
    }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  page.data.orderId = '101';
  page.reloads = 0;
  page.loadOrderDetail = async () => { page.reloads++; };
  page.loadLogisticsTraceMap = () => {};
  return { page, storage, reads, writes, messages, operation };
}

const packagePreview = () => ({ shipmentId: '9007199254740993', expressNo: 'TEST-MERGED', totalQty: 3, previewToken: 'scope-token', orders: [
  { orderId: '101', orderNo: 'CURRENT', status: 'shipped', items: [{ orderItemId: '201', productName: '商品甲', qty: 1 }] },
  { orderId: '102', orderNo: 'OTHER', status: 'shipped', items: [{ orderItemId: '202', productName: '商品乙', qty: 2 }] }
] });
const openEvent = { currentTarget: { dataset: { shipmentId: '9007199254740993' } } };

test('整包解绑先读取全部订单商品，展示当前单及关联单，不自动取消面单或返库', async () => {
  const { page, reads, writes } = load({ preview: packagePreview() });
  await page.cancelWaybill(openEvent);
  assert.equal(reads[0], '/admin/orders-manage/orders/shipments/9007199254740993/unbind-preview');
  assert.equal(writes.length, 0);
  assert.equal(page.data.unbindPreview.orders.length, 2);
  assert.equal(page.data.unbindPreview.orders[0].current, true);
  assert.equal(page.data.unbindPreview.orders[1].current, false);
  assert.equal(page.data.unbindPreview.orders[1].items[0].qty, 2);
  assert.equal(page.data.unbindStockConfirmed, false);
  await page.confirmFullUnbind();
  assert.equal(writes.length, 0);
});

test('整包必须明确勾选实物状态，提交携带所见范围校验及原订单定位信息', async () => {
  let payload;
  const { page, writes, operation } = load({ preview: packagePreview(), post: async (route, value) => { payload = operation.pending(); } });
  await page.cancelWaybill(openEvent);
  page.onUnbindStockConfirmed({ detail: { value: ['confirmed'] } });
  await page.confirmFullUnbind();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.previewToken, 'scope-token');
  assert.equal(writes[0].payload.stockReturned, true);
  assert.equal(payload.context.orderId, '101');
  assert.equal(page.data.showUnbindPreview, false);
  assert.equal(page.reloads, 1);
});

test('网络结果未知后即使包裹已不在订单中，仍能在原订单找到并沿用同号续办', async () => {
  let fail = true;
  const { page, writes, operation } = load({ preview: packagePreview(), post: async () => { if (fail) throw { statusCode: 500, message: '取消结果未知' }; } });
  await page.cancelWaybill(openEvent);
  page.onUnbindStockConfirmed({ detail: { value: ['confirmed'] } });
  await page.confirmFullUnbind();
  const original = operation.pending();
  page.data.shipments = [];
  page.onShow();
  assert.equal(page.data.pendingShipmentUnbind.requestId, original.payload.requestId);
  fail = false;
  await page.retryShipmentUnbind();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(operation.pending(), null);
  assert.equal(page.data.pendingShipmentUnbind, null);
});

test('核查面单保存依据之后，使用原解绑参数续办而不新建请求', async () => {
  let fail = true;
  const { page, writes } = load({ preview: packagePreview(), post: async () => { if (fail) throw { statusCode: 500 }; } });
  await page.cancelWaybill(openEvent);
  page.onUnbindStockConfirmed({ detail: { value: ['confirmed'] } });
  await page.confirmFullUnbind();
  const first = writes[0];
  fail = false;
  await page.reviewShipmentUnbindWaybill();
  assert.match(writes[1].route, new RegExp('/unbind/' + first.payload.requestId + '/confirm-waybill-cancelled$'));
  assert.match(writes[1].payload.note, /实物已回仓/);
  assert.deepEqual(writes[2], first);
  assert.equal(page.data.pendingShipmentUnbind, null);
});

test('范围发生变化被后端明确拒绝后，清理待确认请求并要求重新核对', async () => {
  const { page, operation, messages } = load({ preview: packagePreview(), post: async () => { throw { statusCode: 409, message: '包裹关联订单或商品数量已变化，请重新查看整包解绑范围后再确认' }; } });
  await page.cancelWaybill(openEvent);
  page.onUnbindStockConfirmed({ detail: { value: ['confirmed'] } });
  await page.confirmFullUnbind();
  assert.equal(operation.pending(), null);
  assert.match(messages.at(-1).content, /重新查看/);
});

test('旧版待确认记录在物流异步加载后仍可定位，其他订单不展示此待办', async () => {
  const { page, storage } = load({ preview: [{ id: '88' }] });
  storage.set('quantity_operation_pending', { path: '/admin/orders-manage/orders/shipments/88/unbind', payload: { requestId: 'legacy-pending' } });
  page.onShow();
  assert.equal(page.data.pendingShipmentUnbind, null);
  await page.loadShipmentInfo('101');
  assert.equal(page.data.pendingShipmentUnbind.requestId, 'legacy-pending');
  storage.set('quantity_operation_pending', { path: '/admin/orders-manage/orders/shipments/88/unbind', payload: { requestId: 'other' }, context: { orderId: '102' } });
  page.onShow();
  assert.equal(page.data.pendingShipmentUnbind, null);
});

test('部分解绑用户未确认实物状态时不写入，确认后只提交本单所选商品', async () => {
  for (const confirm of [false, true]) {
    const { page, writes, messages } = load({ modal: { confirm } });
    page.data.partialUnbindShipment = { id: '99' };
    page.data.partialUnbindItems = [{ orderItemId: '9007199254740999', shipQty: 2, unbindQty: '1' }];
    await page.submitPartialUnbind();
    assert.match(messages[0].content, /电子面单取消本身不能返库存/);
    assert.equal(writes.length, confirm ? 1 : 0);
    if (confirm) {
      assert.equal(writes[0].payload.items.length, 1);
      assert.equal(writes[0].payload.items[0].orderItemId, '9007199254740999');
      assert.equal(writes[0].payload.items[0].qty, 1);
    }
  }
});

test('解绑提交期间重复点击和关闭预览不会另发请求或修改确认范围', async () => {
  let finish;
  const { page, writes } = load({ preview: packagePreview(), post: () => new Promise(resolve => { finish = resolve; }) });
  await page.cancelWaybill(openEvent);
  page.onUnbindStockConfirmed({ detail: { value: ['confirmed'] } });
  const first = page.confirmFullUnbind();
  await page.confirmFullUnbind();
  page.closeUnbindPreview();
  assert.equal(writes.length, 1);
  assert.equal(page.data.showUnbindPreview, true);
  finish({});
  await first;
  assert.equal(page.data.showUnbindPreview, false);
});
