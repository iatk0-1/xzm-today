const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderData } = require('../../utils/order-checkout');

const address = {
  recipient: '测试用户',
  phone: '13800138000',
  province: '浙江省',
  city: '杭州市',
  district: '上城区',
  detail: '测试地址'
};

test('订单请求不提交客户端价格和商品快照', function() {
  const data = buildOrderData([{
    productId: '10001',
    skuId: '11001',
    count: 2,
    finalPrice: 0.01,
    name: '伪造商品',
    selectedColor: '伪造规格',
    bundleConfig: [{ skuId: '11001', count: 1, price: 0.01, color: '伪造' }]
  }], address);

  assert.deepEqual(data.items, [{
    productId: '10001',
    skuId: '11001',
    qty: 2,
    pool: 'main',
    bundleConfig: [{ skuId: '11001', count: 1 }]
  }]);
  assert.equal('salePrice' in data.items[0], false);
  assert.equal('productName' in data.items[0], false);
});

test('分销订单携带数据库商品对应的店铺码', function() {
  const data = buildOrderData([{
    productId: '10021', skuId: '11020', count: 1,
    merchantId: '1', distributionSellerId: '9', shopCode: 'shop-safe'
  }], address);
  assert.equal(data.shopCode, 'shop-safe');
});

test('跨卖家商品不能混入同一订单', function() {
  assert.throws(function() {
    buildOrderData([
      { productId: '1', skuId: '11', count: 1, merchantId: '8', distributionSellerId: '9', shopCode: 'a' },
      { productId: '2', skuId: '12', count: 1, merchantId: '8', distributionSellerId: '10', shopCode: 'b' }
    ], address);
  }, /请分开结算/);
});
