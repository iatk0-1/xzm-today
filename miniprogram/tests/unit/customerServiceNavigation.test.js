const test = require('node:test');
const assert = require('node:assert/strict');
const { openFromContact } = require('../../utils/customerServiceNavigation');

test('客服卡片返回小程序时打开商品或订单详情', () => {
  const urls = [];
  global.wx = { navigateTo: ({ url }) => urls.push(url) };

  assert.equal(openFromContact({ detail: { path: 'pages/detail/detail', query: { id: '12' } } }), true);
  assert.equal(openFromContact({ detail: { path: '/pages/orderDetail/orderDetail?id=34&fromCustomerService=1' } }), true);
  assert.equal(openFromContact({ path: '/pages/detail/detail?id=56' }), true);

  assert.deepEqual(urls, [
    '/pages/detail/detail?id=12',
    '/pages/orderDetail/orderDetail?id=34&fromCustomerService=1',
    '/pages/detail/detail?id=56'
  ]);
});

test('客服回调不跳转未知页面或无效商品 ID', () => {
  const urls = [];
  global.wx = { navigateTo: ({ url }) => urls.push(url) };

  assert.equal(openFromContact({ detail: { path: '/pages/chat/chat?id=12' } }), false);
  assert.equal(openFromContact({ detail: { path: '/pages/detail/detail?id=abc' } }), false);
  assert.deepEqual(urls, []);
});
