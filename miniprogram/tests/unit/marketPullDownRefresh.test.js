const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

let pageConfig = null;
let requestHandler = async () => ({});
let requestLog = [];
const wxCalls = { showLoading: 0, hideLoading: 0, stopPullDownRefresh: 0 };

global.Page = (config) => { pageConfig = config; };
global.wx = {
  showLoading() { wxCalls.showLoading += 1; },
  hideLoading() { wxCalls.hideLoading += 1; },
  stopPullDownRefresh() { wxCalls.stopPullDownRefresh += 1; },
  showToast() {},
  navigateTo() {},
  reLaunch() {}
};

const originalLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request.endsWith('utils/api')) {
    return {
      get: async (url) => {
        requestLog.push(url);
        return requestHandler(url);
      },
      post: async () => ({})
    };
  }
  if (request.endsWith('utils/auth')) {
    return { ensureAuthenticated: async () => {}, isAdmin: () => false };
  }
  return originalLoad.call(this, request, ...rest);
};

require('../../pages/market/market.js');

function createPage() {
  requestLog = [];
  wxCalls.showLoading = 0;
  wxCalls.hideLoading = 0;
  wxCalls.stopPullDownRefresh = 0;

  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch) => {
    Object.keys(patch).forEach((key) => { page.data[key] = patch[key]; });
  };
  return page;
}

function wish(id, likes) {
  return { id, title: '心愿' + id, image: '/wish-' + id + '.jpg', likes };
}

nodeTest('市集下拉刷新：重新请求首屏并按热度倒序展示', async () => {
  const page = createPage();
  page.data.wishes = [wish('old', 20)];
  page.data.leftColumn = [wish('old', 20)];
  requestHandler = async () => ({
    content: [wish('low', 2), wish('high', 12), wish('middle', 7)],
    hasNext: false
  });

  await page.onRefresh();

  assert.equal(page.data.refreshing, false);
  assert.equal(page.data.loading, false);
  assert.equal(wxCalls.showLoading, 0);
  assert.deepEqual(requestLog, ['/wishes?page=1&size=20']);
  assert.deepEqual(page.data.wishes.map((item) => item.id), ['high', 'middle', 'low']);
  assert.deepEqual(page.data.leftColumn.map((item) => item.id), ['high', 'low']);
  assert.deepEqual(page.data.rightColumn.map((item) => item.id), ['middle']);
});

nodeTest('市集刷新：请求期间保留旧列表，避免先清空导致页面闪动', async () => {
  const page = createPage();
  page.data.wishes = [wish('old', 8)];
  page.data.leftColumn = [wish('old', 8)];
  let resolveRequest;
  requestHandler = () => new Promise((resolve) => { resolveRequest = resolve; });

  const refresh = page.onRefresh();
  await Promise.resolve();
  assert.deepEqual(page.data.wishes.map((item) => item.id), ['old']);
  assert.equal(page.data.loading, true);

  resolveRequest({ content: [wish('new', 12)], hasNext: false });
  await refresh;

  assert.deepEqual(page.data.wishes.map((item) => item.id), ['new']);
});

nodeTest('市集页面级下拉刷新：结束后收起原生刷新动画', async () => {
  const page = createPage();
  requestHandler = async () => ({ content: [], hasNext: false });

  await page.onPullDownRefresh();

  assert.equal(wxCalls.stopPullDownRefresh, 1);
  assert.equal(page.data.refreshing, false);
});

nodeTest('市集卡片：爱心阻止事件冒泡，热度只展示数值', () => {
  const wxml = fs.readFileSync(
    path.join(__dirname, '../../pages/market/market.wxml'),
    'utf8'
  );

  assert.equal((wxml.match(/catchtap="handleLike"/g) || []).length, 2);
  assert.equal((wxml.match(/热度[^\n]*\/ 50/g) || []).length, 0);
  assert.equal(wxml.includes('class="waterfall-container"'), true);
  assert.equal(wxml.includes('class="wish-image-wrap"'), true);
});
