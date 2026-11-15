const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const history = require('../../utils/orderSpecChangeHistory');

const record = { id: '9007199254740999', productName: '袜子', sourceSpec: '01', sourceSize: '均码',
  targetSpec: '02', targetSize: '均码', qty: 1, createdAt: '2026-11-16T10:00:00+08:00' };
function setup(admin, adjusted = false) {
  const route = admin ? 'adminOrderDetail' : 'orderDetail';
  const filename = path.resolve(__dirname, '../../pages', route, route + '.js');
  let definition;
  const reads = [];
  const order = { id: '123', status: 'paid', priceRevision: 3, promotionDiscount: 0,
    payAmount: '19.39', goodsAmount: '19.39', shippingFee: '0', offlinePaidAmount: '0', items: [
      { id: '456', skuId: '789', qty: 1, productName: '袜子', salePrice: '19.39', productSpec: '02' }
    ] };
  const api = { get: async url => {
    reads.push(url);
    if (url.endsWith('/spec-changes')) return [record];
    if (url.endsWith('/pricing')) return { hasPriceAdjustment: adjusted,
      items: [{ orderItemId: '456', qty: 1, settlementAmount: '19.39' }], offlineAmount: '0',
      history: adjusted ? [{ revision: 3, createdAt: record.createdAt }] : [] };
    return structuredClone(order);
  } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page(value) { definition = value; }, console, setTimeout, clearTimeout, setInterval, clearInterval,
    wx: { showLoading() {}, hideLoading() {}, showToast() {}, showModal() {} },
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/pageSync')) return { wrap: value => value };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => false };
      return require(path.resolve(path.dirname(filename), name));
    }
  });
  const page = { ...definition, data: { ...structuredClone(definition.data), orderId: '123' },
    setData(value) { Object.assign(this.data, value); } };
  for (const method of ['loadAfterSaleRecords', 'loadChangeRequests', 'loadShipmentInfo', 'refreshBlacklist', 'syncPendingShipmentUnbind']) {
    page[method] = () => {};
  }
  return { page, reads };
}

for (const admin of [false, true]) {
  test(`${admin ? '管理端' : '用户端'}只改规格展示独立修改记录，版本递增不标记为改价`, async () => {
    const { page, reads } = setup(admin);
    await page.loadOrderDetail('123'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.data.pricing.hasPriceAdjustment, false);
    assert.equal(page.data.order.items[0].displayUnitPrice, '19.39');
    assert.equal(page.data.specChanges.length, 1);
    assert.equal(page.data.specChanges[0].sourceLabel, '01 / 均码');
    assert.equal(page.data.specChanges[0].targetLabel, '02 / 均码');
    assert.equal(page.data.specChanges[0].qty, 1);
    assert.ok(reads.includes(`${admin ? '/admin/orders-manage/orders' : '/orders'}/123/spec-changes`));
  });
  test(`${admin ? '管理端' : '用户端'}实际改价与规格修改记录独立保留`, async () => {
    const { page } = setup(admin, true);
    await page.loadOrderDetail('123'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.data.pricing.hasPriceAdjustment, true);
    assert.equal(page.data.specChanges.length, 1);
    if (admin) assert.equal(page.data.pricing.history[0].adjustmentNumber, 1);
  });
}
test('规格记录查询失败可以重试，不覆盖金额或将订单标记为改价', async () => {
  const page = { data: { pricing: { hasPriceAdjustment: false } },
    setData(value) { Object.assign(this.data, value); }, formatTime: value => value };
  await history.load(page, { get: async () => { throw new Error('查询失败'); } }, '123');
  assert.match(page.data.specChangesError, /查询失败/);
  assert.equal(page.data.pricing.hasPriceAdjustment, false);
  await history.load(page, { get: async () => [record] }, '123');
  assert.equal(page.data.specChangesError, ''); assert.equal(page.data.specChanges.length, 1);
});
