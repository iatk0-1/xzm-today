const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(images) {
  let definition;
  const events = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../components/sortableImageGrid/index.js'), 'utf8'), {
    Component(value) { definition = value; }, wx: { vibrateShort() {} }, Date
  });
  const grid = {
    ...definition.methods, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push({ name, detail }); }
  };
  definition.properties.images.observer.call(grid, images);
  const event = (index, detail) => ({ currentTarget: { dataset: { index } }, detail });
  return { grid, events, event };
}

test('拖拽跨行排序并输出完整图片顺序，重复图片也保留', () => {
  const { grid, events, event } = setup(['a', 'b', 'a', 'd']);
  grid.start(event(3));
  grid.move(event(3, { source: 'touch', x: 105, y: 0 }));
  grid.end();
  assert.deepEqual(Array.from(events[0].detail.images), ['a', 'd', 'b', 'a']);
  assert.equal(grid.data.dragIndex, -1);
  assert.equal(grid.data.addX, 105);
  assert.equal(grid.data.addY, 105);
  assert.equal(grid.data.areaHeight, 210);
});

test('长按原地松手、取消拖动不修改顺序，非触摸位置事件不干扰拖拽', () => {
  const { grid, events, event } = setup(['a', 'b', 'c']);
  grid.start(event(2));
  grid.move(event(2, { source: '', x: 0, y: 0 }));
  grid.end();
  assert.equal(events.length, 0);
  assert.deepEqual(Array.from(grid.data.items, item => item.url), ['a', 'b', 'c']);
  grid.start(event(1));
  grid.move(event(1, { source: 'touch', x: 0, y: 0 }));
  grid.cancel();
  grid.end();
  assert.equal(events.length, 0);
  assert.equal(grid.data.items[1].x, 105);
});

test('越界拖动钳制到有效位置，删除后添加按钮紧随最后一张图', () => {
  const { grid, events, event } = setup(['a', 'b', 'c']);
  grid.start(event(0));
  grid.move(event(0, { source: 'touch', x: 999, y: 999 }));
  grid.end();
  assert.deepEqual(Array.from(events[0].detail.images), ['b', 'c', 'a']);
  grid.remove(event(1));
  assert.deepEqual(Array.from(events[1].detail.images), ['b', 'a']);
  assert.equal(grid.data.addX, 210);
  assert.equal(grid.data.addY, 0);
  assert.equal(grid.data.areaHeight, 105);
});

test('点击预览与添加分开触发，拖动结束不会误打开图片预览', () => {
  const { grid, events, event } = setup(['a', 'b']);
  grid.preview(event(1));
  assert.equal(events[0].name, 'preview');
  assert.equal(events[0].detail.index, 1);
  grid.add();
  assert.equal(events[1].name, 'add');
  grid.start(event(1));
  grid.preview(event(1));
  grid.end();
  grid.preview(event(1));
  assert.equal(events.length, 2);
});

test('空图片列表仍显示添加入口', () => {
  const { grid } = setup([]);
  assert.equal(grid.data.areaHeight, 105);
  assert.equal(grid.data.addX, 0);
  assert.equal(grid.data.addY, 0);
});
