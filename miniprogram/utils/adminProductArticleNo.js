// 物流、改价等局部数据沿用已加载订单的当前货号，不额外逐件请求商品。
function resolveArticleNo(item, orderItems = []) {
  if (item.articleNo != null) return String(item.articleNo);
  const same = (a, b) => a != null && b != null && String(a) === String(b);
  const source = orderItems.find(row => same(row.id, item.orderItemId))
    || orderItems.find(row => same(row.skuId, item.skuId))
    || orderItems.find(row => same(row.productId, item.productId));
  return source && source.articleNo != null ? String(source.articleNo) : '';
}

function attachArticleNos(items, orderItems) {
  return (items || []).map(item => ({ ...item, articleNo: resolveArticleNo(item, orderItems) }));
}

module.exports = { resolveArticleNo, attachArticleNos };
