const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(admin = true) {
  let config;
  const calls = { posts: [], navigation: [], toasts: [], reloads: [], modals: 0 };
  const controls = { confirm: true, post: async (url, data) => ({ count: data.wishIds.length, wishIds: data.wishIds }) };
  const auth = { getUserInfo: () => ({ userId: '7' }), isAdmin: () => admin,
    isStallManager: () => false, ensureAuthenticated: async () => {} };
  const context = { console: { log() {}, error() {} }, Page: value => { config = value; },
    wx: { showLoading() {}, hideLoading() {},
      showToast: value => calls.toasts.push(value),
      showModal: value => { calls.modals++; value.success({ confirm: controls.confirm }); },
      navigateTo: value => calls.navigation.push(value) },
    require(name) {
      if (name.endsWith('/error')) return { getErrorMessage: (err, fallback) => err.message || fallback };
      if (name.endsWith('/pageSync')) return { wrap: value => value };
      if (name.endsWith('/auth')) return auth;
      if (name.endsWith('/api')) return { post: async (url, data) => {
        calls.posts.push({ url, data }); return controls.post(url, data);
      } };
      return {};
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/market/market.js'), 'utf8'), context);
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = patch => Object.assign(page.data, patch);
  page.loadWishes = async (...args) => { calls.reloads.push(args); };
  page.data.isAdmin = admin;
  page.updateWishColumns([
    { id: '360435019602202624', createdBy: '7', likes: 5 },
    { id: '360435019602202625', createdBy: '8', likes: 4 },
    { id: '360435019602202626', createdBy: '7', likes: 3 }
  ]);
  return { page, calls, controls, auth };
}
const tap = id => ({ currentTarget: { dataset: { id } } });
const plain = value => JSON.parse(JSON.stringify(value));

test('管理员管理模式卡片勾选、全选及取消管理清空选择', async () => {
  const { page, calls } = setup();
  await page.toggleWishManagement();
  page.goToWishDetail(tap(page.data.wishes[0].id));
  assert.equal(page.data.selectedWishCount, 1);
  assert.equal(calls.navigation.length, 0);
  page.goToWishDetail(tap(page.data.wishes[1].id));
  assert.equal(page.data.selectedWishCount, 2);
  page.toggleSelectAllWishes();
  assert.equal(page.data.selectedWishCount, 3);
  assert.equal(page.data.allWishesSelected, true);
  page.toggleSelectAllWishes();
  assert.equal(page.data.selectedWishCount, 0);
  await page.toggleWishManagement();
  assert.equal(page.data.managingWishes, false);
  assert.equal(page.data.wishes.some(wish => wish.selected), false);
});

test('管理员能全选，追加分页后全选状态按已加载列表重新计算', async () => {
  const { page } = setup(true);
  await page.toggleWishManagement();
  page.toggleSelectAllWishes();
  assert.equal(page.data.selectedWishCount, 3);
  page.updateWishColumns(page.data.wishes.concat({ id: '999', createdBy: '8' }));
  assert.equal(page.data.allWishesSelected, false);
  assert.equal(page.data.selectedWishCount, 3);
  page.toggleSelectAllWishes();
  assert.equal(page.data.selectedWishCount, 4);
});

test('未选择和取消确认不发删除请求，保留原选择', async () => {
  const { page, calls, controls } = setup();
  await page.toggleWishManagement();
  await page.deleteSelectedWishes();
  assert.equal(calls.modals, 0);
  page.toggleSelectAllWishes();
  controls.confirm = false;
  await page.deleteSelectedWishes();
  assert.equal(calls.posts.length, 0);
  assert.equal(page.data.selectedWishCount, 3);
  assert.equal(page.data.deletingWishes, false);
});

test('删除成功只提交选中长整数ID，移除卡片并重置分页', async () => {
  const { page, calls } = setup();
  await page.toggleWishManagement();
  page.toggleWishSelection(tap(page.data.wishes[0].id));
  page.toggleWishSelection(tap(page.data.wishes[2].id));
  const ids = plain(page.data.selectedWishIds);
  await page.deleteSelectedWishes();
  assert.deepEqual(plain(calls.posts), [{ url: '/wishes/batch/delete', data: { wishIds: ids } }]);
  assert.deepEqual(plain(page.data.wishes.map(wish => wish.id)), ['360435019602202625']);
  assert.equal(page.data.selectedWishCount, 0);
  assert.equal(page.data.deletingWishes, false);
  assert.deepEqual(plain(calls.reloads), [[true, true]]);
});

test('删除失败保留卡片与勾选，可重试', async () => {
  const { page, controls, calls } = setup();
  await page.toggleWishManagement();
  page.toggleSelectAllWishes();
  controls.post = async () => { throw new Error('仅管理员可以批量删除心愿'); };
  await page.deleteSelectedWishes();
  assert.equal(page.data.wishes.length, 3);
  assert.equal(page.data.selectedWishCount, 3);
  assert.equal(page.data.deletingWishes, false);
  assert.equal(calls.reloads.length, 0);
});

test('分页未结束时等待，删除过程中拦截重复提交及选择变更', async () => {
  const { page, calls } = setup();
  await page.toggleWishManagement();
  page.toggleSelectAllWishes();
  let resolvePage;
  page._wishesTask = new Promise(resolve => { resolvePage = resolve; });
  const task = page.deleteSelectedWishes();
  await Promise.resolve();
  assert.equal(calls.posts.length, 0);
  await page.deleteSelectedWishes();
  page.toggleSelectAllWishes();
  await page.toggleWishManagement();
  assert.equal(page.data.selectedWishCount, 3);
  assert.equal(calls.modals, 1);
  resolvePage();
  await task;
  assert.equal(calls.posts.length, 1);
});

test('选择变更保持现有双列位置，刷新移除旧记录时清理勾选', async () => {
  const { page } = setup(true);
  await page.toggleWishManagement();
  page.data.leftColumn = [page.data.wishes[0]];
  page.data.rightColumn = [page.data.wishes[1], page.data.wishes[2]];
  page.toggleSelectAllWishes();
  assert.equal(page.data.leftColumn.length, 1);
  assert.equal(page.data.rightColumn.length, 2);
  page.updateWishColumns([page.data.wishes[0]]);
  assert.equal(page.data.selectedWishCount, 1);
});

test('非管理员不能进入管理或通过直接调用触发批量删除', async () => {
  const { page, calls } = setup(false);
  await page.toggleWishManagement();
  assert.equal(page.data.managingWishes, false);
  assert.equal(page.data.wishes.some(wish => wish.canDelete), false);
  page.data.managingWishes = true;
  page.data.selectedWishIds = [page.data.wishes[0].id];
  page.toggleSelectAllWishes();
  await page.deleteSelectedWishes();
  assert.equal(calls.modals, 0);
  assert.equal(calls.posts.length, 0);
  const template = fs.readFileSync(path.join(__dirname, '../../pages/market/market.wxml'), 'utf8');
  assert.ok(template.includes('class="wish-management-actions" wx:if="{{isAdmin}}"'));
});

test('管理员切换为普通身份后退出管理并清空勾选', async () => {
  const { page, auth } = setup();
  await page.toggleWishManagement();
  page.toggleSelectAllWishes();
  auth.isAdmin = () => false;
  page.checkAdmin();
  assert.equal(page.data.isAdmin, false);
  assert.equal(page.data.managingWishes, false);
  assert.equal(page.data.selectedWishCount, 0);
  assert.equal(page.data.wishes.some(wish => wish.selected), false);
});
