const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const componentPath = path.join(__dirname, '../../components/productEditorShell');
const template = fs.readFileSync(path.join(componentPath, 'index.wxml'), 'utf8');
const styles = fs.readFileSync(path.join(componentPath, 'index.wxss'), 'utf8');

function shell(saving = false) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(componentPath, 'index.js'), 'utf8'), {
    Component: value => { definition = value; }
  });
  const events = [];
  return { instance: { ...definition.methods, data: { saving }, triggerEvent: name => events.push(name) }, events };
}

test('退出弹窗只留保存并退出和退出，分别使用绿色和红色底色', () => {
  const dialog = template.slice(template.indexOf('class="editor-exit-dialog"'));
  assert.deepEqual([...dialog.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(match => match[1]), ['保存并退出', '退出']);
  assert.match(styles, /\.editor-exit-save\s*\{[^}]*background:\s*#07c160;[^}]*color:\s*#fff/);
  assert.match(styles, /\.editor-exit-discard\s*\{[^}]*background:\s*#d94a3d;[^}]*color:\s*#fff/);
  const { instance, events } = shell();instance.save();instance.discard();
  assert.deepEqual(events, ['saveexit', 'discardexit']);
});

test('点弹窗遮罩只发送关闭事件，点弹窗内部不关闭也不退出', () => {
  assert.match(template, /class="editor-exit-mask" catchtap="cancel" catchtouchmove="blockTouch"/);
  assert.match(template, /class="editor-exit-dialog" catchtap="blockTouch"/);
  const { instance, events } = shell();instance.blockTouch();assert.deepEqual(events, []);
  instance.cancel();assert.deepEqual(events, ['cancel']);
});

test('保存期间不重复触发保存、退出或遮罩关闭', () => {
  const { instance, events } = shell(true);
  instance.save();instance.discard();instance.cancel();instance.back();
  assert.deepEqual(events, []);
});

test('两套商品编辑页不再展示顶部草稿箱行，无异常时不占行，冲突操作仍保留', () => {
  for (const page of ['admin/admin', 'liveRoomPublish/publish']) {
    const markup = fs.readFileSync(path.join(__dirname, '../../pages/' + page + '.wxml'), 'utf8');
    const status = markup.match(/<product-draft-status[^>]*\/>/)[0];
    assert.doesNotMatch(status, /bind:open=|count=|saved=|dirty=/);
    assert.match(status, /bind:reload="reloadDraftSource"/);
  }
  const status = fs.readFileSync(path.join(__dirname, '../../components/productDraftStatus/index.wxml'), 'utf8');
  assert.doesNotMatch(status, /草稿箱|draft-status-row/);
  assert.match(status, /wx:if="\{\{problem \|\| warnings.length \|\| conflict\}\}"/);
  assert.match(status, /打开最新版本/);
});
