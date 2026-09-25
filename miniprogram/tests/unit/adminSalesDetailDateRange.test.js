const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
global.Page = config => { pageConfig = config; };
global.wx = { showToast() {}, setNavigationBarTitle() {} };
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {};
  if (request.endsWith('utils/auth')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminSalesDetail/adminSalesDetail.js');
Module._load = originalLoad;

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  return page;
}

test('详情页从列表继承时间，取消不刷新，确认最近 1 天后只查当天', () => {
  const page = createPage();
  const loads = [];
  page.loadAll = () => loads.push({ startDate: page.data.startDate, endDate: page.data.endDate });
  page.data.startDate = '2026-09-19';
  page.data.endDate = '2026-09-25';

  page.showDateRangeSelector();
  assert.equal(page.data.editingDateRange.startDate, '2026-09-19');
  assert.equal(page.data.editingDateRange.endDate, '2026-09-25');
  page.selectDateRange({ currentTarget: { dataset: { type: '1day' } } });
  page.closeDateModal();
  assert.equal(page.data.startDate, '2026-09-19');
  assert.equal(loads.length, 0);

  page.showDateRangeSelector();
  page.selectDateRange({ currentTarget: { dataset: { type: '1day' } } });
  page.confirmDateRange();
  const today = page.formatDate(new Date());
  assert.deepEqual(loads, [{ startDate: today, endDate: today }]);
  assert.equal(page.data.quickSelect, '1day');
  assert.equal(page.data.showDateModal, false);

  page.clearDateRange();
  assert.deepEqual(loads[1], { startDate: '', endDate: '' });
  assert.equal(page.data.quickSelect, '');
});

test('详情页自定义日期无效时不生效，也不刷新数据', () => {
  const page = createPage();
  let loadCount = 0;
  page.loadAll = () => { loadCount += 1; };
  page.showDateRangeSelector();
  page.onStartDateChange({ detail: { value: '2026-09-25' } });
  page.onEndDateChange({ detail: { value: '2026-09-19' } });
  page.confirmDateRange();
  assert.equal(loadCount, 0);
  assert.equal(page.data.startDate, '');
  assert.equal(page.data.showDateModal, true);
});
