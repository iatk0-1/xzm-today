const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const eligibility = require('../../utils/afterSaleEligibility');

function order(status = 'paid', applicationCount = 0) {
  return { id: '10', status, items: [{ id: '30', qty: 2, salePrice: 10 }],
    afterSaleSummary: { applicationCount } };
}

function harness(name, response = order()) {
  let config;
  const modals = [], navigations = [], reads = [];
  const filename = path.resolve(__dirname, '../../pages', name, name + '.js');
  const api = { get: async url => {
    reads.push(url);
    return url === '/orders/query' ? { content: [response] } : response;
  } };
  const wx = { showLoading() {}, hideLoading() {}, showToast() {},
    showModal: options => modals.push(options), navigateTo: options => navigations.push(options), navigateBack() {} };
  // 公共工具在当前测试进程运行，页面脚本在隔离上下文运行。
  global.wx = wx;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { config = value; }, wx, console, setTimeout: () => {}, clearTimeout() {},
    require(request) {
      if (request.endsWith('/api')) return api;
      if (request.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (request.endsWith('/pageSync')) return { wrap: value => value,
        updateList: async (page, changes, options) => page.setData({ orders: [options.normalize(response)] }) };
      if (request.endsWith('/skuPromotionDisplay')) return {
        orderAmounts: () => ({}), orderItemPrices: value => value.items, discountRows: () => [] };
      if (request.endsWith('/customerServiceOrder')) return { orderCard: () => ({}) };
      return require(path.resolve(path.dirname(filename), request));
    }
  });
  const page = { ...config, data: structuredClone(config.data),
    setData(patch) { Object.assign(this.data, patch); } };
  if (name === 'orderDetail') {
    page.loadAfterSaleRecords = () => {};
    page.loadChangeRequests = () => {};
    page.loadShipmentInfo = () => {};
    page.stopCountdown = () => {};
  }
  return { page, modals, navigations, reads };
}

test('已发货、已完成和未付款订单隐藏入口，部分发货保留入口', () => {
  for (const status of ['shipped', 'completed', 'pending', 'cancelled']) {
    assert.equal(eligibility.applicationState(order(status)).afterSaleVisible, false);
  }
  for (const status of ['stocking', 'paid', 'partial_shipped']) {
    assert.equal(eligibility.applicationState(order(status)).afterSaleVisible, true);
  }
});

for (const name of ['orderList', 'orderDetail']) {
  for (const count of [0, 1, 2, 3]) {
    test(`${name} 累计${count}次申请时正确跳转或弹出次数用尽提示`, () => {
      const env = harness(name);
      const value = order('paid', count);
      env.page.data[name === 'orderList' ? 'orders' : 'order'] = name === 'orderList' ? [value] : value;
      env.page.requestRefund({ currentTarget: { dataset: { id: '10' } } });
      assert.equal(env.navigations.length, count < 2 ? 1 : 0);
      assert.equal(env.modals.length, count >= 2 ? 1 : 0);
      if (count >= 2) assert.equal(env.modals[0].content, '售后次数已用尽，请联系客服协商处理');
    });
  }

  test(`${name} 加载订单时携带置灰状态`, async () => {
    const env = harness(name, order('paid', 2));
    if (name === 'orderList') await env.page.loadOrders();
    else await env.page.loadOrderDetail('10');
    const value = name === 'orderList' ? env.page.data.orders[0] : env.page.data.order;
    assert.equal(value.afterSaleVisible, true);
    assert.equal(value.afterSaleExhausted, true);
  });

  test(`${name} 已发货订单即使直接触发点击也不进入申请页`, () => {
    const env = harness(name);
    const value = order('shipped');
    env.page.data[name === 'orderList' ? 'orders' : 'order'] = name === 'orderList' ? [value] : value;
    env.page.requestRefund({ currentTarget: { dataset: { id: '10' } } });
    assert.equal(env.navigations.length, 0);
    assert.match(env.modals[0].content, /订单已发货/);
  });
}

test('订单列表同步更新后，第二次申请立即使按钮置灰', async () => {
  const env = harness('orderList', order('paid', 2));
  env.page.data.orders = [order('paid', 1)];
  await env.page.refreshOrder('10');
  assert.equal(env.page.data.orders[0].afterSaleExhausted, true);
});

for (const value of [order('shipped'), order('completed'), order('paid', 2)]) {
  test(`直接打开申请页拦截 ${value.status} / ${value.afterSaleSummary.applicationCount}次`, async () => {
    const env = harness('afterSaleApply', value);
    await env.page.loadOrderDetail('10');
    assert.equal(env.modals.length, 1);
    assert.equal(env.modals[0].content, eligibility.blockedMessage(value));
    assert.deepEqual(env.reads, ['/orders/10?flat=true']);
    assert.equal(env.page.data.selectedItems.length, 0);
  });
}
