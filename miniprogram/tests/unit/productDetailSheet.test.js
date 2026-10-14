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
    setData(patch) { Object.assign(this.data, patch); },
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
const tap = (dataset = {}) => ({ currentTarget: { dataset } });

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
  assert.equal(sheet.data.headerHeight, 0);
  assert.equal(sheet.data.contentHeight, 500);
  assert.equal(sheet.data.fullscreen, false);
  sheet.onGestureStart({ detail: { x: 10, y: 400, image: false } }); move(10, 100);
  assert.equal(sheet.data.sheetTop, 0); assert.equal(sheet.data.fullscreen, false);
  sheet.onGestureEnd(); assert.equal(sheet.data.fullscreen, false);
  flush(280); assert.equal(sheet.data.fullscreen, true); assert.equal(sheet.data.headerHeight, 68);
  assert.equal(sheet.data.activeProductId, '360435019602202624'); assert.equal(sheet.data.mounted, true);
  sheet.setData({ contentOffset: 0 });
  sheet.onGestureStart({ detail: { x: 10, y: 100, image: false } }); move(10, 140);
  assert.equal(sheet.data.fullscreen, false); assert.equal(sheet.data.sheetTop, 40);
  sheet.onGestureEnd(); flush(280); assert.equal(sheet.data.state, 'full');
  assert.equal(sheet.data.fullscreen, true); assert.equal(sheet.data.sheetTop, 0);
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
  sheet.onGestureStart({ detail: { x: 20, y: 300 } }); move(20, 200);
  assert.equal(sheet.data.fullscreen, true); assert.equal(sheet.data.contentOffset, 600);
  sheet.onGestureEnd(); assert.equal(sheet.data.fullscreen, true);
  sheet.onGestureStart({ detail: { x: 20, y: 200 } }); move(20, 310);
  assert.equal(sheet.data.sheetTop, 0); assert.equal(sheet.data.contentOffset, 490);
  assert.equal(sheet.data.fullscreen, true); sheet.onGestureEnd();
  sheet.onGestureStart({ detail: { x: 20, y: 100 } }); move(20, 700);
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
  assert.deepEqual(plain(events.slice(0, 2)), [{ name: 'gesturestart', detail: { x: 20, y: 30, image: true } },
    { name: 'gesturemove', detail: { x: 50, y: 60 } }]);
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

test('组件通知等数据更新结束再发送，退出后丢弃，浮钮上下滑动交给整窗', () => {
  const { instance: detail, events, flush } = setup('productDetail');
  detail.notifySheet('titlechange', { title: '测试商品' });
  assert.equal(events.length, 0); flush(0); assert.equal(events[0].name, 'titlechange');
  detail.notifySheet('overlaychange', { blocked: false }); detail._ready = false; flush(0);
  assert.equal(events.length, 1); detail._ready = true;
  detail.data.canShowShareFloat = true; detail.data.shareImageCount = 1; detail.data.shareTemplatesReady = true;
  detail.startShareFloatDrag({ touches: [{ clientX: 200, clientY: 160 }], target: { dataset: {} } });
  detail.moveShareFloat({ touches: [{ clientX: 200, clientY: 240 }] });
  detail.lockVerticalGesture();
  detail.endShareFloatDrag();
  assert.equal(detail.data.showShareTemplates, false);
  assert.deepEqual(events.slice(-3).map(e => e.name), ['gesturestart', 'gesturemove', 'gestureend']);
});


test('全屏正文下拉惯性只回滚到顶部，不带动弹窗；下一次触摸终止惯性', () => {
  const { instance: sheet, flush } = opened();
  sheet.onDocumentHeight({ detail: { height: 2400 } }); sheet.snapTo('full'); flush(280);
  sheet.setData({ contentOffset: 20 }); sheet.startInertia(-3); flush(16);
  assert.equal(sheet.data.contentOffset, 0); assert.equal(sheet.data.sheetTop, 0);
  assert.equal(sheet.data.visible, true); assert.equal(sheet.data.state, 'full');
  sheet.setData({ contentOffset: 300 }); sheet.startInertia(1);
  sheet.onGestureStart({ detail: { x: 20, y: 300 } }); flush(16);
  assert.equal(sheet.data.contentOffset, 300);
});
