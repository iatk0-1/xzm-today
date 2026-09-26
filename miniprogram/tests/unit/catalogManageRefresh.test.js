const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const pageSync = require('../../utils/pageSync');

let pageConfig;
const requests = [];
let groupList = [];
let singleGroup;
let failRefresh = false;

global.Page = config => { pageConfig = config; };
global.wx = { showToast() {}, navigateBack() {} };

const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api') || request === './api') return {
    get: async url => {
      requests.push(url);
      if (failRefresh) throw new Error('模拟刷新失败');
      return url.endsWith('/manage') && !url.match(/\/\d+\/manage$/) ? groupList : singleGroup;
    }
  };
  if (request.endsWith('utils/auth')) return {
    ensureAuthenticated: async () => {}, isAdmin: () => true
  };
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminCatalogManage/adminCatalogManage.js');

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  return page;
}

test('档口管理返回时只同步变动的一行，下拉刷新才重查列表', { concurrency: false }, async () => {
  requests.length = 0;
  groupList = [{ id: 1, name: '一档口', sortOrder: 1 }, { id: 2, name: '二档口', sortOrder: 2 }];
  singleGroup = { id: 2, name: '新二档口', sortOrder: 2, totalProductCount: 3 };
  const page = createPage();
  await page.onLoad();
  await page.onShow();
  assert.deepEqual(requests, ['/stalls/manage']);
  page.scrollTop = 200;

  pageSync.publish('stalls', 2);
  await page.onShow();
  assert.deepEqual(requests, ['/stalls/manage', '/stalls/2/manage']);
  assert.deepEqual(page.data.groups.map(item => item.name), ['一档口', '新二档口']);
  assert.equal(page.scrollTop, 200);

  groupList = [{ id: 1, name: '刷新后' }, singleGroup];
  await page.onRefresh();
  assert.deepEqual(requests, ['/stalls/manage', '/stalls/2/manage', '/stalls/manage']);
  assert.equal(page.data.groups[0].name, '刷新后');
  assert.equal(page.data.refreshing, false);
  page.onUnload();
});

test('下拉刷新失败保留原列表并收起刷新状态，拖动期间不发请求', async () => {
  const page = createPage();
  groupList = [{ id: 1, name: '原档口' }];
  await page.onLoad();
  await new Promise(resolve => setImmediate(resolve));
  failRefresh = true;
  await page.onRefresh();
  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.groups[0].name, '原档口');
  failRefresh = false;
  const count = requests.length;
  page.data.dragIndex = 0;
  await page.onRefresh();
  assert.equal(requests.length, count);
  page.onUnload();
});
