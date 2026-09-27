function orderCard(order) {
  const items = order && Array.isArray(order.items) ? order.items : [];
  const first = items[0] || {};
  const orderNo = order && (order.outTradeNo || order.id);
  const productName = first.productName || '商品';
  const more = items.length > 1 ? `等${items.length}项商品` : '';

  return {
    title: `${productName}${more}｜订单${orderNo}`,
    image: first.skuImageUrl || first.productImage || ''
  };
}

module.exports = { orderCard };
