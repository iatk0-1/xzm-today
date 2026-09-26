const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sync = require('../../utils/pageSync');

const requests = [];
let responses = {};
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === './api' && args[0].filename.endsWith('pageSync.js')) return {
    get: async url => {
      requests.push(url);
      const result = responses[url];
      if (result instanceof Error) throw result;
      return result;
    }
  };
  return originalLoad.call(this, request, ...args);
};

function makePage() {
  const page = sync.wrap({}, function(changes) {
    return sync.updateList(this, changes, {
      entity: 'products', field: 'products', url: id => '/products/' + id,
      matches: product => product.status !== 'off'
    });
  });
  page.data = { products: [{ id: 1, name: '一', selected: true }, { id: 2, name: '二' }], page: 4, hasMore: true, scrollTop: 800 };
  page.setData = patch => Object.assign(page.data, patch);
  page.onLoad();
  return page;
}

test('无变动返回零请求；多次修改合并到单项，页码、勾选和顺序保留', async () => {
  requests.length = 0;
  responses = { '/products/1': { product: { id: 1, name: '改名', status: 'on' } } };
  const page = makePage();
  await page.onShow();
  assert.deepEqual(requests, []);
  sync.recordMutation('/products/1', 'PUT', {}, {});
  sync.recordMutation('/products/1/status', 'PATCH', {}, {});
  await page.onShow();
  assert.deepEqual(requests, ['/products/1']);
  assert.deepEqual(page.data.products.map(item => item.name), ['改名', '二']);
  assert.equal(page.data.products[0].selected, true);
  assert.equal(page.data.page, 4);
  assert.equal(page.data.scrollTop, 800);
  await page.onShow();
  assert.equal(requests.length, 1);
  page.onUnload();
});

test('下架不匹配筛选时移除，删除直接移除，未加载记录不会补查', async () => {
  requests.length = 0;
  responses = { '/products/1': { product: { id: 1, status: 'off' } } };
  const page = makePage();
  sync.publish('products', 1);
  sync.publish('products', 2, true);
  sync.publish('products', 999);
  await page.onShow();
  assert.deepEqual(page.data.products, []);
  assert.deepEqual(requests, ['/products/1']);
  assert.equal(page.data.page, 4);
  page.onUnload();
});

test('同步失败保留原数据，下一次返回可重试', async () => {
  const page = makePage();
  responses = { '/products/1': new Error('模拟网络失败') };
  sync.publish('products', 1);
  await page.onShow();
  assert.equal(page.data.products[0].name, '一');
  responses['/products/1'] = { id: 1, name: '恢复后的数据' };
  await page.onShow();
  assert.equal(page.data.products[0].name, '恢复后的数据');
  page.onUnload();
});

test('发货、解绑和售后变更只通知涉及的订单，查询不产生变更', async () => {
  const batches = [];
  const page = sync.wrap({}, changes => batches.push(changes));
  page.onLoad();
  sync.recordMutation('/shipments', 'POST', { orderIds: ['100', '101'] }, {});
  sync.recordMutation('/shipments/1/orders/100', 'DELETE', {}, {});
  sync.recordMutation('/after-sales/9/review', 'POST', {}, { orderId: '102' });
  sync.recordMutation('/admin/orders-manage/change-requests/3/approve', 'POST', {}, { orderId: '103' });
  sync.recordMutation('/orders/999', 'GET', {}, {});
  await page.onShow();
  assert.deepEqual(batches[0].filter(item => item.entity === 'orders').map(item => item.id), ['100', '101', '102', '103']);
  assert.deepEqual(batches[0].filter(item => item.entity === 'after-sales').map(item => item.id), ['9']);
  page.onUnload();
});
