const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');
const config = require('../../utils/config');

const wsEndpoint = `ws://127.0.0.1:${Number(process.env.WECHAT_DEVTOOLS_PORT || 9420)}`;
const orderId = process.env.E2E_ORDER_ID;
const skuId = process.env.E2E_SKU_ID;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const withTimeout = (promise, milliseconds, label) => Promise.race([
  promise,
  delay(milliseconds).then(() => {
    throw new Error(`${label} timed out after ${milliseconds}ms`);
  })
]);

function step(message) {
  process.stdout.write(`[e2e-ship] ${message}\n`);
}

async function apiGet(accessToken, path) {
  const response = await fetch(config.API_BASE_URL + path, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, `${path} must return HTTP 200, got ${response.status}`);
  return response.json();
}

async function getOrder(accessToken) {
  return apiGet(accessToken, `/orders/${orderId}`);
}

async function getShipments(accessToken) {
  return apiGet(accessToken, `/orders/${orderId}/shipments/detail`);
}

async function waitForPageData(page, predicate, milliseconds, label) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const data = await withTimeout(page.data(), 10000, `${label} page data`);
    if (predicate(data)) return data;
    await delay(500);
  }
  throw new Error(`${label} timed out after ${milliseconds}ms`);
}

async function waitForShippedOrder(accessToken) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const order = await getOrder(accessToken);
    if (order.status === 'shipped') return order;
    await delay(1000);
  }
  throw new Error(`order ${orderId} did not reach shipped within 90 seconds`);
}

async function run() {
  assert.equal(
    process.env.E2E_ALLOW_REAL_SHIPMENT,
    'true',
    'set E2E_ALLOW_REAL_SHIPMENT=true explicitly before requesting a real waybill'
  );
  assert.ok(orderId, 'E2E_ORDER_ID is required');
  assert.ok(skuId, 'E2E_SKU_ID is required');

  let miniProgram;
  try {
    step('connecting to WeChat Developer Tools');
    miniProgram = await withTimeout(
      automator.connect({ wsEndpoint }),
      10000,
      'connect automation endpoint'
    );

    const indexPage = await withTimeout(
      miniProgram.reLaunch('/pages/index/index'),
      60000,
      'open index page after compilation'
    );
    assert.ok(indexPage, 'index page must be created');
    await withTimeout(indexPage.waitFor(3000), 15000, 'wait for index page');

    const userInfo = await withTimeout(
      miniProgram.callWxMethod('getStorageSync', config.USER_INFO_KEY),
      30000,
      'read logged-in user'
    );
    const accessToken = await withTimeout(
      miniProgram.callWxMethod('getStorageSync', config.TOKEN_KEY),
      30000,
      'read access token'
    );
    assert.ok(userInfo && userInfo.userId, 'logged-in userInfo is required');
    assert.equal(userInfo.role, 'admin', 'an administrator account is required');
    assert.ok(accessToken, 'access token is required');

    const before = await getOrder(accessToken);
    assert.ok(
      before.status === 'paid' || before.status === 'shipped',
      'only a paid order may be shipped, or a shipped order may be verified'
    );
    assert.ok(
      before.recipientName && before.recipientName.startsWith('E2E'),
      'only an order with an E2E recipient prefix may be shipped by this script'
    );
    const targetOrderItem = (before.items || []).find(
      (item) => String(item.skuId) === String(skuId)
    );
    assert.ok(targetOrderItem, `order ${orderId} must contain SKU ${skuId}`);
    assert.equal(Number(targetOrderItem.qty), 1, 'real E2E shipment is restricted to one item');
    let shipments = await getShipments(accessToken);
    let shippedOrder = before;
    let selectedAccount = null;

    if (before.status === 'paid') {
      assert.deepEqual(shipments, [], 'paid order must not have an existing shipment');
      step('opening the real electronic-waybill page');
      const shipPage = await withTimeout(
        miniProgram.reLaunch('/pages/adminOrder/adminOrder'),
        30000,
        'open batch shipment page'
      );
      const ready = await waitForPageData(
        shipPage,
        (data) => !data.loading && data.logisticsAccounts.length > 0 && data.orderGroups.length > 0,
        20000,
        'logistics accounts and pending orders'
      );

      const accountIndex = ready.logisticsAccounts.findIndex(
        (account) => Number(account.statusCode) === 0 && Number(account.quotaNum) >= 1
      );
      assert.ok(accountIndex >= 0, 'an active logistics account with waybill quota is required');
      selectedAccount = ready.logisticsAccounts[accountIndex];

      const targetGroupIndex = ready.orderGroups.findIndex(
        (group) => String(group.orderId) === String(orderId)
      );
      assert.ok(targetGroupIndex >= 0, `pending shipment group for order ${orderId} must exist`);
      const targetGroup = ready.orderGroups[targetGroupIndex];
      assert.ok(targetGroup.recipientName.startsWith('E2E'), 'target shipment group must be an E2E order');
      assert.equal(targetGroup.items.length, 1, 'real E2E shipment is restricted to one order item');
      assert.equal(String(targetGroup.items[0].skuId), String(skuId));
      assert.equal(Number(targetGroup.items[0].shipQty), 1);
      assert.equal(targetGroup.items[0].canShip, true);

      if (accountIndex !== ready.logisticsIndex) {
        const logisticsPicker = await shipPage.$('.logistics-picker');
        assert.ok(logisticsPicker, 'logistics account picker must exist');
        await withTimeout(
          logisticsPicker.trigger('change', { value: String(accountIndex) }),
          10000,
          'choose logistics account'
        );
      }

      const groupCheckboxes = await shipPage.$$('.order-checkbox');
      assert.ok(groupCheckboxes[targetGroupIndex], 'target order checkbox must exist');
      await withTimeout(groupCheckboxes[targetGroupIndex].tap(), 10000, 'select target order');
      const selected = await waitForPageData(
        shipPage,
        (data) => data.selectedItems.length === 1,
        5000,
        'select target shipment item'
      );
      assert.equal(String(selected.selectedItems[0].orderId), String(orderId));
      assert.equal(String(selected.selectedItems[0].skuId), String(skuId));
      assert.equal(Number(selected.selectedItems[0].shipQty), 1);

      step(`previewing one ${selectedAccount.deliveryName} electronic waybill`);
      const batchShipButton = await shipPage.$('.batch-ship-btn');
      assert.ok(batchShipButton, 'batch shipment button must exist');
      await withTimeout(batchShipButton.tap(), 10000, 'open shipment preview');
      const preview = await waitForPageData(
        shipPage,
        (data) => data.showPreviewModal && data.canShip && data.previewGroups.length === 1,
        5000,
        'shipment preview'
      );
      assert.equal(preview.previewGroups[0].items.length, 1);
      assert.equal(String(preview.previewGroups[0].items[0].orderId), String(orderId));
      assert.equal(Number(preview.previewGroups[0].totalItems), 1);

      step('confirming the real electronic waybill request');
      const confirmButtons = await shipPage.$$('.modal-confirm');
      assert.ok(confirmButtons.length > 0, 'confirm shipment button must exist');
      await withTimeout(
        confirmButtons[confirmButtons.length - 1].tap(),
        10000,
        'confirm real shipment'
      );

      shippedOrder = await waitForShippedOrder(accessToken);
      shipments = await getShipments(accessToken);
    } else {
      step('real shipment already exists; skipping creation and verifying it idempotently');
    }

    assert.equal(shipments.length, 1, 'exactly one shipment must be created');
    const shipment = shipments[0];
    assert.ok(shipment.expressNo, 'real waybill number must be returned');
    if (selectedAccount) {
      assert.equal(shipment.expressCode, selectedAccount.deliveryId);
    }
    assert.equal((shipment.items || []).length, 1);
    assert.equal(Number(shipment.items[0].shipQty), 1);

    step('verifying user shipment and logistics components');
    const userOrderPage = await withTimeout(
      miniProgram.reLaunch(`/pages/orderDetail/orderDetail?id=${orderId}`),
      30000,
      'open user order detail'
    );
    const userView = await waitForPageData(
      userOrderPage,
      (data) => !data.isLoading && data.order && data.order.status === 'shipped'
        && data.shipments && data.shipments.length === 1,
      20000,
      'user shipped order and logistics card'
    );
    assert.equal(userView.order.statusDisplay, '已发货');
    assert.equal(userView.shipments[0].expressNo, shipment.expressNo);

    const adminOrderPage = await withTimeout(
      miniProgram.reLaunch(`/pages/adminOrderDetail/adminOrderDetail?id=${orderId}`),
      30000,
      'open admin order detail'
    );
    const adminView = await waitForPageData(
      adminOrderPage,
      (data) => !data.isLoading && data.order && data.order.status === 'shipped'
        && data.shipments && data.shipments.length === 1,
      20000,
      'admin shipped order and waybill card'
    );
    assert.equal(adminView.order.statusDisplay, '已发货');
    assert.equal(adminView.shipments[0].expressNo, shipment.expressNo);

    const traces = await apiGet(accessToken, `/orders/${orderId}/shipments/trace`);
    assert.ok(Array.isArray(traces), 'shipment trace endpoint must return a list');

    process.stdout.write(JSON.stringify({
      ok: true,
      orderId: String(orderId),
      skuId: String(skuId),
      status: shippedOrder.status,
      shipmentId: String(shipment.id),
      expressCode: shipment.expressCode,
      expressNo: shipment.expressNo,
      userStatusDisplay: userView.order.statusDisplay,
      adminStatusDisplay: adminView.order.statusDisplay,
      traceCount: traces.length
    }) + '\n');
  } finally {
    if (miniProgram) miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
