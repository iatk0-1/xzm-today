const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture(admin = true) {
  let definition, stored = [], next = 1;
  const writes = [], reads = [], modals = [], timers = new Set(), timeouts = new Set();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/shippingTemplates/shippingTemplates.js'), 'utf8'), {
    Page: p => { definition = p; },
    wx: { showToast() {}, showModal(options) { modals.push(options); }, stopPullDownRefresh() {},
      vibrateShort() {}, createSelectorQuery() {
        const query = { in() { return query; }, select() { return query; }, boundingClientRect() { return query; },
          scrollOffset() { return query; }, exec(callback) { callback([{ top: 100, height: 144 }, { scrollTop: 0 }]); } };
        return query;
      } },
    setInterval(callback) { timers.add(callback); return callback; },
    clearInterval(callback) { timers.delete(callback); },
    setTimeout(callback) { timeouts.add(callback); return callback; },
    clearTimeout(callback) { timeouts.delete(callback); },
    require(name) {
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/provinces')) return require('../../utils/provinces');
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => admin };
      return {
        get: async (url) => { reads.push(url); return structuredClone(stored); },
        post: async (url, body) => {
          writes.push({ url, body });
          if (url.endsWith('/activate') || url.endsWith('/deactivate')) {
            const id = url.split('/')[3], activate = url.endsWith('/activate');
            stored = stored.map(t => ({ ...t, enabled: String(t.id) === id ? activate : activate ? false : t.enabled }));
            return stored.find(t => String(t.id) === id);
          }
          const entry = { ...body, id: next++, enabled: false }; stored.push(entry); return entry;
        },
        put: async (url, body) => {
          writes.push({ url, body }); const id = url.split('/')[3];
          stored = stored.map(t => String(t.id) === id ? { ...t, ...body } : t);
          return stored.find(t => String(t.id) === id);
        }
      };
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(v) {
    for (const [key, value] of Object.entries(v)) {
      const match = key.match(/^rules\[(\d+)\]\.y$/);
      if (match) this.data.rules[Number(match[1])].y = value;
      else this.data[key] = value;
    }
  } };
  return { page, writes, reads, modals, timers, timeouts };
}
const select = code => ({ detail: { value: 1 + require('../../utils/provinces').findIndex(p => p.code === code) } });
const item = id => ({ currentTarget: { dataset: { id } } });

test('新模板不生效，空运费和空首单件数分别保留null', async () => {
  const { page, writes } = fixture(); await page.onLoad(); page.newTemplate();
  page.setData({ name: '偏远省份' }); page.addProvince(select('540000')); page.addProvince(select('650000'));
  page.setData({ rules: page.data.rules.map((r, i) => i ? { ...r, firstQuantity: '5' } : { ...r, shippingFee: '15' }) });
  await page.save();
  assert.equal(writes[0].body.rules[0].firstQuantity, null);
  assert.equal(writes[0].body.rules[1].shippingFee, null);
  assert.equal(page.data.templates[0].enabled, false);
  assert.equal(page.data.templates[0].rules[1].feeLabel, '免运费');
  page.editTemplate(item('1'));
  page.changeProvince({ ...select('110000'), currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.rules[0].provinceCode, '110000');
  assert.equal(page.data.rules[0].shippingFee, '15');
  await page.save();
  assert.equal(writes[1].body.rules[0].provinceCode, '110000');
  assert.equal(writes[1].body.rules[0].shippingFee, '15');
  page.editTemplate(item('1'));
  page.completeProvinces();
  page.completeProvinces();
  assert.equal(page.data.rules.length, require('../../utils/provinces').length);
  assert.equal(new Set(page.data.rules.map(rule => rule.provinceCode)).size, page.data.rules.length);
  assert.equal(page.data.rules[0].shippingFee, '15');
  assert.equal(page.data.rules[1].firstQuantity, '5');
  assert.ok(page.data.rules.slice(2).every(rule => rule.shippingFee === '' && rule.firstQuantity === ''));
  await page.save();
  assert.ok(writes[2].body.rules.slice(2).every(rule => rule.shippingFee === null && rule.firstQuantity === null));
});

test('拖动调整省份顺序，数值随整行移动，保存和重新编辑保持顺序', async () => {
  const { page, writes, timers } = fixture(); await page.onLoad(); page.newTemplate();
  page.setData({ name: '拖动排序' });
  ['110000', '540000', '650000'].forEach(code => page.addProvince(select(code)));
  page.setData({ rules: page.data.rules.map((rule, i) => ({ ...rule, shippingFee: String(i + 1), firstQuantity: String(i + 3) })) });
  page.onDragStart({ currentTarget: { dataset: { index: 0 } }, touches: [{ identifier: 1, clientY: 120 }] });
  // 第二根手指不能改变正在拖动的行。
  page.onDragTouchMove({ touches: [{ identifier: 2, clientY: 900 }] });
  assert.equal(page.data.dragY, 0);
  page.onDragTouchMove({ touches: [{ identifier: 1, clientY: 1000 }] });
  page.removeProvince({ currentTarget: { dataset: { index: 1 } } });
  await page.save();
  assert.equal(writes.length, 0);
  assert.equal(page.data.rules.length, 3);
  page.onDragEnd();
  assert.deepEqual(Array.from(page.data.rules, rule => rule.provinceCode), ['540000', '650000', '110000']);
  assert.equal(page.data.rules[2].shippingFee, '1');
  assert.equal(page.data.rules[2].firstQuantity, '3');
  assert.equal(timers.size, 0);
  await page.save(); page.editTemplate(item('1'));
  assert.deepEqual(Array.from(page.data.rules, rule => rule.provinceCode), ['540000', '650000', '110000']);
  page.onDragStart({ currentTarget: { dataset: { index: 2 } }, touches: [{ identifier: 1, clientY: 220 }] });
  page.onDragTouchMove({ touches: [{ identifier: 1, clientY: -1000 }] });
  page.onDragEnd();
  assert.equal(page.data.rules[0].provinceCode, '110000');
  page.onDragStart({ currentTarget: { dataset: { index: 0 } }, touches: [{ identifier: 1, clientY: 120 }] });
  page.onDragTouchMove({ touches: [{ identifier: 1, clientY: 220 }] });
  page.onDragCancel();
  assert.equal(page.data.rules[0].provinceCode, '110000');
  assert.deepEqual(Array.from(page.data.rules, rule => rule.y), [0, 48, 96]);
  assert.equal(timers.size, 0);
});

test('从手柄触摸序列识别长按，缺少longpress触点仍可启动，短按和滑动不误触', async () => {
  const { page, timeouts, timers } = fixture(); await page.onLoad(); page.newTemplate();
  ['110000', '540000', '650000'].forEach(code => page.addProvince(select(code)));
  const start = { currentTarget: { dataset: { index: 0 } }, touches: [{ identifier: 9, clientX: 25, clientY: 120 }] };
  page.onDragHandleTouchStart(start);
  assert.equal(page.data.dragIndex, -1);
  const fireLongPress = Array.from(timeouts)[0]; fireLongPress();
  assert.equal(page.data.dragIndex, 0);
  page.onDragTouchMove({ touches: [{ identifier: 9, clientX: 25, clientY: 220 }] });
  page.onDragEnd();
  assert.equal(page.data.rules.at(-1).provinceCode, '110000');
  assert.equal(timeouts.size, 0); assert.equal(timers.size, 0);
  page.onDragHandleTouchStart(start);
  page.onDragStart({ currentTarget: start.currentTarget });
  assert.equal(page.data.dragIndex, 0);
  page.onDragCancel();
  page.onDragHandleTouchStart(start);
  const staleCallback = Array.from(timeouts)[0];
  page.onDragEnd(); staleCallback();
  assert.equal(page.data.dragIndex, -1); assert.equal(timeouts.size, 0);
  page.onDragHandleTouchStart(start);
  page.onDragTouchMove({ touches: [{ identifier: 9, clientX: 25, clientY: 150 }] });
  assert.equal(timeouts.size, 0); assert.equal(page.data.dragIndex, -1);
  page.onDragHandleTouchStart(start); page.onHide();
  assert.equal(timeouts.size, 0);
});

test('补全省份后拖到边缘自动滚动，松手排序并停止计时器', async () => {
  const { page, timers, reads } = fixture(); await page.onLoad(); page.newTemplate(); page.completeProvinces();
  const first = page.data.rules[0].provinceCode;
  page.onDragStart({ currentTarget: { dataset: { index: 0 } }, touches: [{ identifier: 3, clientY: 120 }] });
  await page.onRefresh();
  assert.equal(reads.length, 1);
  assert.equal(page.data.refreshing, false);
  page.onDragTouchMove({ touches: [{ identifier: 3, clientY: 240 }] });
  for (let i = 0; i < 200; i++) page.autoScrollRules();
  assert.equal(page.data.ruleScrollTop, page.data.rules.length * 48 - 144);
  page.onDragEnd();
  assert.equal(page.data.rules.at(-1).provinceCode, first);
  assert.equal(timers.size, 0);
  page.onDragStart({ currentTarget: { dataset: { index: 0 } }, touches: [{ identifier: 3, clientY: 120 }] });
  page.onHide(); assert.equal(timers.size, 0); assert.equal(page.data.dragIndex, -1);
  await page.onRefresh();
  assert.equal(reads.length, 1);
  page.cancelEdit(); await page.onRefresh();
  assert.equal(reads.length, 2);
  assert.equal(page.data.refreshing, false);
});
test('编辑当前生效模板保持生效，编辑备用模板不会改变生效模板', async () => {
  const { page } = fixture(); await page.onLoad();
  page.newTemplate(); page.setData({ name: '模板一' }); await page.save(); await page.changeEnabled(item('1'));
  page.newTemplate(); page.setData({ name: '模板二' }); await page.save();
  page.editTemplate(item('2')); page.setData({ name: '备用修改' }); await page.save();
  assert.equal(page.data.templates.find(t => t.id === '1').enabled, true);
  assert.equal(page.data.templates.find(t => t.id === '2').enabled, false);
  page.editTemplate(item('1')); page.setData({ name: '生效修改' }); await page.save();
  assert.equal(page.data.templates.find(t => t.id === '1').enabled, true);
  await page.changeEnabled(item('2'));
  assert.equal(page.data.templates.filter(t => t.enabled).length, 1);
  await page.changeEnabled(item('2'));
  assert.equal(page.data.templates.filter(t => t.enabled).length, 0);
});
test('重复省份、不合法运费和非正整数首单件数阻止保存，非管理员没有管理权限', async () => {
  const { page, writes, modals } = fixture(); await page.onLoad(); page.newTemplate(); page.setData({ name: '测试' });
  page.addProvince(select('540000')); page.addProvince(select('540000')); assert.equal(page.data.rules.length, 1);
  assert.match(modals.at(-1).content, /重复/);
  assert.equal(modals.at(-1).showCancel, false);
  assert.equal(page.data.error, '');
  page.addProvince(select('650000'));
  page.changeProvince({ ...select('540000'), currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.rules[1].provinceCode, '650000');
  assert.match(modals.at(-1).content, /重复/);
  page.setData({ rules: [{ ...page.data.rules[0], shippingFee: '1.001' }] }); await page.save(); assert.equal(writes.length, 0);
  assert.match(modals.at(-1).content, /运费/);
  page.setData({ rules: [{ ...page.data.rules[0], shippingFee: '', firstQuantity: '0' }] }); await page.save(); assert.equal(writes.length, 0);
  assert.match(modals.at(-1).content, /正整数/);
  assert.equal(page.data.editing, true);
  assert.equal(page.data.error, '');
  const user = fixture(false); await user.page.onLoad(); user.page.newTemplate(); await user.page.save();
  assert.equal(user.writes.length, 0); assert.match(user.page.data.error, /仅管理员/);
});
