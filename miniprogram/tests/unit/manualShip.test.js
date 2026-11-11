const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('手工发货提交时保留长订单号的每一位', async () => {
  const orderId = '378493373117370368';
  let definition;
  let request;
  const api = { async post(url, body) {
    request = { url, body: JSON.parse(JSON.stringify(body)) };
    return { id: '28', expressNo: body.expressNo };
  } };
  const filename = path.join(__dirname, '../../pages/manualShip/manualShip.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; },
    require: name => name.endsWith('/api') ? api : {},
    wx: { showLoading() {}, hideLoading() {}, showModal() {} }
  }, { filename });
  const page = { ...definition, data: { ...definition.data, orderId, expressCode: 'ZTO', expressNo: '760000000000',
    items: [{ id: '196', canShip: true, selected: true, shipQty: 1 }] } };
  page.setData = patch => Object.assign(page.data, patch);

  await page.submitShipment();

  assert.equal(request.url, '/shipments');
  assert.deepEqual(request.body.orderIds, [orderId]);
});
