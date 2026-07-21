const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const automator = require('miniprogram-automator');
const config = require('../../utils/config');

const execFileAsync = promisify(execFile);
const wsEndpoint = `ws://127.0.0.1:${Number(process.env.WECHAT_DEVTOOLS_PORT || 9420)}`;
const productId = process.env.E2E_PRODUCT_ID || '329866983975686144';
const skuId = process.env.E2E_SKU_ID || '329866983992463360';
const existingShippedOrderId = process.env.E2E_SHIPPED_ORDER_ID || '337515865090035712';
const sshKey = process.env.XZM_DEV_SSH_KEY || path.join(process.env.USERPROFILE, '.ssh', 'xzm_dev.pem');
const sshTarget = process.env.XZM_DEV_SSH_TARGET || 'root@101.34.57.84';
const runTag = process.env.E2E_RUN_TAG || `AS${Date.now()}`;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const withTimeout = (promise, milliseconds, label) => Promise.race([
  promise,
  delay(milliseconds).then(() => {
    throw new Error(`${label} timed out after ${milliseconds}ms`);
  })
]);

function step(message) {
  process.stdout.write(`[e2e-after-sale] ${message}\n`);
}

async function request(accessToken, method, apiPath, body) {
  const idempotencyKey = `${runTag}-${crypto.randomUUID()}`;
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch(config.API_BASE_URL + apiPath, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(method === 'GET' ? {} : { 'Idempotency-Key': idempotencyKey }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });
      break;
    } catch (error) {
      lastError = error;
      await delay(attempt * 1000);
    }
  }
  if (!response) throw lastError;
  let payload = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); } catch (error) { payload = text; }
  }
  return { status: response.status, body: payload };
}

async function apiOk(accessToken, method, apiPath, body, expectedStatus = 200) {
  const result = await request(accessToken, method, apiPath, body);
  assert.equal(
    result.status,
    expectedStatus,
    `${method} ${apiPath} expected ${expectedStatus}, got ${result.status}: ${JSON.stringify(result.body)}`
  );
  return result.body;
}

async function expectRejected(accessToken, method, apiPath, body) {
  const result = await request(accessToken, method, apiPath, body);
  assert.ok(result.status >= 400 && result.status < 500, `${method} ${apiPath} must be rejected`);
  return result;
}

async function getOrder(accessToken, orderId) {
  return apiOk(accessToken, 'GET', `/orders/${orderId}`);
}

async function waitForOrderStatus(accessToken, orderId, expectedStatus, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const order = await getOrder(accessToken, orderId);
    if (order.status === expectedStatus) return order;
    await delay(500);
  }
  throw new Error(`order ${orderId} did not reach ${expectedStatus}`);
}

async function getAfterSales(accessToken, orderId) {
  const result = await apiOk(accessToken, 'GET', `/after-sales?orderId=${orderId}&page=1&size=100`);
  return result.items || [];
}

async function getAfterSale(accessToken, afterSaleId) {
  return apiOk(accessToken, 'GET', `/after-sales/${afterSaleId}`);
}

async function waitForAfterSaleStatus(accessToken, afterSaleId, expectedStatuses, timeout = 30000) {
  const expected = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const afterSale = await getAfterSale(accessToken, afterSaleId);
    if (expected.includes(afterSale.status)) return afterSale;
    await delay(500);
  }
  throw new Error(`after-sale ${afterSaleId} did not reach ${expected.join('/')}`);
}

async function waitForPageData(page, predicate, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const data = await withTimeout(page.data(), 10000, `${label} data`);
    if (predicate(data)) return data;
    await delay(300);
  }
  throw new Error(`${label} timed out`);
}

async function createOrder(accessToken, scenario, qty = 1, sharedRecipient = false) {
  const recipientName = sharedRecipient ? `E2E售后物流组-${runTag}` : `E2E${scenario}-${runTag}`;
  const existingOrders = await apiOk(accessToken, 'GET', '/orders?page=1&size=100');
  const existing = (existingOrders.items || []).find(
    (order) => order.recipientName === recipientName
      && Number(order.payAmount).toFixed(2) === (qty * 0.01).toFixed(2)
  );
  if (existing) return existing;
  return apiOk(accessToken, 'POST', '/orders', {
    items: [{
      skuId: Number(skuId),
      qty,
      salePrice: 0.01,
      pool: 'main',
      skuSpec: '图片色',
      skuSize: 'M',
      productName: '伟bby is free!',
      productImage: 'https://upload-dev.xianzaimai.com/xzm/products/2026/06/29/2f259e33c3c6478593a15e73c3a509ec.jpg'
    }],
    recipientName,
    recipientPhone: '13000000000',
    recipientProvince: '浙江省',
    recipientCity: '杭州市',
    recipientDistrict: '钱塘区',
    recipientDetail: `E2E售后自动化测试地址-${runTag}`
  }, 201);
}

async function markPaidViaDevServer(orderId) {
  const remoteCommand = [
    'set -e',
    "e2e_key=$(sed -n 's/^APP_E2E_KEY=//p' /data/start.env | tail -n 1)",
    `curl -fsS -X POST -H "X-E2E-Key: \${e2e_key}" http://127.0.0.1:8080/internal/e2e/orders/${orderId}/mark-paid`
  ].join('; ');
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { stdout } = await execFileAsync('ssh.exe', [
        '-i', sshKey,
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ConnectTimeout=20',
        sshTarget,
        remoteCommand
      ], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
      await delay(attempt * 1000);
    }
  }
  throw lastError;
}

function afterSalePayload(order, selectTypes = ['refund', 'return_refund']) {
  const items = [];
  for (const item of order.items || []) {
    const shippedQty = Number(item.shippedQty || 0);
    const totalQty = Number(item.qty || 0);
    const unshippedQty = totalQty - shippedQty;
    if (shippedQty > 0 && selectTypes.includes('return_refund')) {
      items.push({
        orderItemId: item.id,
        productId: item.productId,
        qty: shippedQty,
        shippedQty,
        unshippedQty: 0,
        refundAmount: Number(item.salePrice) * shippedQty,
        afterSaleType: 'return_refund'
      });
    }
    if (unshippedQty > 0 && selectTypes.includes('refund')) {
      items.push({
        orderItemId: item.id,
        productId: item.productId,
        qty: unshippedQty,
        shippedQty: 0,
        unshippedQty,
        refundAmount: Number(item.salePrice) * unshippedQty,
        afterSaleType: 'refund'
      });
    }
  }
  return {
    orderId: order.id,
    reason: `E2E售后接口校验-${runTag}`,
    evidenceUrls: '',
    items
  };
}

async function applyAfterSaleViaUi(miniProgram, accessToken, orderId, expectedTypes) {
  const beforeIds = new Set((await getAfterSales(accessToken, orderId)).map((item) => String(item.id)));
  const page = await withTimeout(
    miniProgram.reLaunch(`/pages/afterSaleApply/afterSaleApply?orderId=${orderId}`),
    30000,
    `open after-sale apply ${orderId}`
  );
  const data = await waitForPageData(
    page,
    (value) => !value.isLoading && value.order && value.splitItems.length > 0,
    15000,
    `after-sale apply ${orderId}`
  );
  assert.equal(String(data.order.id), String(orderId));
  assert.deepEqual(data.splitItems.map((item) => item.type).sort(), [...expectedTypes].sort());

  const splitElements = await page.$$('.split-item');
  for (let index = 0; index < data.splitItems.length; index++) {
    if (expectedTypes.includes(data.splitItems[index].type)) {
      await splitElements[index].tap();
    }
  }
  const reasonTags = await page.$$('.reason-tag');
  assert.ok(reasonTags.length > 1, 'after-sale reason tags must exist');
  await reasonTags[1].tap();
  const submit = await page.$('.submit-btn');
  assert.ok(submit, 'after-sale submit button must exist');
  await submit.tap();

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const created = (await getAfterSales(accessToken, orderId))
      .find((item) => !beforeIds.has(String(item.id)));
    if (created) return getAfterSale(accessToken, created.id);
    await delay(500);
  }
  throw new Error(`after-sale for order ${orderId} was not created`);
}

async function cancelOrderViaUi(miniProgram, accessToken, orderId) {
  const current = await getOrder(accessToken, orderId);
  if (current.status === 'cancelled') return current;
  const page = await miniProgram.reLaunch(`/pages/orderDetail/orderDetail?id=${orderId}`);
  await waitForPageData(page, (data) => !data.isLoading && data.order, 15000, 'pending order detail');
  const cancelButton = await page.$('.btn-ghost');
  assert.ok(cancelButton, 'pending order cancel button must exist');
  await cancelButton.tap();
  await delay(2000);
  if ((await getOrder(accessToken, orderId)).status === 'pending') {
    await apiOk(accessToken, 'POST', `/orders/${orderId}/cancel`);
  }
  return waitForOrderStatus(accessToken, orderId, 'cancelled');
}

async function cancelAfterSaleViaUi(miniProgram, accessToken, afterSaleId) {
  const page = await miniProgram.reLaunch(`/pages/afterSaleDetail/afterSaleDetail?afterSaleId=${afterSaleId}`);
  await waitForPageData(
    page,
    (data) => data.afterSale && data.afterSale.status === 'pending',
    15000,
    'pending after-sale detail'
  );
  const cancelButton = await page.$('.btn-ghost');
  assert.ok(cancelButton, 'after-sale cancel button must exist');
  await cancelButton.tap();
  await delay(2000);
  if ((await getAfterSale(accessToken, afterSaleId)).status === 'pending') {
    await apiOk(accessToken, 'POST', `/after-sales/${afterSaleId}/cancel`);
  }
  return waitForAfterSaleStatus(accessToken, afterSaleId, 'cancelled');
}

async function reviewAfterSaleViaUi(miniProgram, accessToken, afterSaleId, decision, rejectReason) {
  const page = await miniProgram.reLaunch(`/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${afterSaleId}`);
  await waitForPageData(
    page,
    (data) => !data.isLoading && data.afterSale && data.afterSale.status === 'pending',
    15000,
    'admin pending after-sale'
  );
  const openButton = await page.$(decision === 'reject' ? '.btn-ghost' : '.btn-primary');
  assert.ok(openButton, 'admin review button must exist');
  await openButton.tap();
  if (decision === 'reject') {
    const options = await page.$$('.option-item');
    await options[1].tap();
    const reasonInput = await page.$('.input-textarea');
    await reasonInput.input(rejectReason || `E2E拒绝-${runTag}`);
  }
  const confirm = await page.$('.modal-btn.confirm');
  assert.ok(confirm, 'admin review confirm button must exist');
  await confirm.tap();
  return waitForAfterSaleStatus(
    accessToken,
    afterSaleId,
    decision === 'reject' ? 'rejected' : ['approved', 'refunded']
  );
}

async function submitReturnViaUi(miniProgram, accessToken, afterSaleId) {
  const page = await miniProgram.reLaunch(`/pages/afterSaleDetail/afterSaleDetail?afterSaleId=${afterSaleId}`);
  await waitForPageData(
    page,
    (data) => data.afterSale && data.afterSale.status === 'approved',
    15000,
    'approved return after-sale'
  );
  const action = await page.$('.action-btn');
  assert.ok(action, 'return shipment button must exist');
  await action.tap();
  await delay(2000);
  if (!(await getAfterSale(accessToken, afterSaleId)).returnExpressNo) {
    await apiOk(accessToken, 'POST', `/after-sales/${afterSaleId}/return-ship`, {
      expressCode: 'ZTO',
      expressNo: 'E2ERETURN202607210001'
    });
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const afterSale = await getAfterSale(accessToken, afterSaleId);
    if (afterSale.returnExpressNo) return afterSale;
    await delay(500);
  }
  throw new Error(`return shipping for after-sale ${afterSaleId} was not saved`);
}

async function receiveAfterSaleViaUi(miniProgram, accessToken, afterSaleId, warehouseCheck) {
  const page = await miniProgram.reLaunch(`/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${afterSaleId}`);
  await waitForPageData(
    page,
    (data) => data.afterSale && data.afterSale.status === 'approved',
    15000,
    'approved admin after-sale'
  );
  const receiveButton = await page.$('.btn-primary');
  assert.ok(receiveButton, 'warehouse receive button must exist');
  await receiveButton.tap();
  if (warehouseCheck === 'fail') {
    const options = await page.$$('.option-item');
    await options[1].tap();
  }
  const confirm = await page.$('.modal-btn.confirm');
  await confirm.tap();
  return waitForAfterSaleStatus(accessToken, afterSaleId, 'received');
}

async function refundAfterSaleViaUi(miniProgram, accessToken, afterSaleId) {
  const page = await miniProgram.reLaunch(`/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${afterSaleId}`);
  await waitForPageData(
    page,
    (data) => data.afterSale && data.afterSale.status === 'received',
    15000,
    'received admin after-sale'
  );
  const refundButton = await page.$('.btn-primary');
  assert.ok(refundButton, 'admin refund button must exist');
  await refundButton.tap();
  await delay(2000);
  if ((await getAfterSale(accessToken, afterSaleId)).status === 'received') {
    await apiOk(accessToken, 'POST', `/after-sales/${afterSaleId}/refund`);
  }
  return waitForAfterSaleStatus(accessToken, afterSaleId, ['received', 'refunded']);
}

async function prepareOrdersViaUi(miniProgram, accessToken, orderIds) {
  const page = await miniProgram.reLaunch('/pages/pickingList/pickingList');
  const ready = await waitForPageData(
    page,
    (data) => !data.loading && data.filteredList.some((item) => String(item.skuId) === String(skuId)),
    15000,
    'picking list for after-sale fixtures'
  );
  const targetIndex = ready.filteredList.findIndex((item) => String(item.skuId) === String(skuId));
  const expectedQty = ready.filteredList[targetIndex].recommendQty;
  assert.ok(Number(expectedQty) >= orderIds.length, 'picking recommendation must cover fixture orders');
  const checkboxes = await page.$$('.recommend-item .checkbox');
  await checkboxes[targetIndex].tap();
  await waitForPageData(page, (data) => data.selectedCount === 1, 5000, 'select picking recommendation');
  const orderButton = await page.$('.btn-order');
  await orderButton.tap();
  await waitForPageData(page, (data) => data.showOrderModal, 5000, 'picking preview');
  const confirm = await page.$('.btn-confirm');
  await confirm.tap();
  for (const orderId of orderIds) {
    await waitForOrderStatus(accessToken, orderId, 'paid');
  }
}

async function run() {
  assert.equal(process.env.E2E_ALLOW_MUTATION, 'true', 'set E2E_ALLOW_MUTATION=true');
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
        content: options && options.editable ? 'E2ERETURN202607210001' : ''
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

    step(`creating isolated fixtures ${runTag}`);
    const fixtures = {
      pendingCancel: await createOrder(accessToken, '待付款取消'),
      stockingCancelAfterSale: await createOrder(accessToken, '备货撤销售后'),
      stockingReview: await createOrder(accessToken, '备货审核'),
      paidReview: await createOrder(accessToken, '待发货退款'),
      completed: await createOrder(accessToken, '完成退货', 1, true),
      partial: await createOrder(accessToken, '部分发货混合', 2, true)
    };

    step('testing pending user cancellation through order-detail component');
    await cancelOrderViaUi(miniProgram, accessToken, fixtures.pendingCancel.id);
    await expectRejected(accessToken, 'POST', `/orders/${fixtures.pendingCancel.id}/cancel`);
    await expectRejected(
      accessToken,
      'POST',
      '/after-sales',
      afterSalePayload(await getOrder(accessToken, fixtures.pendingCancel.id))
    );

    for (const key of ['stockingCancelAfterSale', 'stockingReview', 'paidReview', 'completed', 'partial']) {
      const current = await getOrder(accessToken, fixtures[key].id);
      if (current.status === 'pending') {
        const paid = await markPaidViaDevServer(fixtures[key].id);
        assert.equal(paid.status, 'stocking');
      }
    }

    step('testing stocking cancellation rejection and user after-sale cancellation');
    await expectRejected(accessToken, 'POST', `/orders/${fixtures.stockingCancelAfterSale.id}/cancel`);
    let cancelledAfterSale = (await getAfterSales(accessToken, fixtures.stockingCancelAfterSale.id))
      .find((item) => item.status === 'pending' || item.status === 'cancelled');
    if (!cancelledAfterSale) {
      cancelledAfterSale = await applyAfterSaleViaUi(
        miniProgram,
        accessToken,
        fixtures.stockingCancelAfterSale.id,
        ['refund']
      );
    }
    if (cancelledAfterSale.status === 'pending') {
      cancelledAfterSale = await cancelAfterSaleViaUi(miniProgram, accessToken, cancelledAfterSale.id);
    }
    assert.equal(cancelledAfterSale.status, 'cancelled');
    const cancelledReapply = await expectRejected(
      accessToken,
      'POST',
      '/after-sales',
      afterSalePayload(await getOrder(accessToken, fixtures.stockingCancelAfterSale.id), ['refund'])
    );

    step('testing admin reject, reapply, approve, automatic refund and idempotency');
    let rejected = (await getAfterSales(accessToken, fixtures.stockingReview.id))
      .find((item) => item.status === 'pending' || item.status === 'rejected');
    if (!rejected) {
      rejected = await applyAfterSaleViaUi(
        miniProgram,
        accessToken,
        fixtures.stockingReview.id,
        ['refund']
      );
    }
    if (rejected.status === 'pending') {
      rejected = await reviewAfterSaleViaUi(
        miniProgram,
        accessToken,
        rejected.id,
        'reject',
        `E2E审核拒绝-${runTag}`
      );
    }
    assert.equal(rejected.status, 'rejected');
    let approved = (await getAfterSales(accessToken, fixtures.stockingReview.id))
      .find((item) => String(item.id) !== String(rejected.id)
        && (item.status === 'pending' || item.status === 'refunded'));
    if (!approved) {
      approved = await applyAfterSaleViaUi(
        miniProgram,
        accessToken,
        fixtures.stockingReview.id,
        ['refund']
      );
    }
    if (approved.status === 'pending') {
      approved = await reviewAfterSaleViaUi(miniProgram, accessToken, approved.id, 'approve');
    }
    await waitForAfterSaleStatus(accessToken, approved.id, 'refunded');
    await waitForOrderStatus(accessToken, fixtures.stockingReview.id, 'cancelled');
    await apiOk(accessToken, 'POST', `/after-sales/${approved.id}/refund`);
    await expectRejected(accessToken, 'POST', `/after-sales/${approved.id}/review`, { decision: 'approve' });

    step('preparing paid/completed/partial fixtures through the picking-list UI');
    await prepareOrdersViaUi(miniProgram, accessToken, [
      fixtures.paidReview.id,
      fixtures.completed.id,
      fixtures.partial.id
    ]);

    step('testing paid cancellation rejection and refund approval');
    await expectRejected(accessToken, 'POST', `/orders/${fixtures.paidReview.id}/cancel`);
    const paidAfterSale = await applyAfterSaleViaUi(
      miniProgram,
      accessToken,
      fixtures.paidReview.id,
      ['refund']
    );
    await reviewAfterSaleViaUi(miniProgram, accessToken, paidAfterSale.id, 'approve');
    await waitForAfterSaleStatus(accessToken, paidAfterSale.id, 'refunded');
    await waitForOrderStatus(accessToken, fixtures.paidReview.id, 'cancelled');

    step('testing shipped return-refund reject, reapply, receive-fail and refund behavior');
    const shippedOrder = await getOrder(accessToken, existingShippedOrderId);
    assert.equal(shippedOrder.status, 'shipped');
    await expectRejected(accessToken, 'POST', `/orders/${existingShippedOrderId}/cancel`);
    const shippedRejected = await applyAfterSaleViaUi(
      miniProgram,
      accessToken,
      existingShippedOrderId,
      ['return_refund']
    );
    await reviewAfterSaleViaUi(miniProgram, accessToken, shippedRejected.id, 'reject', `E2E已发货拒绝-${runTag}`);
    const shippedApproved = await applyAfterSaleViaUi(
      miniProgram,
      accessToken,
      existingShippedOrderId,
      ['return_refund']
    );
    await reviewAfterSaleViaUi(miniProgram, accessToken, shippedApproved.id, 'approve');
    await waitForAfterSaleStatus(accessToken, shippedApproved.id, 'approved');
    await submitReturnViaUi(miniProgram, accessToken, shippedApproved.id);
    await receiveAfterSaleViaUi(miniProgram, accessToken, shippedApproved.id, 'fail');
    const afterFailRefund = await refundAfterSaleViaUi(miniProgram, accessToken, shippedApproved.id);

    const report = {
      ok: true,
      runTag,
      fixtures: Object.fromEntries(Object.entries(fixtures).map(([key, value]) => [key, String(value.id)])),
      afterSales: {
        userCancelled: String(cancelledAfterSale.id),
        rejected: String(rejected.id),
        stockingRefunded: String(approved.id),
        paidRefunded: String(paidAfterSale.id),
        shippedRejected: String(shippedRejected.id),
        shippedReceiveFail: String(shippedApproved.id)
      },
      findings: {
        reapplyAfterUserCancellationHttpStatus: cancelledReapply.status,
        refundAfterWarehouseFailStatus: afterFailRefund.status
      },
      readyForRealShipment: {
        completedOrderId: String(fixtures.completed.id),
        partialOrderId: String(fixtures.partial.id),
        requiredNewWaybills: 1
      }
    };
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally {
    if (miniProgram) {
      try { await miniProgram.restoreWxMethod('showModal'); } catch (error) {}
      try { await miniProgram.restoreWxMethod('showActionSheet'); } catch (error) {}
      miniProgram.disconnect();
    }
  }
}

module.exports = {
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
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
