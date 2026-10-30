const TYPES = ['FIRST', 'AMOUNT', 'RATE', 'QUANTITY'];
const LABELS = ['首单优惠', '满减优惠', '多件多折', '多件优惠'];

function summary(scheme) {
  if (!scheme) return '';
  let text = '';
  if (scheme.type === 'FIRST') text = '首购减' + scheme.amount + '元，' + scheme.maxUsers + '人，' + scheme.validDays + '天';
  if (scheme.type === 'AMOUNT') text = '满' + scheme.thresholdAmount + '元减' + scheme.amount + '元';
  if (scheme.type === 'RATE') text = '满' + scheme.minimumQty + '件打' + Number((Number(scheme.discountPercent) / 10).toFixed(3)) + '折';
  if (scheme.type === 'QUANTITY') text = scheme.mode === 'PROGRESSIVE'
    ? '首件不减，每后件多减' + scheme.amount + '元' + (scheme.maxUnitDiscount ? '，单件最多减' + scheme.maxUnitDiscount + '元' : '')
    : '满' + scheme.minimumQty + '件减' + scheme.amount + '元';
  return text + (scheme.enabled ? '' : '（已停用）');
}
function binding(value) {
  if (value == null) return undefined;
  return { firstSchemeId: value.firstSchemeId ? String(value.firstSchemeId) : null,
    otherSchemeId: value.otherSchemeId ? String(value.otherSchemeId) : null,
    combine: !!value.otherSchemeId && !!value.combine };
}
function fromSelection(selection) {
  if (!selection) return null;
  return { ...selection.binding,
    firstName: selection.firstScheme ? selection.firstScheme.name : '',
    otherName: selection.otherScheme ? selection.otherScheme.name : '',
    firstSummary: summary(selection.firstScheme), otherSummary: summary(selection.otherScheme),
    otherType: selection.otherScheme ? selection.otherScheme.type : '',
    firstActivatedAt: selection.firstActivatedAt || '' };
}
function money(value, label, optional = false) {
  const text = String(value == null ? '' : value).trim();
  if (optional && !text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) <= 0 || Number(text) > 9999999.99)
    throw new Error(label + '须大于0，最多两位小数');
  return Number(text);
}
function positiveInt(value, label, max = 100000000) {
  const text = String(value || '').trim();
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > max) throw new Error(label + '须为1到' + max + '的整数');
  return Number(text);
}
function schemeRequest(form) {
  const name = String(form.name || '').trim();
  if (!name || name.length > 100) throw new Error('请填写100字以内的方案名称');
  if (!TYPES.includes(form.type)) throw new Error('请选择优惠类型');
  const result = { name, type: form.type, mode: 'FIXED', enabled: true };
  if (form.type === 'FIRST') Object.assign(result, { amount: money(form.amount, '首单减免金额'),
    maxUsers: positiveInt(form.maxUsers, '可享人数'), validDays: positiveInt(form.validDays, '有效天数', 36500) });
  if (form.type === 'AMOUNT') {
    result.thresholdAmount = money(form.thresholdAmount, '门槛金额');result.amount = money(form.amount, '减免金额');
    if (result.amount >= result.thresholdAmount) throw new Error('减免金额必须小于门槛金额');
  }
  if (form.type === 'RATE') {
    result.minimumQty = positiveInt(form.minimumQty, '起购件数');
    const fold = money(form.fold, '折扣');
    if (fold >= 10 || !Number.isInteger(Math.round(fold * 100) / 10)) throw new Error('折扣须大于0、小于10，最多一位小数，例如9或9.5');
    result.discountPercent = Math.round(fold * 10);
  }
  if (form.type === 'QUANTITY') {
    result.mode = form.mode === 'PROGRESSIVE' ? 'PROGRESSIVE' : 'FIXED';
    result.minimumQty = result.mode === 'PROGRESSIVE' ? 1 : positiveInt(form.minimumQty, '起购件数');
    result.amount = money(form.amount, result.mode === 'PROGRESSIVE' ? '每件递增减免' : '减免金额');
    if (result.mode === 'PROGRESSIVE') result.maxUnitDiscount = money(form.maxUnitDiscount, '单件减免上限', true);
  }
  return result;
}
module.exports = { TYPES, LABELS, binding, fromSelection, schemeRequest, summary };
