const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// ---- 桩：小程序运行时 ----
let pageConfig = null;
global.Page = (config) => { pageConfig = config; };

let timers = new Map();
let timerSeq = 0;
global.setInterval = (fn) => {
  const id = ++timerSeq;
  timers.set(id, fn);
  return id;
};
global.clearInterval = (id) => { timers.delete(id); };

// 跟 adminCatalogManage.wxss 对齐：.group-row 高 96px，.list-scroll 上下留白 16rpx / 24rpx
const ROW_HEIGHT = 96;
const LIST = { top: 100, height: 400 };
const PADDING_TOP = 8;
const PADDING_BOTTOM = 16;

let currentView = null;

global.wx = {
  vibrateShort() {},
  showToast() {},
  showLoading() {},
  hideLoading() {},
  createSelectorQuery() {
    return {
      select() { return this; },
      boundingClientRect() { return this; },
      scrollOffset() { return this; },
      exec(callback) {
        const view = currentView;
        callback([
          { top: LIST.top, left: 0, width: 375, height: LIST.height },
          { scrollTop: view.scrollTop, scrollLeft: 0 },
          {
            top: LIST.top - view.scrollTop + PADDING_TOP,
            left: 0,
            width: 375,
            height: view.areaHeight
          }
        ]);
      }
    };
  }
};

// api / auth 不需要真实现，桩掉即可
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request.endsWith('utils/api')) {
    return {
      get: async () => [],
      post: async () => ({}),
      put: async () => ({}),
      patch: async () => ({}),
      delete: async () => ({})
    };
  }
  if (request.endsWith('utils/auth')) {
    return { ensureAuthenticated: async () => {}, isAdmin: () => true };
  }
  return originalLoad.call(this, request, ...rest);
};

require('../../pages/adminCatalogManage/adminCatalogManage.js');

function setByPath(target, path, value) {
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cursor = target;
  for (let i = 0; i < tokens.length - 1; i += 1) cursor = cursor[tokens[i]];
  cursor[tokens[tokens.length - 1]] = value;
}

// 造一个页面 + 一个滚动容器模型：滚到头的夹取、bindscroll 回传都按真机来
function createPage(groupCount, scrollTop = 0) {
  timers = new Map();
  timerSeq = 0;

  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.onLoad();

  const groups = [];
  for (let i = 0; i < groupCount; i += 1) {
    groups.push({
      id: 'g' + i,
      name: '档口' + i,
      y: i * ROW_HEIGHT,
      offsetX: 0,
      onSaleProductCount: 1,
      totalProductCount: 1,
      visible: true
    });
  }
  page.data.groups = groups;
  page.data.listHeight = Math.max(groupCount * ROW_HEIGHT, ROW_HEIGHT);

  const view = {
    scrollTop: Math.max(0, scrollTop),
    areaHeight: page.data.listHeight,
    get contentHeight() { return PADDING_TOP + this.areaHeight + PADDING_BOTTOM; },
    get visibleHeight() { return LIST.height - PADDING_TOP - PADDING_BOTTOM; },
    get maxScrollTop() { return Math.max(0, this.contentHeight - this.visibleHeight); }
  };
  currentView = view;

  page.setData = (patch) => {
    Object.keys(patch).forEach((key) => setByPath(page.data, key, patch[key]));
    if (patch.scrollTop === undefined) return;
    const real = Math.max(0, Math.min(view.maxScrollTop, patch.scrollTop));
    if (real === view.scrollTop) return; // 平台没动，bindscroll 也就不会回调
    view.scrollTop = real;
    page.onListScroll({ detail: { scrollTop: real } });
  };
  page.scrollTop = view.scrollTop;
  return { page, view };
}

function rowViewportY(view, index) {
  return LIST.top + PADDING_TOP + index * ROW_HEIGHT - view.scrollTop + ROW_HEIGHT / 2;
}

// 行顶上边缘落在视口里的位置：内容基准 - 当前滚动量 + 行 y
function rowTopViewport(page, view, index) {
  return LIST.top + PADDING_TOP + page.data.groups[index].y - view.scrollTop;
}

// 手指当前所在的视口位置，真机上是 touchmove 一个个点报上来的
let fingerY = null;

function startDrag(page, view, index) {
  fingerY = rowViewportY(view, index);
  page.onDragStart({
    currentTarget: { dataset: { index } },
    touches: [{ clientY: fingerY }]
  });
}

// 手指挪到某个视口位置：手势在 drag-handle 上被 catch 住，行摆哪儿全由页面按手指算，
// 容器（movable-view）只负责把行放到 item.y 那儿，不会再自己写一份位置
function moveFinger(page, view, viewportY) {
  fingerY = viewportY;
  page.onDragTouchMove({ touches: [{ clientY: viewportY }] });
}

function tick(page, times = 1) {
  for (let i = 0; i < times; i += 1) page.autoScrollTick();
}

function draggedY(page, index) {
  return page.data.groups[index].y;
}

function assertInSync(page, view) {
  assert.equal(page.scrollTop, view.scrollTop, '页面记账的滚动位置要和真实滚动位置一致');
}

test('把最后一行拖到列表上边缘会自动向上滚动，松手后落到第一位', () => {
  const count = 10;
  const { page, view } = createPage(count, 0);
  view.scrollTop = view.maxScrollTop; // 跟真人操作一样：先滚到底部再往上拖
  page.scrollTop = view.scrollTop;

  startDrag(page, view, count - 1);
  moveFinger(page, view, LIST.top + 2);
  assert.ok(page.autoScrollStep < 0, '手指压到上边缘要触发向上滚动');

  let guard = 0;
  while (page.data.dragY > 0 && guard < 500) {
    const scrollBefore = view.scrollTop;
    const yBefore = draggedY(page, count - 1);
    tick(page);
    guard += 1;
    const scrollDelta = scrollBefore - view.scrollTop;
    const rowDelta = yBefore - draggedY(page, count - 1);
    assert.ok(scrollDelta > 0, '列表应该一直在往上滚');
    assert.ok(Math.abs(scrollDelta - rowDelta) < 1e-6, '行往上挪多少，列表就要往上滚多少');
    assertInSync(page, view);
  }

  assert.equal(page.data.dragY, 0, '行要能被一路推到列表内容的最上面');

  const scrollAtTop = view.scrollTop;
  tick(page, 30);
  assert.equal(view.scrollTop, scrollAtTop, '行顶到内容最上面之后列表不该再滚');
  assertInSync(page, view);

  page.onDragEnd();
  assert.equal(page.data.groups[0].id, 'g9', '最后一行松手后要落到第一位');
  assert.ok(view.scrollTop <= PADDING_TOP, '松手后要把落位的行完整露出来，不能还切着一截');
});

test('把第一行拖到列表下边缘会自动向下滚动，松手后落到最后一位', () => {
  const count = 10;
  const { page, view } = createPage(count, 0);

  startDrag(page, view, 0);
  moveFinger(page, view, LIST.top + LIST.height - 2);
  assert.ok(page.autoScrollStep > 0, '手指压到下边缘要触发向下滚动');

  const maxDragY = (count - 1) * ROW_HEIGHT;
  let guard = 0;
  while (page.data.dragY < maxDragY && guard < 500) {
    const scrollBefore = view.scrollTop;
    const yBefore = draggedY(page, 0);
    tick(page);
    guard += 1;
    const scrollDelta = view.scrollTop - scrollBefore;
    const rowDelta = draggedY(page, 0) - yBefore;
    assert.ok(scrollDelta > 0, '列表应该一直在往下滚');
    assert.ok(Math.abs(scrollDelta - rowDelta) < 1e-6, '行往下挪多少，列表就要往下滚多少');
    assertInSync(page, view);
  }

  assert.equal(page.data.dragY, maxDragY, '第一行要能被一路拖到列表内容的最下面');

  page.onDragEnd();
  assert.equal(page.data.groups[count - 1].id, 'g0', '第一行松手后要落到最后一位');
  assert.ok(
    view.maxScrollTop - view.scrollTop <= ROW_HEIGHT,
    '松手后列表要靠近底部，落位的行才露得出来'
  );
});

test('拖到边缘自动滚动后手指回到中间，行不能跟手指拉开一段距离', () => {
  const count = 10;
  const { page, view } = createPage(count, 0);
  view.scrollTop = view.maxScrollTop;
  page.scrollTop = view.scrollTop;

  const index = count - 1;
  startDrag(page, view, index);
  // 手指按在行的正中，行内偏移就是半行高，拖动全程都不该变
  const offset = fingerY - rowTopViewport(page, view, index);
  assert.ok(offset > 0 && offset < ROW_HEIGHT, '手指应该压在行中间那一块');
  assert.equal(offset, ROW_HEIGHT / 2, '手指按的就是行的正中');

  // 手指顶进上边缘：自动滚动一路把行推到内容最上面，列表滚不动了才停
  const edgeY = LIST.top + 10;
  moveFinger(page, view, edgeY);
  tick(page, 60);
  assert.equal(page.data.dragY, 0, '行要一路顶到列表内容最上面');
  assert.equal(rowTopViewport(page, view, index), edgeY - offset, '顶着边缘时行还得在手指底下');

  // 手指继续往列表上沿外面挪：行贴到内容最上面就动不了了，这段位移只能被夹掉
  moveFinger(page, view, LIST.top - 70);
  assert.equal(page.data.dragY, 0, '行已经顶到内容最上面，再往外挪也不该跟着出去');
  tick(page, 20);
  assertInSync(page, view);

  // 手指回到列表中间、再出去、再回来：行要一直接着手指，不能留死区、不能来回闪
  const middleY = LIST.top + LIST.height / 2;
  const checkUnderFinger = (viewportY) => {
    moveFinger(page, view, viewportY);
    assert.ok(
      Math.abs(rowTopViewport(page, view, index) - (viewportY - offset)) < 0.5,
      '手指在 ' + viewportY + '，行顶就该在 ' + (viewportY - offset) + ' 处'
    );
    assert.equal(draggedY(page, index), page.data.dragY, '行的位置只有页面这一个写入方');
  };
  checkUnderFinger(middleY);
  checkUnderFinger(LIST.top + 40);
  checkUnderFinger(middleY);

  // 手指出列表上沿：行贴到内容最上面就跟着出不去了，但这一段位移不能记在账上
  moveFinger(page, view, LIST.top - 70);
  assert.equal(page.data.dragY, 0, '行贴到内容最上面就不该再往外走');
  checkUnderFinger(middleY);
  checkUnderFinger(rowViewportY(view, 0) + 60);
  checkUnderFinger(middleY);

  page.onDragEnd();
  assert.equal(timers.size, 0, '松手要把自动滚动定时器清掉');
});

test('自动滚动是靠定时器一直滚的，不是手指一动才滚一下', () => {
  const count = 10;
  const { page, view } = createPage(count, 0);
  view.scrollTop = view.maxScrollTop;
  page.scrollTop = view.scrollTop;

  startDrag(page, view, count - 1);
  moveFinger(page, view, LIST.top + 2);

  const intervalCallbacks = Array.from(timers.values());
  assert.equal(intervalCallbacks.length, 1, '拖动开始后应该只有一个自动滚动定时器');
  const before = view.scrollTop;
  intervalCallbacks[0](); // 手指顶着不动，定时器每跑一次列表就该滚一点
  assert.ok(view.scrollTop < before, '定时器每跑一次列表就该往上滚一点');
});

test('拖动开始时按滚动容器回传的真实位置对齐基准', () => {
  const { page, view } = createPage(10, 0);
  // 模拟手动滚到中间、页面这一趟没收到 bindscroll：页面记账还停在 0
  view.scrollTop = 300;
  page.scrollTop = 0;

  startDrag(page, view, 4);
  assert.equal(page.scrollTop, 300, '拖动开始要把真实滚动位置对齐过来');

  moveFinger(page, view, rowViewportY(view, 4));
  assert.equal(page.autoScrollStep, 0, '手指落在列表中间，不该触发自动滚动');
});

test('手指在列表中间时不滚动，松手也不会乱动列表位置', () => {
  const { page, view } = createPage(10, 200);

  startDrag(page, view, 4);
  moveFinger(page, view, rowViewportY(view, 4));
  assert.equal(page.autoScrollStep, 0);

  tick(page, 10);
  assert.equal(view.scrollTop, 200, '中间区域不该滚动');

  page.onDragEnd();
  assert.equal(view.scrollTop, 200, '这一趟本来就没滚过，松手也不该挪列表');
});

test('档口撑不满一屏时不会瞎滚，页面记账也不会跑偏', () => {
  const { page, view } = createPage(3, 0);
  assert.equal(view.maxScrollTop, 0, '三条档口撑不满一屏，本来就滚不动');

  startDrag(page, view, 0);
  moveFinger(page, view, LIST.top + LIST.height - 2);
  tick(page, 30);

  assert.equal(view.scrollTop, 0);
  assertInSync(page, view);
});

test('拖动结束和页面卸载都会停掉自动滚动定时器', () => {
  const first = createPage(4, 0);
  startDrag(first.page, first.view, 3);
  assert.ok(first.page.autoScrollTimer, '拖动开始后要有自动滚动定时器');

  first.page.onDragEnd();
  assert.equal(first.page.autoScrollTimer, null, '拖动结束要清掉定时器');
  assert.equal(timers.size, 0, '不应该残留定时器');

  const second = createPage(4, 0);
  startDrag(second.page, second.view, 3);
  second.page.onUnload();
  assert.equal(timers.size, 0, '页面卸载也要清掉定时器');
});

test('切换档口/标签会把列表滚回顶部', () => {
  const { page, view } = createPage(10, 300);

  page.switchType({ currentTarget: { dataset: { type: 'tag' } } });

  assert.equal(page.scrollTop, 0);
  assert.equal(page.data.scrollTop, 0);
  assert.equal(view.scrollTop, 0);
});
