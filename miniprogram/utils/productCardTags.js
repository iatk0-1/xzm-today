const { TYPES, LABELS } = require('./productPromotions');
const { getFreeStockQty, isSkuSoldOut } = require('./stock');

function cardTags(product, offers = []) {
  const available = new Set((Array.isArray(offers) ? offers : [])
    .filter(offer => offer && offer.status === 'AVAILABLE').map(offer => offer.type));
  const tags = TYPES.filter(type => available.has(type))
    .map(type => ({ type, label: LABELS[TYPES.indexOf(type)] }));
  if ((product.skuMatrix || []).some(sku => !isSkuSoldOut(sku) && getFreeStockQty(sku) > 0)) {
    tags.push({ type: 'READY_STOCK', label: '现货' });
  }
  return tags;
}

// 管理列表展示商品启用的优惠配置，不按当前管理者的购买资格筛选。
function managedCardTags(product, selection) {
  const schemes = selection ? [selection.firstScheme, selection.otherScheme] : [];
  return cardTags(product, schemes.filter(scheme => scheme && scheme.enabled)
    .map(scheme => ({ type: scheme.type, status: 'AVAILABLE' })));
}

// 商品先展示，再分批补充优惠；每次加载使用独立标记，避免旧请求覆盖刷新后的卡片。
async function loadCardTags(page, products, field, getOffers, buildTags = cardTags) {
  const requests = page._cardTagRequests || (page._cardTagRequests = new Map());
  const entries = products.map(product => {
    const key = String(product.id);
    const token = {};
    requests.set(key, token);
    return { product, key, token };
  });
  const pending = entries.slice();
  const replacements = new Map();
  const isCurrent = entry => !page._pageClosed && requests.get(entry.key) === entry.token
    && (page.data[field] || []).some(product => String(product.id) === entry.key);
  async function worker() {
    while (pending.length && !page._pageClosed) {
      const entry = pending.shift();
      const { product, key } = entry;
      if (!isCurrent(entry)) continue;
      try {
        const offers = await getOffers(product.id);
        if (isCurrent(entry)) replacements.set(key, offers);
      } catch (error) {
        // 优惠失败不影响商品浏览和现货标签，下一次查询会重新加载。
        console.error('加载商品卡片优惠失败:', product.id, error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  const currentKeys = new Set(entries.filter(isCurrent).map(entry => entry.key));
  if (!page._pageClosed && replacements.size && currentKeys.size) {
    const replace = list => list.map(product => {
      const key = String(product.id);
      return currentKeys.has(key) && replacements.has(key)
        ? { ...product, cardTags: buildTags(product, replacements.get(key)), cardTagsReady: true } : product;
    });
    const patch = { [field]: replace(page.data[field]) };
    for (const column of ['leftColumn', 'rightColumn']) {
      if (Array.isArray(page.data[column])) patch[column] = replace(page.data[column]);
    }
    page.setData(patch);
  }
  entries.forEach(entry => {
    if (requests.get(entry.key) === entry.token) requests.delete(entry.key);
  });
}

module.exports = { cardTags, managedCardTags, loadCardTags };
