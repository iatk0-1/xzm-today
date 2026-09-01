function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function buildDistributionSetting(product) {
  const mode = String(product.commissionMode || 'PRODUCT').toUpperCase();
  if (mode !== 'PRODUCT' && mode !== 'SKU') {
    throw new Error('佣金模式不正确');
  }
  if (mode === 'PRODUCT') {
    const amount = money(product.productCommissionAmount || 0);
    const prices = (product.skus || []).map(item => money(item.sourcePrice)).filter(Number.isFinite);
    const minimum = prices.length ? Math.min.apply(null, prices) : 0;
    if (!Number.isFinite(amount) || amount < 0 || amount > minimum) {
      throw new Error('统一佣金必须在 0 到最低 SKU 原价之间');
    }
    return {
      enabled: !!product.distributionEnabled,
      commissionMode: 'PRODUCT',
      productCommissionAmount: amount.toFixed(2),
      skuCommissions: []
    };
  }

  const skuCommissions = (product.skus || []).map(item => {
    const amount = money(item.fixedCommissionAmount);
    const sourcePrice = money(item.sourcePrice);
    if (!Number.isFinite(amount) || amount < 0 || amount > sourcePrice) {
      throw new Error('每个 SKU 佣金必须在 0 到对应原价之间');
    }
    return { skuId: item.skuId, fixedCommissionAmount: amount.toFixed(2) };
  });
  if (!skuCommissions.length) throw new Error('逐 SKU 佣金至少需要一个有效 SKU');
  return {
    enabled: !!product.distributionEnabled,
    commissionMode: 'SKU',
    productCommissionAmount: null,
    skuCommissions
  };
}

module.exports = { buildDistributionSetting };
