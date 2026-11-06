const LIMIT = 2147483647;
const tabs = [
  { id: 'inbound', name: '入库' }, { id: 'outbound', name: '出库' },
  { id: 'backfill', name: '补报单' }, { id: 'exchange', name: '换货' },
  { id: 'return', name: '退货' }, { id: 'reports', name: '报单记录' }
];
const operations = {
  normal: { id: 'normal', name: '入库', type: 'normal', tip: '按报单时间核销待入库，超出报单待入库的数量进入异常库存。' },
  history: { id: 'history', name: '历史入库', type: 'history', tip: '首次登记历史实物，不抵扣报单待入库。' },
  outbound: { id: 'outbound', name: '出库', type: 'outbound', action: 'outbound', tip: '优先扣减异常库存，不足部分扣减正常库存。' },
  backfill: { id: 'backfill', name: '补报单', type: 'backfill', tip: '已入库只补报单来源；从未记过库存的收货，选择首次入库。' },
  exchange: { id: 'exchange', name: '换货', type: 'outbound', action: 'exchange', tip: '优先出异常库存，不足部分出正常库存。出库和应换回总件数须一致，可跨商品和规格；换回前不增加现货。' },
  return: { id: 'return', name: '退货', type: 'outbound', action: 'return', tip: '退回供应商，优先扣减异常库存，不足部分扣减正常库存；不取消客户需求和报单待入库。' }
};
const functions = {
  inbound: [operations.normal, { id: 'receipts', name: '入库记录', view: 'receipts' }],
  outbound: [operations.outbound, { id: 'outbound_records', name: '出库记录', view: 'flows' }],
  backfill: [operations.backfill, { id: 'backfill_records', name: '补单记录', view: 'backfills' }],
  exchange: [operations.exchange, { id: 'exchanges', name: '换货记录', view: 'exchanges' }, { id: 'exchange_pending', name: '换货未回', view: 'exchanges' }],
  return: [operations.return, { id: 'return_records', name: '退货记录', view: 'flows' }],
  reports: []
};
function quantity(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text)) return null;
  const num = Number(text);
  return Number.isSafeInteger(num) && num <= LIMIT ? num : null;
}
function row(item, previous = {}) {
  return {
    ...item, id: item.skuId, label: [item.spec || '默认规格', item.size].filter(Boolean).join(' / '),
    operationQty: previous.operationQty == null ? '0' : String(previous.operationQty),
    receipt: previous.receipt || null, report: previous.report || null
  };
}
function receiptChoice(item) {
  const linked = (item.allocations || []).reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
  const remaining = Math.max(0, Number(item.effectiveQty == null ? item.qty : item.effectiveQty) - linked);
  const allowed = ['normal', 'history', 'stocktake_gain'].includes(item.source);
  return { ...item, choiceId: item.id, remaining, disabled: !!item.revoked || !allowed || !remaining,
    reason: item.revoked ? '已撤销' : !allowed ? '此来源不支持补录' : !remaining ? '已全部关联报单' : '' };
}
function sourceText(source) {
  return { normal: '报单到货', history: '历史库存', stocktake_gain: '盘点盈余', abnormal_keep: '异常保留补报',
    return_inspection: '退货验收入库', history_confirm: '历史/盘盈确认', existing_receipt_confirm: '既有收货来源确认', exchange_in: '换回入库' }[source] || source;
}
function changeText(type) {
  return { outbound: '出库', exchange_out: '换货出库', return_out: '退货出库', arrival: '报单到货入库', history_in: '历史库存入库', shipment: '发货出库', return_inspection: '退货验收入库',
    stocktake_gain: '盘盈', stocktake_loss: '盘亏', abnormal_keep: '异常保留补报', abnormal_exchange_out: '换货出库',
    history_confirm: '历史/盘盈转正常', receipt_backfill: '既有收货来源补录', exchange_in: '换回入库',
    abnormal_return_out: '异常退供应商', receipt_revoke: '撤销入库', receipt_correct: '入库数量更正', shipment_cancel: '发货解绑返还' }[type] || type;
}
function buildOperation(data) {
  const operation = operations[data.functionId];
  if (!operation) throw new Error('请选择库存操作功能');
  const note = (data.note || '').trim();
  const items = [];
  for (const sku of data.skus) {
    const qty = quantity(sku.operationQty);
    if (qty == null) throw new Error(sku.label + '：数量须为非负整数，且不能超过 ' + LIMIT);
    if (!qty) continue;
    if (operation.type === 'outbound' && qty > sku.qty) throw new Error(sku.label + '：超过实际库存数量');
    let receiptId = null;
    if (operation.type === 'backfill' && data.backfillMode === 'existing') {
      if (!sku.receipt) throw new Error(sku.label + '：请选择既有入库记录');
      if (qty > sku.receipt.remaining) throw new Error(sku.label + '：超过收货可补录数量');
      receiptId = sku.receipt.id;
    }
    items.push({ skuId: sku.id, qty, receiptId });
  }
  if (!items.length) throw new Error('至少填写一个大于0的操作数量');
  const targets = [];
  if (operation.id === 'exchange') {
    for (const product of data.exchangeProducts) for (const sku of product.skus) {
      const qty = quantity(sku.operationQty);
      if (qty == null) throw new Error(product.name + ' ' + sku.label + '：换回数量须为非负整数');
      if (qty) targets.push({ skuId: sku.id, qty, purchaseOrderId: sku.report ? sku.report.purchaseOrderId : null });
    }
    if (items.reduce((sum, item) => sum + item.qty, 0) !== targets.reduce((sum, item) => sum + item.qty, 0)) throw new Error('换回总数量必须与出库总数量一致');
  }
  return { type: operation.type, action: operation.action || null, direction: operation.direction || null,
    category: null, backfillMode: operation.type === 'backfill' ? data.backfillMode : null,
    note, items, targets };
}
module.exports = { LIMIT, tabs, functions, operations, quantity, row, receiptChoice, sourceText, changeText, buildOperation };
