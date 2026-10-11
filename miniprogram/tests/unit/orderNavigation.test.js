const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const navigation = require('../../utils/orderNavigation');

function touch(timeStamp, x = 50, y = 50) {
  return { timeStamp, touches: [{ clientX: x, clientY: y }] };
}

const pages = [
  ['orderList', 'goToDetail'],
  ['adminOrderManage', 'goToDetail'],
  ['adminOrder', 'goToOrderDetail'],
  ['orderDetail', 'goToProduct'],
  ['adminOrderDetail', 'goToProduct']
];

for (const [name, handler] of pages) {
  test(`${name} 长按不移动直接抬手不跳详情，下次普通点击仍可跳转`, () => {
    let page;
    const urls = [];
    const filename = path.join(__dirname, '../../pages', name, `${name}.js`);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      require(request) {
        if (request.endsWith('/orderNavigation')) return navigation;
        if (request.endsWith('/pageSync') || request.endsWith('/autoSearch')) {
          return { wrap: config => config };
        }
        return {};
      },
      Page(config) { page = config; },
      wx: { navigateTo({ url }) { urls.push(url); } }
    });
    const tap = { timeStamp: 810, currentTarget: { dataset: { id: '42', orderId: '42', productId: '42' } } };
    page.onOrderTouchStart(touch(100));
    page.onOrderTouchEnd(touch(800));
    page[handler](tap);
    page[handler](tap);
    assert.deepEqual(urls, []);

    // 下一次触摸必须恢复普通点击，不能把之前的长按状态留在页面里。
    page.onOrderTouchStart(touch(1000));
    page.onOrderTouchEnd(touch(1100));
    page[handler]({ ...tap, timeStamp: 1110 });
    assert.equal(urls.length, 1);
    assert.match(urls[0], /id=42$/);

    // 原生选择接管了 touchend 时，后续 tap 仍不能触发跳转。
    page.onOrderTouchStart(touch(2000));
    page[handler]({ ...tap, timeStamp: 2700 });
    assert.equal(urls.length, 1);

    const template = fs.readFileSync(filename.replace(/\.js$/, '.wxml'), 'utf8');
    const targets = template.match(/<[^>]*(?:bindtap|catchtap)="(?:goToDetail|goToOrderDetail|goToProduct)"[^>]*>/g);
    assert.ok(targets && targets.length);
    for (const target of targets) {
      for (const phase of ['Start', 'Move', 'End', 'Cancel']) {
        assert.ok(target.includes(`bindtouch${phase.toLowerCase()}="onOrderTouch${phase}"`));
      }
    }
    assert.match(template, /user-select="{{true}}"/);
    assert.doesNotMatch(template, /catchlongpress="copy/);
  });
}

test('拖动选区或滚动后即使手指回到原位也不跳转', () => {
  const page = {};
  navigation.onTouchStart.call(page, touch(0));
  navigation.onTouchMove.call(page, touch(50, 80));
  navigation.onTouchMove.call(page, touch(100));
  navigation.onTouchEnd.call(page, touch(120));
  assert.equal(navigation.canNavigate(page, { timeStamp: 125 }), false);
});

test('手势取消不跳转，下次轻触有少量抖动仍能跳转', () => {
  const page = {};
  navigation.onTouchStart.call(page, touch(0));
  navigation.onTouchCancel.call(page);
  assert.equal(navigation.canNavigate(page, { timeStamp: 100 }), false);
  navigation.onTouchStart.call(page, touch(1000));
  navigation.onTouchMove.call(page, touch(1050, 54, 53));
  navigation.onTouchEnd.call(page, touch(1100));
  assert.equal(navigation.canNavigate(page, { timeStamp: 1110 }), true);
});

test('短按抬手后的延迟 tap 不会被误判为长按', () => {
  const page = {};
  navigation.onTouchStart.call(page, touch(0));
  navigation.onTouchEnd.call(page, touch(100));
  assert.equal(navigation.canNavigate(page, { timeStamp: 1000 }), true);
});

test('无时间戳时仍按实际按住的时长拦住长按', () => {
  const page = {};
  navigation.onTouchStart.call(page, { touches: [] });
  page._orderNavigationGesture.startedAt -= 700;
  navigation.onTouchEnd.call(page, {});
  assert.equal(navigation.canNavigate(page, {}), false);
});
