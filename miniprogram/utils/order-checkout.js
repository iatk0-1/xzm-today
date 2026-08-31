function buildOrderData(checkoutItems, address) {
  if (!Array.isArray(checkoutItems) || checkoutItems.length === 0) {
    throw new Error('购物车为空');
  }

  const knownContexts = checkoutItems
    .filter(function(item) {
      return item.merchantId != null || item.distributionSellerId != null || item.shopCode;
    })
    .map(function(item) {
      return String(item.merchantId || '') + ':' + String(item.distributionSellerId || 'DIRECT');
    });
  if (new Set(knownContexts).size > 1) {
    throw new Error('同一订单只能结算同一商户、同一卖家来源的商品，请分开结算');
  }

  const sellerItems = checkoutItems.filter(function(item) {
    return item.distributionSellerId != null;
  });
  const shopCodes = Array.from(new Set(sellerItems.map(function(item) {
    return item.shopCode || '';
  })));
  if (sellerItems.length > 0 && (shopCodes.length !== 1 || !shopCodes[0])) {
    throw new Error('卖家店铺上下文已失效，请重新进入店铺结算');
  }

  const data = {
    items: checkoutItems.map(function(item) {
      const orderItem = {
        productId: item.productId,
        skuId: item.skuId,
        qty: item.count,
        pool: 'main'
      };
      if (Array.isArray(item.bundleConfig) && item.bundleConfig.length > 0) {
        orderItem.bundleConfig = item.bundleConfig.map(function(sub) {
          return { skuId: sub.skuId, count: sub.count || 1 };
        });
      }
      if (item.remark && item.remark.trim()) {
        orderItem.remark = item.remark.trim();
      }
      return orderItem;
    }),
    recipientName: address.recipient,
    recipientPhone: address.phone,
    recipientProvince: address.province,
    recipientCity: address.city,
    recipientDistrict: address.district,
    recipientDetail: address.detail
  };
  if (sellerItems.length > 0) {
    data.shopCode = shopCodes[0];
  }
  return data;
}

module.exports = { buildOrderData };
