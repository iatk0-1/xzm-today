const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
let currentUserId = 20;
let session;
let newest = [];
let earlier = [];
const requests = [];
const posts = [];

global.Page = config => { pageConfig = config; };
global.wx = {
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  showToast: () => {},
  navigateBack: () => {}
};
const originalLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request.endsWith('utils/api')) return {
    get: async (url, data) => {
      requests.push({ url, data });
      if (url.endsWith('/messages')) return data && data.before ? earlier : newest;
      return session;
    },
    post: async (url, data) => { posts.push({ url, data }); return {}; }
  };
  if (request.endsWith('utils/auth')) return {
    ensureAuthenticated: async () => {},
    getUserInfo: () => ({ userId: currentUserId })
  };
  return originalLoad.call(this, request, ...rest);
};
require('../../pages/customerServiceChat/customerServiceChat.js');
Module._load = originalLoad;

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = Object.assign({}, pageConfig.data, { id: '1' });
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

function activeSession(overrides = {}) {
  return Object.assign({
    id: 1, status: 'active', assignedStaffId: 20,
    remainingReplies: 5,
    lastUserAt: new Date(Date.now() - 60_000).toISOString(),
    replyExpiresAt: new Date(Date.now() + 3_600_000).toISOString()
  }, overrides);
}

test('轮询新消息时保留已翻出的历史，翻页带上最早消息 ID', async () => {
  requests.length = 0;
  session = activeSession();
  newest = Array.from({ length: 50 }, (_, i) => ({ id: i + 51, content: String(i + 51), direction: 'user' }));
  earlier = [{ id: 50, content: '旧消息', direction: 'user' }];
  const page = createPage();

  await page.refresh();
  assert.equal(page.data.hasMore, true);
  await page.loadEarlier();
  assert.equal(page.data.messages[0].id, 50);
  assert.deepEqual(requests.at(-1), {
    url: '/wechat/customer-service/sessions/1/messages', data: { before: 51 }
  });

  newest = newest.slice(1).concat({ id: 101, content: '新消息', direction: 'user' });
  await page.refresh(true);
  assert.equal(page.data.messages[0].id, 50);
  assert.equal(page.data.messages.at(-1).id, 101);
  assert.equal(page.data.messages.length, 52);
});

test('非当前接入客服只能看，不能向微信发送', async () => {
  posts.length = 0;
  currentUserId = 21;
  session = activeSession();
  newest = [];
  const page = createPage();

  await page.refresh();
  assert.equal(page.data.canReply, false);
  page.setData({ inputText: '你好' });
  await page.send();
  assert.equal(posts.length, 0);
  currentUserId = 20;
});

test('超过用户最后一条消息 48 小时，即使显示窗口未过期也禁发', async () => {
  posts.length = 0;
  session = activeSession({
    lastUserAt: new Date(Date.now() - 49 * 3_600_000).toISOString(),
    remainingReplies: 2,
    replyExpiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  newest = [];
  const page = createPage();

  await page.refresh();
  assert.equal(page.data.canReply, false);
  assert.match(page.data.quotaText, /超过 48 小时/);
  page.setData({ inputText: '迟来的回复' });
  await page.send();
  assert.equal(posts.length, 0);
});
