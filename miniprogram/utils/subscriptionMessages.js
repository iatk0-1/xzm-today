// 只在用户提交/补订阅的点击处理里申请，模板配置提前加载，避免丢失点击触发时机。
const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  templates: {
    review: 'DBABT4AnVqHfQPlB944CrKFZbjT3LEN6oHS4MsIWxK4',
    refund: 'qceGTkKhHr_tTDq_vPDhq2DZP304hSmgKh8S-ZfFTw0'
  }
});
const PENDING_KEY = 'pendingAfterSaleSubscriptions';

async function loadConfig(api) {
  try {
    const value = await api.get('/after-sales/subscription-config');
    return value && typeof value.enabled === 'boolean' && value.templates ? value : DEFAULT_CONFIG;
  }
  catch (error) {
    console.warn('售后订阅配置暂未加载，使用已配置模板');
    return DEFAULT_CONFIG;
  }
}

function request(runtime, config = DEFAULT_CONFIG, scenes = ['review', 'refund']) {
  const requestId = 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 14);
  const settings = config || DEFAULT_CONFIG;
  const templates = settings.templates || {};
  const selected = scenes.filter(scene => templates[scene]);
  const result = new Promise(resolve => {
    if (!settings.enabled || !selected.length || typeof runtime.requestSubscribeMessage !== 'function') {
      resolve({}); return;
    }
    try {
      runtime.requestSubscribeMessage({
        tmplIds: selected.map(scene => templates[scene]),
        success(response) {
          const results = {};
          selected.forEach(scene => {
            const value = response[templates[scene]];
            if (['accept', 'reject', 'ban', 'filter'].includes(value)) results[scene] = value;
          });
          resolve(results);
        },
        fail() { resolve({}); }
      });
    } catch (error) { resolve({}); }
  });
  return { requestId, result, templateIds: Object.fromEntries(selected.map(scene => [scene, templates[scene]])) };
}

function pending(runtime) {
  try {
    const value = runtime.getStorageSync(PENDING_KEY);
    return Array.isArray(value) ? value : [];
  } catch (error) { return []; }
}
function savePending(runtime, values) {
  try { runtime.setStorageSync(PENDING_KEY, values.slice(-20)); }
  catch (error) { console.warn('售后订阅结果暂存失败'); }
}

async function persist(api, runtime, afterSaleId, attempt) {
  const results = await attempt.result;
  if (!afterSaleId || !Object.keys(results).length) return results;
  const entry = { afterSaleId: String(afterSaleId), requestId: attempt.requestId, results, templateIds: attempt.templateIds };
  // 售后已经成功创建；订阅结果上报失败不能让页面提示“售后提交失败”。
  const entries = pending(runtime).filter(value => value.requestId !== entry.requestId);
  entries.push(entry);
  savePending(runtime, entries);
  try {
    await api.post(`/after-sales/${entry.afterSaleId}/subscriptions`, {
      requestId: entry.requestId, results: entry.results, templateIds: entry.templateIds
    }, { idempotencyKey: entry.requestId });
    savePending(runtime, pending(runtime).filter(value => value.requestId !== entry.requestId));
  } catch (error) {
    console.warn('售后订阅结果上报未完成，将在下次进入售后页面时重试');
  }
  return results;
}

async function flush(api, runtime) {
  for (const entry of pending(runtime)) {
    try {
      await api.post(`/after-sales/${entry.afterSaleId}/subscriptions`, {
        requestId: entry.requestId, results: entry.results, templateIds: entry.templateIds
      }, { idempotencyKey: entry.requestId });
      savePending(runtime, pending(runtime).filter(value => value.requestId !== entry.requestId));
    } catch (error) {
      console.warn('售后订阅结果上报未完成，将在下次进入售后页面时重试');
    }
  }
}

module.exports = { DEFAULT_CONFIG, loadConfig, request, persist, flush };
