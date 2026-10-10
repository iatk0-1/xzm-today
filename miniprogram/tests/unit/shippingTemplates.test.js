const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture(admin = true) {
  let definition, stored = [], next = 1;
  const writes = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/shippingTemplates/shippingTemplates.js'), 'utf8'), {
    Page: p => { definition = p; },
    wx: { showToast() {}, stopPullDownRefresh() {} },
    require(name) {
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/provinces')) return require('../../utils/provinces');
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => admin };
      return {
        get: async () => structuredClone(stored),
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
  const page = { ...definition, data: structuredClone(definition.data), setData(v) { Object.assign(this.data, v); } };
  return { page, writes };
}
const select = code => ({ detail: { value: 1 + require('../../utils/provinces').findIndex(p => p.code === code) } });
const item = id => ({ currentTarget: { dataset: { id } } });

test('新模板不生效，空运费和空件数上限分别保留null', async () => {
  const { page, writes } = fixture(); await page.onLoad(); page.newTemplate();
  page.setData({ name: '偏远省份' }); page.addProvince(select('540000')); page.addProvince(select('650000'));
  page.setData({ rules: page.data.rules.map((r, i) => i ? { ...r, maxQuantity: '5' } : { ...r, shippingFee: '15' }) });
  await page.save();
  assert.equal(writes[0].body.rules[0].maxQuantity, null);
  assert.equal(writes[0].body.rules[1].shippingFee, null);
  assert.equal(page.data.templates[0].enabled, false);
  assert.equal(page.data.templates[0].rules[1].feeLabel, '免运费');
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
test('重复省份、不合法运费和非正整数上限阻止保存，非管理员没有管理权限', async () => {
  const { page, writes } = fixture(); await page.onLoad(); page.newTemplate(); page.setData({ name: '测试' });
  page.addProvince(select('540000')); page.addProvince(select('540000')); assert.equal(page.data.rules.length, 1);
  assert.match(page.data.error, /重复/);
  page.setData({ rules: [{ ...page.data.rules[0], shippingFee: '1.001' }] }); await page.save(); assert.equal(writes.length, 0);
  page.setData({ rules: [{ ...page.data.rules[0], shippingFee: '', maxQuantity: '0' }] }); await page.save(); assert.equal(writes.length, 0);
  const user = fixture(false); await user.page.onLoad(); user.page.newTemplate(); await user.page.save();
  assert.equal(user.writes.length, 0); assert.match(user.page.data.error, /仅管理员/);
});
