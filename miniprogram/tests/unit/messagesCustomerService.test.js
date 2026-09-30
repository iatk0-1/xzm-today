const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let config;
let response = { hasContacted: false };
let permission = { canServe: false };
let sessions = [];
let unread = { totalUnreadCount: 7 };
const requests = [];
global.Page = value => { config = value; };
const originalLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request.endsWith('utils/api')) {
    return { get: async url => {
      requests.push(url);
      if (url === '/wechat/customer-service/me') return permission;
      if (url === '/wechat/customer-service/sessions') return sessions;
      if (url === '/wechat/customer-service/unread') return unread;
      return response;
    } };
  }
  if (request.endsWith('utils/auth')) {
    return { isAdmin: () => false, isStallManager: () => false, ensureAuthenticated: async () => {} };
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
  permission = { canServe: false };
  const page = createPage();
  await page.loadContact();
  assert.equal(page.data.hasContacted, false);

  response = { hasContacted: true, firstMessageAt: '2026-09-26T08:42:00Z', unreadCount: 4 };
  await page.loadContact();
  assert.equal(page.data.hasContacted, true);
  assert.equal(page.data.contactUnreadCount, 4);
  assert.equal(page.data.messageUnreadCount, 4);
  assert.deepEqual(requests, [
    '/wechat/customer-service/me',
    '/wechat/customer-service/contact',
    '/wechat/customer-service/me',
    '/wechat/customer-service/contact'
  ]);
});

test('客服身份同时读取接待会话和自己作为用户的客服卡片', async () => {
  requests.length = 0;
  permission = { canServe: true };
  response = { hasContacted: true, firstMessageAt: '2026-09-26T08:42:00Z', unreadCount: 4 };
  sessions = [
    { id: 1, nickname: '甲', unreadCount: 2, lastContent: '你好' },
    { id: 2, nickname: '乙', unreadCount: 1, lastContent: '订单咨询' }
  ];
  const page = createPage();

  await page.loadContact();

  assert.equal(page.data.canServe, true);
  assert.equal(page.data.hasContacted, true);
  assert.ok(page.data.firstMessageTime);
  assert.equal(page.data.sessions.length, 2);
  assert.deepEqual(page.data.sessions.map(item => item.unreadLabel), ['2', '1']);
  assert.equal(page.data.contactUnreadCount, 4);
  assert.equal(page.data.messageUnreadCount, 7);
  assert.deepEqual(requests, [
    '/wechat/customer-service/me',
    '/wechat/customer-service/sessions',
    '/wechat/customer-service/contact',
    '/wechat/customer-service/unread'
  ]);
});
