function getContextKey(item) {
  const merchantId = item.merchantId == null ? 'UNKNOWN' : String(item.merchantId);
  const sellerId = item.distributionSellerId == null
    ? 'DIRECT'
    : String(item.distributionSellerId);
  const shopCode = sellerId === 'DIRECT' ? 'DIRECT' : String(item.shopCode || 'INVALID');
  return [merchantId, sellerId, shopCode].join(':');
}

function groupCheckoutItems(checkoutItems) {
  if (!Array.isArray(checkoutItems) || checkoutItems.length === 0) {
    return [];
  }

  const groupMap = new Map();
  checkoutItems.forEach(function(item, sourceIndex) {
    const key = getContextKey(item);
    let group = groupMap.get(key);
    if (!group) {
      const isDistribution = item.distributionSellerId != null;
      group = {
        key: key,
        merchantId: item.merchantId,
        distributionSellerId: item.distributionSellerId,
        shopCode: isDistribution ? (item.shopCode || '') : '',
        isDistribution: isDistribution,
        title: isDistribution ? '分销店铺订单' : '商户自营订单',
        items: [],
        itemCount: 0,
        totalPrice: '0.00'
      };
      groupMap.set(key, group);
    }

    const groupedItem = Object.assign({}, item, { sourceIndex: sourceIndex });
    group.items.push(groupedItem);
    group.itemCount += Number(item.count || 0);
    const linePrice = Number(item.finalPrice || item.price || 0) * Number(item.count || 0);
    group.totalPrice = (Number(group.totalPrice) + linePrice).toFixed(2);
  });

  return Array.from(groupMap.values());
}

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

function buildSplitOrderData(checkoutItems, address) {
  return groupCheckoutItems(checkoutItems).map(function(group) {
    return Object.assign({}, group, {
      orderData: buildOrderData(group.items, address)
    });
  });
}

module.exports = { buildOrderData, buildSplitOrderData, groupCheckoutItems };
