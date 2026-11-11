const test = require('node:test');
const assert = require('node:assert/strict');

let config;
global.Page = value => { config = value; };
require('../../pages/pickingList/pickingList');

function page() {
  const instance = { ...config, data: structuredClone(config.data) };
  instance.setData = patch => Object.assign(instance.data, patch);
  instance.data.filterPanelHeight = 200;
  instance.data.toolbarPlaceholderHeight = 300;
  return instance;
}
function scroll(instance, scrollTop) { instance.onPageScroll({ scrollTop }); }

test('拣货单筛选区按滚动距离收缩，收完后全选栏停在标题下，反向滚动逐步展开', () => {
  const instance = page();
  for (const [top, offset] of [[35, 35], [100, 100], [240, 200], [400, 200], [375, 175], [200, 0]]) {
    scroll(instance, top);
    assert.equal(instance.data.filterCollapseOffset, offset);
    assert.equal(instance.data.toolbarPlaceholderHeight, 300, '收放不改变列表占位，避免滚动抖动');
  }
});

test('回到顶部立即展开筛选，回顶动画不会再次收起，到顶后正常响应滚动', () => {
  const calls = [];
  global.wx = { pageScrollTo: options => calls.push(options) };
  const instance = page();
  scroll(instance, 500);
  instance.backToTop();
  assert.equal(instance.data.filterCollapseOffset, 0);
  assert.deepEqual(calls, [{ scrollTop: 0, duration: 300 }]);
  for (const top of [450, 300, 150, 0]) {
    scroll(instance, top);
    assert.equal(instance.data.filterCollapseOffset, 0);
  }
  scroll(instance, 50);
  assert.equal(instance.data.filterCollapseOffset, 50);
});

test('手指打断回顶后正常收缩，顶部回弹和横向不变的滚动不误收缩', () => {
  global.wx = { pageScrollTo() {} };
  const instance = page();
  scroll(instance, 500);
  instance.backToTop();
  scroll(instance, 300);
  instance.onPickingTouchStart();
  scroll(instance, 340);
  assert.equal(instance.data.filterCollapseOffset, 40);
  scroll(instance, 340);
  assert.equal(instance.data.filterCollapseOffset, 40);
  scroll(instance, -20);
  assert.equal(instance.data.filterCollapseOffset, 0);
  scroll(instance, 0);
  assert.equal(instance.data.filterCollapseOffset, 0);
});

test('弹窗期间保持工具栏状态且不改筛选和已选数量', () => {
  const instance = page();
  instance.data.selectedStall = '8';
  instance.data.skuKeyword = '棉袄';
  instance.data.pendingOrderList = [{ skuId: '1', qty: 7 }];
  for (const modal of ['showOrderModal', 'showRefundModal', 'showCostModal']) {
    instance.data[modal] = true;
    scroll(instance, (instance._pickingScrollTop || 0) + 30);
    assert.equal(instance.data.filterCollapseOffset, 0);
    instance.data[modal] = false;
  }
  assert.equal(instance.data.selectedStall, '8');
  assert.equal(instance.data.skuKeyword, '棉袄');
  assert.deepEqual(instance.data.pendingOrderList, [{ skuId: '1', qty: 7 }]);
});

test('按真实高度初始化占位，旋转屏幕后重新测量，保持已收缩状态', () => {
  const instance = page();
  instance.data.filterPanelHeight = 0;
  instance.data.toolbarPlaceholderHeight = 0;
  let result = [{ height: 300 }, { height: 200 }];
  global.wx = {
    nextTick: callback => callback(),
    createSelectorQuery: () => ({
      in() { return this; }, select() { return this; }, boundingClientRect() { return this; },
      exec(callback) { callback(result); }
    })
  };
  instance.onReady();
  assert.equal(instance.data.filterPanelHeight, 200);
  assert.equal(instance.data.toolbarPlaceholderHeight, 300);
  scroll(instance, 150);
  result = [{ height: 150 }, { height: 240 }];
  instance.onResize();
  assert.equal(instance.data.filterPanelHeight, 240);
  assert.equal(instance.data.filterCollapseOffset, 150);
  assert.equal(instance.data.toolbarPlaceholderHeight, 340);
  result = [{ height: 190 }, { height: 100 }];
  instance.onResize();
  assert.equal(instance.data.filterPanelHeight, 100);
  assert.equal(instance.data.filterCollapseOffset, 100);
  assert.equal(instance.data.toolbarPlaceholderHeight, 200);
});
