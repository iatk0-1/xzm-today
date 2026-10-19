const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
let responses = [];
const queries = [];
let destination;
let preview;
let toast;
let managedProduct;

global.Page = config => { pageConfig = config; };
global.wx = {
  navigateTo(options) { destination = options.url; },
  previewImage(options) { preview = options; },
  showToast(options) { toast = options.title; }
};

const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) {
    return {
      get: async (url, params) => {
        if (url.includes('?manage=true')) return managedProduct;
        if (url === '/picking-list/recommend/search/query') {
          queries.push(params);
          return responses.shift();
        }
        return [];
      }
    };
  }
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {}, isStallManager: () => false };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/pickingList/pickingList.js');
Module._load = originalLoad;

test('从关联订单列表返回后保留推荐列表、勾选和已加载页码', async () => {
  responses = [
    { content: [{ skuId: 11, productName: '商品一', recommendQty: 2 }], hasNext: true },
    { content: [{ skuId: 22, productName: '商品二', recommendQty: 3 }], hasNext: false }
  ];
  queries.length = 0;
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch);
    if (callback) callback();
  };

  page.onLoad();
  await new Promise(resolve => setImmediate(resolve));
  await page.loadRecommendations(false);
  page.toggleSelect({ currentTarget: { dataset: { index: 1 } } });
  page.goToRelatedOrders({ currentTarget: { dataset: { index: 1 } } });

  assert.match(destination, /skuId=22/);
  await page.onShow();
  page.onUnload();
  assert.deepEqual(page.data.recommendList.map(item => item.skuId), [11, 22]);
  assert.equal(page.data.page, 3);
  assert.equal(page.data.selectedCount, 1);
  assert.deepEqual(queries.map(params => params.page), [1, 2]);
});

test('报单弹窗按预览列表索引预览图片并打开正确商品编辑页', async () => {
  const page = { ...pageConfig, data: JSON.parse(JSON.stringify(pageConfig.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  page.data.filteredList = [
    { skuId: '1', productId: '100', selected: false, recommendQty: 2, imageUrl: 'https://example.com/other.jpg' },
    { skuId: '2', productId: '9007199254740993', selected: true, recommendQty: 3, imageUrl: 'https://example.com/selected.jpg' }
  ];
  page.data.recommendList = page.data.filteredList;
  await page.createPurchaseOrder();
  const event = { currentTarget: { dataset: { index: 0 } } };
  page.previewOrderProductImage(event);
  assert.equal(preview.current, 'https://example.com/selected.jpg');
  assert.deepEqual(preview.urls, ['https://example.com/selected.jpg']);
  page.editOrderProduct(event);
  assert.equal(destination, '/pages/admin/admin?editId=9007199254740993');
  assert.equal(page.data.showOrderModal, true);
  page.data.orderPreviewList[0].imageUrl = '';
  page.data.orderPreviewList[0].defaultImageUrl = 'https://example.com/cover.jpg';
  page.previewOrderProductImage(event);
  assert.equal(preview.current, 'https://example.com/cover.jpg');
  page.data.orderPreviewList[0].defaultImageUrl = '/images/default-goods-image.png';
  page.previewOrderProductImage(event);
  assert.equal(toast, '暂无可预览图片');
});

test('商品编辑保存返回后同步成本和图片，保留弹窗数量及其他商品', async () => {
  const page = { ...pageConfig, data: JSON.parse(JSON.stringify(pageConfig.data)) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  page.loadFilterOptions = () => {};
  page.loadRecommendations = () => {};
  page.onLoad();
  page.data.recommendList = [
    { skuId: '11', productId: '101', selected: true, recommendQty: 2, costPrice: null },
    { skuId: '12', productId: '101', selected: true, recommendQty: 1, costPrice: null },
    { skuId: '22', productId: '202', selected: true, recommendQty: 1, costPrice: '10.00' }
  ];
  page.data.filteredList = page.data.recommendList;
  await page.createPurchaseOrder();
  page.setOrderQty(0, '5');
  managedProduct = { product: { id: '101', name: '修改后的商品', coverUrl: 'https://example.com/new.jpg' },
    costPrice: '20.00', skus: [{ id: '11', spec: '红', size: 'M', costPrice: '12.50' },
      { id: '12', spec: '蓝', size: 'L', costPrice: null }] };
  require('../../utils/pageSync').publish('products', '101');
  await page.onShow();
  assert.equal(page.data.orderPreviewList[0].qty, '5');
  assert.equal(page.data.orderPreviewList[0].costSubtotal, '62.50');
  assert.equal(page.data.orderPreviewList[1].costSubtotal, '20.00');
  assert.equal(page.data.orderPreviewList[0].productName, '修改后的商品');
  assert.equal(page.data.orderPreviewList[0].defaultImageUrl, 'https://example.com/new.jpg');
  assert.equal(page.data.totalCost, '92.50');
  assert.equal(page.data.totalQty, 7);
  assert.equal(page.data.selectedCount, 3);
  assert.equal(page.data.missingCostCount, 0);
  assert.equal(page.data.recommendList[0].selected, true);
  assert.equal(page.data.showOrderModal, true);
  page.onUnload();
});

test('待报列表跨档口标签搜索保留待报单，恢复勾选和数量，取消全选只影响可见行', async () => {
  const page = { ...pageConfig, data: JSON.parse(JSON.stringify(pageConfig.data)) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  responses = [
    { content: [{ skuId: '9007199254740993', recommendQty: 2, costPrice: 10 }], hasNext: false },
    { content: [{ skuId: '2', recommendQty: 3, costPrice: 20 }], hasNext: false },
    { content: [{ skuId: '9007199254740993', recommendQty: 4, costPrice: 15 }], hasNext: false },
    { content: [], hasNext: false }
  ];
  await page.loadRecommendations();
  page.toggleSelect({ currentTarget: { dataset: { index: 0 } } });
  await page.createPurchaseOrder();
  page.setOrderQty(0, '7');
  page.hideOrderModal();
  page.setData({ selectedStall: '2', selectedTag: '3', skuKeyword: '棉袄' });
  await page.loadRecommendations();
  assert.equal(page.data.selectedCount, 1);
  assert.equal(page.data.totalQty, 7);
  assert.equal(page.data.recommendList[0].selected, false);
  page.toggleSelectAll();
  assert.equal(page.data.selectedCount, 2);
  assert.equal(page.data.totalQty, 10);
  await page.createPurchaseOrder();
  assert.deepEqual(page.data.orderPreviewList.map(item => [item.skuId, item.qty]), [['9007199254740993', 7], ['2', 3]]);
  assert.equal(page.data.totalCost, '130.00');
  page.hideOrderModal();
  page.setData({ selectedStall: '', selectedTag: '', skuKeyword: '' });
  await page.loadRecommendations();
  assert.equal(page.data.recommendList[0].selected, true);
  assert.equal(page.data.selectedCount, 2);
  assert.equal(page.data.totalQty, 10, '推荐数量变化不覆盖待报单已编辑的数量');
  await page.createPurchaseOrder();
  assert.equal(page.data.totalCost, '165.00', '恢复行使用最新商品成本');
  page.hideOrderModal();
  page.toggleSelectAll();
  assert.deepEqual(page.data.pendingOrderList.map(item => item.skuId), ['2']);
  await page.loadRecommendations();
  assert.equal(page.data.recommendList.length, 0);
  assert.equal(page.data.selectedCount, 1);
  await page.createPurchaseOrder();
  assert.equal(page.data.orderPreviewList[0].skuId, '2');
});

test('快速切换待报筛选仅采用最新响应，已有待报单不被慢响应清空', async () => {
  const page = { ...pageConfig, data: JSON.parse(JSON.stringify(pageConfig.data)) };
  page.setData = patch => Object.assign(page.data, patch);
  page.data.filteredList = [{ skuId: '1', selected: true, recommendQty: 5 }];
  page.data.recommendList = page.data.filteredList;
  let finishOld;
  responses = [new Promise(resolve => { finishOld = resolve; }),
    { content: [{ skuId: '3', recommendQty: 2 }], hasNext: false }];
  const oldRequest = page.loadRecommendations();
  await new Promise(resolve => setImmediate(resolve));
  page.setData({ selectedTag: '3' });
  await page.loadRecommendations();
  finishOld({ content: [{ skuId: '2', recommendQty: 1 }], hasNext: true });
  await oldRequest;
  assert.deepEqual(page.data.recommendList.map(item => item.skuId), ['3']);
  assert.deepEqual(page.data.pendingOrderList.map(item => item.skuId), ['1']);
  assert.equal(page.data.totalQty, 5);
  assert.equal(page.data.loading, false);
});
