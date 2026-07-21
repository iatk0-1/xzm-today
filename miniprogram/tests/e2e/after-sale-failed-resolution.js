const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');
const config = require('../../utils/config');
const {
  delay,
  withTimeout,
  apiOk,
  getOrder,
  waitForOrderStatus,
  getAfterSales,
  getAfterSale,
  waitForAfterSaleStatus,
  waitForPageData,
  createOrder,
  markPaidViaDevServer,
  prepareOrdersViaUi,
  applyAfterSaleViaUi,
  reviewAfterSaleViaUi,
  submitReturnViaUi,
  receiveAfterSaleViaUi,
  refundAfterSaleViaUi
} = require('./after-sale-pre-shipment');

const wsEndpoint = `ws://127.0.0.1:${Number(process.env.WECHAT_DEVTOOLS_PORT || 9420)}`;

function step(message) {
  process.stdout.write(`[e2e-failed-resolution] ${message}\n`);
}

async function getShipments(accessToken, orderId) {
  return apiOk(accessToken, 'GET', `/orders/${orderId}/shipments/detail`);
}

async function preparePaidOrders(miniProgram, accessToken, orders) {
  const stockingIds = [];
  for (const order of orders) {
    let current = await getOrder(accessToken, order.id);
    if (current.status === 'pending') {
      await markPaidViaDevServer(order.id);
      current = await getOrder(accessToken, order.id);
    }
    if (current.status === 'stocking') stockingIds.push(order.id);
  }
  if (stockingIds.length > 0) {
    await prepareOrdersViaUi(miniProgram, accessToken, stockingIds);
  }
  for (const order of orders) {
    await waitForOrderStatus(accessToken, order.id, 'paid');
  }
}

async function shipTwoOrders(miniProgram, accessToken, firstOrder, secondOrder) {
  const firstExisting = await getShipments(accessToken, firstOrder.id);
  const secondExisting = await getShipments(accessToken, secondOrder.id);
  if (firstExisting.length || secondExisting.length) {
    assert.equal(firstExisting.length, 1);
    assert.equal(secondExisting.length, 1);
    assert.equal(String(firstExisting[0].id), String(secondExisting[0].id));
    return firstExisting[0];
  }

  const page = await miniProgram.reLaunch('/pages/adminOrder/adminOrder');
  const ready = await waitForPageData(
    page,
    data => !data.loading && data.logisticsAccounts.length > 0
      && data.orderGroups.some(group => String(group.orderId) === String(firstOrder.id))
      && data.orderGroups.some(group => String(group.orderId) === String(secondOrder.id)),
    20000,
    'failed-resolution shipment fixtures'
  );
  const accountIndex = ready.logisticsAccounts.findIndex(
    account => Number(account.statusCode) === 0 && Number(account.quotaNum) >= 1
  );
  assert.ok(accountIndex >= 0, 'active logistics account with quota is required');
  const account = ready.logisticsAccounts[accountIndex];
  const quotaBefore = Number(account.quotaNum);
  if (accountIndex !== ready.logisticsIndex) {
    const picker = await page.$('.logistics-picker');
    await picker.trigger('change', { value: String(accountIndex) });
  }

  for (const order of [firstOrder, secondOrder]) {
    const current = await page.data();
    const groupIndex = current.orderGroups.findIndex(
      group => String(group.orderId) === String(order.id)
    );
    const groups = await page.$$('.order-group');
    const checkbox = await groups[groupIndex].$('.order-checkbox');
    await checkbox.tap();
  }
  const selected = await waitForPageData(
    page,
    data => data.selectedItems.length === 2,
    5000,
    'select failed-resolution shipments'
  );
  assert.deepEqual(
    selected.selectedItems.map(item => Number(item.shipQty)).sort((a, b) => a - b),
    [1, 2]
  );

  const shipButton = await page.$('.batch-ship-btn');
  await shipButton.tap();
  const preview = await waitForPageData(
    page,
    data => data.showPreviewModal && data.canShip && data.previewGroups.length === 1,
    5000,
    'failed-resolution waybill preview'
  );
  assert.equal(Number(preview.previewGroups[0].totalItems), 3);
  const confirmButtons = await page.$$('.modal-confirm');
  await confirmButtons[confirmButtons.length - 1].tap();
  await waitForOrderStatus(accessToken, firstOrder.id, 'shipped', 90000);
  await waitForOrderStatus(accessToken, secondOrder.id, 'shipped', 90000);

  const firstShipments = await getShipments(accessToken, firstOrder.id);
  const secondShipments = await getShipments(accessToken, secondOrder.id);
  assert.equal(String(firstShipments[0].id), String(secondShipments[0].id));
  const quotaPage = await miniProgram.reLaunch('/pages/adminOrder/adminOrder');
  const quotaData = await waitForPageData(
    quotaPage,
    data => data.logisticsAccounts.length > 0,
    15000,
    'failed-resolution post-shipment quota'
  );
  const quotaAfter = Number(quotaData.logisticsAccounts.find(
    item => item.deliveryId === account.deliveryId && item.bizId === account.bizId
  ).quotaNum);
  assert.equal(quotaAfter, quotaBefore - 1);
  return { ...firstShipments[0], quotaBefore, quotaAfter };
}

async function createFailedAfterSale(miniProgram, accessToken, orderId) {
  let afterSale = (await getAfterSales(accessToken, orderId))[0];
  if (!afterSale) {
    afterSale = await applyAfterSaleViaUi(miniProgram, accessToken, orderId, ['return_refund']);
  }
  afterSale = await getAfterSale(accessToken, afterSale.id);
  if (afterSale.status === 'pending') {
    afterSale = await reviewAfterSaleViaUi(miniProgram, accessToken, afterSale.id, 'approve');
  }
  if (!afterSale.returnExpressNo) {
    afterSale = await submitReturnViaUi(miniProgram, accessToken, afterSale.id);
  }
  if (afterSale.status === 'approved') {
    afterSale = await receiveAfterSaleViaUi(miniProgram, accessToken, afterSale.id, 'fail');
  }
  assert.equal(afterSale.status, 'received');
  assert.equal(afterSale.warehouseCheck, 'fail');
  return afterSale;
}

async function resolveByReinspection(miniProgram, accessToken, afterSale) {
  const page = await miniProgram.reLaunch(
    `/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${afterSale.id}`
  );
  await waitForPageData(
    page,
    data => data.afterSale && data.afterSale.warehouseCheck === 'fail',
    15000,
    'reinspection action page'
  );
  const ghostButton = await page.$('.btn-ghost');
  assert.equal(await ghostButton.text(), '重新验收');
  await ghostButton.tap();
  await waitForPageData(page, data => data.showReceiveModal && data.isReinspection, 5000, 'reinspection modal');
  const confirm = await page.$('.modal-btn.confirm');
  await confirm.tap();

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const detail = await getAfterSale(accessToken, afterSale.id);
    if (detail.warehouseCheck === 'pass') break;
    await delay(500);
  }
  const passed = await getAfterSale(accessToken, afterSale.id);
  assert.equal(passed.warehouseCheck, 'pass');
  const refunded = await refundAfterSaleViaUi(miniProgram, accessToken, afterSale.id);
  assert.equal(refunded.status, 'refunded');
  return refunded;
}

async function resolveByNegotiation(miniProgram, accessToken, afterSale) {
  const page = await miniProgram.reLaunch(
    `/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${afterSale.id}`
  );
  await waitForPageData(
    page,
    data => data.afterSale && data.afterSale.warehouseCheck === 'fail',
    15000,
    'negotiated-refund action page'
  );
  const primaryButton = await page.$('.btn-primary');
  assert.equal(await primaryButton.text(), '协商退款');
  await primaryButton.tap();
  const modalData = await waitForPageData(
    page,
    data => data.showNegotiatedRefundModal && data.negotiatedItems.length === 1,
    5000,
    'negotiated-refund modal'
  );
  assert.equal(Number(modalData.negotiatedItems[0].refundAmount), 0.02);
  const amountInput = await page.$('.negotiated-amount');
  await amountInput.input('0.01');
  const reasonInput = await page.$('.negotiated-reason');
  await reasonInput.input('商品轻微破损，用户同意部分退款');
  const noteInput = await page.$('.negotiated-note');
  await noteInput.input('E2E协商记录');
  const confirm = await page.$('.modal-btn.confirm');
  await confirm.tap();
  const refunded = await waitForAfterSaleStatus(accessToken, afterSale.id, 'refunded', 30000);
  assert.equal(Number(refunded.items[0].refundAmount), 0.01);
  const logs = await apiOk(accessToken, 'GET', `/after-sales/${afterSale.id}/logs?limit=50`);
  assert.ok(logs.some(log => log.action === 'negotiated_refund'));

  const duplicate = await apiOk(accessToken, 'POST', `/after-sales/${afterSale.id}/negotiated-refund`, {
    reason: '商品轻微破损，用户同意部分退款',
    note: 'E2E协商记录',
    items: [{ afterSaleItemId: refunded.items[0].id, refundAmount: 0.01 }]
  });
  assert.equal(duplicate.status, 'success');
  return refunded;
}

async function run() {
  assert.equal(process.env.E2E_ALLOW_REAL_SHIPMENT, 'true', 'set E2E_ALLOW_REAL_SHIPMENT=true');
  let miniProgram;
  try {
    miniProgram = await withTimeout(automator.connect({ wsEndpoint }), 10000, 'connect automation endpoint');
    const indexPage = await miniProgram.reLaunch('/pages/index/index');
    await indexPage.waitFor(2000);
    const userInfo = await miniProgram.callWxMethod('getStorageSync', config.USER_INFO_KEY);
    const accessToken = await miniProgram.callWxMethod('getStorageSync', config.TOKEN_KEY);
    assert.equal(userInfo.role, 'admin');

    await miniProgram.mockWxMethod('showModal', function showModal(options) {
      const result = {
        confirm: true,
        cancel: false,
        errMsg: 'showModal:ok',
        content: options && options.editable ? 'E2EFAILEDRESOLUTION' : ''
      };
      if (options && options.success) options.success(result);
      if (options && options.complete) options.complete(result);
      return result;
    });
    await miniProgram.mockWxMethod('showActionSheet', function showActionSheet(options) {
      const result = { tapIndex: 0, errMsg: 'showActionSheet:ok' };
      if (options && options.success) options.success(result);
      if (options && options.complete) options.complete(result);
      return result;
    });
    await miniProgram.mockWxMethod('openBusinessView', function openBusinessView(options) {
      const result = { errMsg: 'openBusinessView:fail E2E fallback' };
      if (options && options.fail) options.fail(result);
      if (options && options.complete) options.complete(result);
      return result;
    });

    step('creating two isolated e2e_manual orders');
    const reinspectionOrder = await createOrder(accessToken, '重新验收', 1, true);
    const negotiationOrder = await createOrder(accessToken, '协商退款', 2, true);
    await preparePaidOrders(miniProgram, accessToken, [reinspectionOrder, negotiationOrder]);

    step('creating one authorized real merged waybill');
    const shipment = await shipTwoOrders(miniProgram, accessToken, reinspectionOrder, negotiationOrder);

    step('creating two warehouse-failed after-sales');
    const reinspectionAfterSale = await createFailedAfterSale(
      miniProgram, accessToken, reinspectionOrder.id
    );
    const negotiationAfterSale = await createFailedAfterSale(
      miniProgram, accessToken, negotiationOrder.id
    );

    step('resolving one failure by reinspection pass and normal refund');
    const reinspectionResult = await resolveByReinspection(
      miniProgram, accessToken, reinspectionAfterSale
    );

    step('resolving one failure by audited partial negotiated refund');
    const negotiationResult = await resolveByNegotiation(
      miniProgram, accessToken, negotiationAfterSale
    );

    assert.equal((await getOrder(accessToken, reinspectionOrder.id)).status, 'cancelled');
    assert.equal((await getOrder(accessToken, negotiationOrder.id)).status, 'cancelled');
    process.stdout.write(JSON.stringify({
      ok: true,
      shipment: {
        id: String(shipment.id),
        expressNo: shipment.expressNo,
        quotaBefore: shipment.quotaBefore,
        quotaAfter: shipment.quotaAfter
      },
      reinspection: {
        orderId: String(reinspectionOrder.id),
        afterSaleId: String(reinspectionResult.id),
        status: reinspectionResult.status,
        warehouseCheck: reinspectionResult.warehouseCheck
      },
      negotiation: {
        orderId: String(negotiationOrder.id),
        afterSaleId: String(negotiationResult.id),
        status: negotiationResult.status,
        actualRefundAmount: negotiationResult.items[0].refundAmount
      }
    }) + '\n');
  } finally {
    if (miniProgram) {
      for (const method of ['showModal', 'showActionSheet', 'openBusinessView']) {
        try { await miniProgram.restoreWxMethod(method); } catch (error) {}
      }
      miniProgram.disconnect();
    }
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
