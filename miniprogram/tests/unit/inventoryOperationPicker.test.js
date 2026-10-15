const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../../utils/inventoryOperations');
function data(patch = {}) {
  return { functionId: 'backfill', backfillMode: 'existing', note: '补收货来源', lossCategory: 'normal', exchangeProducts: [],
    skus: [inventory.row({ skuId: '9007199254740993', spec: '红', size: 'M', qty: 5, abnormalQty: 2 }, { operationQty: '1' })], ...patch };
}
test('既有收货按未关联数量选择，撤销和不支持来源不可选', () => {
  assert.equal(inventory.receiptChoice({ id: '1', qty: 5, source: 'history', allocations: [{ qty: 2 }] }).remaining, 3);
  assert.equal(inventory.receiptChoice({ qty: 2, source: 'history', revoked: true }).disabled, true);
  assert.equal(inventory.receiptChoice({ qty: 2, source: 'normal', allocations: [{ qty: 2 }] }).disabled, true);
  assert.equal(inventory.receiptChoice({ qty: 2, source: 'return_inspection' }).disabled, true);
});
test('未选择收货记录不能自动转首次入库，必须明确切换方式', () => {
  assert.throws(() => inventory.buildOperation(data()), /请选择既有入库记录/);
  const payload = inventory.buildOperation(data({ backfillMode: 'first' }));
  assert.equal(payload.items[0].receiptId, null);
  assert.equal(payload.items[0].skuId, '9007199254740993');
});
test('补来源保留长入库编号，不能超过未关联余额', () => {
  const input = data();
  input.skus[0].receipt = { id: '9007199254740995', remaining: 2 };
  assert.equal(inventory.buildOperation(input).items[0].receiptId, '9007199254740995');
  input.skus[0].operationQty = '3';
  assert.throws(() => inventory.buildOperation(input), /超过收货可补录/);
});
test('多商品换货只核对总件数，允许跨规格拆分且保留报单长编号', () => {
  const input = data({ functionId: 'exchange', skus: [
    inventory.row({ skuId: '1', spec: '红', qty: 3, abnormalQty: 3 }, { operationQty: '2' }),
    inventory.row({ skuId: '2', spec: '黑', qty: 1, abnormalQty: 1 }, { operationQty: '1' })
  ], exchangeProducts: [{ name: '毛衣', skus: [
    inventory.row({ skuId: '9007199254740997', spec: '蓝' }, { operationQty: '1' }),
    inventory.row({ skuId: '9007199254740999', spec: '白' }, { operationQty: '2', report: { purchaseOrderId: '9007199254740998' } })
  ] }] });
  const payload = inventory.buildOperation(input);
  assert.equal(payload.items.reduce((sum, item) => sum + item.qty, 0), 3);
  assert.equal(payload.targets.reduce((sum, item) => sum + item.qty, 0), 3);
  assert.equal(payload.targets[1].purchaseOrderId, '9007199254740998');
  input.exchangeProducts[0].skus[1].operationQty = '1';
  assert.throws(() => inventory.buildOperation(input), /总数量必须/);
});
test('数量0不处理，负数小数和超出数据库整数上限不能写入', () => {
  for (const qty of ['-1', '1.5', '1件', '2147483648']) {
    const input = data({ functionId: 'history' }); input.skus[0].operationQty = qty;
    assert.throws(() => inventory.buildOperation(input), /非负整数/);
  }
  const input = data({ functionId: 'history' }); input.skus[0].operationQty = '0';
  assert.throws(() => inventory.buildOperation(input), /大于0/);
  input.skus.push(inventory.row({ skuId: '2' }, { operationQty: '2' }));
  assert.equal(inventory.buildOperation(input).items.length, 1);
});
test('切换为退供应商或普通入库时，不携带旧换货参数', () => {
  const payload = inventory.buildOperation(data({ functionId: 'return', exchangeProducts: [{ skus: [{ id: '99', operationQty: '3', report: { purchaseOrderId: '88' } }] }] }));
  assert.equal(payload.action, 'return');
  assert.deepEqual(payload.targets, []);
});
test('异常出库和盘亏都不能超过对应实物数量，必填操作原因', () => {
  const input = data({ functionId: 'return' }); input.skus[0].operationQty = '3';
  assert.throws(() => inventory.buildOperation(input), /超过异常库存/);
  input.functionId = 'loss'; input.lossCategory = 'abnormal';
  assert.throws(() => inventory.buildOperation(input), /超过该类实际库存/);
  input.lossCategory = 'normal'; input.skus[0].operationQty = '4';
  assert.throws(() => inventory.buildOperation(input), /超过该类实际库存/);
  input.skus[0].operationQty = '1'; input.note = '';
  assert.throws(() => inventory.buildOperation(input), /填写来源或调整原因/);
});
test('历史现货数量与可售库存无限标记分开，规格仍按仓库真实数量展示', () => {
  const sku = inventory.row({ skuId: '1', qty: 0, readyToShipQty: 0, unlimitedStock: true });
  assert.equal(sku.qty, 0); assert.equal(sku.operationQty, '0');
  assert.equal(inventory.quantity(''), 0); assert.equal(inventory.quantity('2147483647'), 2147483647);
});
