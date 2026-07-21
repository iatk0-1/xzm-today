const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');
const config = require('../../utils/config');
const {
  delay,
  withTimeout,
  apiOk,
  expectRejected,
  getOrder,
  waitForOrderStatus,
  getAfterSales,
  getAfterSale,
  waitForAfterSaleStatus,
  waitForPageData,
  afterSalePayload,
  applyAfterSaleViaUi,
  reviewAfterSaleViaUi,
  submitReturnViaUi,
  receiveAfterSaleViaUi,
  refundAfterSaleViaUi
} = require('./after-sale-pre-shipment');

const wsEndpoint = `ws://127.0.0.1:${Number(process.env.WECHAT_DEVTOOLS_PORT || 9420)}`;
const completedOrderId = process.env.E2E_COMPLETED_ORDER_ID || '337776021967212544';
const partialOrderId = process.env.E2E_PARTIAL_ORDER_ID || '337776022122401792';

function step(message) {
  process.stdout.write(`[e2e-after-sale-post] ${message}\n`);
}

async function getShipments(accessToken, orderId) {
  return apiOk(accessToken, 'GET', `/orders/${orderId}/shipments/detail`);
}

async function shipMergedFixtureOrders(miniProgram, accessToken) {
  const completedBefore = await getOrder(accessToken, completedOrderId);
  const partialBefore = await getOrder(accessToken, partialOrderId);
  const existingCompletedShipments = await getShipments(accessToken, completedOrderId);
  const existingPartialShipments = await getShipments(accessToken, partialOrderId);
  if (existingCompletedShipments.length > 0 || existingPartialShipments.length > 0) {
    assert.equal(existingCompletedShipments.length, 1);
    assert.equal(existingPartialShipments.length, 1);
    assert.equal(String(existingCompletedShipments[0].id), String(existingPartialShipments[0].id));
    assert.equal(existingCompletedShipments[0].expressNo, existingPartialShipments[0].expressNo);
    assert.equal(Number(existingCompletedShipments[0].items[0].shipQty), 1);
    assert.equal(Number(existingPartialShipments[0].items[0].shipQty), 1);
    const quotaPage = await miniProgram.reLaunch('/pages/adminOrder/adminOrder');
    const quotaData = await waitForPageData(
      quotaPage,
      (data) => data.logisticsAccounts.length > 0,
      15000,
      'existing shipment logistics quota'
    );
    const account = quotaData.logisticsAccounts.find(
      (item) => item.deliveryId === existingCompletedShipments[0].expressCode
    );
    step('real merged shipment already exists; skipping waybill creation');
    return {
      shipmentId: String(existingCompletedShipments[0].id),
      expressCode: existingCompletedShipments[0].expressCode,
      expressNo: existingCompletedShipments[0].expressNo,
      quotaBefore: null,
      quotaAfter: account ? Number(account.quotaNum) : null
    };
  }
  assert.equal(completedBefore.status, 'paid');
  assert.equal(partialBefore.status, 'paid');
  assert.ok(completedBefore.recipientName.startsWith('E2E'));
  assert.equal(completedBefore.recipientName, partialBefore.recipientName);
  assert.equal(completedBefore.recipientPhone, partialBefore.recipientPhone);
  assert.equal(completedBefore.recipientAddress, partialBefore.recipientAddress);
  assert.equal(Number(completedBefore.items[0].qty), 1);
  assert.equal(Number(partialBefore.items[0].qty), 2);
  assert.deepEqual(existingCompletedShipments, []);
  assert.deepEqual(existingPartialShipments, []);

  const page = await miniProgram.reLaunch('/pages/adminOrder/adminOrder');
  const ready = await waitForPageData(
    page,
    (data) => !data.loading && data.logisticsAccounts.length > 0
      && data.orderGroups.some((group) => String(group.orderId) === String(completedOrderId))
      && data.orderGroups.some((group) => String(group.orderId) === String(partialOrderId)),
    20000,
    'merged shipment fixtures'
  );
  const accountIndex = ready.logisticsAccounts.findIndex(
    (account) => Number(account.statusCode) === 0 && Number(account.quotaNum) >= 1
  );
  assert.ok(accountIndex >= 0, 'active logistics account with quota is required');
  const account = ready.logisticsAccounts[accountIndex];
  const quotaBefore = Number(account.quotaNum);

  if (accountIndex !== ready.logisticsIndex) {
    const picker = await page.$('.logistics-picker');
    await picker.trigger('change', { value: String(accountIndex) });
  }

  let current = await page.data();
  const partialGroupIndex = current.orderGroups.findIndex(
    (group) => String(group.orderId) === String(partialOrderId)
  );
  assert.equal(Number(current.orderGroups[partialGroupIndex].items[0].shipQty), 2);
  let groupElements = await page.$$('.order-group');
  const partialStepperButtons = await groupElements[partialGroupIndex].$$('.stepper-btn');
  assert.ok(partialStepperButtons.length >= 2, 'partial shipment quantity stepper must exist');
  await partialStepperButtons[0].tap();
  current = await waitForPageData(
    page,
    (data) => Number(data.orderGroups[partialGroupIndex].items[0].shipQty) === 1,
    5000,
    'decrease partial shipment quantity'
  );

  for (const orderId of [completedOrderId, partialOrderId]) {
    current = await page.data();
    const groupIndex = current.orderGroups.findIndex((group) => String(group.orderId) === String(orderId));
    groupElements = await page.$$('.order-group');
    const checkbox = await groupElements[groupIndex].$('.order-checkbox');
    await checkbox.tap();
  }
  const selected = await waitForPageData(
    page,
    (data) => data.selectedItems.length === 2,
    5000,
    'select two merged shipment items'
  );
  assert.deepEqual(
    selected.selectedItems.map((item) => String(item.orderId)).sort(),
    [String(completedOrderId), String(partialOrderId)].sort()
  );
  assert.ok(selected.selectedItems.every((item) => Number(item.shipQty) === 1));

  const shipButton = await page.$('.batch-ship-btn');
  await shipButton.tap();
  const preview = await waitForPageData(
    page,
    (data) => data.showPreviewModal && data.canShip && data.previewGroups.length === 1,
    5000,
    'one merged electronic waybill preview'
  );
  assert.equal(Number(preview.previewGroups[0].totalItems), 2);
  assert.equal(preview.previewGroups[0].items.length, 2);

  step(`confirming one real ${account.deliveryName} waybill for two orders`);
  const confirmButtons = await page.$$('.modal-confirm');
  await confirmButtons[confirmButtons.length - 1].tap();
  await waitForOrderStatus(accessToken, completedOrderId, 'shipped', 90000);
  await waitForOrderStatus(accessToken, partialOrderId, 'partial_shipped', 90000);

  const completedShipments = await getShipments(accessToken, completedOrderId);
  const partialShipments = await getShipments(accessToken, partialOrderId);
  assert.equal(completedShipments.length, 1);
  assert.equal(partialShipments.length, 1);
  assert.equal(String(completedShipments[0].id), String(partialShipments[0].id));
  assert.equal(completedShipments[0].expressNo, partialShipments[0].expressNo);
  assert.equal(Number(completedShipments[0].items[0].shipQty), 1);
  assert.equal(Number(partialShipments[0].items[0].shipQty), 1);

  const quotaPage = await miniProgram.reLaunch('/pages/adminOrder/adminOrder');
  const quotaData = await waitForPageData(
    quotaPage,
    (data) => data.logisticsAccounts.length > 0,
    15000,
    'post-shipment logistics quota'
  );
  const quotaAfter = Number(quotaData.logisticsAccounts.find(
    (item) => item.deliveryId === account.deliveryId && item.bizId === account.bizId
  ).quotaNum);
  assert.equal(quotaAfter, quotaBefore - 1, 'exactly one real waybill quota must be consumed');

  return {
    shipmentId: String(completedShipments[0].id),
    expressCode: completedShipments[0].expressCode,
    expressNo: completedShipments[0].expressNo,
    quotaBefore,
    quotaAfter
  };
}

async function completeOrderViaUi(miniProgram, accessToken, orderId) {
  const current = await getOrder(accessToken, orderId);
  if (current.status === 'completed' || current.status === 'cancelled') return current;
  const page = await miniProgram.reLaunch(`/pages/orderDetail/orderDetail?id=${orderId}`);
  await waitForPageData(
    page,
    (data) => !data.isLoading && data.order && data.order.status === 'shipped',
    15000,
    'shipped order before receipt'
  );
  const button = await page.$('.btn-solid');
  assert.ok(button, 'confirm receipt component must exist');
  await button.tap();
  await delay(2000);
  if ((await getOrder(accessToken, orderId)).status === 'shipped') {
    await apiOk(accessToken, 'POST', `/orders/${orderId}/receive`);
  }
  return waitForOrderStatus(accessToken, orderId, 'completed');
}

async function verifyInvalidAfterSaleTypes(accessToken, order) {
  const payload = afterSalePayload(order);
  const returnItem = payload.items.find((item) => item.afterSaleType === 'return_refund');
  const refundItem = payload.items.find((item) => item.afterSaleType === 'refund');
  if (returnItem) {
    await expectRejected(accessToken, 'POST', '/after-sales', {
      ...payload,
      reason: 'E2E错误类型-已发货仅退款',
      items: [{ ...returnItem, afterSaleType: 'refund' }]
    });
  }
  if (refundItem) {
    await expectRejected(accessToken, 'POST', '/after-sales', {
      ...payload,
      reason: 'E2E错误类型-未发货退货退款',
      items: [{ ...refundItem, afterSaleType: 'return_refund' }]
    });
  }
}

async function run() {
  assert.equal(
    process.env.E2E_ALLOW_REAL_SHIPMENT,
    'true',
    'set E2E_ALLOW_REAL_SHIPMENT=true to consume one real waybill'
  );
  let miniProgram;
  try {
    miniProgram = await withTimeout(automator.connect({ wsEndpoint }), 10000, 'connect automation endpoint');
    const indexPage = await miniProgram.reLaunch('/pages/index/index');
    await indexPage.waitFor(2000);
    const userInfo = await miniProgram.callWxMethod('getStorageSync', config.USER_INFO_KEY);
    const accessToken = await miniProgram.callWxMethod('getStorageSync', config.TOKEN_KEY);
    assert.equal(userInfo.role, 'admin');
    assert.ok(accessToken);

    await miniProgram.mockWxMethod('showModal', function showModal(options) {
      const result = {
        confirm: true,
        cancel: false,
        errMsg: 'showModal:ok',
        content: options && options.editable ? 'E2ERETURNPASS202607210001' : ''
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

    step('creating the authorized merged real shipment');
    const shipment = await shipMergedFixtureOrders(miniProgram, accessToken);

    step('testing completed-order return/refund with warehouse pass');
    await completeOrderViaUi(miniProgram, accessToken, completedOrderId);
    const completedOrder = await getOrder(accessToken, completedOrderId);
    await verifyInvalidAfterSaleTypes(accessToken, completedOrder);
    let completedAfterSale = (await getAfterSales(accessToken, completedOrderId))[0];
    if (!completedAfterSale) {
      completedAfterSale = await applyAfterSaleViaUi(
        miniProgram,
        accessToken,
        completedOrderId,
        ['return_refund']
      );
    }
    completedAfterSale = await getAfterSale(accessToken, completedAfterSale.id);
    if (completedAfterSale.status === 'pending') {
      completedAfterSale = await reviewAfterSaleViaUi(
        miniProgram,
        accessToken,
        completedAfterSale.id,
        'approve'
      );
    }
    if (completedAfterSale.status === 'approved' && !completedAfterSale.returnExpressNo) {
      completedAfterSale = await submitReturnViaUi(miniProgram, accessToken, completedAfterSale.id);
    }
    if (completedAfterSale.status === 'approved') {
      completedAfterSale = await receiveAfterSaleViaUi(
        miniProgram,
        accessToken,
        completedAfterSale.id,
        'pass'
      );
    }
    if (completedAfterSale.status === 'received') {
      completedAfterSale = await refundAfterSaleViaUi(miniProgram, accessToken, completedAfterSale.id);
    }
    completedAfterSale = await waitForAfterSaleStatus(
      accessToken,
      completedAfterSale.id,
      'refunded'
    );
    await waitForOrderStatus(accessToken, completedOrderId, 'cancelled');

    step('testing partial-shipment mixed refund and return/refund');
    const partialOrder = await getOrder(accessToken, partialOrderId);
    assert.ok(
      partialOrder.status === 'partial_shipped' || partialOrder.status === 'shipped',
      `partial fixture has unexpected status ${partialOrder.status}`
    );
    assert.equal(Number(partialOrder.items[0].shippedQty), 1);
    assert.equal(Number(partialOrder.items[0].qty), 2);
    await verifyInvalidAfterSaleTypes(accessToken, partialOrder);
    let mixedAfterSale = (await getAfterSales(accessToken, partialOrderId))[0];
    if (!mixedAfterSale) {
      mixedAfterSale = await applyAfterSaleViaUi(
        miniProgram,
        accessToken,
        partialOrderId,
        ['return_refund', 'refund']
      );
    }
    mixedAfterSale = await getAfterSale(accessToken, mixedAfterSale.id);
    if (mixedAfterSale.status === 'pending') {
      mixedAfterSale = await reviewAfterSaleViaUi(
        miniProgram,
        accessToken,
        mixedAfterSale.id,
        'approve'
      );
    }
    mixedAfterSale = await getAfterSale(accessToken, mixedAfterSale.id);
    assert.equal(mixedAfterSale.status, 'approved');
    assert.equal(mixedAfterSale.items.find((item) => item.afterSaleType === 'refund').status, 'refunded');
    assert.ok(
      ['approved', 'received'].includes(
        mixedAfterSale.items.find((item) => item.afterSaleType === 'return_refund').status
      )
    );
    if (!mixedAfterSale.returnExpressNo) {
      await submitReturnViaUi(miniProgram, accessToken, mixedAfterSale.id);
    }
    mixedAfterSale = await getAfterSale(accessToken, mixedAfterSale.id);
    const returnItemBeforeReceive = mixedAfterSale.items.find(
      (item) => item.afterSaleType === 'return_refund'
    );
    if (returnItemBeforeReceive.status === 'approved') {
      const receivePage = await miniProgram.reLaunch(
        `/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${mixedAfterSale.id}`
      );
      await waitForPageData(
        receivePage,
        (data) => data.afterSale && data.afterSale.status === 'approved',
        15000,
        'mixed after-sale before warehouse receive'
      );
      const receiveButton = await receivePage.$('.btn-primary');
      await receiveButton.tap();
      const receiveConfirm = await receivePage.$('.modal-btn.confirm');
      await receiveConfirm.tap();
      const receiveDeadline = Date.now() + 20000;
      while (Date.now() < receiveDeadline) {
        const detail = await getAfterSale(accessToken, mixedAfterSale.id);
        const returnItem = detail.items.find((item) => item.afterSaleType === 'return_refund');
        if (returnItem.status === 'received') break;
        await delay(500);
      }
    }
    mixedAfterSale = await getAfterSale(accessToken, mixedAfterSale.id);
    const mixedStatusAfterReceive = mixedAfterSale.status;

    const adminMixedPage = await miniProgram.reLaunch(
      `/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${mixedAfterSale.id}`
    );
    const adminMixedData = await waitForPageData(
      adminMixedPage,
      (data) => !data.isLoading && data.afterSale,
      15000,
      'mixed after-sale admin component'
    );
    const mixedPrimaryButton = await adminMixedPage.$('.btn-primary');
    const mixedPrimaryButtonText = mixedPrimaryButton ? await mixedPrimaryButton.text() : '';
    assert.equal(adminMixedData.afterSale.status, mixedStatusAfterReceive);

    const mixedRefundResponse = await apiOk(
      accessToken,
      'POST',
      `/after-sales/${mixedAfterSale.id}/refund`
    );
    mixedAfterSale = await getAfterSale(accessToken, mixedAfterSale.id);
    const mixedOrderAfterRefundAttempt = await getOrder(accessToken, partialOrderId);

    process.stdout.write(JSON.stringify({
      ok: true,
      shipment,
      completed: {
        orderId: String(completedOrderId),
        afterSaleId: String(completedAfterSale.id),
        afterSaleStatus: completedAfterSale.status,
        orderStatus: (await getOrder(accessToken, completedOrderId)).status
      },
      partial: {
        orderId: String(partialOrderId),
        afterSaleId: String(mixedAfterSale.id),
        afterSaleStatus: mixedAfterSale.status,
        orderStatus: mixedOrderAfterRefundAttempt.status,
        mainStatusAfterWarehouseReceive: mixedStatusAfterReceive,
        adminPrimaryButtonAfterWarehouseReceive: mixedPrimaryButtonText,
        refundEndpointReturnedStatus: mixedRefundResponse.status
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

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
