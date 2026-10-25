const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(get) {
  const filename = path.resolve(__dirname, '../../pages/shipmentTraceDetail/shipmentTraceDetail.js');
  let definition;
  const copied = [], navigations = [];
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; },
    require(name) {
      if (name.endsWith('/api')) return { get };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/clipboard')) return { copyText: value => copied.push(value) };
      return require(path.resolve(path.dirname(filename), name));
    },
    wx: { showToast() {}, navigateTo: value => navigations.push(value.url) }
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); }
  };
  return { page, copied, navigations };
}

const shipments = [
  { id: '9007199254740993', shippedAt: '2026-10-20 09:00:00', expressCode: 'ZTO',
    items: [{ productName: '旧包裹商品', skuImageUrl: '/old-sku.jpg' }] },
  { id: '9007199254740994', shippedAt: '2026-10-22T09:00:00', expressCode: 'SF',
    items: [{ productName: '中间包裹商品', productImage: '/cover.jpg' }] },
  { id: '9007199254740995', shippedAt: '2026-10-24T09:00:00', expressCode: 'YTO',
    items: [{ productName: '新包裹商品', skuImageUrl: '/new-sku.jpg', productImage: '/new-cover.jpg', spec: '红色', size: 'M' },
      { skuImageUrl: '/second-item.jpg' }] }
];

function trace(id) {
  return { shipmentId: id, expressNo: `单号${id}`, expressCode: 'SF',
    nodes: [{ description: '派送员电话13800138000', time: '2026-10-25T10:00:00' }] };
}

test('从旧包裹入口进入也默认展示最新包裹，按倒序编号并优先显示首件SKU图片', async () => {
  const calls = [];
  const { page } = harness(async url => {
    calls.push(url);
    return url.endsWith('/detail') ? shipments : trace(shipments[2].id);
  });
  await page.onLoad({ orderId: '订单1', shipmentId: shipments[0].id });
  assert.deepEqual(Array.from(page.data.shipments, item => item.packageNumber), [3, 2, 1]);
  assert.deepEqual(Array.from(page.data.shipments, item => item.id), shipments.slice().reverse().map(item => item.id));
  assert.equal(page.data.shipmentId, shipments[2].id);
  assert.equal(page.data.selectedShipment.imageUrl, '/new-sku.jpg');
  assert.equal(page.data.selectedShipment.specDisplay, '红色 / M');
  assert.equal(page.data.shipments[1].imageUrl, '/cover.jpg');
  assert.equal(page.data.trace.expressName, '顺丰速运');
  assert.equal(page.data.trace.nodes[0].descriptionSegments[1].value, '13800138000');
  assert.equal(calls.length, 2);
  assert.equal(calls[1], `/shipments/${shipments[2].id}/trace`);
});

test('相同发货时间使用完整长ID排序，缺少图片的包裹使用默认图', async () => {
  const { page } = harness(async url => url.endsWith('/detail')
    ? [{ id: '9007199254740992', shippedAt: '2026-10-24T09:00:00', items: [] },
      { id: '9007199254740993', shippedAt: '2026-10-24T09:00:00', items: [] }]
    : trace('9007199254740993'));
  await page.onLoad({ orderId: '订单1' });
  assert.equal(page.data.shipmentId, '9007199254740993');
  assert.equal(page.data.selectedShipment.imageUrl, '/images/default-goods-image.png');
});

test('快速切换时旧请求成功或失败都不能覆盖当前包裹，复制使用当前单号', async () => {
  const pending = [];
  const { page, copied } = harness(url => {
    if (url.endsWith('/detail')) return Promise.resolve(shipments);
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  });
  const initial = page.onLoad({ orderId: '订单1' });
  await new Promise(resolve => setImmediate(resolve));
  const middle = page.switchShipment({ currentTarget: { dataset: { index: 1 } } });
  await new Promise(resolve => setImmediate(resolve));
  const latest = page.switchShipment({ currentTarget: { dataset: { index: 2 } } });
  await new Promise(resolve => setImmediate(resolve));
  pending[2].resolve(trace(shipments[0].id));
  await latest;
  pending[0].resolve(trace(shipments[2].id));
  pending[1].reject(new Error('旧请求失败'));
  await Promise.all([initial, middle]);
  assert.equal(page.data.trace.shipmentId, shipments[0].id);
  assert.equal(page.data.loadError, '');
  assert.equal(page.data.traceLoading, false);
  page.copyExpressNo();
  assert.equal(copied[0], `单号${shipments[0].id}`);
});

test('左右滑动切换相邻包裹，纵向滚动、取消触摸和边界滑动不误切换', async () => {
  const { page } = harness(async url => url.endsWith('/detail') ? shipments : trace(url.split('/')[2]));
  await page.onLoad({ orderId: '订单1' });
  async function swipe(x, y, cancelled = false) {
    page.handleTouchStart({ touches: [{ clientX: 200, clientY: 200 }] });
    if (cancelled) page.handleTouchCancel();
    await page.handleTouchEnd({ changedTouches: [{ clientX: x, clientY: y }] });
  }
  await swipe(300, 200);
  assert.equal(page.data.activeIndex, 0);
  await swipe(100, 205);
  assert.equal(page.data.activeIndex, 1);
  assert.equal(page.data.activePackageId, 'package-1');
  await swipe(100, 400);
  assert.equal(page.data.activeIndex, 1);
  await swipe(100, 200, true);
  assert.equal(page.data.activeIndex, 1);
  await swipe(300, 200);
  assert.equal(page.data.activeIndex, 0);
});

test('切换请求失败会清空旧物流，重试仍加载当前包裹，图片失败回退默认图', async () => {
  let fail = false;
  const { page } = harness(async url => {
    if (url.endsWith('/detail')) return shipments;
    if (fail) throw new Error('网络连接异常');
    return trace(url.split('/')[2]);
  });
  await page.onLoad({ orderId: '订单1' });
  fail = true;
  await page.selectShipment(1);
  assert.equal(page.data.trace, null);
  assert.equal(page.data.loadError, '网络连接异常');
  assert.equal(page.data.selectedShipment.id, shipments[1].id);
  fail = false;
  await page.retryLoad();
  assert.equal(page.data.trace.shipmentId, shipments[1].id);
  page.handlePackageImageError({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.selectedShipment.imageUrl, '/images/default-goods-image.png');
});

test('包裹列表失败可重试，单包裹历史入口仍可查询物流', async () => {
  let fail = true;
  const { page } = harness(async url => {
    if (fail) throw new Error('加载包裹失败');
    return url.endsWith('/detail') ? shipments.slice(0, 1) : trace(shipments[0].id);
  });
  await page.onLoad({ orderId: '订单1' });
  assert.equal(page.data.isLoading, false);
  assert.equal(page.data.loadError, '加载包裹失败');
  fail = false;
  await page.retryLoad();
  assert.equal(page.data.shipments.length, 1);
  assert.equal(page.data.shipments[0].packageNumber, 1);
  const legacy = harness(async () => trace(shipments[0].id));
  await legacy.page.onLoad({ shipmentId: shipments[0].id });
  assert.equal(legacy.page.data.trace.shipmentId, shipments[0].id);
});
