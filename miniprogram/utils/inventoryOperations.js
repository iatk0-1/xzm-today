const LIMIT = 2147483647;
const tabs = [
  { id: 'operate', name: '操作' }, { id: 'ledger', name: '入库与流水' },
  { id: 'returns', name: '换货/退件' }, { id: 'reports', name: '报单记录' }
];
const functions = {
  operate: [
    { id: 'normal', name: '正常到货', type: 'normal', tip: '按报单时间核销待到货，超出报单的数量进入异常库存。' },
    { id: 'history', name: '历史入库', type: 'history', tip: '首次登记历史实物，不抵扣报单待到货。' },
    { id: 'backfill', name: '收货补录', type: 'backfill', tip: '已入库只补来源；从未记过库存的收货，选择首次入库。' },
    { id: 'gain', name: '盘盈', type: 'stocktake', direction: 'gain', tip: '盘盈先记入异常库存，核实来源后再转正常。' },
    { id: 'loss', name: '盘亏', type: 'stocktake', direction: 'loss', tip: '登记实际损失数量；涉及发货任务占用时需要先核查。' },
    { id: 'keep', name: '供应商多发保留', type: 'abnormal', action: 'keep', tip: '异常转正常并补建已收报单，实物总量不增加。' },
    { id: 'confirm_history', name: '历史/盘盈确认', type: 'abnormal', action: 'confirm_history', tip: '核实来源后异常转正常，不虚建供应商报单。' },
    { id: 'exchange', name: '换货出库', type: 'abnormal', action: 'exchange', tip: '上方填写异常出库量，下方填写应换回量。总件数必须相等，可跨商品和规格。换回前不增加现货。' },
    { id: 'return', name: '退供应商', type: 'abnormal', action: 'return', tip: '异常实物退回供应商，不取消客户需求和原报单待到货。' }
  ],
  ledger: [{ id: 'receipts', name: '入库记录' }, { id: 'flows', name: '库存流水' }],
  returns: [{ id: 'exchanges', name: '换货待回' }, { id: 'inspections', name: '退件验收/处置' }],
  reports: [{ id: 'all', name: '全部报单' }, { id: 'pending', name: '待到货' }, { id: 'received', name: '已到齐' }]
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
  const remaining = Math.max(0, Number(item.qty) - linked);
  const allowed = ['normal', 'history', 'stocktake_gain'].includes(item.source);
  return { ...item, choiceId: item.id, remaining, disabled: !!item.revoked || !allowed || !remaining,
    reason: item.revoked ? '已撤销' : !allowed ? '此来源不支持补录' : !remaining ? '已全部关联报单' : '' };
}
function sourceText(source) {
  return { normal: '报单到货', history: '历史库存', stocktake_gain: '盘点盈余', abnormal_keep: '异常保留补报',
    return_inspection: '退货验收入库', history_confirm: '历史/盘盈确认', existing_receipt_confirm: '既有收货来源确认', exchange_in: '换回入库' }[source] || source;
}
function changeText(type) {
  return { arrival: '报单到货入库', history_in: '历史库存入库', shipment: '发货出库', return_inspection: '退货验收入库',
    stocktake_gain: '盘盈', stocktake_loss: '盘亏', abnormal_keep: '异常保留补报', abnormal_exchange_out: '换货出库',
    history_confirm: '历史/盘盈转正常', receipt_backfill: '既有收货来源补录', exchange_in: '换回入库',
    abnormal_return_out: '异常退供应商', receipt_revoke: '撤销入库', shipment_cancel: '发货解绑返还' }[type] || type;
}
function buildOperation(data) {
  const operation = functions.operate.find(item => item.id === data.functionId);
  if (!operation) throw new Error('请选择库存操作功能');
  const note = (data.note || '').trim();
  if ((['backfill', 'stocktake'].includes(operation.type) || operation.action === 'confirm_history') && !note) throw new Error('请填写来源或调整原因');
  const items = [];
  for (const sku of data.skus) {
    const qty = quantity(sku.operationQty);
    if (qty == null) throw new Error(sku.label + '：数量须为非负整数，且不能超过 ' + LIMIT);
    if (!qty) continue;
    if (operation.type === 'abnormal' && qty > sku.abnormalQty) throw new Error(sku.label + '：超过异常库存数量');
    if (operation.id === 'loss' && qty > (data.lossCategory === 'abnormal' ? sku.abnormalQty : sku.qty - sku.abnormalQty)) throw new Error(sku.label + '：超过该类实际库存');
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
    category: operation.id === 'loss' ? data.lossCategory : null, backfillMode: operation.type === 'backfill' ? data.backfillMode : null,
    note, items, targets };
}
module.exports = { LIMIT, tabs, functions, quantity, row, receiptChoice, sourceText, changeText, buildOperation };
