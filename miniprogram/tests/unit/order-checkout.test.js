const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOrderData,
  buildSplitOrderData,
  groupCheckoutItems
} = require('../../utils/order-checkout');

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

test('购物车按商户和卖家来源分组并保留原始索引', function() {
  const groups = groupCheckoutItems([
    { productId: '1', count: 1, price: 10, merchantId: '8' },
    { productId: '2', count: 2, price: 12, merchantId: '8', distributionSellerId: '9', shopCode: 'a' },
    { productId: '3', count: 1, price: 15, merchantId: '8', distributionSellerId: '9', shopCode: 'a' },
    { productId: '4', count: 1, price: 20, merchantId: '8', distributionSellerId: '10', shopCode: 'b' }
  ]);

  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(group => group.itemCount), [1, 3, 1]);
  assert.deepEqual(groups.map(group => group.totalPrice), ['10.00', '39.00', '20.00']);
  assert.deepEqual(groups[1].items.map(item => item.sourceIndex), [1, 2]);
});

test('跨来源购物车自动拆成独立的服务端定价请求', function() {
  const orders = buildSplitOrderData([
    { productId: '1', skuId: '11', count: 1, merchantId: '8', finalPrice: 0.01 },
    { productId: '2', skuId: '12', count: 2, merchantId: '8', distributionSellerId: '9', shopCode: 'a', finalPrice: 0.01 }
  ], address);

  assert.equal(orders.length, 2);
  assert.deepEqual(orders[0].orderData.items, [
    { productId: '1', skuId: '11', qty: 1, pool: 'main' }
  ]);
  assert.equal(orders[0].orderData.shopCode, undefined);
  assert.deepEqual(orders[1].orderData.items, [
    { productId: '2', skuId: '12', qty: 2, pool: 'main' }
  ]);
  assert.equal(orders[1].orderData.shopCode, 'a');
});
