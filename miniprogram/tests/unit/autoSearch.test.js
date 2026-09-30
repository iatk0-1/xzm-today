const test = require('node:test');
const assert = require('node:assert/strict');
const { wrap } = require('../../utils/autoSearch');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const config = wrap({
    data: { keyword: '', loading: false },
    input(e) { this.setData({ keyword: e.detail.value }); },
    search(reset = true) { calls.push([this.data.keyword, reset]); },
    clearSearch() { this.setData({ keyword: '' }); this.search(); },
    onUnload() { this.closed = true; }
  }, { input: 'input', submit: 'search', field: 'keyword' });
  const page = { ...config, data: { ...config.data } };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  const input = value => page.input({ detail: { value } });
  return { page, calls, input };
}

test('连续输入只查询最后的关键词，输入事件不返回 Promise', t => {
  const { calls, input } = setup(t);
  assert.equal(input('棉'), undefined);
  t.mock.timers.tick(200);
  input('棉袄');
  t.mock.timers.tick(349);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, [['棉袄', true]]);
});

test('加载锁释放后搜索最新输入，不丢失搜索也不提前重置列表', t => {
  const { page, calls, input } = setup(t);
  page.data.loading = true;
  input('旧词');
  t.mock.timers.tick(350);
  assert.deepEqual(calls, []);
  input('新词');
  t.mock.timers.tick(350);
  page.data.loading = false;
  t.mock.timers.tick(50);
  assert.deepEqual(calls, [['新词', true]]);
});

test('手动确认取消防抖，清空恢复全部结果，分页保留追加参数', t => {
  const { page, calls, input } = setup(t);
  input('商品');
  page.search();
  t.mock.timers.tick(350);
  assert.equal(calls.length, 1);
  input('');
  t.mock.timers.tick(1);
  assert.deepEqual(calls[1], ['', true]);
  page.search(false);
  assert.deepEqual(calls[2], ['', false]);
  input('待查询');
  page.clearSearch();
  t.mock.timers.tick(350);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[3], ['', true]);
});

test('卸载页面取消待执行及等待加载的搜索，并保留原卸载逻辑', t => {
  const { page, calls, input } = setup(t);
  page.data.loading = true;
  input('商品');
  t.mock.timers.tick(350);
  page.onUnload();
  page.data.loading = false;
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, []);
  assert.equal(page.closed, true);
});
