const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveDirection, moveSheet, settleSheet } = require('../../utils/productSheetGesture');
const plain = value => JSON.parse(JSON.stringify(value));

function setup(component = 'productDetailSheet', handlers = {}) {
  let definition, timerId = 0, now = 1000;
  const timers = new Map(), events = [], calls = { locks: 0, suppress: 0, pause: 0, posts: [], navigation: [], storage: [] };
  const child = { lockVerticalGesture() { calls.locks++; }, suppressGestureTap() { calls.suppress++; },
    pauseProductVideos() { calls.pause++; }, getProductShare: () => ({ path: '/pages/detail/detail?id=1' }) };
  const filename = path.resolve(__dirname, '../../components', component, 'index.js');
  const ctx = {
    Component(value) { definition = value; }, console,
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    Date: class extends Date { static now() { return now; } },
    getApp: () => ({}),
    wx: { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 750, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({ left: 280, bottom: 70 }), showLoading() {}, hideLoading() {},
      showToast() {}, showModal() {}, createVideoContext: () => ({ pause() {}, play() {} }),
      navigateTo: value => calls.navigation.push(value), setStorageSync: (key, value) => calls.storage.push({ key, value }) },
    require(name) {
      if (name.endsWith('/api')) return {
        get: handlers.get || (async () => ({ product: { id: '1', name: '商品', skuMatrix: [] } })),
        post: async (url, data) => { calls.posts.push({ url, data }); return handlers.post ? handlers.post(url, data) : {}; }
      };
      if (name.endsWith('/auth')) return { isAdmin: () => false, isStallManager: () => false, ensureAuthenticated: async () => {} };
      if (name.endsWith('/shareImage')) return { createShareImage: async () => '' };
      if (name === './controller') {
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(path.dirname(filename), 'controller.js'), 'utf8'), { ...ctx, module });
        return module.exports;
      }
      return require(path.resolve(path.dirname(filename), name));
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), ctx);
  const instance = { ...definition.methods, data: plain(definition.data), _attached: true,
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
    triggerEvent(name, detail) { events.push({ name, detail }); },
    selectComponent() { return child; },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect(cb) { this.cb = cb; return this; }, exec() { this.cb({ height: 2100 }); } }; }
  };
  if (component === 'productDetail') {
    instance.data.viewportHeight = 472; instance.data.contentOffset = 0; instance.data.productId = '1'; instance._ready = true;
  }
  const flush = delay => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay === delay) { timers.delete(id); timer.fn(); }
    }
  };
  const move = (x, y, elapsed = 100) => { now += elapsed; instance.onGestureMove({ detail: { x, y } }); };
  return { instance, definition, calls, events, child, flush, move, timers };
}
function opened() {
  const env = setup(); env.instance.open('360435019602202624'); env.flush(30); env.flush(280); return env;
}
test('详情主图、正文和横滑图使用兼容地址，SKU 预览同步使用同一地址', async () => {
  const url = require('../../utils/config').CDN_BASE_URL + '/xzm/products/gray.jpg';
  const safe = url + '?imageMogr2/strip';
  const { instance } = setup('productDetail', { get: async () => ({ product: {
    id: '1', name: '灰度尺码图', coverUrl: url, bannerImages: [url], lookbookImages: [url],
    detailImages: [url], skuMatrix: [{ skuId: '2', imageUrl: url }]
  } }) });
  await instance.getProductDetail('1');
  assert.deepEqual(plain(instance.data.bannerImgs), [safe, safe]);
  assert.deepEqual(plain(instance.data.lookbookImgs), [safe]);
  assert.deepEqual(plain(instance.data.detailImgs), [safe]);
  assert.equal(instance.data.product.skuMatrix[0].imageUrl, safe);
});
const tap = (dataset = {}) => ({ currentTarget: { dataset } });

test('顶部每张图片独立适配，切换商品重置模式并忽略旧图片加载回调', async () => {
  let product = { id: '1', coverUrl: 'portrait.jpg', bannerImages: ['wide.jpg'], skuMatrix: [] };
  const { instance } = setup('productDetail', { get: async () => ({ product }) });
  await instance.getProductDetail('1');
  assert.deepEqual(plain(instance.data.bannerImageModes), ['aspectFit', 'aspectFit']);
  const load = (index, src, width, height) => instance.onBannerImageLoad({
    currentTarget: { dataset: { index, src } }, detail: { width, height }
  });
  load(0, 'portrait.jpg', 750, 1000);
  load(1, 'wide.jpg', 714, 102);
  assert.deepEqual(plain(instance.data.bannerImageModes), ['aspectFill', 'aspectFit']);
  const previousHeight = instance.data.galleryHeight;
  instance.onBannerChange({ detail: { current: 1 } });
  assert.equal(instance.data.galleryHeight, previousHeight);
  await instance.getProductDetail('1');
  assert.deepEqual(plain(instance.data.bannerImageModes), ['aspectFill', 'aspectFit'], '已加载地址使用页面内缓存');
  product = { id: '2', coverUrl: 'new.jpg', skuMatrix: [] };
  await instance.getProductDetail('2');
  load(0, 'portrait.jpg', 750, 1000);
  assert.deepEqual(plain(instance.data.bannerImageModes), ['aspectFit'], '旧回调不影响新商品');
  load(0, 'new.jpg', 0, 0);
  assert.deepEqual(plain(instance.data.bannerImageModes), ['aspectFit']);
});

test('细节图片独立判断、复用缓存，切商品后不接收旧图回调', async () => {
  let product = { id: '1', detailImages: ['detail-portrait', 'detail-wide'], skuMatrix: [] };
  const { instance } = setup('productDetail', { get: async () => ({ product }) });
  await instance.getProductDetail('1');
  assert.deepEqual(plain(instance.data.detailImageModes), ['aspectFit', 'aspectFit']);
  const load = (index, src, width, height) => instance.onDetailImageLoad({
    currentTarget: { dataset: { index, src } }, detail: { width, height }
  });
  load(0, 'detail-portrait', 750, 1000);
  load(1, 'detail-wide', 714, 102);
  assert.deepEqual(plain(instance.data.detailImageModes), ['aspectFill', 'aspectFit']);
  instance.onResize();
  assert.deepEqual(plain(instance.data.detailImageModes), ['aspectFill', 'aspectFit']);
  await instance.getProductDetail('1');
  assert.deepEqual(plain(instance.data.detailImageModes), ['aspectFill', 'aspectFit']);
  product = { id: '2', detailImages: ['new-detail'], skuMatrix: [] };
  await instance.getProductDetail('2');
  load(0, 'detail-portrait', 750, 1000);
  load(0, 'new-detail', 0, 0);
  assert.deepEqual(plain(instance.data.detailImageModes), ['aspectFit']);
});

test('细节图箭头逐张切换并限制首尾，横滑后继续从当前页翻图', () => {
  const { instance } = setup('productDetail');
  instance.data.detailImgs = ['first', 'second', 'third'];
  const change = step => instance.changeDetailImage(tap({ step }));
  change(-1);
  assert.equal(instance.data.currentDetailIndex, 1);
  change(1);
  assert.equal(instance.data.currentDetailIndex, 2);
  change(1);
  change(1);
  assert.equal(instance.data.currentDetailIndex, 3);
  instance.onDetailSwiperChange({ detail: { current: 1 } });
  change(-1);
  assert.equal(instance.data.currentDetailIndex, 1);
  instance._suppressTapUntil = 2000;
  change(1);
  assert.equal(instance.data.currentDetailIndex, 1, '刚滑动后不会误触箭头再翻一张');
  instance._suppressTapUntil = 0;
  instance.data.detailImgs = ['only'];
  change(1);
  assert.equal(instance.data.currentDetailIndex, 1);
  change('invalid');
  assert.equal(instance.data.currentDetailIndex, 1);
});

test('细节轮播首尾按需显示方向按钮，去掉下一张预览且按钮不触发大图', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../../components/productDetail/document.wxml'), 'utf8');
  assert.doesNotMatch(template, /next-margin=/);
  assert.match(template, /wx:if="\{\{currentDetailIndex > 1\}\}"[^\n]+catchtap="changeDetailImage"[^\n]+data-step="-1"/);
  assert.match(template, /wx:if="\{\{currentDetailIndex < detailImgs.length\}\}"[^\n]+catchtap="changeDetailImage"[^\n]+data-step="1"/);
});

test('只有图片准确横向滑动才翻图，斜滑按纵向，微小移动不锁定', () => {
  assert.equal(resolveDirection(5, 3, true), '');
  assert.equal(resolveDirection(100, 20, true), 'horizontal');
  assert.equal(resolveDirection(30, 25, true), 'vertical');
  assert.equal(resolveDirection(30, 25, false), 'ignore');
  assert.equal(resolveDirection(5, 30, false), 'vertical');
});

test('半屏上拉先展开，到顶后才滚正文，全屏下拉先回滚正文', () => {
  assert.deepEqual(moveSheet({ top: 250, offset: 100 }, -150, 750, 2200), { top: 100, offset: 100 });
  assert.deepEqual(moveSheet({ top: 250, offset: 100 }, -300, 750, 2200), { top: 0, offset: 150 });
  assert.deepEqual(moveSheet({ top: 0, offset: 600, origin: 'full' }, 120, 750, 2200), { top: 0, offset: 480 });
  assert.deepEqual(moveSheet({ top: 0, offset: 600, origin: 'full' }, 900, 750, 2200), { top: 0, offset: 0 });
  assert.deepEqual(moveSheet({ top: 0, offset: 0, origin: 'full' }, 120, 750, 2200), { top: 120, offset: 0 });
  assert.deepEqual(moveSheet({ top: 0, offset: 1400 }, -400, 750, 2200), { top: 0, offset: 1450 });
});

test('松手按距离和方向吸附全屏半屏或关闭，轻拖不会误关闭', () => {
  assert.equal(settleSheet(225, 'half', 750, 0), 'half');
  assert.equal(settleSheet(140, 'half', 750, 0), 'full');
  assert.equal(settleSheet(400, 'half', 750, 0), 'closed');
  assert.equal(settleSheet(30, 'full', 750, 0), 'full');
  assert.equal(settleSheet(100, 'full', 750, 0), 'closed');
  assert.equal(settleSheet(30, 'full', 750, 3), 'full');
  assert.equal(settleSheet(69, 'full', 750, 3), 'full');
  assert.equal(settleSheet(70, 'full', 750, 0), 'closed');
  assert.equal(settleSheet(430, 'full', 750, 0), 'closed');
  for (const height of [480, 750, 932]) {
    const half = height / 3, distance = Math.min(70, half * 0.4);
    assert.equal(settleSheet(half - distance + 1, 'half', height, -3), 'half');
    assert.equal(settleSheet(half - distance, 'half', height, 0), 'full');
    assert.equal(settleSheet(distance - 1, 'full', height, 3), 'full');
    assert.equal(settleSheet(distance, 'full', height, 0), 'closed');
    assert.equal(settleSheet(half + distance - 1, 'half', height, 3), 'half');
    assert.equal(settleSheet(half + distance, 'half', height, 0), 'closed');
  }
});

test('打开三分之二窗口只创建一次商品，全屏完成后才显示导航，下拉立即隐藏', () => {
  const { instance: sheet, flush, move } = opened();
  assert.equal(sheet.data.sheetTop, 250);
  assert.equal(sheet.data.expansionProgress, 0);
  assert.equal(sheet.data.headerHeight, 0);
  assert.equal(sheet.data.contentHeight, 500);
  assert.equal(sheet.data.fullscreen, false);
  sheet.onGestureStart({ detail: { x: 10, y: 400, image: false } }); move(10, 100);
  assert.equal(sheet.data.sheetTop, 0); assert.equal(sheet.data.fullscreen, false);
  sheet.onGestureEnd(); assert.equal(sheet.data.fullscreen, false);
  flush(280); assert.equal(sheet.data.fullscreen, true); assert.equal(sheet.data.headerHeight, 68);
  assert.equal(sheet.data.contentHeight, 750, '全屏导航覆盖图片，不扣除导航占位高度');
  assert.equal(sheet.data.expansionProgress, 1);
  assert.equal(sheet.data.activeProductId, '360435019602202624'); assert.equal(sheet.data.mounted, true);
  sheet.setData({ contentOffset: 0 });
  sheet.onGestureStart({ detail: { x: 10, y: 100, image: false } }); move(10, 140);
  assert.equal(sheet.data.fullscreen, false); assert.equal(sheet.data.sheetTop, 40);
  sheet.onGestureEnd(); flush(280); assert.equal(sheet.data.state, 'full');
  assert.equal(sheet.data.fullscreen, true); assert.equal(sheet.data.sheetTop, 0);
});

test('半屏上滑只展开到全屏，超出距离和松手速度都不会继续滚动正文', () => {
  const { instance: sheet, flush, move } = opened();
  sheet.onDocumentHeight({ detail: { height: 2400 } });
  sheet.onGestureStart({ detail: { x: 20, y: 600, image: false } });
  move(20, 50, 100);
  assert.equal(sheet.data.sheetTop, 0);
  assert.equal(sheet.data.contentOffset, 0, '超出展开距离不滚正文');
  sheet.onGestureEnd();
  flush(280);
  flush(16);
  assert.equal(sheet.data.fullscreen, true);
  assert.equal(sheet.data.contentOffset, 0, '展开完成后不启动惯性');
  sheet.onGestureStart({ detail: { x: 20, y: 500, image: false } });
  move(20, 400, 100);
  assert.equal(sheet.data.contentOffset, 0, '触摸事件不模拟正文滚动');
  sheet.onContentScroll({ detail: { offset: 100 } });
  sheet.onGestureEnd();
  flush(16);
  assert.equal(sheet.data.contentOffset, 100, 'JS 不接管原生惯性');
});

test('图片横滑不移动弹窗，方向锁定后不混入纵向，正文不抢轮播', () => {
  const { instance: sheet, move, calls } = opened();
  sheet.onGestureStart({ detail: { x: 10, y: 200, image: true } }); move(110, 210); move(120, 310);
  assert.equal(sheet.data.sheetTop, 250); assert.equal(calls.locks, 0);
  assert.ok(calls.suppress > 0); sheet.onGestureEnd();
  sheet.onGestureStart({ detail: { x: 10, y: 200, image: true } }); move(30, 160);
  assert.equal(sheet.data.sheetTop, 210); assert.equal(calls.locks, 1);
  move(300, 150); assert.equal(sheet.data.sheetTop, 200);
});

test('全屏下拉先回滚正文，到顶重新下拉，不够距离回弹，足够距离直接关闭', () => {
  const { instance: sheet, flush, move } = opened();
  sheet.onDocumentHeight({ detail: { height: 2400 } }); sheet.snapTo('full'); flush(280);
  sheet.setData({ contentOffset: 500 });
  sheet.onGestureStart({ detail: { x: 20, y: 300, nativeContent: true, offset: 500 } }); move(20, 200);
  sheet.onContentScroll({ detail: { offset: 600 } });
  assert.equal(sheet.data.fullscreen, true); assert.equal(sheet.data.contentOffset, 600);
  sheet.onGestureEnd(); assert.equal(sheet.data.fullscreen, true);
  sheet.onGestureStart({ detail: { x: 20, y: 200, nativeContent: true, offset: 600 } }); move(20, 310);
  sheet.onContentScroll({ detail: { offset: 490 } });
  assert.equal(sheet.data.sheetTop, 0); assert.equal(sheet.data.contentOffset, 490);
  assert.equal(sheet.data.fullscreen, true); sheet.onGestureEnd();
  sheet.onGestureStart({ detail: { x: 20, y: 100, nativeContent: true, offset: 490 } }); move(20, 700);
  sheet.onContentScroll({ detail: { offset: 0 } });
  move(20, 740);
  assert.equal(sheet.data.sheetTop, 0); assert.equal(sheet.data.contentOffset, 0);
  sheet.onGestureEnd(); assert.equal(sheet.data.state, 'full');
  sheet.onGestureStart({ detail: { x: 20, y: 100 } }); move(20, 140);
  assert.equal(sheet.data.sheetTop, 40); assert.equal(sheet.data.fullscreen, false);
  sheet.onGestureEnd(); flush(280);
  assert.equal(sheet.data.state, 'full'); assert.equal(sheet.data.sheetTop, 0);
  assert.equal(sheet.data.fullscreen, true); assert.equal(sheet.data.mounted, true);
  sheet.onGestureStart({ detail: { x: 20, y: 100 } }); move(20, 280);
  sheet.onGestureEnd(); assert.equal(sheet.data.sheetTop, 750);
  flush(280); assert.equal(sheet.data.visible, false); assert.equal(sheet.data.state, 'closed');
});

test('轻点不触发拖动，取消手势回原高度，规格面板阻止外层手势', () => {
  const { instance: sheet, flush, move } = opened();
  sheet.onGestureStart({ detail: { x: 10, y: 400 } }); move(12, 401); sheet.onGestureEnd();
  assert.equal(sheet.data.sheetTop, 250);
  sheet.onGestureStart({ detail: { x: 10, y: 400 } }); move(12, 300); sheet.onGestureCancel(); flush(280);
  assert.equal(sheet.data.sheetTop, 250);
  sheet.onOverlayChange({ detail: { blocked: true } });
  sheet.onGestureStart({ detail: { x: 10, y: 400 } }); move(10, 100);
  assert.equal(sheet.data.sheetTop, 250);
});

test('返回和原生返回只关闭商品窗口，先下滑动画再清理，不重复发关闭事件', () => {
  const { instance: sheet, flush, events, calls } = opened();
  sheet.snapTo('full'); flush(280); sheet.requestClose();
  assert.equal(sheet.data.sheetTop, 750); assert.equal(sheet.data.mounted, true); assert.equal(sheet.data.fullscreen, false);
  sheet.requestClose(); flush(280);
  assert.equal(sheet.data.visible, false); assert.equal(sheet.data.mounted, false);
  sheet.onContainerLeave(); sheet.onContainerLeft();
  assert.equal(events.filter(e => e.name === 'close').length, 1);
  assert.equal(calls.navigation.length, 0);
  assert.ok(calls.pause > 0);
});

test('离开和尺寸变化保留商品及正文状态，切关联商品清理正文避免串数据', () => {
  const env = opened(), sheet = env.instance;
  sheet.setData({ contentOffset: 300 });
  env.definition.pageLifetimes.hide.call(sheet); env.flush(280);
  assert.equal(sheet.data.activeProductId, '360435019602202624'); assert.equal(sheet.data.contentOffset, 300);
  env.definition.pageLifetimes.resize.call(sheet); env.flush(280);
  assert.equal(sheet.data.contentOffset, 300);
  sheet.onProductChange({ detail: { id: '2' } });
  assert.equal(sheet.data.activeProductId, '2'); assert.equal(sheet.data.contentOffset, 0);
});

test('嵌入详情向外发送图片手势，浮层打开时不让弹窗抢手势，多指取消', () => {
  const { instance: detail, events } = setup('productDetail');
  const start = { touches: [{ clientX: 20, clientY: 30 }], target: { dataset: { gesture: 'image' } } };
  detail.forwardTouchStart(start); detail.forwardTouchMove({ touches: [{ clientX: 50, clientY: 60 }] });
  assert.deepEqual(plain(events.slice(0, 2)), [{ name: 'gesturestart', detail: { x: 20, y: 30, image: true, nativeContent: false, offset: 0 } },
    { name: 'gesturemove', detail: { x: 50, y: 60, offset: 0 } }]);
  detail.forwardTouchMove({ touches: [{}, {}] }); assert.equal(events.at(-1).name, 'gesturecancel');
  detail.setData({ showSku: true }); const count = events.length; detail.forwardTouchStart(start);
  assert.equal(events.length, count);
});

test('共用规格逻辑在弹窗选择数量并加购，防止重复提交，立即购买进入原结算页', async () => {
  let finish;
  const { instance: detail, calls } = setup('productDetail', { post: () => new Promise(resolve => { finish = resolve; }) });
  detail.data.product = { id: '360435019602202624', name: '外套', coverUrl: 'cover.jpg',
    skuMatrix: [{ skuId: '360435019602202625', color: '黑色', size: 'M', stock: 5, price: 99 }] };
  detail.data.uniqueColors = ['黑色']; detail.data.uniqueSizes = ['M'];
  detail.openSkuPanel(tap({ action: 'cart' })); detail.skuQuantityPlus();
  detail.confirmSkuAction(tap({ action: 'cart' })); detail.confirmSkuAction(tap({ action: 'cart' }));
  assert.equal(calls.posts.length, 1);
  assert.deepEqual(plain(calls.posts[0]), { url: '/cart/items', data: { productId: '360435019602202624',
    skuId: '360435019602202625', color: '黑色', size: 'M', count: 2 } });
  finish({}); await new Promise(setImmediate);
  assert.equal(detail.data.purchasePending, false); assert.equal(detail.data.showSku, false);
  detail.confirmSkuAction(tap({ action: 'buy' }));
  assert.equal(calls.navigation[0].url, '/pages/checkout/checkout');
  assert.equal(calls.storage[0].value[0].skuId, '360435019602202625');
  assert.equal(calls.storage[0].value[0].count, 2);
});

test('弹窗保留套装勾选和购买，售罄与下架阻止加购', () => {
  const { instance: detail, calls } = setup('productDetail');
  detail.data.product = { id: '1', name: '套装', bundleGroups: [
    { name: '上衣', skus: [{ skuId: '11', color: '黑', size: 'M', stock: 2, price: 10 }] },
    { name: '裤子', skus: [{ skuId: '12', color: '黑', size: 'M', stock: 2, price: 20 }] }
  ] };
  detail.openSkuPanel(tap({ action: 'buy' })); detail.confirmSkuAction(tap({ action: 'buy' }));
  assert.equal(calls.storage[0].value[0].bundleConfig.length, 2); assert.equal(calls.storage[0].value[0].finalPrice, 30);
  detail.data.product.offSale = true; detail.confirmSkuAction(tap({ action: 'cart' }));
  assert.equal(calls.posts.length, 0);
});

test('商品切换时旧详情请求晚返回不覆盖新商品，失败内联重试不退出心愿', async () => {
  let resolveFirst;
  const { instance: detail } = setup('productDetail', { get: async url => url.endsWith('/1')
    ? new Promise(resolve => { resolveFirst = resolve; }) : { product: { id: '2', name: '新商品', skuMatrix: [] } } });
  const first = detail.initializeProduct('1'); await new Promise(setImmediate);
  await detail.initializeProduct('2'); resolveFirst({ product: { id: '1', name: '旧商品', skuMatrix: [] } }); await first;
  assert.equal(detail.data.product.id, '2');
  const failed = setup('productDetail', { get: async () => { throw new Error('网络失败'); } });
  await failed.instance.initializeProduct('3'); assert.equal(failed.instance.data.loadError, '网络失败');
  assert.equal(failed.instance.data.loading, false); assert.equal(failed.calls.navigation.length, 0);
});

test('嵌入商品分享链接是商品，内部关联商品切换弹窗不新建页面', () => {
  const { instance: detail, calls, events } = setup('productDetail');
  detail.data.product = { id: '123', name: '外套', coverUrl: 'cover.jpg' };
  const share = detail.getProductShare({ target: { dataset: { template: 'single' } } });
  assert.equal(share.path, '/pages/detail/detail?id=123');
  detail.goToRelatedDetail(tap({ id: '456' }));
  assert.equal(events.at(-1).name, 'productchange'); assert.equal(events.at(-1).detail.id, '456');
  assert.equal(calls.navigation.length, 0);
});


test('图片区方向锁定：横滑只翻一张，斜滑和取消不翻图，详情图同样受控', () => {
  const { instance: detail, events } = setup('productDetail');
  detail.data.bannerImgs = ['a', 'b', 'c']; detail.data.detailImgs = ['d', 'e'];
  const begin = (gallery, x = 200, y = 150) => detail.forwardTouchStart({ touches: [{ clientX: x, clientY: y }], target: { dataset: { gesture: 'image', gallery } } });
  const move = (x, y) => detail.onImageTouchMove({ touches: [{ clientX: x, clientY: y }] });
  begin('banner'); move(100, 160); detail.forwardTouchEnd();
  assert.equal(detail.data.bannerIndex, 1);
  begin('banner'); move(180, 200); move(20, 210); detail.forwardTouchEnd();
  assert.equal(detail.data.bannerIndex, 1, '先锁定纵向后不能因后续横移翻图');
  begin('banner'); move(100, 155); detail.forwardTouchCancel();
  assert.equal(detail.data.bannerIndex, 1);
  begin('detail'); move(100, 155); detail.forwardTouchEnd();
  assert.equal(detail.data.currentDetailIndex, 2);
  begin('detail'); move(100, 155); detail.forwardTouchEnd();
  assert.equal(detail.data.currentDetailIndex, 2, '最后一张不会循环');
  assert.ok(events.some(e => e.name === 'gesturecancel'));
});

test('组件通知等数据更新结束再发送，退出后丢弃，浮钮独立拖动不带动整窗', () => {
  const { instance: detail, events, flush } = setup('productDetail');
  detail.notifySheet('titlechange', { title: '测试商品' });
  assert.equal(events.length, 0); flush(0); assert.equal(events[0].name, 'titlechange');
  detail.notifySheet('overlaychange', { blocked: false }); detail._ready = false; flush(0);
  assert.equal(events.length, 1); detail._ready = true;
  detail.data.canShowShareFloat = true; detail.data.shareImageCount = 1; detail.data.shareTemplatesReady = true;
  detail.startShareFloatDrag({ touches: [{ clientX: 200, clientY: 160 }], target: { dataset: {} } });
  detail.moveShareFloat({ touches: [{ clientX: 200, clientY: 240 }] });
  detail.endShareFloatDrag();
  assert.equal(detail.data.showShareTemplates, false);
  assert.equal(detail.data.shareFloatTop, 80);
  assert.equal(events.some(e => e.name.startsWith('gesture')), false);
});

test('弹窗浮钮避开胶囊，拖动限制在可视范围且尺寸变化保留位置', () => {
  const { instance: detail } = setup('productDetail');
  detail.initShareFloatPosition({ windowWidth: 375, windowHeight: 472 });
  detail.updateFloatBounds();
  assert.equal(detail.data.shareFloatTop, 82);
  assert.equal(detail.data.editFloatTop, 132);
  detail.startEditFloatDrag({ touches: [{ clientX: 300, clientY: 150 }] });
  detail.moveEditFloat({ touches: [{ clientX: 1000, clientY: -1000 }] });
  assert.equal(detail.data.editFloatLeft, 333);
  assert.equal(detail.data.editFloatTop, 82);
  detail.cancelFloatTouch();
  detail.data.viewportHeight = 750;
  detail.updateFloatBounds();
  assert.equal(detail.data.editFloatLeft, 333);
  assert.equal(detail.data.editFloatTop, 82);
  detail.startShareFloatDrag({ touches: [{ clientX: 300, clientY: 100 }] });
  detail.moveShareFloat({ touches: [{ clientX: -1000, clientY: 2000 }] });
  detail.endShareFloatDrag();
  assert.equal(detail.data.shareFloatLeft, 0);
  assert.equal(detail.data.shareFloatTop, 708);
  assert.equal(detail.data.showShareTemplates, false);
});


test('全屏原生滚动及惯性通知不刷新父弹窗，不创建 JS 惯性定时器', () => {
  const { instance: sheet, flush, move, calls, timers } = opened();
  sheet.snapTo('full'); flush(280);
  const patches = [];
  sheet.setData = patch => { patches.push(patch); Object.assign(sheet.data, patch); };
  sheet.onGestureStart({ detail: { x: 20, y: 500, nativeContent: true, offset: 300 } });
  for (const y of [480, 460, 440, 420]) move(20, y);
  sheet.onGestureEnd();
  for (const offset of [320, 340, 380, 400]) sheet.onContentScroll({ detail: { offset } });
  assert.equal(sheet.data.contentOffset, 400);
  assert.equal(patches.length, 0);
  assert.equal(calls.locks, 0);
  assert.equal(timers.size, 0);
});

test('横滑画廊不重复测量正文，同高度回调不重复通知父组件', () => {
  const { instance: detail, flush, events } = setup('productDetail');
  detail.data.bannerImgs = ['a', 'b', 'c'];
  detail.updateGallery(); detail.measureDocument(); flush(30);
  const heights = () => events.filter(event => event.name === 'documentheight');
  assert.equal(heights().length, 1);
  let measurements = 0;
  const original = detail.measureDocument;
  detail.measureDocument = () => { measurements++; original.call(detail); };
  detail.updateGallery(40);
  detail.updateGallery(80);
  assert.equal(measurements, 0);
  detail.measureDocument(); flush(30);
  assert.equal(heights().length, 1);
});

test('拖动缩放保持图片绘制尺寸，不在拖动和吸附期间查询正文布局', () => {
  const { instance: detail, flush, events } = setup('productDetail');
  detail.data.bannerImgs = ['a', 'b', 'c'];
  detail.data.sheetDragging = true;
  for (const progress of [0, .2, .4, .8, 1]) {
    detail.data.expansionProgress = progress;
    detail.updateGallery(); flush(30);
    assert.equal(detail.data.galleryBaseWidth, 375);
    assert.equal(detail.data.galleryBaseHeight, 468.75);
  }
  assert.equal(events.filter(e => e.name === 'documentheight').length, 0);
  detail.data.sheetDragging = false;
  detail.data.galleryAnimating = true;
  detail.measureDocument(); flush(30);
  assert.equal(events.filter(e => e.name === 'documentheight').length, 0);
  detail.data.galleryAnimating = false;
  detail.measureDocument(); flush(30);
  assert.equal(events.filter(e => e.name === 'documentheight').length, 1);
});

test('全屏下拉和关闭保持图片全屏尺寸，轻拖取消不触发缩小再放大', () => {
  const { instance: sheet, move, flush } = opened();
  sheet.snapTo('full'); flush(280);
  sheet.onGestureStart({ detail: { x: 20, y: 200 } }); move(20, 240);
  assert.equal(sheet.data.expansionProgress, 1);
  sheet.onGestureEnd(); flush(280);
  assert.equal(sheet.data.expansionProgress, 1);
  sheet.onGestureStart({ detail: { x: 20, y: 200 } }); move(20, 340);
  assert.equal(sheet.data.expansionProgress, 1);
  sheet.onGestureEnd();
  assert.equal(sheet.data.sheetTop, 750);
  assert.equal(sheet.data.expansionProgress, 1, '关闭动画保持图片尺寸');
  flush(280);
  sheet.open('next'); flush(30); flush(280);
  assert.equal(sheet.data.expansionProgress, 0, '再次半屏打开仍恢复半屏尺寸');
});

test('全屏连续纵滑不刷新子组件，正文到顶后同一划不接管弹窗', () => {
  const { instance: detail, events } = setup('productDetail');
  detail.data.nativeScroll = true;
  detail.onNativeScroll({ detail: { scrollTop: 120 } });
  const patches = [];
  detail.setData = patch => { patches.push(patch); Object.assign(detail.data, patch); };
  detail.forwardTouchStart({ touches: [{ clientX: 20, clientY: 200 }], target: { dataset: {} } });
  detail.forwardTouchMove({ touches: [{ clientX: 20, clientY: 260 }] });
  detail.onNativeScroll({ detail: { scrollTop: 0 } });
  detail.forwardTouchMove({ touches: [{ clientX: 20, clientY: 400 }] });
  detail.forwardTouchEnd();
  assert.equal(patches.length, 0);
  assert.equal(events.filter(e => e.name === 'gesturemove').length, 0);
  assert.equal(detail._nativeScrollTop, 0);
  detail.forwardTouchStart({ touches: [{ clientX: 20, clientY: 200 }], target: { dataset: {} } });
  detail.forwardTouchMove({ touches: [{ clientX: 20, clientY: 260 }] });
  assert.equal(events.at(-1).name, 'gesturemove', '到顶重新下拉才交给弹窗');
  detail.lockVerticalGesture();
  assert.equal(detail.data.sheetDragging, true);
  detail.forwardTouchCancel();
  assert.equal(detail.data.sheetDragging, false);
});

test('全屏从顶部上滑后反向仍是原生滚动，图片横滑仍只翻图', () => {
  const { instance: detail, events } = setup('productDetail');
  detail.data.nativeScroll = true;
  detail.data.bannerImgs = ['a', 'b'];
  const begin = () => detail.forwardTouchStart({ touches: [{ clientX: 200, clientY: 200 }], target: { dataset: { gesture: 'image', gallery: 'banner' } } });
  begin();
  detail.forwardTouchMove({ touches: [{ clientX: 200, clientY: 150 }] });
  detail.forwardTouchMove({ touches: [{ clientX: 200, clientY: 250 }] });
  detail.forwardTouchEnd();
  assert.equal(events.filter(e => e.name === 'gesturemove').length, 0);
  assert.equal(detail.data.bannerIndex, 0);
  begin();
  detail.forwardTouchMove({ touches: [{ clientX: 100, clientY: 205 }] });
  assert.equal(detail.data.sheetDragging, true);
  detail.forwardTouchEnd();
  assert.equal(detail.data.bannerIndex, 1);
  assert.equal(detail.data.sheetDragging, false);
});

function connectedFullSheet() {
  const env = opened();
  const sheet = env.instance;
  sheet.snapTo('full'); env.flush(280);
  const { instance: detail } = setup('productDetail');
  detail.data.nativeScroll = true;
  sheet.getProductDetail = () => detail;
  const routes = { gesturestart: 'onGestureStart', gesturemove: 'onGestureMove', gestureend: 'onGestureEnd',
    gesturecancel: 'onGestureCancel', contentscroll: 'onContentScroll' };
  detail.triggerEvent = (name, value) => { if (routes[name]) sheet[routes[name]]({ detail: value }); };
  const start = () => detail.forwardTouchStart({ touches: [{ clientX: 20, clientY: 200 }], target: { dataset: {} } });
  const move = y => detail.forwardTouchMove({ touches: [{ clientX: 20, clientY: y }] });
  return { ...env, sheet, detail, start, move };
}

test('到顶通知晚于触摸开始时，第一划下拉仍能交给父弹窗关闭', () => {
  for (const notification of ['scroll', 'upper', 'dragstart']) {
    const { sheet, detail, start, move, flush } = connectedFullSheet();
    detail.onNativeScroll({ detail: { scrollTop: 48 } });
    start();
    if (notification === 'scroll') detail.onNativeScroll({ detail: { scrollTop: 0 } });
    if (notification === 'upper') detail.onNativeScrollUpper();
    if (notification === 'dragstart') detail.onNativeDragStart({ detail: { scrollTop: 0 } });
    move(320);
    assert.equal(sheet.data.sheetTop, 120, notification);
    detail.forwardTouchEnd(); flush(280);
    assert.equal(sheet.data.visible, false, notification);
  }
});

test('原生滑动起点通知晚于首次移动时，也能纠正过时缓存并关闭', () => {
  const { sheet, detail, start, move, flush } = connectedFullSheet();
  detail.onNativeScroll({ detail: { scrollTop: 20 } });
  start(); move(230);
  assert.equal(sheet.data.sheetTop, 0);
  detail.onNativeDragStart({ detail: { scrollTop: 0 } });
  assert.equal(sheet.data.sheetTop, 30, '补接首次下拉的距离');
  move(320); detail.forwardTouchEnd(); flush(280);
  assert.equal(sheet.data.visible, false);
});

test('本次从正文中间滚到顶仍不关窗，松手后下次下拉可以关闭', () => {
  const { sheet, detail, start, move, flush } = connectedFullSheet();
  detail.onNativeScroll({ detail: { scrollTop: 80 } });
  start(); move(230);
  detail.onNativeDragStart({ detail: { scrollTop: 80 } });
  detail.onNativeScrollUpper(); move(380); detail.forwardTouchEnd();
  assert.equal(sheet.data.sheetTop, 0);
  assert.equal(sheet.data.visible, true);
  start(); move(320); detail.forwardTouchEnd(); flush(280);
  assert.equal(sheet.data.visible, false);
});

test('顶部先上滑再反向时，迟到的原生起点通知不会误转成关窗', () => {
  const { sheet, detail, start, move } = connectedFullSheet();
  start(); move(170); move(320);
  detail.onNativeDragStart({ detail: { scrollTop: 0 } });
  detail.forwardTouchEnd();
  assert.equal(sheet.data.sheetTop, 0);
  assert.equal(sheet.data.visible, true);
});

test('正文使用固定高度原生滚动，图片区不拦截纵向事件，切商品回顶部', async () => {
  const root = path.resolve(__dirname, '../../components/productDetail');
  const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  const document = fs.readFileSync(path.join(root, 'document.wxml'), 'utf8');
  assert.match(template, /<scroll-view[^>]+scroll-y=/);
  assert.doesNotMatch(template, /translate3d/);
  assert.doesNotMatch(document, /catchtouchmove/);
  assert.match(document, /wx:else class="detail-swiper detail-strip"/);
  const { instance: detail } = setup('productDetail');
  detail.onNativeScroll({ detail: { scrollTop: 600 } });
  const positions = [];
  const original = detail.setData;
  detail.setData = (patch, callback) => { if ('requestedScrollTop' in patch) positions.push(patch.requestedScrollTop); original.call(detail, patch, callback); };
  await detail.initializeProduct('new');
  assert.deepEqual(positions, [600, 0]);
  assert.equal(detail._nativeScrollTop, 0);
});

test('图片带最小露出1.5张，跟随展开进度放大，最后一张靠右，单图居中', () => {
  const { getGalleryLayout } = require('../../utils/productGallery');
  const half = getGalleryLayout(375, 0, 3, 0);
  assert.equal(half.galleryItemWidth, 250); assert.equal(half.galleryHeight, 312.5);
  assert.equal(half.galleryOffset, 0); assert.equal(375 / half.galleryItemWidth, 1.5);
  const middle = getGalleryLayout(375, .5, 3, 1);
  assert.equal(middle.galleryItemWidth, 312.5); assert.equal(middle.galleryOffset, 312.5);
  const full = getGalleryLayout(375, 1, 3, 1);
  assert.equal(full.galleryItemWidth, 375); assert.equal(full.galleryHeight, 468.75);
  assert.equal(full.galleryOffset, 375);
  const last = getGalleryLayout(375, 0, 3, 2);
  assert.equal(last.galleryOffset, 375); assert.equal(3 * last.galleryItemWidth - last.galleryOffset, 375);
  assert.equal(getGalleryLayout(375, 1, 3, 2).galleryOffset, 750);
  const single = getGalleryLayout(375, 0, 1, 0);
  assert.equal(single.galleryTranslateX, 62.5); assert.equal(single.galleryItemWidth, 250);
  assert.equal(getGalleryLayout(375, 1, 1, 0).galleryOffset, 0);
});

test('展开时图片带保留当前图，横滑跟手，取消复位，切商品重建布局', async () => {
  const { instance: detail } = setup('productDetail');
  detail.data.bannerImgs = ['a', 'b', 'c']; detail.data.bannerIndex = 2;
  detail.data.expansionProgress = 0; detail.updateGallery();
  assert.equal(detail.data.galleryOffset, 375);
  detail.data.expansionProgress = 1; detail.updateGallery();
  assert.equal(detail.data.bannerIndex, 2); assert.equal(detail.data.galleryOffset, 750);
  detail.forwardTouchStart({ touches: [{ clientX: 100, clientY: 100 }], target: { dataset: { gesture: 'image', gallery: 'banner' } } });
  detail.onImageTouchMove({ touches: [{ clientX: 180, clientY: 110 }] });
  assert.equal(detail.data.galleryOffset, 670);
  detail.forwardTouchCancel(); assert.equal(detail.data.galleryOffset, 750);
  await detail.initializeProduct('new-product');
  assert.equal(detail.data.bannerIndex, 0);
});


test('图片首尾带阻力，最后一张反向拖动从真实停靠位置开始，不跳半张', () => {
  const { getGalleryLayout: layout } = require('../../utils/productGallery');
  assert.equal(layout(375, 0, 3, 2, 20).galleryOffset, 355);
  const first = layout(375, 0, 3, 0, 100).galleryOffset;
  assert.ok(first < 0 && first > -100);
  const last = layout(375, 1, 3, 2, -100).galleryOffset;
  assert.ok(last > 750 && last < 850);
  assert.equal(layout(375, 1, 3, 2).galleryOffset, 750);
});

test('越界拖动松手平滑回弹，不循环，新手势和换商品清理回弹状态', async () => {
  const { instance: detail, flush } = setup('productDetail');
  detail.data.bannerImgs = ['a', 'b']; detail.data.bannerIndex = 1; detail.data.expansionProgress = 1;
  const start = () => detail.forwardTouchStart({ touches: [{ clientX: 200, clientY: 100 }], target: { dataset: { gesture: 'image', gallery: 'banner' } } });
  start(); detail.onImageTouchMove({ touches: [{ clientX: 100, clientY: 110 }] });
  assert.ok(detail.data.galleryOffset > 375); detail.forwardTouchEnd();
  assert.equal(detail.data.bannerIndex, 1); assert.equal(detail.data.galleryOffset, 375);
  assert.equal(detail.data.gallerySettling, true); flush(280); assert.equal(detail.data.gallerySettling, false);
  start(); detail.onImageTouchMove({ touches: [{ clientX: 170, clientY: 105 }] }); detail.forwardTouchCancel();
  assert.equal(detail.data.gallerySettling, true); start(); assert.equal(detail.data.gallerySettling, false);
  await detail.initializeProduct('another'); flush(280); assert.equal(detail.data.gallerySettling, false);
});
