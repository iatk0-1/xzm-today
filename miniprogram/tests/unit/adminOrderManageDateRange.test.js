const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
global.Page = config => { pageConfig = config; };
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request.endsWith('utils/api')) return {};
  if (request.endsWith('utils/auth')) return {};
  if (request.endsWith('utils/clipboard')) return {};
  return originalLoad.call(this, request, ...args);
};
require('../../pages/adminOrderManage/adminOrderManage.js');
Module._load = originalLoad;

test('订单管理最近 1 天为当天，确认后按日期重查首屏', () => {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = patch => {
    for (const [key, value] of Object.entries(patch)) {
      if (key.startsWith('dateRange.')) page.data.dateRange[key.slice('dateRange.'.length)] = value;
      else page.data[key] = value;
    }
  };
  const loads = [];
  page.loadOrders = () => loads.push({ ...page.data.dateRange });
  page.selectDateRange({ currentTarget: { dataset: { type: '1day' } } });
  const today = page.formatDate(new Date());
  assert.equal(page.data.dateRange.startDate, today);
  assert.equal(page.data.dateRange.endDate, today);
  assert.equal(page.data.dateRange.quickSelect, '1day');
  page.confirmDateRange();
  assert.equal(loads.length, 1);
  assert.equal(loads[0].startDate, today);
});
