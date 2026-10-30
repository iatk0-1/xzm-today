const TYPES = ['FIRST', 'AMOUNT', 'RATE', 'QUANTITY'];
const LABELS = ['首单优惠', '满减优惠', '多件多折', '多件优惠'];

function summary(scheme) {
  if (!scheme) return '';
  if (scheme.mode === 'PROGRESSIVE') return '旧版方案已停用，请重新配置规则';
  let text;
  if (scheme.type === 'FIRST') text = '首购减' + scheme.amount + '元，' + scheme.maxUsers + '人，' + scheme.validDays + '天';
  else {
    const rules = Array.isArray(scheme.rules) ? scheme.rules : [scheme];
    text = rules.map(rule => {
      if (scheme.type === 'AMOUNT') return '满' + rule.thresholdAmount + '元减' + rule.amount + '元';
      if (scheme.type === 'RATE') return '满' + rule.minimumQty + '件打' + Number((Number(rule.discountPercent) / 10).toFixed(3)) + '折';
      return '满' + rule.minimumQty + '件减' + rule.amount + '元';
    }).join('；');
  }
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
  if (form.type !== 'FIRST') {
    if (!Array.isArray(form.rules) || !form.rules.length || form.rules.length > 100) throw new Error('每个方案请填写1到100条规则');
    const seen = new Set();
    result.rules = form.rules.map((row, index) => {
      const label = '第' + (index + 1) + '条规则：';
      if (!row) throw new Error(label + '请填写完整');
      let rule, threshold;
      if (form.type === 'AMOUNT') {
        threshold = money(row.thresholdAmount, label + '门槛金额');
        const amount = money(row.amount, label + '减免金额');
        if (amount >= threshold) throw new Error(label + '减免金额必须小于门槛金额');
        rule = { thresholdAmount: threshold, amount };
      } else {
        threshold = positiveInt(row.minimumQty, label + '件数门槛');
        if (form.type === 'RATE') {
          const fold = money(row.fold, label + '折扣');
          if (fold >= 10 || !Number.isInteger(Math.round(fold * 100) / 10)) throw new Error(label + '折扣须大于0、小于10，最多一位小数');
          rule = { minimumQty: threshold, discountPercent: Math.round(fold * 10) };
        } else rule = { minimumQty: threshold, amount: money(row.amount, label + '减免金额') };
      }
      if (seen.has(threshold)) throw new Error(label + '门槛不能重复');
      seen.add(threshold);
      return rule;
    });
  }
  return result;
}
module.exports = { TYPES, LABELS, binding, fromSelection, schemeRequest, summary };
