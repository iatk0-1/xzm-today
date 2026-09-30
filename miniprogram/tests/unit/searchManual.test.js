const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  let config;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/search/search.js'), 'utf8'), {
    Page(value) { config = value; },
    require(name) {
      if (name.endsWith('/api')) return {
        get: async (url, params) => {
          if (url === '/products/query') { requests.push(params); return { content: [], hasNext: true }; }
          return [];
        }, delete: async () => {}
      };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/stock')) return { isProductSoldOut: () => false };
      throw new Error('未模拟依赖：' + name);
    },
    wx: { showLoading() {}, hideLoading() {}, showToast() {} },
    setTimeout, clearTimeout, console
  });
  const page = { ...config, data: structuredClone(config.data) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return { page, requests };
}

test('输入和停顿不搜索，失焦后查询一次，重复失焦不重复记录历史', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '棉袄' } });
  t.mock.timers.tick(1000);
  assert.equal(requests.length, 0);
  page.onSearchBlur();
  t.mock.timers.tick(200);
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].keyword, '棉袄');
  page.onSearchBlur();
  t.mock.timers.tick(200);
  assert.equal(requests.length, 1);
});

test('失焦同时点击搜索或历史词只查询一次', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '未完成词' } });
  page.onSearchBlur();
  page.onSearchHistoryTap({ currentTarget: { dataset: { keyword: '历史词' } } });
  await Promise.resolve();
  t.mock.timers.tick(200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].keyword, '历史词');
  page.onSearchBlur();
  await page.doSearch({ type: 'tap' });
  t.mock.timers.tick(200);
  assert.equal(requests.length, 2);
});

test('未提交的新输入不影响已有结果分页，清空后手动搜索恢复全部商品', async t => {
  const { page, requests } = setup(t);
  page.onInput({ detail: { value: '棉袄' } });
  await page.doSearch();
  page.onInput({ detail: { value: '外套' } });
  await page.doSearch(false);
  assert.equal(requests[1].keyword, '棉袄');
  assert.equal(requests[1].page, 2);
  page.onInput({ detail: { value: '' } });
  assert.equal(requests.length, 2);
  await page.doSearch();
  assert.equal(requests[2].keyword, undefined);
  assert.equal(page.data.searchType, 'all');
});

test('正在加载时手动搜索会排队，页面卸载取消失焦搜索', async t => {
  const { page, requests } = setup(t);
  page.data.loading = true;
  page.onInput({ detail: { value: '新词' } });
  await page.doSearch();
  assert.equal(requests.length, 0);
  page.data.loading = false;
  page.finishPendingSearch();
  await Promise.resolve();
  assert.equal(requests[0].keyword, '新词');
  page.onInput({ detail: { value: '另一个词' } });
  page.onSearchBlur();
  page.onUnload();
  t.mock.timers.tick(200);
  assert.equal(requests.length, 1);
});
