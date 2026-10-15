const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(name) {
  let definition;
  const writes = [];
  const context = {
    console, setTimeout, clearTimeout,
    Page: value => { definition = value; },
    wx: { showToast() {}, showLoading() {}, hideLoading() {}, showModal: o => o.success({ confirm: true }), getStorageSync: () => null },
    require: name => {
      if (name.endsWith('/api')) return { get: async () => ({}), post: async () => ({}) };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/error')) return { getErrorMessage: (e, fallback) => e.message || fallback };
      if (name.endsWith('/quantityOperation')) return { run: async (api, route, payload) => { writes.push({ route, payload }); }, pending: () => null };
      if (name.endsWith('/autoSearch') || name.endsWith('/pageSync')) return { wrap: value => value, publish() {} };
      if (name.endsWith('/expressCompany')) return { getExpressName: () => '' };
      return {};
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages', name, name + '.js'), 'utf8'), context);
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  page.refreshSkuRecommendations = async () => {};
  page.loadOrderDetail = async () => {};
  return { page, writes };
}

test('正常待报使用需求采购，保留推荐数量；调大数量才标记备货', async () => {
  const { page, writes } = loadPage('pickingList');
  page.data.filteredList = [{ skuId: '9007199254740993', selected: true, recommendQty: 3, spec: '红', size: 'M' }];
  await page.createPurchaseOrder();
  assert.equal(page.data.orderPreviewList[0].recommendQty, 3);
  await page.confirmOrder();
  assert.equal(writes[0].payload.purpose, 'demand');
  assert.equal(writes[0].payload.items[0].skuId, '9007199254740993');
  page.data.orderPreviewList[0].qty = 5;
  await page.confirmOrder();
  assert.equal(writes[1].payload.purpose, 'stock');
  assert.equal(writes[1].payload.items[0].qty, 5);
});

test('没有待报缺口仍可显式追加备货采购', async () => {
  const { page, writes } = loadPage('pickingList');
  page.data.recommendList = [{ skuId: '66', recommendQty: 0, stockQty: 5 }];
  page.openStockPurchase({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.showOrderModal, true);
  await page.confirmOrder();
  assert.equal(writes[0].payload.purpose, 'stock');
  assert.equal(writes[0].payload.items[0].qty, 1);
});

test('部分解绑确认实际回仓后经过数量操作模块，长订单商品编号保持字符串', async () => {
  const { page, writes } = loadPage('adminOrderDetail');
  page.data.partialUnbindShipment = { id: '99' };
  page.data.partialUnbindItems = [{ orderItemId: '9007199254740993', shipQty: 3, unbindQty: '1' }];
  await page.submitPartialUnbind();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].route, '/admin/orders-manage/orders/shipments/99/partial-unbind');
  assert.equal(writes[0].payload.stockReturned, true);
  assert.equal(writes[0].payload.items[0].orderItemId, '9007199254740993');
  assert.equal(writes[0].payload.items[0].qty, 1);
});

test('部分解绑不允许小数、负数及混有文字的数量写入后端', async () => {
  for (const qty of ['1.5', '-1', '1件']) {
    const { page, writes } = loadPage('adminOrderDetail');
    page.data.partialUnbindShipment = { id: '99' };
    page.data.partialUnbindItems = [{ orderItemId: '10', shipQty: 3, unbindQty: qty }];
    await page.submitPartialUnbind();
    assert.equal(writes.length, 0);
  }
});
