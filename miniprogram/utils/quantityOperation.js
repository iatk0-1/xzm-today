// 数量写入超时后保留原请求，恢复网络时沿用同号重试，避免重复报单或入库。
const KEY = 'quantity_operation_pending';
let busy = false;
function pending() { return wx.getStorageSync ? wx.getStorageSync(KEY) || null : null; }
function save(value) { if (wx.setStorageSync) wx.setStorageSync(KEY, value); }
function clear() { if (wx.removeStorageSync) wx.removeStorageSync(KEY); }
function requestId() { return 'quantity_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
async function send(api, operation) {
  if (busy) throw new Error('上一次数量操作还在提交，请稍候');
  busy = true;
  try {
    const result = await api.post(operation.path, operation.payload);
    clear();
    return result;
  } catch (err) {
    if (err && err.statusCode >= 400 && err.statusCode < 500) clear();
    throw err;
  } finally { busy = false; }
}
async function run(api, path, payload, context) {
  const signature = JSON.stringify({ path, payload });
  let operation = pending();
  if (operation && operation.signature !== signature) {
    const page = /\/shipments\/[^/]+\/(partial-)?unbind$/.test(operation.path) ? '原订单页' : '库存页';
    throw new Error('上次数量操作结果待确认，请先到' + page + '重试原操作');
  }
  if (!operation) {
    operation = { path, payload: { ...payload, requestId: requestId() }, signature, context };
    save(operation);
  }
  return send(api, operation);
}
async function retry(api) {
  const operation = pending();
  if (!operation) return null;
  const result = await send(api, operation);
  return { operation, result };
}
module.exports = { pending, run, retry, requestId };
