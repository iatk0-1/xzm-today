function canManageQuickOrder(auth) {
  const snapshot = typeof auth.getPermissionSnapshot === 'function' ? auth.getPermissionSnapshot() : null;
  return auth.isAdmin() && auth.canAccessMenu('productManage') && !(snapshot && snapshot.currentRole && snapshot.currentRole.stallScoped);
}

function validateQuickProduct(draft, images) {
  if (!String(draft.name || '').trim()) return '请填写商品名称';
  if (!String(draft.articleNo || '').trim()) return '请填写货号';
  if (!images || images.length < 1 || images.length > 9) return '请选择1至9张商品图片';
  for (const [field, label] of [['costPrice', '成本'], ['price', '价格']]) {
    const raw = String(draft[field] || '');
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) return label + '须大于0，最多两位小数';
  }
  return '';
}

function requestShippingSubscription(runtime, config) {
  const requestId = 'quick_sub_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const result = new Promise(resolve => {
    if (!config || !config.enabled || !config.templateId || typeof runtime.requestSubscribeMessage !== 'function') { resolve(null); return; }
    try {
      runtime.requestSubscribeMessage({ tmplIds: [config.templateId],
        success: response => resolve(['accept', 'reject', 'ban', 'filter'].includes(response[config.templateId])
          ? { requestId, templateId: config.templateId, result: response[config.templateId] } : null),
        fail: () => resolve(null) });
    } catch (_) { resolve(null); }
  });
  return result;
}

const PENDING = 'pendingQuickOrderSubscriptions';
function pending(runtime) {
  try { const value = runtime.getStorageSync(PENDING); return Array.isArray(value) ? value : []; }
  catch (_) { return []; }
}
function storePending(runtime, entries) {
  try { runtime.setStorageSync(PENDING, entries.slice(-20)); }
  catch (_) { console.warn('发货订阅结果暂存失败'); }
}
async function uploadSubscription(api, runtime, entry) {
  try {
    await api.post('/quick-orders/orders/' + entry.orderId + '/subscriptions', entry.subscription);
    storePending(runtime, pending(runtime).filter(value => value.subscription.requestId !== entry.subscription.requestId));
  } catch (_) { /* 下单已完成，保留订阅结果供重新进入时重报。 */ }
}
async function flushSubscriptions(api, runtime) {
  for (const entry of pending(runtime)) await uploadSubscription(api, runtime, entry);
}
async function saveSubscription(api, runtime, orderId, subscription) {
  if (!subscription) return;
  const entry = { orderId, subscription };
  storePending(runtime, pending(runtime).filter(value => value.subscription.requestId !== subscription.requestId).concat(entry));
  await uploadSubscription(api, runtime, entry);
}
module.exports = { canManageQuickOrder, validateQuickProduct, requestShippingSubscription, saveSubscription, flushSubscriptions };
