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
  if (request.endsWith('utils/customerServiceUnread')) return { start() {}, stop() {} };
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
    return { ensureAuthenticated: async () => {}, isAdmin: () => false, isStallManager: () => false };
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

nodeTest('市集下拉刷新：默认最新，保留后端创建时间倒序而非按点赞数重排', async () => {
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
  assert.equal(page.data.currentSort, 'newest');
  assert.deepEqual(requestLog, ['/wishes?page=1&size=20&sort=newest']);
  assert.deepEqual(page.data.wishes.map((item) => item.id), ['low', 'high', 'middle']);
  assert.deepEqual(page.data.leftColumn.map((item) => item.id), ['low', 'middle']);
  assert.deepEqual(page.data.rightColumn.map((item) => item.id), ['high']);
});

const sortTap = sort => ({ currentTarget: { dataset: { sort } } });

nodeTest('切换点赞数从第一页查询，翻页和刷新延续所选排序，重复点击不请求', async () => {
  const page = createPage();
  page.data.page = 4;
  page.data.hasMore = false;
  page.data.wishes = [wish('old', 2)];
  requestHandler = async url => ({
    content: url.includes('page=2') ? [wish('third', 5)] : [wish('first', 20), wish('second', 10)],
    hasNext: !url.includes('page=2')
  });
  await page.handleSortChange(sortTap('likes'));
  assert.deepEqual(page.data.wishes.map(item => item.id), ['first', 'second']);
  assert.equal(page.data.page, 2);
  await page.handleSortChange(sortTap('likes'));
  assert.equal(requestLog.length, 1);
  await page.loadWishes(false);
  assert.deepEqual(page.data.wishes.map(item => item.id), ['first', 'second', 'third']);
  await page.onRefresh();
  assert.deepEqual(requestLog, [
    '/wishes?page=1&size=20&sort=likes',
    '/wishes?page=2&size=20&sort=likes',
    '/wishes?page=1&size=20&sort=likes'
  ]);
  await page.handleSortChange(sortTap('newest'));
  assert.equal(requestLog.at(-1), '/wishes?page=1&size=20&sort=newest');
});

nodeTest('加载中连续切换不混入旧分页，只有最后一次排序请求生效', async () => {
  const page = createPage();
  page.data.wishes = [wish('kept', 1)];
  let resolveOld;
  let resolveNew;
  requestHandler = () => new Promise(resolve => { resolveOld = resolve; });
  const oldTask = page.loadWishes(false);
  const firstSwitch = page.handleSortChange(sortTap('likes'));
  const secondSwitch = page.handleSortChange(sortTap('newest'));
  const lastSwitch = page.handleSortChange(sortTap('likes'));
  requestHandler = () => new Promise(resolve => { resolveNew = resolve; });
  resolveOld({ content: [wish('stale', 99)], hasNext: false });
  await oldTask;
  await firstSwitch;
  await secondSwitch;
  assert.deepEqual(page.data.wishes.map(item => item.id), ['kept']);
  assert.deepEqual(requestLog, ['/wishes?page=1&size=20&sort=newest', '/wishes?page=1&size=20&sort=likes']);
  resolveNew({ content: [wish('latest-choice', 50)], hasNext: false });
  await lastSwitch;
  assert.deepEqual(page.data.wishes.map(item => item.id), ['latest-choice']);
  assert.equal(page.data.loading, false);
});

nodeTest('排序加载失败保留列表，触底重试替换首屏，删除期间不切换排序', async () => {
  const page = createPage();
  page.data.wishes = [wish('kept', 1)];
  page._loadedWishSort = 'newest';
  page.data.deletingWishes = true;
  await page.handleSortChange(sortTap('likes'));
  assert.equal(page.data.currentSort, 'newest');
  assert.equal(requestLog.length, 0);
  page.data.deletingWishes = false;
  requestHandler = async () => { throw new Error('网络失败'); };
  await page.handleSortChange(sortTap('likes'));
  assert.deepEqual(page.data.wishes.map(item => item.id), ['kept']);
  assert.equal(page.data.loading, false);
  requestHandler = async () => ({ content: [wish('recovered', 10)], hasNext: false });
  await page.loadWishes(false);
  assert.deepEqual(page.data.wishes.map(item => item.id), ['recovered']);
  assert.equal(requestLog.at(-1), '/wishes?page=1&size=20&sort=likes');
});

nodeTest('发布新心愿返回市集时按当前排序重载，最新心愿不再追加在末尾', async () => {
  for (const sort of ['newest', 'likes']) {
    const page = createPage();
    page.onLoad();
    page._hasLoadedMarketData = true;
    page.data.currentSort = sort;
    page.data.page = 4;
    page.data.wishes = [wish('old', 5)];
    requestHandler = async () => ({ content: [wish('new', 0), wish('old', 5)], hasNext: false });
    require('../../utils/pageSync').publish('wishes', 'new', false, { created: true });
    try {
      await page.onShow();
      assert.deepEqual(requestLog, [`/wishes?page=1&size=20&sort=${sort}`]);
      assert.deepEqual(page.data.wishes.map(item => item.id), ['new', 'old']);
      assert.equal(page.data.page, 2);
    } finally {
      page.onUnload();
    }
  }
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

nodeTest('市集点赞：只更新当前卡片，不重新排列列表', async () => {
  const page = createPage();
  const first = wish('first', 20);
  const second = wish('second', 1);
  page.data.wishes = [first, second];
  page.data.leftColumn = [first];
  page.data.rightColumn = [second];

  await page.handleLike({ currentTarget: { dataset: { id: 'second' } } });

  assert.deepEqual(page.data.wishes.map((item) => item.id), ['first', 'second']);
  assert.equal(page.data.wishes[1].likes, 2);
  assert.deepEqual(page.data.leftColumn.map((item) => item.id), ['first']);
  assert.deepEqual(page.data.rightColumn.map((item) => item.id), ['second']);
});

nodeTest('市集卡片：保留点赞和商品入口，恢复热度进度条且不显示热度文案', () => {
  const wxml = fs.readFileSync(
    path.join(__dirname, '../../pages/market/market.wxml'),
    'utf8'
  );

  assert.equal((wxml.match(/catchtap="handleLike"/g) || []).length, 2);
  assert.equal((wxml.match(/class="like-count"/g) || []).length, 2);
  assert.equal((wxml.match(/wx:if="{{item.hasLinkedProducts}}" catchtap="goToWishDetail"/g) || []).length, 2);
  assert.equal((wxml.match(/src="\/images\/add-cart.png"/g) || []).length, 2);
  assert.doesNotMatch(wxml, /热度/);
  assert.equal((wxml.match(/class="progress-bar"/g) || []).length, 2);
  assert.equal((wxml.match(/class="progress-fill"/g) || []).length, 2);
  assert.equal((wxml.match(/item.likes \/ 50/g) || []).length, 2);
  assert.equal(wxml.includes('class="masonry-grid"'), true);
  assert.equal(wxml.includes('class="wish-card"'), true);
  assert.equal(wxml.includes('mode="widthFix"'), true);
});
