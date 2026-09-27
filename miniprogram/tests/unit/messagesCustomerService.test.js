const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
let response = { hasContacted: false };
const requests = [];
global.Page = value => { config = value; };
const originalLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request.endsWith('utils/api')) {
    return { get: async url => { requests.push(url); return response; } };
  }
  if (request.endsWith('utils/auth')) {
    return { isAdmin: () => false, ensureAuthenticated: async () => {} };
  }
  if (request.endsWith('utils/customerServiceNavigation')) {
    return { openFromContact: () => false };
  }
  return originalLoad.call(this, request, ...rest);
};
require('../../pages/messages/messages.js');
Module._load = originalLoad;

function createPage() {
  const page = Object.assign({}, config);
  page.data = Object.assign({}, config.data);
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

test('信息页只在客服收到用户消息后展示单张入口卡片', async () => {
  requests.length = 0;
  const page = createPage();
  await page.loadContact();
  assert.equal(page.data.hasContacted, false);

  response = { hasContacted: true, firstMessageAt: '2026-09-26T08:42:00Z' };
  await page.loadContact();
  assert.equal(page.data.hasContacted, true);
  assert.deepEqual(requests, [
    '/wechat/customer-service/contact',
    '/wechat/customer-service/contact'
  ]);
});
