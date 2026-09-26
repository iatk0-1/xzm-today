// 页面返回时仅同步成功修改的记录，不重新查询列表首屏。
const listeners = new Set();

function publish(entity, id, removed = false, extra = {}) {
  if (id == null) return;
  listeners.forEach(listener => listener({ entity, id: String(id), removed, ...extra }));
}

function recordMutation(url, method, data = {}, result) {
  if (method === 'GET') return;
  const path = url.split('?')[0];
  const match = path.match(/^\/(products|live-products|live-sessions|wishes|orders|stalls|tags)\/([^/]+)(?:\/(.*))?$/);
  if (match && !['deleted', 'status', 'query', 'active', 'ended', 'search', 'manage', 'batch', 'order'].includes(match[2])
      && !['view', 'pay/wechat'].includes(match[3])) {
    publish(match[1], match[2], method === 'DELETE' && !match[3]);
  }
  if (path === '/products/status/batch') (data.productIds || []).forEach(id => publish('products', id));
  const adminOrder = path.match(/^\/admin\/orders-manage\/orders\/(\d+)/);
  if (adminOrder) publish('orders', adminOrder[1]);
  const changeRequest = path.match(/^\/admin\/orders-manage\/change-requests\/\d+\//);
  if (changeRequest && result) publish('orders', result.orderId);
  const afterSale = path.match(/^\/after-sales\/(\d+)\//);
  if (afterSale) {
    publish('after-sales', afterSale[1]);
    if (result) publish('orders', result.orderId);
  }
  if (path === '/shipments') (data.orderIds || []).forEach(id => publish('orders', id));
  const unbindOrder = path.match(/^\/shipments\/\d+\/orders\/(\d+)$/);
  if (unbindOrder) publish('orders', unbindOrder[1]);
  if (path === '/after-sales' && data.orderId) publish('orders', data.orderId);
  if (path === '/live-products' && result) {
    const sessionId = (url.match(/[?&]sessionId=([^&]+)/) || [])[1];
    publish('live-products', (result.product || result).id, false, { product: result.product || result, sessionId });
  }
  if (path === '/live-sessions' && result) publish('live-sessions', result.id);
  if (path === '/wishes' && result) publish('wishes', result.id, false, { created: true });
  if (path === '/wishes/batch' && result) (result.wishes || []).forEach(item => publish('wishes', item.id, false, { created: true }));
  if (['/stalls', '/tags'].includes(path) && result) publish(path.slice(1), (result.stall || result.tag || result).id);
  const conversation = path.match(/^\/conversations\/(\d+)(?:\/(messages|read))?$/);
  if (conversation) publish('conversations', conversation[1], method === 'DELETE', { perspective: data.perspective, read: conversation[2] === 'read' });
  if (match && ['stalls', 'tags'].includes(match[1]) && match[3] === 'products') {
    (data.productIds || []).forEach(id => publish('products', id));
  }
  if (path === '/cart/selected' && method === 'DELETE') publish('cart-removed', 'selected');
  if (path === '/picking-list/order') (data.items || []).forEach(item => publish('picking-skus', item.skuId));
}

function wrap(config, synchronize) {
  const load = config.onLoad;
  const show = config.onShow;
  const unload = config.onUnload;
  return {
    ...config,
    onLoad(...args) {
      this._pendingPageChanges = new Map();
      this._pageChangeListener = change => {
        const key = change.entity + ':' + change.id;
        this._pendingPageChanges.set(key, { ...this._pendingPageChanges.get(key), ...change });
      };
      listeners.add(this._pageChangeListener);
      return load && load.apply(this, args);
    },
    onShow(...args) {
      const result = show && show.apply(this, args);
      if (this._pendingPageChanges && this._pendingPageChanges.size) {
        const changes = [...this._pendingPageChanges.values()];
        this._pendingPageChanges.clear();
        return Promise.resolve().then(() => synchronize.call(this, changes)).catch(err => {
          changes.forEach(change => {
            const key = change.entity + ':' + change.id;
            if (!this._pendingPageChanges.has(key)) this._pendingPageChanges.set(key, change);
          });
          console.error('同步页面单项数据失败:', err);
        });
      }
      return result;
    },
    onUnload(...args) {
      listeners.delete(this._pageChangeListener);
      return unload && unload.apply(this, args);
    }
  };
}

async function updateList(page, changes, options) {
  const api = require('./api');
  for (const change of changes.filter(item => item.entity === options.entity)) {
    const list = page.data[options.field];
    if (!list.some(item => String(item[options.idField || 'id']) === change.id)) continue;
    let updated;
    if (!change.removed) {
      try {
        const result = await api.get(options.url(change.id));
        const item = result && (result.product || result);
        updated = item && (options.normalize ? options.normalize.call(page, item) : item);
      } catch (err) {
        if (err.statusCode !== 404) throw err;
      }
    }
    const current = page.data[options.field];
    const next = current.flatMap(item => {
      if (String(item[options.idField || 'id']) !== change.id) return [item];
      return updated && (!options.matches || options.matches.call(page, updated)) ? [{ ...item, ...updated }] : [];
    });
    page.setData({ [options.field]: next });
  }
  if (options.after) options.after.call(page);
}

module.exports = { wrap, publish, recordMutation, updateList };
