const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let pageConfig;
let currentUserId = 20;
let currentUserIsAdmin = false;
let session;
let newest = [];
let earlier = [];
const requests = [];
const posts = [];
const uploads = [];
let imageOptions;
let postResult = {};
let keyboardHides = 0;
const navigations = [];

global.Page = config => { pageConfig = config; };
global.wx = {
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  showToast: () => {},
  hideKeyboard: () => { keyboardHides++; },
  navigateTo: options => { navigations.push(options.url); },
  navigateBack: () => {},
  chooseImage: options => { imageOptions = options; }
};
const originalLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request.endsWith('utils/cos-upload')) return {
    uploadFile: async (path, dir, progress, format) => {
      uploads.push({ path, dir, format });
      return 'https://upload.example/xzm/chats/' + (format || 'image') + '.' + (format || 'jpg');
    }
  };
  if (request.endsWith('utils/media')) return { compressImage: async path => ({ path }) };
  if (request.endsWith('utils/api')) return {
    get: async (url, data) => {
      requests.push({ url, data });
      if (url.endsWith('/messages')) return data && data.before ? earlier : newest;
      return session;
    },
    post: async (url, data) => { posts.push({ url, data }); return postResult; }
  };
  if (request.endsWith('utils/auth')) return {
    ensureAuthenticated: async () => {},
    getUserInfo: () => ({ userId: currentUserId }),
    isAdmin: () => currentUserIsAdmin
  };
  return originalLoad.call(this, request, ...rest);
};
require('../../pages/customerServiceChat/customerServiceChat.js');
Module._load = originalLoad;

function createPage() {
  const page = Object.assign({}, pageConfig);
  page.data = Object.assign({}, pageConfig.data, { id: '1' });
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
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
  assert.equal(page.data.scrollToId, '');
  await page.loadEarlier();
  assert.equal(page.data.messages[0].id, 50);
  assert.equal(page.data.scrollToId, 'msg-51');
  assert.deepEqual(requests.at(-1), {
    url: '/wechat/customer-service/sessions/1/messages', data: { before: 51 }
  });

  newest = newest.slice(1).concat({ id: 101, content: '新消息', direction: 'user' });
  await page.refresh(true);
  assert.equal(page.data.messages[0].id, 50);
  assert.equal(page.data.messages.at(-1).id, 101);
  assert.equal(page.data.messages.length, 52);
  assert.equal(page.data.scrollToId, 'msg-51');
});

test('首次进入和发送回复定位列表末尾，定时刷新不改变阅读位置', async () => {
  session = activeSession(); posts.length = 0;
  newest = [{ id: 201, direction: 'user', content: '历史消息' }];
  const page = createPage();
  await page.refresh(false, true);
  assert.equal(page.data.scrollToId, 'msg-bottom');
  page.setData({ scrollToId: 'msg-201' });
  await page.refresh(true);
  assert.equal(page.data.scrollToId, 'msg-201');
  page.setData({ inputText: '客服回复' });
  postResult = { id: 202, direction: 'staff', content: '客服回复', status: 'sent' };
  await page.send();
  assert.equal(page.data.scrollToId, 'msg-bottom');
  newest = [...newest, { id: 202, direction: 'staff', content: '客服回复', status: 'sent' }];
  await page.refresh(true);
  assert.equal(page.data.scrollToId, 'msg-bottom');
  postResult = {};
});

test('从详情页返回聊天时刷新消息但保留当前阅读位置', async () => {
  session = activeSession();
  newest = [{ id: 301, direction: 'user', content: '旧消息' }];
  const page = createPage();
  page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.scrollToId, 'msg-bottom');
  page.onHide();
  newest = [...newest, { id: 302, direction: 'user', content: '新消息' }];
  page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.messages.at(-1).id, 302);
  assert.equal(page.data.scrollToId, '');
  page.onHide();
});

test('发送后保持输入焦点，点击或滑动消息列表才收起键盘', async () => {
  session = activeSession(); newest = []; posts.length = 0; keyboardHides = 0;
  const page = createPage();
  await page.refresh();
  page.onInputFocus();
  page.onInput({ detail: { value: '第一条', cursor: 3 } });
  postResult = { id: 203, direction: 'staff', content: '第一条', status: 'sent' };
  await page.send();
  assert.equal(page.data.inputFocused, true);
  assert.equal(page.data.inputText, '');
  assert.equal(keyboardHides, 0);
  page.hideInputKeyboard();
  assert.equal(page.data.inputFocused, false);
  assert.equal(keyboardHides, 1);
  page.hideInputKeyboard();
  assert.equal(keyboardHides, 1);
  page.onInputFocus();
  page.hideInputKeyboard();
  assert.equal(keyboardHides, 2);
  postResult = {};
});

test('发送途中继续输入的新内容不会被上一条消息清空', async () => {
  session = activeSession(); newest = []; posts.length = 0;
  const page = createPage();
  await page.refresh();
  page.setData({ inputText: '第一条' });
  let finishPost;
  postResult = new Promise(resolve => { finishPost = resolve; });
  const sending = page.send();
  page.onInput({ detail: { value: '第二条', cursor: 3 } });
  finishPost({ id: 204, direction: 'staff', content: '第一条', status: 'sent' });
  await sending;
  assert.equal(posts.at(-1).data.content, '第一条');
  assert.equal(page.data.inputText, '第二条');
  postResult = {};
});

test('管理员打开订单卡片进入管理详情，普通客服进入客服详情，商品仍进入商品详情', () => {
  const page = createPage();
  navigations.length = 0;
  const card = pagePath => ({ currentTarget: { dataset: { metadata: { PagePath: pagePath } } } });
  currentUserIsAdmin = true;
  page.openMiniProgramCard(card('pages/orderDetail/orderDetail?id=317504652948017152'));
  assert.equal(navigations.at(-1), '/pages/adminOrderDetail/adminOrderDetail?id=317504652948017152');
  page.openMiniProgramCard(card('pages/detail/detail?id=123'));
  assert.equal(navigations.at(-1), '/pages/detail/detail?id=123');
  currentUserIsAdmin = false;
  page.openMiniProgramCard(card('pages/orderDetail/orderDetail?id=317504652948017152'));
  assert.equal(navigations.at(-1), '/pages/customerServiceOrderDetail/customerServiceOrderDetail?sessionId=1&orderId=317504652948017152');
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

test('预计剩余零条仍允许发给微信判断，失败原因保留在消息列表', async () => {
  posts.length = 0;
  session = activeSession({ remainingReplies: 0 });
  newest = [{ id: 102, direction: 'staff', status: 'failed',
    content: '4', errorMessage: '微信客服回复条数已超出限制（错误码：45047）' }];
  const page = createPage();

  await page.refresh();
  assert.equal(page.data.canReply, true);
  assert.match(page.data.quotaText, /预计剩余 0 条/);
  assert.equal(page.data.messages[0].errorMessage, '微信客服回复条数已超出限制（错误码：45047）');
  page.setData({ inputText: '再试一次' });
  await page.send();
  assert.equal(posts.at(-1).url, '/wechat/customer-service/sessions/1/messages');
});

test('预计剩余条数仍有，但可回复时间已过时不能发送', async () => {
  posts.length = 0;
  session = activeSession({ remainingReplies: 5,
    replyExpiresAt: new Date(Date.now() - 60_000).toISOString() });
  newest = [];
  const page = createPage();

  await page.refresh();
  assert.equal(page.data.canReply, false);
  assert.match(page.data.quotaText, /可回复时间已过/);
  page.setData({ inputText: '晚了' });
  await page.send();
  assert.equal(posts.length, 0);
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

test('图片入口只能选一张，并发送图片类型及上传后的地址', async () => {
  session = activeSession(); newest = []; posts.length = 0; uploads.length = 0;
  const page = createPage(); await page.refresh();
  page.chooseImage();
  assert.equal(imageOptions.count, 1);
  await page.sendImage('/tmp/photo.jpg');
  assert.deepEqual(uploads[0], { path: '/tmp/photo.jpg', dir: 'chats', format: undefined });
  assert.deepEqual(posts.at(-1).data, {
    type: 'image', mediaUrl: 'https://upload.example/xzm/chats/image.jpg'
  });
  assert.equal(page.data.sending, false);
});

test('视频上传视频和单张封面，由后端转为微信客服可打开的链接卡片', async () => {
  session = activeSession(); newest = []; posts.length = 0; uploads.length = 0;
  const page = createPage(); await page.refresh();
  await page.sendVideo({ tempFilePath: '/tmp/video.mp4', thumbTempFilePath: '/tmp/cover.jpg' });
  assert.deepEqual(uploads.map(u => u.format), ['mp4', 'jpg']);
  assert.deepEqual(posts.at(-1).data, {
    type: 'video', mediaUrl: 'https://upload.example/xzm/chats/mp4.mp4',
    thumbUrl: 'https://upload.example/xzm/chats/jpg.jpg', title: '客服视频'
  });
});

test('商品和订单卡片保留字符串编号，并使用用户侧的详情路径', async () => {
  session = activeSession(); newest = []; posts.length = 0;
  const page = createPage(); await page.refresh();
  page.setData({ composerType: 'miniprogrampage', draftPageKind: 'order',
    draftTitle: '订单详情', draftTargetId: '317504652948017152',
    draftThumbUrl: 'https://upload.example/xzm/chats/cover.jpg' });
  await page.sendCard();
  assert.equal(posts.at(-1).data.pagePath, 'pages/orderDetail/orderDetail?id=317504652948017152');
  assert.equal(posts.at(-1).data.type, 'miniprogrampage');
  assert.equal(page.data.composerType, '');
});

test('图文链接使用 link 类型，未接入客服不能发送媒体', async () => {
  session = activeSession(); newest = []; posts.length = 0; uploads.length = 0;
  const page = createPage(); await page.refresh();
  page.setData({ composerType: 'link', draftTitle: '使用说明',
    draftUrl: 'https://example.com/help', draftThumbUrl: 'https://upload.example/xzm/chats/cover.jpg' });
  await page.sendCard();
  assert.equal(posts.at(-1).data.type, 'link');
  assert.equal(posts.at(-1).data.url, 'https://example.com/help');
  page.setData({ canReply: false });
  const sent = posts.length;
  await page.sendImage('/tmp/a.jpg');
  assert.equal(posts.length, sent);
  assert.equal(uploads.length, 0);
});

test('重试较早的图片消息后更新原消息状态，轮询仍保留更新后的历史', async () => {
  session = activeSession(); newest = [{ id: 100, direction: 'user', messageType: 'text', content: '新消息' }];
  const page = createPage(); await page.refresh();
  const image = { id: 1, direction: 'staff', messageType: 'image', status: 'failed',
    mediaUrl: 'https://upload.example/xzm/chats/image.jpg', errorMessage: '发送失败' };
  page.setData({ messages: [image, ...page.data.messages] });
  postResult = { ...image, status: 'sent', errorMessage: null };
  await page.retry({ currentTarget: { dataset: { id: 1 } } });
  assert.equal(page.data.messages[0].status, 'sent');
  assert.equal(page.data.messages[0].messageType, 'image');
  assert.equal(page.data.messages[0].errorMessage, null);
  postResult = {};
});

test('微信回调的 HTTP 图片和卡片封面统一升级 HTTPS 以供真机加载', async () => {
  session = activeSession();
  newest = [
    { id: 201, direction: 'user', messageType: 'image',
      mediaUrl: 'http://mmbiz.qpic.cn/mmbiz_jpg/a/0' },
    { id: 202, direction: 'user', messageType: 'miniprogrampage',
      mediaUrl: 'http://mmbiz.qpic.cn/sz_mmbiz_jpg/b/0' }
  ];
  const page = createPage();
  await page.refresh();
  assert.equal(page.data.messages[0].mediaUrl, 'https://mmbiz.qpic.cn/mmbiz_jpg/a/0');
  assert.equal(page.data.messages[1].mediaUrl, 'https://mmbiz.qpic.cn/sz_mmbiz_jpg/b/0');
  page.onMediaLoadError({ currentTarget: { dataset: { id: 201 } } });
  assert.equal(page.data.messages[0].mediaLoadFailed, true);
  assert.equal(page.data.messages[1].mediaLoadFailed, undefined);
});

test('微信表情代码在聊天中显示为可读表情，原始消息内容保持不变', async () => {
  session = activeSession();
  newest = [{ id: 301, direction: 'user', messageType: 'text',
    content: '你好/:8-)[Doge][Sweats]，还有[未知]' }];
  const page = createPage();
  await page.refresh();
  assert.equal(page.data.messages[0].content, '你好/:8-)[Doge][Sweats]，还有[未知]');
  assert.equal(page.data.messages[0].displayContent, '你好😎🐶😓，还有[未知]');
});

test('表情选择器在光标位置插入微信代码并按原码发送', async () => {
  session = activeSession(); newest = []; posts.length = 0;
  const page = createPage();
  await page.refresh();
  page.onInput({ detail: { value: '你好世界', cursor: 2 } });
  page.toggleEmojis();
  assert.equal(page.data.showEmojis, true);
  page.insertEmoji({ currentTarget: { dataset: { code: '[Doge]' } } });
  assert.equal(page.data.inputText, '你好[Doge]世界');
  page.insertEmoji({ currentTarget: { dataset: { code: '[unknown]' } } });
  assert.equal(page.data.inputText, '你好[Doge]世界');
  await page.send();
  assert.equal(posts.at(-1).data.content, '你好[Doge]世界');
});
