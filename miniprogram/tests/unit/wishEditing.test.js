const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = value => JSON.parse(JSON.stringify(value));
function setup(role = 'admin', filename = 'publishWish') {
  let config;
  const calls = { gets: [], writes: [], uploads: [], toasts: [], navigation: [] };
  const controls = { get: async () => ({ content: [], hasNext: false }) };
  const auth = { isAdmin: () => role === 'admin', isStallManager: () => role === 'stall_manager',
    getUserInfo: () => ({ userId: '7', role }), ensureAuthenticated: async () => {} };
  const api = {
    get: async (url, data) => { calls.gets.push({ url, data }); return controls.get(url, data); },
    post: async (url, data) => { calls.writes.push({ method: 'POST', url, data }); },
    put: async (url, data) => { calls.writes.push({ method: 'PUT', url, data }); },
    uploadFile: async (url, image) => { calls.uploads.push(image); return { url: 'https://uploaded/' + image }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages', filename, filename + '.js'), 'utf8'), {
    Page: value => { config = value; }, console, Set,
    setTimeout: () => 1, clearTimeout() {},
    wx: { showLoading() {}, hideLoading() {}, setNavigationBarTitle() {},
      showToast: value => calls.toasts.push(value), navigateBack() {},
      navigateTo: value => calls.navigation.push(value),
      showModal: value => value.success({ confirm: true }) },
    require(name) {
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return auth;
      if (name.endsWith('/error')) return { getErrorMessage: (err, fallback) => err.message || fallback };
      if (name.endsWith('/pageSync')) return { wrap: value => value };
      return {};
    }
  });
  const page = Object.assign({}, config, { data: plain(config.data) });
  page.setData = patch => Object.assign(page.data, patch);
  return { page, calls, controls };
}
function fill(page) { page.setData({ imageList: ['new.jpg'], title: '名称', content: '正文' }); }

test('编辑回填心愿和商品，保留预算与长整数ID，只上传新增图片', async () => {
  const { page, calls, controls } = setup();
  const id = '360435019602202624';
  controls.get = async url => url.includes('/wishes/')
    ? { images: ['https://old/a.jpg'], title: '原标题', content: '原正文', expectedPrice: '99.00', linkedProductId: id }
    : { id, name: '原商品', coverUrl: 'cover.jpg' };
  await page.onLoad({ id });
  assert.equal(page.data.title, '原标题');
  assert.equal(page.data.linkedProduct.id, id);
  page.data.imageList.push('http://tmp/new.jpg');
  page.setData({ title: '新标题', splitByImage: true });
  await page.submitWish();
  assert.deepEqual(plain(calls.uploads), ['http://tmp/new.jpg']);
  assert.deepEqual(plain(calls.writes), [{ method: 'PUT', url: '/wishes/' + id,
    data: { images: ['https://old/a.jpg', 'https://uploaded/http://tmp/new.jpg'], title: '新标题',
      content: '原正文', expectedPrice: '99.00', linkedProductId: id, updateLinkedProduct: true } }]);
});

test('普通用户编辑正文不提交关联字段，只有管理员和档口负责人显示选择入口', async () => {
  for (const role of ['user', 'admin', 'stall_manager']) {
    const { page, controls, calls } = setup(role);
    controls.get = async () => ({ images: ['https://old/a.jpg'], title: '名称', content: '正文' });
    await page.onLoad({ id: '101' });
    assert.equal(page.data.canLinkProduct, role !== 'user');
    await page.submitWish();
    assert.equal('updateLinkedProduct' in calls.writes[0].data, role !== 'user');
    assert.equal('linkedProductId' in calls.writes[0].data, role !== 'user');
  }
});

test('选中关联商品关闭拆分，取消窗口不改变原关联，移除后可重新拆分', () => {
  const { page } = setup();
  page.setData({ canLinkProduct: true, splitByImage: true, pickerProduct: { id: '5', name: '商品' }, showProductPicker: true });
  page.confirmProduct();
  assert.equal(page.data.splitByImage, false);
  page.toggleSplitByImage({ detail: { value: true } });
  assert.equal(page.data.splitByImage, false);
  page.setData({ pickerProduct: { id: '6' }, showProductPicker: true });
  page.closeProductPicker();
  assert.equal(page.data.linkedProduct.id, '5');
  page.removeLinkedProduct();
  page.toggleSplitByImage({ detail: { value: true } });
  assert.equal(page.data.splitByImage, true);
});

test('关联商品创建只发单条创建请求，提交时兜底关闭拆分', async () => {
  const { page, calls } = setup();
  fill(page);
  page.setData({ canLinkProduct: true, linkedProduct: { id: '77' }, splitByImage: true });
  await page.submitWish();
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].url, '/wishes');
  assert.equal(calls.writes[0].data.linkedProductId, '77');
});

test('筛选联合查询和分页加载，档口负责人只加载负责档口', async () => {
  const { page, calls, controls } = setup('stall_manager');
  await page.onLoad({});
  controls.get = async url => url === '/stall-managers/stalls/mine' ? [{ id: '3', name: '档口' }]
    : url === '/tags/all' ? [{ id: '4', name: '标签' }] : { content: [{ id: '1' }], hasNext: true };
  await page.openProductPicker();
  page.setData({ productKeyword: ' 外套 ', stallIndex: 1, tagIndex: 1 });
  await page.searchProducts();
  await page.loadMoreProducts();
  assert.deepEqual(plain(calls.gets.at(-1)), { url: '/wishes/linkable-products', data: { page: 2, size: 20, keyword: '外套', stallId: '3', tagId: '4' } });
  assert.equal(calls.gets.some(call => call.url === '/stalls/all'), false);
});

test('筛选变化时旧请求晚返回不会覆盖新结果，关闭窗口后不写入结果', async () => {
  const { page, controls } = setup();
  page.setData({ showProductPicker: true });
  let resolveOld;
  controls.get = () => new Promise(resolve => { resolveOld = resolve; });
  const oldTask = page.loadProducts(true);
  controls.get = async () => ({ content: [{ id: 'new' }], hasNext: false });
  page.setData({ productKeyword: '新' });
  await page.searchProducts();
  resolveOld({ content: [{ id: 'old' }], hasNext: true });
  await oldTask;
  assert.deepEqual(plain(page.data.productList), [{ id: 'new' }]);
  controls.get = () => new Promise(resolve => { resolveOld = resolve; });
  const closedTask = page.loadProducts(true);
  page.closeProductPicker();
  resolveOld({ content: [{ id: 'closed' }], hasNext: false });
  await closedTask;
  assert.deepEqual(plain(page.data.productList), []);
});

test('加载失败禁止保存，避免覆盖已有心愿', async () => {
  const { page, controls, calls } = setup();
  controls.get = async () => { throw new Error('无权编辑'); };
  await page.onLoad({ id: '101' });
  fill(page);
  await page.submitWish();
  assert.equal(calls.writes.length, 0);
  assert.equal(page.data.loadFailed, true);
});

test('详情页只有创建者和管理员可编辑，跳转携带心愿ID', async () => {
  for (const role of ['user', 'admin', 'stall_manager']) {
    const { page, calls } = setup(role, 'wishDetail');
    page.setData({ wishId: '101', wish: { createdBy: '8' } });
    page.checkDeletePermission(page.data.wish);
    assert.equal(page.data.canEdit, role === 'admin');
    page.setData({ wish: { createdBy: '7' } });
    await page.editWish();
    assert.equal(calls.navigation[0].url, '/pages/publishWish/publishWish?id=101');
  }
});
