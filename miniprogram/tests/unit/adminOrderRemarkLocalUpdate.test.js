const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const requests = [];
const api = {
  patch: async (url, body) => { requests.push({ method: 'PATCH', url, body }); },
  get: async url => {
    requests.push({ method: 'GET', url });
    return { id: '10', status: 'stocking', items: [{ id: '101', adminRemark: '已核对' }] };
  }
};
let config;
let modal;
global.Page = page => { config = page; };
global.wx = {
  showModal(options) { modal = options; }, showToast() {}, showLoading() {}, hideLoading() {}
};
const originalLoad = Module._load;
function stubLoad(request, ...args) {
  if (request.endsWith('utils/api') || (request === './api' && args[0].filename.endsWith('pageSync.js'))) return api;
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
  if (request.endsWith('utils/clipboard')) return {};
  return originalLoad.call(this, request, ...args);
}
Module._load = stubLoad;
require('../../pages/adminOrder/adminOrder.js');
const pendingPageConfig = config;
require('../../pages/adminOrderManage/adminOrderManage.js');
const managePageConfig = config;
Module._load = originalLoad;

function pageFrom(pageConfig) {
  const page = { ...pageConfig, data: JSON.parse(JSON.stringify(pageConfig.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

test('待发货管理保存备注仅更新当前订单商品，保留分页、选中和待发货清单', async () => {
  requests.length = 0;
  const page = pageFrom(pendingPageConfig);
  const target = { orderId: '10', orderItemId: '101', skuId: '5', adminRemark: '旧备注', selected: true };
  const other = { orderId: '20', orderItemId: '201', skuId: '6', adminRemark: '其他订单', selected: true };
  page.rawPendingItems = [target, other];
  page.data.page = 3;
  page.data.orderGroups = [{ orderId: '10', items: [target], selected: true }, { orderId: '20', items: [other] }];
  page.data.selectedItems = [target, other];
  page.data.pendingShipItems = [target, other];
  page.data.pendingOrderGroups = [{ orderId: '10', items: [target] }];
  page.editAdminRemark({ currentTarget: { dataset: { item: target } } });
  await modal.success({ confirm: true, content: '已核对' });
  assert.deepEqual(requests, [{ method: 'PATCH', url: '/admin/orders-manage/orders/10/items/101/admin-remark', body: { remark: '已核对' } }]);
  assert.equal(page.data.page, 3);
  assert.equal(page.data.orderGroups[0].selected, true);
  assert.equal(page.data.orderGroups[0].items[0].adminRemark, '已核对');
  assert.equal(page.data.orderGroups[1].items[0].adminRemark, '其他订单');
  assert.equal(page.rawPendingItems[0].adminRemark, '已核对');
  assert.equal(page.data.selectedItems[0].adminRemark, '已核对');
  assert.equal(page.data.pendingShipItems[0].adminRemark, '已核对');
  assert.equal(page.data.pendingOrderGroups[0].items[0].adminRemark, '已核对');
});

test('订单管理保存备注只查询并更新对应订单，不重查第一页', async () => {
  requests.length = 0;
  const page = pageFrom(managePageConfig);
  page.data.page = 4;
  page.data.orders = [
    { id: '10', status: 'stocking', items: [{ id: '101', adminRemark: '旧备注' }] },
    { id: '20', status: 'stocking', items: [{ id: '201', adminRemark: '其他订单' }] }
  ];
  page.data.adminRemarkPanel = { orderId: '10', itemId: '101' };
  page.data.adminRemarkValue = '已核对';
  Module._load = stubLoad;
  try {
    await page.saveAdminRemark();
  } finally {
    Module._load = originalLoad;
  }
  assert.deepEqual(requests.map(item => item.url), [
    '/admin/orders-manage/orders/10/items/101/admin-remark',
    '/admin/orders-manage/orders/10'
  ]);
  assert.equal(page.data.page, 4);
  assert.equal(page.data.orders[0].items[0].adminRemark, '已核对');
  assert.equal(page.data.orders[1].items[0].adminRemark, '其他订单');
});
