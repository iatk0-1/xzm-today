const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
let getCost;
let putCost;
let toast;
const calls = [];
global.Page = value => { config = value; };
global.wx = { showToast: options => { toast = options.title; } };
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {
    get: async url => { calls.push({ method: 'GET', url }); return getCost(); },
    put: async (url, body) => { calls.push({ method: 'PUT', url, body }); return putCost(body); }
  };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/pickingList/pickingList.js');
Module._load = originalLoad;

const event = { currentTarget: { dataset: { index: 0 } } };
function page() {
  calls.length = 0;
  getCost = async () => ({ productId: '101', skuId: '9007199254740993', costPrice: '12.50' });
  putCost = async body => ({ productId: '101', skuId: '9007199254740993', ...body });
  const instance = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
  instance.setData = values => Object.assign(instance.data, values);
  const items = [
    { skuId: '9007199254740993', productId: '101', productName: '测试商品', costPrice: null, qty: '3', selected: true, recommendQty: 2 },
    { skuId: '22', productId: '202', costPrice: '10.00', qty: 2, selected: true, recommendQty: 2 }
  ];
  instance.data.recommendList = items;
  instance.data.filteredList = items;
  instance.data.pendingOrderList = items.map(item => ({ ...item }));
  instance.data.showOrderModal = true;
  instance.updateOrderPreview(items);
  return instance;
}

test('编辑读取当前SKU最新单价，取消不更改成本和报单数量', async () => {
  const instance = page();
  await instance.openCostModal(event);
  assert.equal(instance.data.costPriceInput, '12.50');
  assert.equal(calls[0].url, '/picking-list/skus/9007199254740993/cost');
  instance.onCostPriceInput({ detail: { value: '15.99' } });
  instance.closeCostModal();
  assert.equal(instance.data.showCostModal, false);
  assert.equal(instance.data.showOrderModal, true);
  assert.equal(instance.data.orderPreviewList[0].costPrice, null);
  assert.equal(instance.data.orderPreviewList[0].qty, '3');
  assert.equal(calls.length, 1);
});

test('未设置成本留空，保存持久化单价并同步列表、小计和总额', async () => {
  const instance = page();
  getCost = async () => ({ costPrice: null });
  await instance.openCostModal(event);
  assert.equal(instance.data.costPriceInput, '');
  instance.onCostPriceInput({ detail: { value: '19.90' } });
  await instance.saveOrderCost();
  assert.deepEqual(calls[1], { method: 'PUT', url: '/picking-list/skus/9007199254740993/cost', body: { costPrice: '19.90' } });
  assert.equal(instance.data.orderPreviewList[0].costSubtotal, '59.70');
  assert.equal(instance.data.totalCost, '79.70');
  assert.equal(instance.data.missingCostCount, 0);
  assert.equal(instance.data.totalQty, 5);
  assert.equal(instance.data.orderPreviewList[0].qty, '3');
  assert.equal(instance.data.pendingOrderList[0].costPrice, '19.90');
  assert.equal(instance.data.recommendList[0].costPrice, '19.90');
  assert.equal(instance.data.showCostModal, false);
  assert.equal(instance.data.showOrderModal, true);
  instance.toggleSelect(event);
  assert.equal(instance.data.recommendList[0].selected, false, '保存后勾选状态仍同步');
});

test('非法成本不发送保存请求，保存失败保留输入和原成本供重试', async () => {
  const instance = page();
  await instance.openCostModal(event);
  for (const value of ['', '0', '-1', '1.234', '1e2', '100000000', 'abc']) {
    instance.onCostPriceInput({ detail: { value } });
    await instance.saveOrderCost();
  }
  assert.equal(calls.length, 1);
  putCost = async () => { throw new Error('保存断网'); };
  instance.onCostPriceInput({ detail: { value: '20.50' } });
  await instance.saveOrderCost();
  assert.equal(instance.data.showCostModal, true);
  assert.equal(instance.data.costPriceInput, '20.50');
  assert.equal(instance.data.orderPreviewList[0].costPrice, null);
  assert.equal(instance.data.costSaving, false);
  assert.equal(toast, '保存断网');
});

test('加载失败可重试，关闭后到达的旧请求不覆盖新弹窗', async () => {
  const instance = page();
  getCost = async () => { throw new Error('加载断网'); };
  await instance.openCostModal(event);
  assert.ok(instance.data.costLoadError);
  await instance.saveOrderCost();
  assert.equal(calls.length, 1);
  let resolveOld;
  getCost = () => new Promise(resolve => { resolveOld = resolve; });
  const oldRequest = instance.loadEditingCost();
  instance.closeCostModal();
  getCost = async () => ({ costPrice: '99.00' });
  await instance.openCostModal({ currentTarget: { dataset: { index: 1 } } });
  resolveOld({ costPrice: '1.00' });
  await oldRequest;
  assert.equal(instance.data.costPriceInput, '99.00');
  assert.equal(instance.data.costEditingItem.skuId, '22');
  assert.equal(instance.data.costLoading, false);
});

test('保存中阻止重复保存和关闭，底层报单弹窗不响应提交', async () => {
  const instance = page();
  await instance.openCostModal(event);
  let finish;
  putCost = body => new Promise(resolve => { finish = () => resolve({ ...body }); });
  const saving = instance.saveOrderCost();
  instance.closeCostModal();
  instance.hideOrderModal();
  await instance.confirmOrder();
  await instance.saveOrderCost();
  assert.equal(instance.data.showCostModal, true);
  assert.equal(instance.data.showOrderModal, true);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  finish();
  await saving;
});
