const assert = require('node:assert/strict');
const config = require('../../utils/config');
const { connectDeveloperTools, disconnectDeveloperTools } = require('./devtools');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const withTimeout = (promise, milliseconds, label) => Promise.race([
  promise,
  delay(milliseconds).then(() => {
    throw new Error(`${label} timed out after ${milliseconds}ms`);
  })
]);

function step(message) {
  process.stdout.write(`[e2e] ${message}\n`);
}

async function verifyBackend() {
  const response = await fetch(config.API_BASE_URL + '/system/ping', {
    signal: AbortSignal.timeout(10000)
  });
  assert.equal(response.status, 200, 'dev backend ping must return HTTP 200');
  const body = await response.json();
  assert.equal(body.status, 'ok');
  return body;
}

async function run() {
  step('checking dev backend');
  const backend = await verifyBackend();
  let miniProgram;
  let cli;
  try {
    ({ miniProgram, cli } = await connectDeveloperTools());

    step('opening index page');
    const page = await withTimeout(
      miniProgram.reLaunch('/pages/index/index'),
      30000,
      'open index page'
    );
    assert.ok(page, 'index page must be created');
    await withTimeout(page.waitFor(8000), 15000, 'wait for index page data');

    step('reading index components and data');
    const container = await withTimeout(page.$('.container'), 10000, 'find index container');
    assert.ok(container, 'index page container must exist');

    const data = await withTimeout(page.data(), 15000, 'read index page data');
    assert.ok(Array.isArray(data.productList), 'productList must be an array');
    assert.ok(Array.isArray(data.leftColumn), 'leftColumn must be an array');
    assert.ok(Array.isArray(data.rightColumn), 'rightColumn must be an array');
    assert.ok(data.productList.length > 0, 'dev backend must return at least one product');

    step('tapping cart entry');
    const cartEntry = await withTimeout(page.$('.nav-cart-right'), 10000, 'find cart entry');
    assert.ok(cartEntry, 'cart entry must exist');
    await withTimeout(cartEntry.tap(), 10000, 'tap cart entry');
    await delay(2000);

    const cartPage = await withTimeout(miniProgram.currentPage(), 10000, 'read current cart page');
    assert.ok(cartPage, 'cart page must be created');
    assert.equal(cartPage.path, 'pages/cart/cart');
    const cartData = await withTimeout(cartPage.data(), 15000, 'read cart page data');
    const cartItems = Array.isArray(cartData.cartItems)
      ? cartData.cartItems
      : (Array.isArray(cartData.items) ? cartData.items : []);

    process.stdout.write(JSON.stringify({
      ok: true,
      backend: backend.service,
      route: page.path,
      productCount: data.productList.length,
      isAdmin: data.isAdmin === true,
      cartRoute: cartPage.path,
      cartItemCount: cartItems.length
    }) + '\n');
  } finally {
    disconnectDeveloperTools(miniProgram, cli);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
