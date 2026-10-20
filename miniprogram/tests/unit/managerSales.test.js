const test = require('node:test');
const assert = require('node:assert/strict');
const createSalesPage = require('../../utils/salesPage');
const autoSearch = require('../../utils/autoSearch');
const { getErrorMessage } = require('../../utils/error');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const managerId = '9007199254740993';
const base = '/admin/sales/managers/' + managerId;

function harness(get) {
  const requests = [], routes = [];
  const api = { async get(url, params) {
    requests.push({ url, params });
    if (get) return get(url, params);
    if (url.endsWith('/stalls')) return [{ id: '2', name: '二号档口' }];
    if (url === base + '/tags') return [{ id: '3', name: '秋装' }];
    if (url.endsWith('/query/products')) return { content: [], totalElements: 0 };
    return { soldQty: 8, salesCommission: '12.34', refundedCommission: '2.10' };
  } };
  const auth = { ensureAuthenticated: async () => {}, isStallManager: () => false };
  global.wx = { showToast() {}, stopPullDownRefresh() {}, navigateTo: data => routes.push(data.url) };
  const config = createSalesPage({ api, auth, autoSearch, getErrorMessage }, { managerView: true });
  const page = { ...config, data: { ...structuredClone(config.data), managerId } };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return { page, requests, routes };
}

test('负责人销售默认当天，列表和两组统计均查询指定负责人且展示佣金', async () => {
  const { page, requests } = harness();
  await page.onLoad();
  const today = page.formatDate(new Date());
  assert.equal(page.data.startDate, today);
  assert.equal(page.data.endDate, today);
  assert.equal(page.data.overview.salesCommission, '12.34');
  assert.equal(page.data.filteredOverview.salesCommission, '12.34');
  assert.equal(page.data.overview.refundedCommission, '2.10');
  assert.equal(page.data.filteredOverview.refundedCommission, '2.10');
  assert.ok(requests.some(r => r.url === base + '/stalls'));
  assert.ok(requests.some(r => r.url === base + '/tags'));
  assert.ok(requests.some(r => r.url === base + '/overview'));
  assert.ok(requests.some(r => r.url === base + '/query/overview'));
  assert.ok(requests.some(r => r.url === base + '/query/products'));
  assert.equal(requests.some(r => r.url === '/admin/sales/overview' || r.url === '/stalls/all'), false);
});

test('搜索、档口、标签及日期同时传给统计和分页，翻页保留条件', async () => {
  const { page, requests } = harness((url, params) => url.endsWith('/query/products')
    ? { content: [{ productId: String(params.page), salesCommission: '1.23' }], totalElements: 2 } : {});
  page.setData({ keyword: '棉袄', selectedStall: '2', selectedTag: '3', startDate: '2026-10-01', endDate: '2026-10-20' });
  await page.reloadFilteredData();
  await page.loadMore();
  const listRequests = requests.filter(r => r.url.endsWith('/query/products'));
  const { page: firstPage, size, ...filters } = listRequests[0].params;
  assert.deepEqual(filters, { keyword: '棉袄', stallId: '2', tagId: '3', startDate: '2026-10-01', endDate: '2026-10-20' });
  assert.deepEqual(requests.find(r => r.url.endsWith('/query/overview')).params, filters);
  assert.deepEqual(listRequests[1].params, { ...filters, page: 2, size });
  assert.deepEqual(page.data.products.map(p => p.productId), ['1', '2']);
  assert.equal(page.data.hasMore, false);
});

test('负责人详情入口保留长编号、商品及日期', () => {
  const { page, routes } = harness();
  page.setData({ startDate: '2026-10-01', endDate: '2026-10-20' });
  page.goToDetail({ currentTarget: { dataset: { item: { productId: '9007199254740997', productName: '棉袄' } } } });
  const url = new URL(routes[0], 'https://example.test');
  assert.equal(url.searchParams.get('managerId'), managerId);
  assert.equal(url.searchParams.get('productId'), '9007199254740997');
  assert.equal(url.searchParams.get('startDate'), '2026-10-01');
});

test('商品详情的概览、SKU和订单均保留负责人范围', async () => {
  let config;
  const requests = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/adminSalesDetail/adminSalesDetail.js'), 'utf8'), {
    Page: value => { config = value; }, console,
    require: name => name.endsWith('/error') ? { getErrorMessage } : name.endsWith('/api') ? {
      get: async (url, params) => {
        requests.push({ url, params });
        return url.endsWith('/skus') ? { content: [{ skuSpec: '红色', skuSize: 'M', salesCommission: '4.95' }], totalElements: 1 }
          : { salesCommission: '9.90', refundedCommission: '1.10', content: [] };
      }
    } : {}, wx: {}
  });
  const page = { ...config, data: { ...structuredClone(config.data), managerId, productId: '7', startDate: '2026-10-01' } };
  page.setData = patch => Object.assign(page.data, patch);
  await Promise.all([page.loadOverview(), page.loadSkus(), page.loadOrders(true)]);
  assert.deepEqual(requests.map(r => r.url), [base + '/products/7/overview', base + '/query/products/7/skus', base + '/query/products/7/orders']);
  assert.ok(requests.every(r => r.params.startDate === '2026-10-01'));
  assert.equal(page.data.overview.salesCommission, '9.90');
  assert.equal(page.data.overview.refundedCommission, '1.10');
  assert.equal(page.data.skus[0].salesCommission, '4.95');
});

test('详情页销售tab的触底事件交给销售组件，切换tab不调用佣金列表接口', async () => {
  let config;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.js'), 'utf8'), {
    Page: value => { config = value; }, require: () => ({}), console
  });
  let more = 0, list = 0;
  const page = { ...config, data: structuredClone(config.data), selectComponent: () => ({ loadMore: () => ++more }), loadList: () => ++list };
  page.setData = patch => Object.assign(page.data, patch);
  await page.changeTab({ currentTarget: { dataset: { tab: 'sales' } } });
  page.onReachBottom();
  assert.equal(page.data.tab, 'sales');
  assert.equal(more, 1);
  assert.equal(list, 0);
});
