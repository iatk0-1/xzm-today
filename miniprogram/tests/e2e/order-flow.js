const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const automator = require('miniprogram-automator');
const config = require('../../utils/config');

const execFileAsync = promisify(execFile);
const wsEndpoint = `ws://127.0.0.1:${Number(process.env.WECHAT_DEVTOOLS_PORT || 9420)}`;
const productId = process.env.E2E_PRODUCT_ID || '329866983975686144';
const sshKey = process.env.XZM_DEV_SSH_KEY || path.join(process.env.USERPROFILE, '.ssh', 'xzm_dev.pem');
const sshTarget = process.env.XZM_DEV_SSH_TARGET || 'root@101.34.57.84';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const withTimeout = (promise, milliseconds, label) => Promise.race([
  promise,
  delay(milliseconds).then(() => {
    throw new Error(`${label} timed out after ${milliseconds}ms`);
  })
]);

function step(message) {
  process.stdout.write(`[e2e-order] ${message}\n`);
}

async function listOrders(accessToken) {
  const response = await fetch(config.API_BASE_URL + '/orders?page=1&size=50', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000)
  });
  assert.equal(response.status, 200, 'order list must return HTTP 200');
  const body = await response.json();
  return Array.isArray(body.items) ? body.items : [];
}

async function waitForNewOrder(accessToken, existingOrderIds) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const orders = await listOrders(accessToken);
    const created = orders.find((order) => !existingOrderIds.has(String(order.id)));
    if (created) return created;
    await delay(1000);
  }
  throw new Error('new order did not appear within 30 seconds');
}

async function markPaidViaDevServer(orderId) {
  const remoteCommand = [
    'set -e',
    "e2e_key=$(sed -n 's/^APP_E2E_KEY=//p' /data/start.env | tail -n 1)",
    `curl -fsS -X POST -H "X-E2E-Key: \${e2e_key}" `
      + `http://127.0.0.1:8080/internal/e2e/orders/${orderId}/mark-paid`
  ].join('; ');
  const { stdout } = await execFileAsync('ssh.exe', [
    '-i', sshKey,
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=15',
    sshTarget,
    remoteCommand
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}

async function run() {
  assert.equal(
    process.env.E2E_ALLOW_MUTATION,
    'true',
    'set E2E_ALLOW_MUTATION=true explicitly before creating a dev order'
  );

  let miniProgram;
  try {
    step('connecting to WeChat Developer Tools');
    miniProgram = await withTimeout(
      automator.connect({ wsEndpoint }),
      10000,
      'connect automation endpoint'
    );

    const userInfo = await miniProgram.callWxMethod('getStorageSync', config.USER_INFO_KEY);
    const accessToken = await miniProgram.callWxMethod('getStorageSync', config.TOKEN_KEY);
    assert.ok(userInfo && userInfo.userId, 'logged-in userInfo is required');
    assert.equal(userInfo.isPhoneBound, true, 'test account must have a bound phone');
    assert.ok(accessToken, 'access token is required');

    await miniProgram.mockWxMethod('chooseAddress', function chooseAddress(options) {
      const result = {
        errMsg: 'chooseAddress:ok',
        userName: 'E2E测试用户',
        telNumber: '13000000000',
        provinceName: '浙江省',
        cityName: '杭州市',
        countyName: '钱塘区',
        detailInfo: 'E2E自动化测试地址',
        postalCode: '310000',
        nationalCode: '510000'
      };
      if (options && options.success) options.success(result);
      if (options && options.complete) options.complete(result);
      return result;
    });
    await miniProgram.mockWxMethod('requestPayment', function requestPayment(options) {
      const result = { errMsg: 'requestPayment:ok' };
      if (options && options.success) options.success(result);
      if (options && options.complete) options.complete(result);
      return result;
    });

    const beforeOrders = await listOrders(accessToken);
    const existingOrderIds = new Set(beforeOrders.map((order) => String(order.id)));

    step(`opening product ${productId}`);
    const detailPage = await miniProgram.reLaunch(`/pages/detail/detail?id=${productId}`);
    assert.ok(detailPage, 'product detail page must be created');
    await detailPage.waitFor(5000);

    const detailData = await detailPage.data();
    assert.equal(String(detailData.product.id), String(productId));
    assert.equal(detailData.product.productType, 'normal');

    const buyButton = await detailPage.$('.btn-buy-half');
    assert.ok(buyButton, 'buy button must exist');
    await buyButton.tap();
    await delay(500);

    let skuSections = await detailPage.$$('.sku-section');
    if (detailData.uniqueColors.length > 0) {
      const colorOptions = await skuSections[0].$$('.sku-tag');
      assert.ok(colorOptions.length > 0, 'at least one color option is required');
      await colorOptions[0].tap();
      await delay(300);
    }
    if (detailData.uniqueSizes.length > 0) {
      skuSections = await detailPage.$$('.sku-section');
      const sizeSectionIndex = detailData.uniqueColors.length > 0 ? 1 : 0;
      const sizeOptions = await skuSections[sizeSectionIndex].$$('.sku-tag');
      assert.ok(sizeOptions.length > 0, 'at least one size option is required');
      await sizeOptions[0].tap();
      await delay(300);
    }

    const selectedSku = await detailPage.data();
    assert.ok(selectedSku.currentSkuId, 'a purchasable SKU must be selected');
    assert.equal(Number(selectedSku.currentSkuPrice).toFixed(2), '0.01');

    const confirmBuy = await detailPage.$('.sku-btn-buy');
    assert.ok(confirmBuy, 'SKU buy button must exist');
    await confirmBuy.tap();
    await delay(3000);

    const checkoutPage = await miniProgram.currentPage();
    assert.equal(checkoutPage.path, 'pages/checkout/checkout');
    const checkoutBeforeAddress = await checkoutPage.data();
    assert.equal(checkoutBeforeAddress.totalPrice, '0.01');

    step('choosing mocked address');
    const addressEntry = await checkoutPage.$('.address-section');
    assert.ok(addressEntry, 'address selector must exist');
    await addressEntry.tap();
    await delay(500);
    const checkoutData = await checkoutPage.data();
    assert.ok(checkoutData.address, 'mocked address must be stored on page');

    step('creating order and preparing real WeChat prepay parameters');
    const payButton = await checkoutPage.$('.btn-pay');
    assert.ok(payButton, 'pay button must exist');
    await payButton.tap();

    const createdOrder = await waitForNewOrder(accessToken, existingOrderIds);
    assert.equal(Number(createdOrder.payAmount).toFixed(2), '0.01');

    step(`marking order ${createdOrder.id} paid through guarded E2E endpoint`);
    const paid = await markPaidViaDevServer(createdOrder.id);
    assert.ok(['stocking', 'paid'].includes(paid.status));
    assert.equal(paid.payChannel, 'e2e_manual');

    const orderPage = await miniProgram.reLaunch(`/pages/orderDetail/orderDetail?id=${createdOrder.id}`);
    assert.ok(orderPage, 'order detail page must be created');
    await orderPage.waitFor(4000);
    const orderData = await orderPage.data();
    assert.ok(orderData.order, 'order detail must be loaded');
    assert.ok(['stocking', 'paid'].includes(orderData.order.status));

    process.stdout.write(JSON.stringify({
      ok: true,
      orderId: String(createdOrder.id),
      amount: createdOrder.payAmount,
      status: orderData.order.status,
      payChannel: paid.payChannel,
      userId: String(userInfo.userId),
      productId: String(productId)
    }) + '\n');
  } finally {
    if (miniProgram) {
      try { await miniProgram.restoreWxMethod('chooseAddress'); } catch (error) {}
      try { await miniProgram.restoreWxMethod('requestPayment'); } catch (error) {}
      miniProgram.disconnect();
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
