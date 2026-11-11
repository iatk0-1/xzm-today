const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const toolbar = require('../../utils/collapsibleToolbar');

function page(options = {}) {
  const instance = toolbar.wrap({ data: { keyword: '棉袄', selectedIds: ['1'], modal: false },
    backToTop() { wx.pageScrollTo({ scrollTop: 0, duration: 300 }); } }, options);
  instance.data = structuredClone(instance.data);
  instance.setData = patch => Object.assign(instance.data, patch);
  let rectangles = [{ height: 320 }, [{ height: 200 }]];
  global.wx = {
    pageScrollTo() {},
    nextTick: callback => callback(),
    createSelectorQuery: () => ({
      in() { return this; }, select() { return this; }, selectAll() { return this; },
      boundingClientRect() { return this; }, exec(callback) { callback(rectangles); }
    })
  };
  instance.onReady();
  instance.setRectangles = value => { rectangles = value; };
  return instance;
}

test('整页滚动逐步收起筛选，反向展开，完整占位和筛选及选择保持不变', () => {
  const instance = page();
  for (const [top, offset] of [[40, 40], [120, 120], [300, 200], [280, 180], [100, 0]]) {
    instance.onPageScroll({ scrollTop: top });
    assert.equal(instance.data.toolbarCollapseOffset, offset);
    assert.equal(instance.data.toolbarPlaceholderHeight, 320);
    assert.deepEqual(instance.data.toolbarSectionStyles, [`height:${200 - offset}px;`]);
  }
  assert.equal(instance.data.keyword, '棉袄');
  assert.deepEqual(instance.data.selectedIds, ['1']);
});

test('商品列表使用内部滚动事件，不受页面滚动或横向位置不变的事件干扰', () => {
  const instance = page({ scrollView: true });
  instance.onPageScroll({ scrollTop: 300 });
  assert.equal(instance.data.toolbarCollapseOffset, 0);
  instance.onToolbarScroll({ detail: { scrollTop: 80 } });
  assert.equal(instance.data.toolbarCollapseOffset, 80);
  instance.onToolbarScroll({ detail: { scrollTop: 80 } });
  assert.equal(instance.data.toolbarCollapseOffset, 80);
  instance.onToolbarScroll({ detail: { scrollTop: 30 } });
  assert.equal(instance.data.toolbarCollapseOffset, 30);
});

test('回顶动画期间保持展开，手指打断回顶后继续按方向收放', () => {
  const instance = page();
  const calls = [];
  wx.pageScrollTo = options => calls.push(options);
  instance.onPageScroll({ scrollTop: 500 });
  instance.backToTop();
  assert.deepEqual(calls, [{ scrollTop: 0, duration: 300 }]);
  instance.onPageScroll({ scrollTop: 300 });
  assert.equal(instance.data.toolbarCollapseOffset, 0);
  instance.onToolbarTouchStart();
  instance.onPageScroll({ scrollTop: 350 });
  assert.equal(instance.data.toolbarCollapseOffset, 50);
  instance.onPageScroll({ scrollTop: -20 });
  assert.equal(instance.data.toolbarCollapseOffset, 0);
});

test('弹窗滚动不改变工具栏，弹窗关闭后从当前滚动位置继续收放', () => {
  const instance = page({ blockedFields: ['modal'] });
  instance.data.modal = true;
  instance.onPageScroll({ scrollTop: 200 });
  assert.equal(instance.data.toolbarCollapseOffset, 0);
  instance.data.modal = false;
  instance.onPageScroll({ scrollTop: 230 });
  assert.equal(instance.data.toolbarCollapseOffset, 30);
});

test('异步筛选内容或屏幕宽度改变时重新测量，已完全收起的筛选仍保持收起', () => {
  const instance = page();
  instance.onPageScroll({ scrollTop: 400 });
  instance.setRectangles([{ height: 120 }, [{ height: 260 }]]);
  instance.onResize();
  assert.equal(instance.data.toolbarCollapseHeight, 260);
  assert.equal(instance.data.toolbarCollapseOffset, 260);
  assert.equal(instance.data.toolbarPlaceholderHeight, 380);
  assert.deepEqual(instance.data.toolbarSectionStyles, ['height:0px;']);
});

test('页面卸载后忽略未完成的测量，并保留原生命周期回调', () => {
  let readyCalls = 0;
  let unloadCalls = 0;
  const instance = toolbar.wrap({ data: {}, onReady() { readyCalls++; }, onUnload() { unloadCalls++; } });
  instance.setData = patch => Object.assign(instance.data, patch);
  let finish;
  global.wx = { createSelectorQuery: () => ({
    in() { return this; }, select() { return this; }, selectAll() { return this; },
    boundingClientRect() { return this; }, exec(callback) { finish = callback; }
  }) };
  instance.onReady();
  instance.onUnload();
  finish([{ height: 320 }, [{ height: 200 }]]);
  assert.equal(readyCalls, 1);
  assert.equal(unloadCalls, 1);
  assert.equal(instance.data.toolbarPlaceholderHeight, 0);
});

function templateNodes(name) {
  const source = fs.readFileSync(path.join(__dirname, `../../pages/${name}/${name}.wxml`), 'utf8');
  const clean = source.replace(/<!--[^]*?-->/g, '').replace(/\{\{[^]*?\}\}/g, 'binding');
  const stack = [];
  const nodes = [];
  for (const match of clean.matchAll(/<(\/?)([\w:-]+)\b([^>]*?)(\/?)>/g)) {
    if (match[1]) {
      assert.equal(stack.pop().tag, match[2], '模板标签应配对');
    } else {
      const node = { tag: match[2], attrs: match[3], parents: [...stack] };
      nodes.push(node);
      if (!match[4]) stack.push(node);
    }
  }
  assert.equal(stack.length, 0);
  return nodes;
}

for (const [name, retainedClass] of [['adminProduct', 'admin-header'], ['skuInventory', 'inventory-action-bar'], ['adminOrder', 'toolbar']]) {
  test(`${name}：保留整个指定操作模块，搜索筛选置于可收缩区域内`, () => {
    const nodes = templateNodes(name);
    const hasClass = (node, value) => (node.attrs.match(/class="([^"]*)"/) || [null, ''])[1].split(/\s+/).includes(value);
    const retained = nodes.find(node => hasClass(node, retainedClass));
    assert.ok(retained);
    assert.ok(retained.parents.some(node => /id="collapsible-toolbar"/.test(node.attrs)));
    assert.ok(!retained.parents.some(node => hasClass(node, 'collapsible-panel')), '整个操作模块不能随筛选一起隐藏');
    const search = nodes.find(node => hasClass(node, 'search-input'));
    assert.ok(search.parents.some(node => hasClass(node, 'collapsible-panel')));
    if (name === 'adminOrder') {
      const batchButton = nodes.find(node => hasClass(node, 'batch-ship-btn'));
      assert.ok(batchButton.parents.includes(retained), '批量发货应留在常驻操作模块里');
    }
    if (name === 'skuInventory') {
      const batchButton = nodes.find(node => hasClass(node, 'batch-receive-btn'));
      assert.ok(batchButton.parents.includes(retained), '批量入库应留在常驻操作模块里');
    }
    if (name === 'adminProduct') {
      const list = nodes.find(node => hasClass(node, 'product-scroll-area'));
      assert.match(list.attrs, /bindscroll="onToolbarScroll"/);
    }
  });
}
