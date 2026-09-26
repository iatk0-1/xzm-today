const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
let responses = [];
const queries = [];
let destination;

global.Page = config => { pageConfig = config; };
global.wx = {
  navigateTo(options) { destination = options.url; },
  showToast() {}
};

const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) {
    return {
      get: async (url, params) => {
        if (url === '/picking-list/recommend/search/query') {
          queries.push(params);
          return responses.shift();
        }
        return [];
      }
    };
  }
  if (request.endsWith('utils/auth')) return { ensureAuthenticated: async () => {} };
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
