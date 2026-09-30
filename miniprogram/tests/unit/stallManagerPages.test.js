const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const requests = [];
let pageConfig;
global.Page = config => { pageConfig = config; };
global.wx = { showLoading() {}, hideLoading() {}, showToast() {}, stopPullDownRefresh() {} };

const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/auth')) return {
    ensureAuthenticated: async () => {}, isStallManager: () => true
  };
  if (request.endsWith('utils/api')) return {
    get: async (url, params) => {
      requests.push({ url, params });
      if (url === '/stall-managers/stalls/mine') return [
        { id: '2', name: '二号档口' }, { id: '3', name: '三号档口' }
      ];
      if (url === '/products/query' || url === '/admin/sales/query/products') {
        return { content: [], totalElements: 0, hasNext: false };
      }
      if (url === '/admin/sales/query/overview') return {};
      return [];
    }
  };
  return originalLoad.call(this, request, ...args);
};

function createPage(path) {
  delete require.cache[require.resolve(path)];
  require(path);
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  return page;
}

test('负责人商品管理只请求自己的商品和已分配档口', async () => {
  requests.length = 0;
  const page = createPage('../../pages/adminProduct/adminProduct.js');
  page.onLoad();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(requests.some(item => item.url === '/stall-managers/stalls/mine'));
  assert.ok(requests.some(item => item.url === '/products/query' && item.params.manage === true));
  assert.deepEqual(page.data.stallList.map(item => item.id), ['2', '3']);
});

test('负责人销售数据默认汇总所有已分配档口，且不请求全站概览', async () => {
  requests.length = 0;
  const page = createPage('../../pages/adminSales/adminSales.js');
  await page.onLoad();
  assert.equal(requests.some(item => item.url === '/admin/sales/overview'), false);
  assert.ok(requests.some(item => item.url === '/admin/sales/query/products' && !item.params.stallId));
  assert.ok(requests.some(item => item.url === '/admin/sales/query/overview' && !item.params.stallId));
});

test.after(() => { Module._load = originalLoad; });
