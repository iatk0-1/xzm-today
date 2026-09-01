const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDistributionSetting } = require('../../utils/distribution-setting');

test('商品统一佣金不能超过最低 SKU 原价', () => {
  assert.throws(() => buildDistributionSetting({
    commissionMode: 'PRODUCT', productCommissionAmount: '101',
    skus: [{ sourcePrice: '100' }, { sourcePrice: '200' }]
  }), /最低 SKU 原价/);
});

test('逐 SKU 佣金只提交 skuId 和固定金额', () => {
  const result = buildDistributionSetting({
    distributionEnabled: true,
    commissionMode: 'SKU',
    skus: [{ skuId: 1, spec: '红色', sourcePrice: '100', fixedCommissionAmount: '12.5' }]
  });
  assert.deepEqual(result, {
    enabled: true,
    commissionMode: 'SKU',
    productCommissionAmount: null,
    skuCommissions: [{ skuId: 1, fixedCommissionAmount: '12.50' }]
  });
});
