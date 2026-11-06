const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../../utils/inventoryOperations');
function data(patch = {}) {
  return { functionId: 'backfill', note: '补报单', exchangeLines: [],
    skus: [inventory.row({ skuId: '9007199254740993', spec: '红', size: 'M', qty: 5, abnormalQty: 2 }, { operationQty: '1' })], ...patch };
}
test('既有收货按未关联数量选择，撤销和不支持来源不可选', () => {
  assert.equal(inventory.receiptChoice({ id: '1', qty: 5, source: 'history', allocations: [{ qty: 2 }] }).remaining, 3);
  assert.equal(inventory.receiptChoice({ qty: 2, source: 'history', revoked: true }).disabled, true);
  assert.equal(inventory.receiptChoice({ qty: 2, source: 'normal', allocations: [{ qty: 2 }] }).disabled, true);
  assert.equal(inventory.receiptChoice({ qty: 2, source: 'return_inspection' }).disabled, true);
});
test('补报单无需入库记录且仅限已有异常数量，空备注可提交', () => {
  const input = data({ note: '' });
  const payload = inventory.buildOperation(input);
  assert.equal(payload.items[0].receiptId, null); assert.equal(payload.backfillMode, 'abnormal');
  assert.equal(payload.items[0].skuId, '9007199254740993'); assert.equal(payload.note, '');
  input.skus[0].operationQty = '3'; assert.throws(() => inventory.buildOperation(input), /不能超过异常数量/);
  input.skus[0].abnormalQty = 0; input.skus[0].operationQty = '1';
  assert.throws(() => inventory.buildOperation(input), /不能超过异常数量/);
});

test('同商品换货保留逐行来源，多个出库规格可换回同一规格，禁止外部规格和数量不一致', () => {
  const input = data({ functionId: 'exchange', skus: [
    inventory.row({ skuId: '1', spec: '红', qty: 3 }, { operationQty: '2' }),
    inventory.row({ skuId: '2', spec: '蓝', qty: 1 }, { operationQty: '1' })
  ], exchangeLines: [
    { sourceSkuId: '1', targetSkuId: '2', qty: 2, report: { purchaseOrderId: '9007199254740998' } },
    { sourceSkuId: '2', targetSkuId: '2', qty: 1 }
  ] });
  const payload = inventory.buildOperation(input);
  assert.equal(payload.targets[0].sourceSkuId, '1'); assert.equal(payload.targets[0].purchaseOrderId, '9007199254740998');
  assert.equal(payload.targets[1].skuId, '2');
  input.exchangeLines[0].qty = 1; assert.throws(() => inventory.buildOperation(input), /数量.*一致/);
  input.exchangeLines[0].qty = 2; input.exchangeLines[0].targetSkuId = 'foreign';
  assert.throws(() => inventory.buildOperation(input), /当前商品/);
  input.exchangeLines = []; assert.throws(() => inventory.buildOperation(input), /核对应换回/);
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
  assert.equal(inventory.changeText('abnormal_exchange_out'), '换货出库');
  assert.equal(inventory.changeText('exchange_cancel'), '取消换货待回');
  const payload = inventory.buildOperation(data({ functionId: 'return', exchangeLines: [{ sourceSkuId: '1', targetSkuId: '99', qty: 3 }] }));
  assert.equal(payload.action, 'return');
  assert.deepEqual(payload.targets, []);
});
test('出库和退货可超过异常量但不能超过实际库存，备注选填，旧菜单不可提交', () => {
  for (const functionId of ['outbound', 'return']) {
    const input = data({ functionId, note: '' }); input.skus[0].operationQty = '3';
    assert.equal(inventory.buildOperation(input).items[0].qty, 3);
    input.skus[0].operationQty = '6';
    assert.throws(() => inventory.buildOperation(input), /超过实际库存/);
  }
  assert.equal(inventory.buildOperation(data({ note: '  ' })).note, '');
  for (const functionId of ['gain', 'loss', 'keep', 'confirm_history']) {
    assert.throws(() => inventory.buildOperation(data({ functionId })), /请选择库存操作/);
  }
});

test('历史现货数量与可售库存无限标记分开，规格仍按仓库真实数量展示', () => {
  const sku = inventory.row({ skuId: '1', qty: 0, readyToShipQty: 0, unlimitedStock: true });
  assert.equal(sku.qty, 0); assert.equal(sku.operationQty, '0');
  assert.equal(inventory.quantity(''), 0); assert.equal(inventory.quantity('2147483647'), 2147483647);
});
