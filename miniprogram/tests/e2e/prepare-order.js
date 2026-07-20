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
  process.stdout.write(`[e2e-prepare] ${message}\n`);
}

async function getOrder(accessToken) {
  const response = await fetch(`${config.API_BASE_URL}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000)
  });
  assert.equal(response.status, 200, `order detail must return HTTP 200, got ${response.status}`);
  return response.json();
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

async function waitForOrderStatus(accessToken, expectedStatus) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const order = await getOrder(accessToken);
    if (order.status === expectedStatus) return order;
    await delay(1000);
  }
  throw new Error(`order ${orderId} did not reach ${expectedStatus} within 30 seconds`);
}

async function run() {
  assert.equal(
    process.env.E2E_ALLOW_MUTATION,
    'true',
    'set E2E_ALLOW_MUTATION=true explicitly before creating a purchase order'
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

    step('waiting for the freshly opened project to compile');
    const indexPage = await withTimeout(
      miniProgram.reLaunch('/pages/index/index'),
      60000,
      'open index page after compilation'
    );
    assert.ok(indexPage, 'index page must be created');
    await withTimeout(indexPage.waitFor(5000), 15000, 'wait for index page');

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
    assert.equal(before.status, 'stocking', 'only a stocking order may enter this preparation flow');
    assert.ok(
      before.recipientName && before.recipientName.startsWith('E2E'),
      'only an order with an E2E recipient prefix may be prepared by this script'
    );
    const targetItem = (before.items || []).find((item) => String(item.skuId) === String(skuId));
    assert.ok(targetItem, `order ${orderId} must contain SKU ${skuId}`);

    step(`opening picking recommendations for SKU ${skuId}`);
    const pickingPage = await withTimeout(
      miniProgram.reLaunch('/pages/pickingList/pickingList'),
      30000,
      'open picking list page'
    );
    assert.ok(pickingPage, 'picking list page must be created');
    await waitForPageData(
      pickingPage,
      (data) => !data.loading,
      15000,
      'initial picking list load'
    );

    const searched = await waitForPageData(
      pickingPage,
      (data) => !data.loading && data.filteredList.some((item) => String(item.skuId) === String(skuId)),
      15000,
      'target SKU recommendation'
    );
    const targetIndex = searched.filteredList.findIndex((item) => String(item.skuId) === String(skuId));
    const recommendation = searched.filteredList[targetIndex];
    assert.equal(
      Number(recommendation.recommendQty),
      Number(targetItem.qty),
      'recommendation quantity must match only the target E2E order quantity'
    );

    const checkboxes = await pickingPage.$$('.recommend-item .checkbox');
    assert.ok(checkboxes[targetIndex], 'target SKU checkbox must exist');
    await withTimeout(checkboxes[targetIndex].tap(), 10000, 'select target SKU');
    const selected = await waitForPageData(
      pickingPage,
      (data) => data.selectedCount === 1,
      5000,
      'select target SKU'
    );
    assert.equal(String(selected.filteredList[targetIndex].skuId), String(skuId));

    step('opening and confirming the purchase-order preview');
    const orderButton = await pickingPage.$('.btn-order');
    assert.ok(orderButton, 'create purchase order button must exist');
    await withTimeout(orderButton.tap(), 10000, 'open purchase-order preview');
    const preview = await waitForPageData(
      pickingPage,
      (data) => data.showOrderModal && data.orderPreviewList.length === 1,
      5000,
      'purchase-order preview'
    );
    assert.equal(String(preview.orderPreviewList[0].skuId), String(skuId));

    const confirmButton = await pickingPage.$('.btn-confirm');
    assert.ok(confirmButton, 'confirm purchase order button must exist');
    await withTimeout(confirmButton.tap(), 10000, 'confirm purchase order');

    const paidOrder = await waitForOrderStatus(accessToken, 'paid');
    step(`order ${orderId} reached paid through the normal preparation service`);

    const userOrderPage = await withTimeout(
      miniProgram.reLaunch(`/pages/orderDetail/orderDetail?id=${orderId}`),
      30000,
      'open user order detail'
    );
    const userView = await waitForPageData(
      userOrderPage,
      (data) => !data.isLoading && data.order && data.order.status === 'paid',
      15000,
      'user order detail paid state'
    );
    assert.equal(userView.order.statusDisplay, '待发货');

    const adminOrderPage = await withTimeout(
      miniProgram.reLaunch(`/pages/adminOrderDetail/adminOrderDetail?id=${orderId}`),
      30000,
      'open admin order detail'
    );
    const adminView = await waitForPageData(
      adminOrderPage,
      (data) => !data.isLoading && data.order && data.order.status === 'paid',
      15000,
      'admin order detail paid state'
    );
    assert.equal(adminView.order.statusDisplay, '待发货');

    const purchaseOrdersPage = await withTimeout(
      miniProgram.reLaunch('/pages/purchaseOrders/purchaseOrders'),
      30000,
      'open purchase order history'
    );
    const purchaseOrders = await waitForPageData(
      purchaseOrdersPage,
      (data) => !data.loading && data.orderList.length > 0,
      15000,
      'purchase order history'
    );
    const purchaseRecord = purchaseOrders.orderList.find(
      (item) => String(item.skuId) === String(skuId) && item.status === 'ordered'
    );
    assert.ok(purchaseRecord, `ordered purchase record for SKU ${skuId} must exist`);

    process.stdout.write(JSON.stringify({
      ok: true,
      orderId: String(orderId),
      skuId: String(skuId),
      status: paidOrder.status,
      userStatusDisplay: userView.order.statusDisplay,
      adminStatusDisplay: adminView.order.statusDisplay,
      purchaseOrderId: String(purchaseRecord.id),
      purchaseQty: purchaseRecord.qty
    }) + '\n');
  } finally {
    if (miniProgram) miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
