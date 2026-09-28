const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let unreadCount = 0;
const originalLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request === './api') {
    return { get: async () => ({ totalUnreadCount: unreadCount }) };
  }
  if (request === './auth') {
    return { ensureAuthenticated: async () => {} };
  }
  return originalLoad.call(this, request, ...rest);
};
const unread = require('../../utils/customerServiceUnread');
Module._load = originalLoad;

test('底栏角标显示未读总数，超过 99 条封顶展示', async () => {
  const page = {
    data: {},
    _messageUnreadVisible: true,
    setData(patch) { Object.assign(this.data, patch); }
  };
  unreadCount = 3;
  await unread.refresh(page);
  assert.deepEqual(page.data, { messageUnreadCount: 3, messageUnreadLabel: '3' });

  unreadCount = 123;
  await unread.refresh(page);
  assert.deepEqual(page.data, { messageUnreadCount: 123, messageUnreadLabel: '99+' });

  unread.stop(page);
  unreadCount = 0;
  await unread.refresh(page);
  assert.equal(page.data.messageUnreadCount, 123);
});
