const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = value => JSON.parse(JSON.stringify(value));
function setup(role = 'admin', filename = 'publishWish') {
  let config;
  const calls = { gets: [], writes: [], uploads: [], toasts: [], navigation: [] };
  const controls = { get: async () => ({ content: [], hasNext: false }),
    extract: async () => 'http://tmp/first-frame.jpg', selectedVideo: null };
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
      chooseMedia: options => options.success({ tempFiles: [controls.selectedVideo] }),
      createVideoContext: () => ({ pause: () => { calls.pauses = (calls.pauses || 0) + 1; } }),
      showToast: value => calls.toasts.push(value), navigateBack() {},
      navigateTo: value => calls.navigation.push(value),
      showModal: value => value.success({ confirm: true }) },
    require(name) {
      if (name.endsWith('/videoCover')) return { extractVideoCover: source => controls.extract(source) };
      if (name.endsWith('/media')) return { compressVideo: async file => ({ path: file }) };
      if (name.endsWith('/cos-upload')) return { uploadFile: async file => { calls.uploads.push(file); return 'https://uploaded/video.mp4'; } };
      if (name.endsWith('/wishProducts')) return require('../../utils/wishProducts');
      if (name.endsWith('/detailImagePreload')) return require('../../utils/detailImagePreload');
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return auth;
      if (name.endsWith('/error')) return { getErrorMessage: (err, fallback) => err.message || fallback };
      if (name.endsWith('/pageSync')) return { wrap: value => value };
      return {};
    }
  });
  const page = Object.assign({}, config, { data: plain(config.data),
    selectComponent: () => ({ pause: () => { calls.pauses = (calls.pauses || 0) + 1; } }) });
  page.setData = patch => {
    for (const [key, value] of Object.entries(patch)) {
      const keys = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = page.data;
      for (let i = 0; i < keys.length - 1; i++) target = target[keys[i]];
      target[keys.at(-1)] = value;
    }
  };
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
  assert.equal(page.data.linkedProducts[0].id, id);
  page.data.imageList.push('http://tmp/new.jpg');
  page.setData({ title: '新标题', splitByImage: true });
  await page.submitWish();
  assert.deepEqual(plain(calls.uploads), ['http://tmp/new.jpg']);
  assert.deepEqual(plain(calls.writes), [{ method: 'PUT', url: '/wishes/' + id,
    data: { images: ['https://old/a.jpg', 'https://uploaded/http://tmp/new.jpg'], title: '新标题',
      content: '原正文', expectedPrice: '99.00', linkedProductIds: [id], updateLinkedProduct: true } }]);
});

test('普通用户编辑正文不提交关联字段，只有管理员和档口负责人显示选择入口', async () => {
  for (const role of ['user', 'admin', 'stall_manager']) {
    const { page, controls, calls } = setup(role);
    controls.get = async () => ({ images: ['https://old/a.jpg'], title: '名称', content: '正文' });
    await page.onLoad({ id: '101' });
    assert.equal(page.data.canLinkProduct, role !== 'user');
    await page.submitWish();
    assert.equal('updateLinkedProduct' in calls.writes[0].data, role !== 'user');
    assert.equal('linkedProductIds' in calls.writes[0].data, role !== 'user');
  }
});

test('选中关联商品关闭拆分，取消窗口不改变原关联，移除后可重新拆分', () => {
  const { page } = setup();
  page.setData({ canLinkProduct: true, splitByImage: true, pickerProducts: [{ id: '5', name: '商品' }], showProductPicker: true });
  page.confirmProduct();
  assert.equal(page.data.splitByImage, false);
  page.toggleSplitByImage({ detail: { value: true } });
  assert.equal(page.data.splitByImage, false);
  page.setData({ pickerProducts: [{ id: '6' }], showProductPicker: true });
  page.closeProductPicker();
  assert.equal(page.data.linkedProducts[0].id, '5');
  page.removeLinkedProduct({ currentTarget: { dataset: { id: '5' } } });
  page.toggleSplitByImage({ detail: { value: true } });
  assert.equal(page.data.splitByImage, true);
});

test('关联商品创建只发单条创建请求，提交时兜底关闭拆分', async () => {
  const { page, calls } = setup();
  fill(page);
  page.setData({ canLinkProduct: true, linkedProducts: [{ id: '77' }, { id: '78' }], splitByImage: true });
  await page.submitWish();
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].url, '/wishes');
  assert.deepEqual(plain(calls.writes[0].data.linkedProductIds), ['77', '78']);
});

test('筛选联合查询和分页加载，档口负责人只加载负责档口', async () => {
  const { page, calls, controls } = setup('stall_manager');
  await page.onLoad({});
  controls.get = async url => url === '/stall-managers/stalls/mine' ? [{ id: '3', name: '档口' }]
    : url === '/tags/all' ? [{ id: '4', name: '标签' }] : { content: [{ id: '1' }], hasNext: true };
  await page.openProductPicker();
  page.setData({ productKeyword: ' 外套 ' });
  await page.changeProductStall({ currentTarget: { dataset: { stall: '3' } } });
  await page.changeProductTag({ currentTarget: { dataset: { tag: '4' } } });
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
  assert.deepEqual(plain(page.data.productList), [{ id: 'new', selected: false }]);
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

const imageTap = index => ({ currentTarget: { dataset: { index } } });
function dragTo(page, index, x, y, source = 'touch', id) {
  page.onImageDragStart(imageTap(index));
  page.onImageDragMove({ currentTarget: { dataset: { id: id || page.data.imageItems[index].id } },
    detail: { x, y, source } });
  page.onImageDragEnd();
}

test('长按跨行拖动插入新位置，首图成为封面，移动过程不会改动顺序', () => {
  const { page } = setup();
  page.initImageGrid(330);
  page.refreshImageGrid(['a', 'b', 'c', 'd', 'e']);
  const id = page.data.imageItems[4].id;
  page.onImageDragStart(imageTap(4));
  assert.equal(page.data.dragIndex, 4);
  page.onImageDragMove({ currentTarget: { dataset: { id } }, detail: { x: 0, y: 0, source: 'touch' } });
  assert.deepEqual(plain(page.data.imageList), ['a', 'b', 'c', 'd', 'e']);
  page.onImageDragEnd();
  assert.deepEqual(plain(page.data.imageList), ['e', 'a', 'b', 'c', 'd']);
  assert.equal(page.data.imageItems[0].id, id);
  assert.equal(page.data.dragIndex, -1);
  assert.equal(page.data.imageItems[3].x, 0);
  assert.equal(page.data.imageItems[3].y, page.data.imageStep);
});

test('长按不移动保持位置，程序触发或其他图片的移动事件不影响落点', () => {
  const { page } = setup();
  page.initImageGrid(330);
  page.refreshImageGrid(['a', 'b', 'c', 'd']);
  page.onImageDragStart(imageTap(3));
  page.onImageDragEnd();
  assert.deepEqual(plain(page.data.imageList), ['a', 'b', 'c', 'd']);
  dragTo(page, 3, 0, 0, '');
  assert.deepEqual(plain(page.data.imageList), ['a', 'b', 'c', 'd']);
  dragTo(page, 3, 0, 0, 'touch', 'other');
  assert.deepEqual(plain(page.data.imageList), ['a', 'b', 'c', 'd']);
});

test('拖到空格或网格外按有效位置归位，取消触摸保留原顺序', () => {
  const { page } = setup();
  page.initImageGrid(330);
  page.refreshImageGrid(['a', 'b', 'c', 'd']);
  dragTo(page, 0, 1000, 1000);
  assert.deepEqual(plain(page.data.imageList), ['b', 'c', 'd', 'a']);
  dragTo(page, 3, -1000, -1000);
  assert.deepEqual(plain(page.data.imageList), ['a', 'b', 'c', 'd']);
  page.onImageDragStart(imageTap(3));
  page.onImageDragMove({ currentTarget: { dataset: { id: page.data.imageItems[3].id } },
    detail: { x: 10, y: 10, source: 'touch' } });
  page.cancelImageDrag();
  assert.deepEqual(plain(page.data.imageList), ['a', 'b', 'c', 'd']);
  assert.equal(page.data.imageItems[3].x, 0);
  assert.equal(page.data.imageItems[3].y, page.data.imageStep);
});

test('屏宽适配三列，重复地址独立ID，99张无额外上传格', () => {
  const { page } = setup();
  page.initImageGrid(600);
  page.refreshImageGrid(['same', 'same']);
  assert.notEqual(page.data.imageItems[0].id, page.data.imageItems[1].id);
  assert.equal(page.data.uploadImageX, 2 * page.data.imageStep);
  assert.ok(2 * page.data.imageStep + page.data.imageItemSize <= 600.001);
  page.refreshImageGrid(Array.from({ length: 99 }, (_, index) => 'img' + index));
  assert.equal(page.data.imageAreaHeight, 32 * page.data.imageStep + page.data.imageItemSize);
  page.removeImage(imageTap(98));
  assert.equal(page.data.imageItems.length, 98);
  assert.equal(page.data.uploadImageX, 2 * page.data.imageStep);
  assert.equal(page.data.uploadImageY, 32 * page.data.imageStep);
});

test('编辑已有图片拖动后按新顺序提交，原图不重复上传', async () => {
  const { page, controls, calls } = setup();
  const images = ['https://old/a.jpg', 'https://old/b.jpg', 'https://old/c.jpg', 'https://old/d.jpg'];
  controls.get = async () => ({ images, title: '名称', content: '正文' });
  await page.onLoad({ id: '101' });
  dragTo(page, 3, 0, 0);
  await page.submitWish();
  assert.deepEqual(plain(calls.uploads), []);
  assert.deepEqual(plain(calls.writes[0].data.images), [images[3], ...images.slice(0, 3)]);
});

test('加载或保存时禁用拖动，拖动期间不能删除图片', () => {
  const { page } = setup();
  page.initImageGrid();
  page.refreshImageGrid(['a', 'b']);
  page.setData({ submitting: true });
  page.onImageDragStart(imageTap(1));
  assert.equal(page.data.dragIndex, -1);
  page.setData({ submitting: false, loading: true });
  page.onImageDragStart(imageTap(1));
  assert.equal(page.data.dragIndex, -1);
  page.setData({ loading: false });
  page.onImageDragStart(imageTap(1));
  page.removeImage(imageTap(0));
  assert.deepEqual(plain(page.data.imageList), ['a', 'b']);
});


const productTap = id => ({ currentTarget: { dataset: { id } } });
test('商品多选跨筛选和分页保留，重复点击取消，确认前不修改原关联', async () => {
  const { page, controls } = setup();
  page.setData({ canLinkProduct: true, linkedProducts: [{ id: '9', name: '旧商品' }] });
  controls.get = async url => url.includes('/wishes/')
    ? { content: [{ id: '1', name: '商品一' }], hasNext: true } : [];
  await page.openProductPicker();
  page.selectProduct(productTap('1'));
  controls.get = async () => ({ content: [{ id: '2', name: '商品二' }], hasNext: false });
  await page.changeProductTag({ currentTarget: { dataset: { tag: '3' } } });
  page.selectProduct(productTap('2'));
  assert.deepEqual(plain(page.data.pickerProducts.map(p => p.id)), ['9', '1', '2']);
  assert.deepEqual(plain(page.data.linkedProducts.map(p => p.id)), ['9']);
  controls.get = async () => ({ content: [{ id: '1', name: '商品一' }], hasNext: true });
  await page.searchProducts();
  assert.equal(page.data.productList[0].selected, true);
  page.selectProduct(productTap('1'));
  assert.equal(page.data.productList[0].selected, false);
  await page.loadMoreProducts();
  page.confirmProduct();
  assert.deepEqual(plain(page.data.linkedProducts.map(p => p.id)), ['9', '2']);
  page.removeLinkedProduct(productTap('9'));
  assert.deepEqual(plain(page.data.linkedProducts.map(p => p.id)), ['2']);
});

test('编辑回填多商品保留顺序，部分商品失效也不会丢关联，空数组覆盖旧字段', async () => {
  const { page, controls, calls } = setup();
  controls.get = async url => {
    if (url.includes('/wishes/')) return { images: ['old'], title: '标题', content: '正文',
      linkedProductId: '99', linkedProductIds: ['2', '1', '2'] };
    if (url.endsWith('/2')) throw new Error('商品失效');
    return { product: { id: '1', name: '商品一', bannerImages: ['first.jpg'], coverUrl: 'cover.jpg' } };
  };
  await page.onLoad({ id: '101' });
  assert.deepEqual(plain(page.data.linkedProducts.map(p => p.id)), ['2', '1']);
  assert.equal(page.data.linkedProducts[1].coverUrl, 'cover.jpg');
  await page.submitWish();
  assert.deepEqual(plain(calls.writes[0].data.linkedProductIds), ['2', '1']);
  page.setData({ pickerProducts: [] });
  page.confirmProduct();
  await page.submitWish();
  assert.deepEqual(plain(calls.writes[1].data.linkedProductIds), []);
  const { getLinkedProductIds } = require('../../utils/wishProducts');
  assert.deepEqual(getLinkedProductIds({ linkedProductId: '99', linkedProductIds: [] }), []);
});

test('详情加载多商品首图和名称，点击各商品打开对应详情弹窗，关联行在标题之前', async () => {
  const { page, calls, controls } = setup('user', 'wishDetail');
  page.prepareShareImages = () => {};
  page.setData({ wishId: '101' });
  controls.get = async url => url.includes('/wishes/')
    ? { images: ['wish.jpg'], title: '标题', content: '正文', linkedProductIds: ['2', '1'] }
    : { product: { id: url.split('/').at(-1), name: '商品' + url.split('/').at(-1), bannerImages: ['first.jpg'] } };
  await page.loadWishDetail();
  assert.deepEqual(plain(page.data.linkedProducts.map(p => p.id)), ['2', '1']);
  assert.equal(page.data.linkedProducts[0].name, '商品2');
  assert.equal(page.data.linkedProducts[0].coverUrl, 'first.jpg');
  const opened = [];
  page.selectComponent = () => ({ open: id => opened.push(id) });
  page.goToProduct(productTap('2'));
  page.goToProduct(productTap('1'));
  assert.deepEqual(opened, ['2', '1']);
  assert.equal(calls.navigation.length, 0);
  const markup = fs.readFileSync(path.join(__dirname, '../../pages/wishDetail/wishDetail.wxml'), 'utf8');
  assert.ok(markup.indexOf('class="linked-section"') < markup.indexOf('class="wish-title"'));
  assert.match(markup, /class="linked-product-scroll" scroll-x="true"/);
});

test('详情刷新时旧商品请求晚返回不能盖住新关联，退出页面后不回填', async () => {
  const { page, controls } = setup('user', 'wishDetail');
  page.prepareShareImages = () => {};
  page.setData({ wishId: '101' });
  let resolveProduct;
  controls.get = async url => url.includes('/wishes/')
    ? { images: [], title: '旧标题', linkedProductIds: ['1'] }
    : new Promise(resolve => { resolveProduct = resolve; });
  const first = page.loadWishDetail();
  await new Promise(setImmediate);
  controls.get = async () => ({ images: [], title: '新标题', linkedProductIds: [] });
  await page.loadWishDetail();
  resolveProduct({ id: '1', name: '旧商品' });
  await first;
  assert.equal(page.data.wish.title, '新标题');
  assert.deepEqual(plain(page.data.linkedProducts), []);
  let resolveWish;
  controls.get = () => new Promise(resolve => { resolveWish = resolve; });
  const last = page.loadWishDetail();
  page.onUnload();
  resolveWish({ title: '退出后返回的数据', linkedProductIds: ['2'] });
  await last;
  assert.equal(page.data.wish.title, '新标题');
});


test('弹窗打开时转发商品详情，关闭后恢复心愿分享链接', () => {
  const { page } = setup('admin', 'wishDetail');
  page.setData({ wishId: 'wish-1', wish: { title: '心愿', image: 'wish.jpg' }, productSheetVisible: true });
  page.selectComponent = () => ({ getProductShare: () => ({ title: '商品', path: '/pages/detail/detail?id=product-1' }) });
  assert.equal(page.onShareAppMessage({ from: 'menu' }).path, '/pages/detail/detail?id=product-1');
  page.onProductSheetVisibility({ detail: { visible: false } });
  assert.equal(page.onShareAppMessage({ from: 'menu' }).path, '/pages/wishDetail/wishDetail?id=wish-1');
});


test('视频首帧回填不混入可拖动图片，保存不重复上传旧视频和封面', async () => {
  const { page, controls, calls } = setup('user');
  controls.get = async () => ({ images: ['https://old/cover.jpg', 'https://old/photo.jpg'],
    videoUrl: 'https://old/video.mp4', useVideoCover: true, title: '标题', content: '正文' });
  await page.onLoad({ id: '101' });
  assert.deepEqual(plain(page.data.imageList), ['https://old/photo.jpg']);
  assert.equal(page.data.videoThumbPath, 'https://old/cover.jpg');
  await page.submitWish();
  assert.equal(calls.uploads.length, 0);
  assert.deepEqual(plain(calls.writes[0].data.images), ['https://old/cover.jpg', 'https://old/photo.jpg']);
  assert.equal(calls.writes[0].data.videoUrl, 'https://old/video.mp4');
  assert.equal(calls.writes[0].data.useVideoCover, true);
});

test('移除视频自动取消首帧封面并明确提交空地址', async () => {
  const { page, controls, calls } = setup('user');
  controls.get = async () => ({ images: ['cover.jpg', 'photo.jpg'], videoUrl: 'https://old/video.mp4',
    useVideoCover: true, title: '标题', content: '正文' });
  await page.onLoad({ id: '101' });
  page.removeVideo();
  assert.equal(page.data.videoUrl, '');
  assert.equal(page.data.videoThumbPath, '');
  assert.equal(page.data.useVideoCover, false);
  assert.equal(page.data.imageItems[0].x, 0);
  await page.submitWish();
  assert.equal(calls.writes[0].data.videoUrl, '');
  assert.equal(calls.writes[0].data.useVideoCover, false);
  assert.deepEqual(plain(calls.writes[0].data.images), ['photo.jpg']);
});

test('只上传视频并使用首帧封面也能创建，视频上传后不能按图片拆分', async () => {
  const { page, calls, controls } = setup('user');
  controls.selectedVideo = { tempFilePath: 'http://tmp/video.mp4', duration: 60 };
  page.setData({ title: '标题', content: '正文', splitByImage: true });
  page.uploadVideo();
  assert.equal(page.data.splitByImage, false);
  page.toggleSplitByImage({ detail: { value: true } });
  assert.equal(page.data.splitByImage, false);
  page.toggleVideoCover();
  await page.submitWish();
  assert.deepEqual(plain(calls.uploads), ['http://tmp/first-frame.jpg', 'http://tmp/video.mp4']);
  assert.equal(calls.writes[0].url, '/wishes');
  assert.deepEqual(plain(calls.writes[0].data.images), ['https://uploaded/http://tmp/first-frame.jpg']);
  assert.equal(calls.writes[0].data.useVideoCover, true);
});

test('视频超过一分钟拒绝选择，取帧失败阻止提交并允许重试', async () => {
  const { page, calls, controls } = setup('user');
  controls.selectedVideo = { tempFilePath: 'http://tmp/long.mp4', duration: 61 };
  page.uploadVideo();
  assert.equal(page.data.videoUrl, '');
  page.setData({ videoUrl: 'http://tmp/video.mp4', useVideoCover: true, title: '标题', content: '正文' });
  controls.extract = async () => { throw new Error('取帧失败'); };
  await page.submitWish();
  assert.equal(calls.writes.length, 0);
  assert.equal(page.data.submitting, false);
  assert.equal(page.data.videoCoverLoading, false);
  controls.extract = async () => 'http://tmp/retry.jpg';
  await page.submitWish();
  assert.equal(calls.writes.length, 1);
});

test('视频封面占用一个图片名额，99张图片时禁止勾选首帧', () => {
  const { page, calls } = setup();
  page.setData({ imageList: Array(99).fill('photo.jpg'), videoUrl: 'video.mp4' });
  page.toggleVideoCover();
  assert.equal(page.data.useVideoCover, false);
  assert.match(calls.toasts[0].title, /移除一张图片/);
});

test('详情页面隐藏和打开商品时通知通用画廊暂停', () => {
  const { page, calls } = setup('user', 'wishDetail');
  page.setData({ wish: { images: [], videoUrl: 'https://old/video.mp4' } });
  page.onHide();
  page.onProductSheetVisibility({ detail: { visible: true } });
  assert.equal(calls.pauses, 2);
});


test('详情悬浮视频打开全屏时暂停轮播，返回键优先关闭视频', () => {
  const { page, calls } = setup('user', 'wishDetail');
  page.setData({ wish: { videoUrl: 'video.mp4', images: ['cover.jpg'] } });
  page.openVideoOverlay();
  assert.equal(page.data.showVideo, true);
  assert.equal(calls.pauses, 1);
  page.goBack();
  assert.equal(page.data.showVideo, false);
  assert.equal(calls.pauses, 2);
  page.setData({ productSheetVisible: true });
  page.openVideoOverlay();
  assert.equal(page.data.showVideo, false);
});


test('首帧封面占图片组第一格，普通图片和添加入口顺延，取消勾选后归位', async () => {
  const { page } = setup();
  page.setData({ videoUrl: 'video.mp4' });
  page.refreshImageGrid(['a.jpg', 'b.jpg']);
  page.toggleVideoCover();
  await page.ensureVideoCover();
  assert.equal(page.data.imageItems[0].x, page.data.imageStep);
  assert.equal(page.data.imageItems[1].x, page.data.imageStep * 2);
  assert.equal(page.data.uploadImageX, 0);
  assert.equal(page.data.uploadImageY, page.data.imageStep);
  assert.equal(page.data.imageAreaHeight, page.data.imageStep + page.data.imageItemSize);
  page.toggleVideoCover();
  assert.equal(page.data.imageItems[0].x, 0);
  assert.equal(page.data.uploadImageX, page.data.imageStep * 2);
  assert.equal(page.data.uploadImageY, 0);
});

test('图片拖到视频封面位置也只能排在封面后，跨行排序扣除固定封面格', () => {
  const { page } = setup();
  page.setData({ videoUrl: 'video.mp4', useVideoCover: true, videoThumbPath: 'cover.jpg' });
  page.refreshImageGrid(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
  page.onImageDragStart({ currentTarget: { dataset: { index: 3 } } });
  page.onImageDragMove({ currentTarget: { dataset: { id: page.data.imageItems[3].id } },
    detail: { x: 0, y: 0, source: 'touch' } });
  page.onImageDragEnd();
  assert.deepEqual(plain(page.data.imageList), ['d.jpg', 'a.jpg', 'b.jpg', 'c.jpg']);
  assert.equal(page.data.imageItems[0].x, page.data.imageStep);
  assert.equal(page.data.videoThumbPath, 'cover.jpg');
  page.onImageDragStart({ currentTarget: { dataset: { index: 0 } } });
  page.onImageDragMove({ currentTarget: { dataset: { id: page.data.imageItems[0].id } },
    detail: { x: 0, y: page.data.imageStep, source: 'touch' } });
  page.onImageDragEnd();
  assert.deepEqual(plain(page.data.imageList), ['a.jpg', 'b.jpg', 'd.jpg', 'c.jpg']);
});

test('视频封面在图片组内使用固定普通view，没有删除或拖动绑定', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/publishWish/publishWish.wxml'), 'utf8');
  const cover = wxml.slice(wxml.indexOf('class="image-drag-item video-cover-fixed"'), wxml.indexOf('<movable-view wx:for'));
  assert.match(cover, /视频封面/);
  assert.doesNotMatch(cover, /removeImage|onImageDragStart|movable-view/);
  assert.doesNotMatch(wxml, /video-cover-preview/);
});


test('心愿分享和视频浮窗与商品一致：轻微抖动不挪位，拖动松手不打开，取消触摸不误触', () => {
  const { page } = setup('admin', 'wishDetail');
  page.setData({ wish: { videoUrl: 'video.mp4' }, shareFloatLeft: 200, shareFloatTop: 100 });
  page._shareWindow = { width: 375, height: 750 };
  let shares = 0;
  page.openShareTemplateSelector = () => { shares++; };
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  page.startShareFloatDrag(touch(210, 110));
  page.moveShareFloat(touch(212, 112));
  assert.equal(page.data.shareFloatLeft, 200);
  page.endShareFloatDrag();
  assert.equal(shares, 1);
  page.startShareFloatDrag(touch(210, 110));
  page.moveShareFloat(touch(-100, 999));
  page.endShareFloatDrag();
  assert.equal(shares, 1);
  assert.equal(page.data.shareFloatLeft, 0);
  assert.equal(page.data.shareFloatTop, 692);
  page.startShareFloatDrag(touch(10, 700));
  page.cancelFloatTouch();
  page.endShareFloatDrag();
  assert.equal(shares, 1);
  page.startVideoFloatTouch(touch(310, 600));
  page.moveVideoFloat(touch(280, 570));
  page.endVideoFloatTouch();
  assert.equal(page.data.showVideo, false);
  assert.match(page.data.videoFloatStyle, /left:/);
  page.startVideoFloatTouch(touch(280, 570));
  page.endVideoFloatTouch();
  assert.equal(page.data.showVideo, true);
  page.closeVideoOverlay();
  page.startVideoFloatTouch(touch(280, 570));
  page.cancelVideoFloatTouch();
  page.endVideoFloatTouch();
  assert.equal(page.data.showVideo, false);
});
