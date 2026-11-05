const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { limitTextInput } = require('../../utils/textInputLimit');

function harness() {
  let definition, timerId = 0, nativeValue = '';
  const timers = new Map(), ticks = [], patches = [], requests = [], scrolls = [];
  let pageScrollTop = 100;
  const filename = path.resolve(__dirname, '../../pages/afterSaleApply/afterSaleApply.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; }, console,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    wx: { showToast() {}, showLoading() {}, hideLoading() {}, showModal() {},
      nextTick: callback => ticks.push(callback),
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 800 }),
      pageScrollTo: options => { scrolls.push(options); pageScrollTop = options.scrollTop; },
      createSelectorQuery() {
        const query = { select: () => query, boundingClientRect: () => query,
          selectViewport: () => query, scrollOffset: () => query,
          exec: callback => callback([{ top: 650 - (pageScrollTop - 100) }, { scrollTop: pageScrollTop }]) };
        return query;
      }
    },
    require(name) {
      if (name.endsWith('/api')) return { post: async (url, data) => requests.push({ url, data }) };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {} };
      if (name.endsWith('/clipboard')) return {};
      return require(path.resolve(path.dirname(filename), name));
    }
  });
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch, callback) {
      if ('reasonInputValue' in patch && patch.reasonInputValue !== this.data.reasonInputValue) {
        nativeValue = patch.reasonInputValue;
      }
      patches.push(structuredClone(patch)); Object.assign(this.data, patch);
      if (callback) callback();
    } };
  return { page, patches, requests, scrolls,
    get nativeValue() { return nativeValue; },
    input(value, detail = {}) {
      nativeValue = value;
      // 原生 model:value 同步用户输入；同步本身不是业务主动重写输入框。
      page.data.reasonInputValue = value;
      page.onReasonInput({ detail: { value, cursor: value.length, ...detail } });
    },
    flush() {
      for (const [id, callback] of timers) { timers.delete(id); callback(); }
      while (ticks.length) ticks.shift()();
    } };
}

test('499字后整句中文上屏，只收下剩余的一个汉字，不在拼音阶段截断', () => {
  const env = harness(), before = '原'.repeat(499);
  env.input(before); env.patches.length = 0;
  env.page.onReasonCompositionStart();
  env.input(before + "ni'hao'shi'jie", { keyCode: 229 });
  assert.equal(env.page.data.reasonText, before);
  assert.equal(env.patches.length, 0);
  env.input(before + '你好世界', { keyCode: 229 });
  env.page.onReasonCompositionEnd(); env.flush();
  assert.equal(env.page.data.reasonText, before + '你');
  assert.equal(env.page.data.reasonInputValue, before + '你');
  assert.equal(env.page.data.reasonLength, 500);
  assert.ok(env.patches.every(patch => !('reasonCursor' in patch)));
});

test('兼容组词结束先到、最终input后到且keyCode仍为229的事件顺序', () => {
  const env = harness(), before = '原'.repeat(498);
  env.input(before); env.page.onReasonCompositionStart(); env.input(before + 'nihaoshijie');
  env.page.onReasonCompositionEnd();
  env.input(before + '你好世界', { keyCode: 229 }); env.flush();
  assert.equal(env.page.data.reasonText, before + '你好');
  assert.equal(env.page.data.reasonLength, 500);
});

test('已满500字仍可完成中文组词，连续超限也始终恢复汉字原文', () => {
  const env = harness(), before = '原'.repeat(500);
  env.input(before);
  for (const candidate of ['你好', '世界']) {
    env.page.onReasonCompositionStart(); env.input(before + 'pinyin');
    env.input(before + candidate); env.page.onReasonCompositionEnd(); env.flush();
    assert.equal(env.page.data.reasonText, before);
    assert.equal(env.page.data.reasonInputValue, before);
    assert.equal(env.nativeValue, before);
  }
  assert.equal(env.patches.filter(patch => patch.reasonInputValue === before).length, 2);
});

test('普通输入只更新提交内容和计数，不回写原生文本、光标或高度', () => {
  const env = harness();
  env.input('第一行'); env.input('第一行\n第二行'); env.input('第一行\n第二行\n第三行');
  assert.equal(env.page.data.reasonText, '第一行\n第二行\n第三行');
  assert.ok(env.patches.every(patch => !('reasonInputValue' in patch) && !('reasonCursor' in patch)
    && !('reasonAutoHeight' in patch)));
});

test('键盘打开只为五行定位一次，随后每次换行和五行后内部滚动都不再上推页面', () => {
  const env = harness();
  env.page.onReasonFocus({ detail: { height: 300 } }); env.flush();
  assert.equal(env.scrolls.length, 1);
  assert.equal(env.scrolls[0].scrollTop, 366);
  env.patches.length = 0;
  for (let lines = 1; lines <= 20; lines++) { env.input('换行\n'.repeat(lines)); env.flush(); }
  for (const lines of [5, 4, 2]) { env.input('缩回\n'.repeat(lines)); env.flush(); }
  env.page.onReasonKeyboardHeightChange({ detail: { height: 300 } }); env.flush();
  assert.equal(env.scrolls.length, 1);
  assert.ok(env.patches.every(patch => !('reasonAutoHeight' in patch) && !('reasonRows' in patch)
    && !('reasonKeyboardSpace' in patch)));
});

test('中间插入超限中文保留后面的原文，计算出实际接受的插入结束位置', () => {
  const previous = '前'.repeat(250) + '尾'.repeat(249);
  const input = '前'.repeat(250) + '你好世界' + '尾'.repeat(249);
  const result = limitTextInput(input, previous, 254);
  assert.equal(result.value, '前'.repeat(250) + '你' + '尾'.repeat(249));
  assert.equal(result.cursor, 251);
  assert.equal(result.length, 500);
});

test('整段粘贴和表情按完整字符截断，不截断代理对，也不丢失换行', () => {
  const result = limitTextInput('字'.repeat(497) + '\n😀你好');
  assert.equal(result.value, '字'.repeat(497) + '\n😀你');
  assert.equal(result.length, 500);
  assert.equal(result.cursor, result.value.length);
  assert.equal(limitTextInput('字'.repeat(501), '', -1).cursor, 500);
});

test('没有合成事件但带229键值时，等失焦给出最终汉字再裁剪', () => {
  const env = harness(), before = '原'.repeat(499);
  env.input(before); env.input(before + 'nihaoshijie', { keyCode: 229 });
  assert.equal(env.page.data.reasonText, before);
  env.page.onReasonFinish({ detail: { value: before + '你好世界', cursor: 503 } });
  env.flush();
  assert.equal(env.page.data.reasonText, before + '你');
});

test('待完成的旧回写不能覆盖用户随后输入，离开页面也取消组词回调', () => {
  const env = harness();
  env.input('字'.repeat(501));
  env.input('新内容'); env.flush();
  assert.equal(env.page.data.reasonText, '新内容');
  assert.equal(env.nativeValue, '新内容');
  env.page.onReasonCompositionStart(); env.input('未结束的拼音'); env.page.onReasonCompositionEnd();
  env.page.onUnload(); env.flush();
  assert.equal(env.page.data.reasonText, '新内容');
});

test('满字数后的连续超限每次只写一次裁剪结果，不写临时长文、不重设光标', () => {
  const env = harness(), before = '字'.repeat(500);
  env.input(before); env.patches.length = 0;
  for (const extra of ['额外文字', '\n下一行', 'abc']) { env.input(before + extra); env.flush(); }
  const corrections = env.patches.filter(patch => 'reasonInputValue' in patch);
  assert.equal(corrections.length, 3);
  assert.ok(corrections.every(patch => patch.reasonInputValue === before && Object.keys(patch).length === 1));
  assert.equal(env.nativeValue, before);
  assert.ok(env.patches.every(patch => !('reasonCursor' in patch)));
});

test('失焦后键盘回调和旧定位回调不会再次移动页面', () => {
  const env = harness();
  env.page.onReasonFocus({ detail: { height: 300 } });
  env.page.onReasonBlur({ detail: { value: '', cursor: 0 } }); env.flush();
  assert.equal(env.page.data.reasonKeyboardSpace, 0);
  assert.equal(env.scrolls.length, 0);
  env.page.onReasonKeyboardHeightChange({ detail: { height: 250 } }); env.flush();
  assert.equal(env.scrolls.length, 0);
});

test('提交继续使用原reason参数，并在提交边界再次限制到500个完整字符', async () => {
  const env = harness(), item = { orderItemId: '1', productId: '2', type: 'refund',
    qty: 1, selectedQty: 1, salePrice: 1, inputAmount: '1.00', maxRefundAmount: 1 };
  Object.assign(env.page.data, { orderId: '10', order: {}, splitItems: [item], selectedItems: [item],
    reason: '其他', reasonText: '字'.repeat(501) });
  await env.page.submitAfterSale();
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].data.reason, '其他\n' + '字'.repeat(500));
});
