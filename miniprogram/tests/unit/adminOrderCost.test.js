const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
let getCost;
let putCost;
let getPricing;
let toast;
const calls = [];
const api = {
  get: async url => {
    calls.push({ method: 'GET', url });
    return url.endsWith('/pricing') ? getPricing() : getCost(url);
  },
  put: async (url, body) => {
    calls.push({ method: 'PUT', url, body });
    return putCost(url, body);
  },
  patch: async (url, body) => { calls.push({ method: 'PATCH', url, body }); }
};
global.Page = value => { config = value; };
global.wx = { showToast: options => { toast = options.title; } };
const originalLoad = Module._load;
try {
  Module._load = function(request, ...args) {
    if (request.endsWith('utils/api')) return api;
    if (request.endsWith('utils/auth')) return {};
    return originalLoad.call(this, request, ...args);
  };
  require('../../pages/adminOrderDetail/adminOrderDetail');
} finally {
  Module._load = originalLoad;
}

const event = index => ({ currentTarget: { dataset: { index } } });
function page(items) {
  calls.length = 0;
  toast = '';
  getCost = async () => ({ costPrice: null });
  putCost = async (url, body) => ({ ...body });
  getPricing = async () => ({ costAmount: '30.00', costComplete: true, revision: '99', onlineAmount: '999' });
  const instance = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
  instance.setData = values => Object.assign(instance.data, values);
  Object.assign(instance.data, {
    showPricePanel: true, orderId: '123',
    order: { payAmount: '100.00', goodsAmount: '90.00', shippingFee: '10.00',
      items: items || [{ skuId: '9007199254740993', productName: '上衣', productSpec: '红色', productSize: 'M' }] },
    pricing: { revision: '2', costAmount: '0', costComplete: false, items: [{ settlementAmount: '90.00' }] },
    priceDraft: { revision: '2', onlineAmount: '100.00', offlineAmount: '0', shippingFee: '10.00',
      reason: '已填写的改价原因', offlineMethod: '银行转账', offlineNote: '保留备注', peerOrder: false }
  });
  return instance;
}
function edit(instance, index, value) {
  instance.editOrderCost(event(index));
  instance.onOrderCostInput({ ...event(index), detail: { value } });
}

test('读取订单SKU当前成本，缺成本点击后输入，关闭不保存且保留改价草稿', async () => {
  const instance = page();
  const before = structuredClone(instance.data.priceDraft);
  await instance.openOrderCostPanel();
  assert.equal(calls[0].url, '/picking-list/skus/9007199254740993/cost');
  assert.equal(instance.data.orderCostRows[0].costPrice, null);
  assert.equal(instance.data.orderCostRows[0].editing, false);
  assert.equal(instance.data.orderCostRows[0].input, '');
  edit(instance, 0, '19.90');
  assert.equal(instance.data.orderCostRows[0].editing, true);
  instance.closeOrderCostPanel();
  assert.equal(instance.data.showCostPanel, false);
  assert.equal(instance.data.showPricePanel, true);
  assert.deepEqual(instance.data.priceDraft, before);
  assert.equal(calls.length, 1);
});

test('列出普通商品、旧套装和新套装的子SKU，同一SKU只维护一次且长ID不丢精度', async () => {
  const instance = page([
    { skuId: '1', productName: '单品', productSpec: '白', productSize: 'M' },
    { skuId: '1', productName: '单品重复' },
    { skuId: '999', productName: '旧套装', bundleConfig: [
      { skuId: '9007199254740993', bundleGroupName: '上衣', color: '红', size: 'L', count: 2 },
      { skuId: '3', bundleGroupName: '裤子', color: '黑', size: 'M', count: 1 }
    ] },
    { skuId: '4', productName: '新套装子项', bundleProductName: '新套装', bundleConfig: [
      { skuId: '4', bundleGroupName: '外套', color: '蓝', size: 'S', count: 3 }
    ] }
  ]);
  getCost = async () => ({ costPrice: '12.50' });
  await instance.openOrderCostPanel();
  assert.deepEqual(instance.data.orderCostRows.map(row => row.skuId), ['1', '9007199254740993', '3', '4']);
  assert.equal(instance.data.orderCostRows[1].spec, '上衣 / 红 / L');
  assert.equal(instance.data.orderCostRows[3].productName, '新套装');
  assert.equal(instance.data.orderCostRows[0].costDisplay, '12.50');
  assert.equal(calls.length, 4);
});

test('保存只调用SKU成本接口和成本预览，不提交改价、不覆盖订单或改价草稿', async () => {
  const instance = page();
  const draft = structuredClone(instance.data.priceDraft);
  const order = structuredClone(instance.data.order);
  const pricingItems = structuredClone(instance.data.pricing.items);
  await instance.openOrderCostPanel();
  edit(instance, 0, '30');
  await instance.saveOrderCosts();
  assert.deepEqual(calls.slice(1), [
    { method: 'PUT', url: '/picking-list/skus/9007199254740993/cost', body: { costPrice: '30.00' } },
    { method: 'GET', url: '/admin/orders-manage/orders/123/pricing' }
  ]);
  assert.deepEqual(instance.data.order, order);
  assert.deepEqual(instance.data.priceDraft, draft);
  assert.deepEqual(instance.data.pricing.items, pricingItems);
  assert.equal(instance.data.pricing.revision, '2');
  assert.equal(instance.data.pricing.costAmount, '30.00');
  assert.equal(instance.data.pricing.costComplete, true);
  assert.equal(instance.data.pricePreview.valid, true);
  assert.equal(instance.data.pricePreview.total, '100.00');
  assert.equal(instance.data.showCostPanel, false);
  assert.equal(instance.data.showPricePanel, true);
});

test('保存前校验所有编辑行，非法成本不发请求，支持成本上限和两位小数', async () => {
  const instance = page();
  await instance.openOrderCostPanel();
  for (const value of ['', '0', '-1', '1.234', '1e2', '100000000', 'NaN']) {
    edit(instance, 0, value);
    await instance.saveOrderCosts();
    assert.match(toast, /成本须大于0/);
  }
  assert.equal(calls.length, 1);
  edit(instance, 0, '99999999.99');
  await instance.saveOrderCosts();
  assert.equal(calls[1].body.costPrice, '99999999.99');
});

test('多行有一行非法时，前面合法的行也不会提前保存', async () => {
  const instance = page([{ skuId: '1' }, { skuId: '2' }]);
  await instance.openOrderCostPanel();
  edit(instance, 0, '12');
  edit(instance, 1, '0');
  await instance.saveOrderCosts();
  assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
});

test('同值成本不重复保存', async () => {
  const instance = page();
  getCost = async () => ({ costPrice: '12.5' });
  await instance.openOrderCostPanel();
  edit(instance, 0, '12.50');
  await instance.saveOrderCosts();
  assert.equal(calls.length, 1);
  assert.equal(instance.data.showCostPanel, false);
});

test('部分保存失败保留未保存输入，重试只提交失败行，成本汇总仍刷新', async () => {
  const instance = page([{ skuId: '1' }, { skuId: '2' }]);
  await instance.openOrderCostPanel();
  edit(instance, 0, '12');
  edit(instance, 1, '18');
  putCost = async (url, body) => {
    if (url.includes('/2/')) throw new Error('第二行保存断网');
    return body;
  };
  await instance.saveOrderCosts();
  assert.equal(instance.data.orderCostRows[0].editing, false);
  assert.equal(instance.data.orderCostRows[0].costPrice, '12.00');
  assert.equal(instance.data.orderCostRows[1].editing, true);
  assert.equal(instance.data.orderCostRows[1].input, '18');
  assert.equal(instance.data.showCostPanel, true);
  assert.equal(instance.data.costSummaryStale, false);
  assert.equal(calls.at(-1).url, '/admin/orders-manage/orders/123/pricing');
  putCost = async (url, body) => body;
  await instance.saveOrderCosts();
  assert.equal(calls.filter(call => call.method === 'PUT' && call.url.includes('/1/')).length, 1);
  assert.equal(calls.filter(call => call.method === 'PUT' && call.url.includes('/2/')).length, 2);
  assert.equal(instance.data.showCostPanel, false);
});

test('保存后汇总刷新失败阻止改价，重试只刷新汇总、不重复保存SKU', async () => {
  const instance = page();
  await instance.openOrderCostPanel();
  edit(instance, 0, '30');
  getPricing = async () => { throw new Error('汇总断网'); };
  await instance.saveOrderCosts();
  assert.equal(instance.data.costSummaryStale, true);
  assert.equal(instance.data.showCostPanel, true);
  instance.closeOrderCostPanel();
  await instance.savePrice();
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
  await instance.openOrderCostPanel();
  getPricing = async () => ({ costAmount: '30', costComplete: true });
  await instance.saveOrderCosts();
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  assert.equal(instance.data.costSummaryStale, false);
  assert.equal(instance.data.showCostPanel, false);
});

test('成本刷新后重新校验下限，成本未补齐或超过成交额时仍禁止改价', async () => {
  const instance = page();
  getPricing = async () => ({ costAmount: '30', costComplete: false });
  await instance.refreshPriceCosts();
  assert.equal(instance.data.pricePreview.valid, false);
  assert.match(instance.data.pricePreview.error, /快捷设置商品成本/);
  getPricing = async () => ({ costAmount: '100', costComplete: true });
  await instance.refreshPriceCosts();
  assert.match(instance.data.pricePreview.error, /不能低于商品成本/);
});

test('加载失败展示错误，重试保留其他行的编辑内容', async () => {
  const instance = page([{ skuId: '1' }, { skuId: '2' }]);
  getCost = async url => {
    if (url.includes('/2/')) throw new Error('成本加载断网');
    return { costPrice: '12.00' };
  };
  await instance.openOrderCostPanel();
  assert.equal(instance.data.orderCostRows[1].loadError, '成本加载断网');
  instance.editOrderCost(event(1));
  assert.equal(instance.data.orderCostRows[1].editing, false);
  edit(instance, 0, '20');
  getCost = async () => ({ costPrice: '18.00' });
  await instance.loadOrderCosts();
  assert.equal(instance.data.orderCostRows[0].input, '20');
  assert.equal(instance.data.orderCostRows[0].editing, true);
  assert.equal(instance.data.orderCostRows[1].costPrice, '18.00');
  assert.equal(calls.filter(call => call.url.includes('/1/')).length, 1);
});

test('关闭后到达的旧加载结果不覆盖重新打开的成本弹窗', async () => {
  const instance = page();
  let resolveOld;
  getCost = () => new Promise(resolve => { resolveOld = resolve; });
  const old = instance.openOrderCostPanel();
  instance.closeOrderCostPanel();
  getCost = async () => ({ costPrice: '99.00' });
  await instance.openOrderCostPanel();
  resolveOld({ costPrice: '1.00' });
  await old;
  assert.equal(instance.data.orderCostRows[0].costPrice, '99.00');
  assert.equal(instance.data.orderCostLoading, false);
});

test('保存中阻止重复请求、关闭弹窗、改输入和提交订单改价', async () => {
  const instance = page();
  await instance.openOrderCostPanel();
  edit(instance, 0, '30');
  let resolveSave;
  putCost = () => new Promise(resolve => { resolveSave = resolve; });
  const saving = instance.saveOrderCosts();
  await instance.saveOrderCosts();
  instance.closeOrderCostPanel();
  instance.closePricePanel();
  edit(instance, 0, '999');
  await instance.savePrice();
  assert.equal(instance.data.orderCostRows[0].input, '30');
  assert.equal(instance.data.showCostPanel, true);
  assert.equal(instance.data.showPricePanel, true);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
  resolveSave({ costPrice: '30.00' });
  await saving;
  assert.equal(instance.data.orderCostSaving, false);
  assert.equal(instance.data.showCostPanel, false);
});
