const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const finance = require('../../utils/managerFinance');

function harness({ admin = true, confirm = true, get = async () => [], write } = {}) {
  let config;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/commissionConfigs/commissionConfigs.js'), 'utf8'), {
    Page: value => { config = value; },
    require: name => name.endsWith('/error') ? require('../../utils/error') : name.endsWith('/auth') ? { ensureAuthenticated: async () => {}, isAdmin: () => admin }
      : name.endsWith('/managerFinance') ? { ...finance, confirmAction: async () => confirm }
        : { get: async url => { calls.push({ method: 'get', url }); return get(url); },
          post: async (url, body) => { calls.push({ method: 'post', url, body }); return write ? write(url, body) : { affectedProducts: 2 }; },
          put: async (url, body) => { calls.push({ method: 'put', url, body }); return write ? write(url, body) : { affectedProducts: 2 }; } },
    wx: { showToast() {}, stopPullDownRefresh() {} }
  });
  const page = { ...config, data: structuredClone(config.data), _authorized: true };
  page.setData = patch => Object.assign(page.data, patch);
  return { page, calls };
}
const saveEvent = active => ({ currentTarget: { dataset: { activate: active } } });
const idEvent = id => ({ currentTarget: { dataset: { id } } });

test('非管理员不能加载或保存配置', async () => {
  const { page, calls } = harness({ admin: false });
  page._authorized = false;
  await page.onLoad();
  page.newConfig();
  await page.save(saveEvent(true));
  assert.equal(calls.length, 0);
  assert.match(page.data.error, /管理员/);
});
test('列表区分0金额和0比例，保留雪花ID', async () => {
  const { page } = harness({ get: async () => [{ id: '9007199254740993', name: '零比例', profitPercent: '0.00', unitCommission: null },
    { id: '2', name: '零固定', unitCommission: '0.00', profitPercent: null }] });
  await page.load();
  assert.equal(page.data.configs[0].id, '9007199254740993');
  assert.equal(page.data.configs[0].valueLabel, '利润的 0.00%');
  assert.equal(page.data.configs[1].valueLabel, '每件 / 每套 ¥0.00');
});
test('固定金额仅保存不会生效，比例保存生效时仅发送比例', async () => {
  const fixed = harness();
  fixed.page.newConfig();
  fixed.page.setData({ name: '固定', value: '0' });
  await fixed.page.save(saveEvent(false));
  assert.equal(fixed.calls[0].body.unitCommission, '0.00');
  assert.equal(fixed.calls[0].body.profitPercent, null);
  assert.equal(fixed.calls[0].body.activate, false);
  const percent = harness();
  percent.page.newConfig();
  percent.page.setData({ name: '比例', mode: 'percent', value: '10.5' });
  await percent.page.save(saveEvent('true'));
  assert.equal(percent.calls[0].body.profitPercent, '10.50');
  assert.equal(percent.calls[0].body.unitCommission, null);
  assert.equal(percent.calls[0].body.activate, true);
});
test('切换模式清空旧输入，防止把金额误作比例', () => {
  const { page } = harness();
  page.setData({ value: '200' });
  page.changeMode({ detail: { value: 'percent' } });
  assert.equal(page.data.mode, 'percent');
  assert.equal(page.data.value, '');
});
test('空名称、空金额、负数、超比例及多余精度不调用接口', async () => {
  for (const [name, value] of [['', '10'], ['配置', ''], ['配置', '-1'], ['配置', '100.01'], ['配置', '0.001']]) {
    const { page, calls } = harness();
    page.setData({ name, value, mode: 'percent' });
    await page.save(saveEvent(true));
    assert.equal(calls.length, 0);
    assert.ok(page.data.error);
    assert.equal(page.data.busy, false);
  }
});
test('已生效配置编辑必须重新生效，不能仅保存造成商品与配置不一致', async () => {
  const { page, calls } = harness();
  page.setData({ configs: [{ id: '9007199254740993', name: '已生效', enabled: true, profitPercent: '10', unitCommission: null }] });
  page.editConfig(idEvent('9007199254740993'));
  assert.equal(page.data.value, '10');
  assert.equal(page.data.mode, 'percent');
  await page.save(saveEvent(false));
  assert.equal(calls.length, 0);
  await page.save(saveEvent(true));
  assert.equal(calls[0].url, '/commission-configs/9007199254740993');
  assert.equal(calls[0].method, 'put');
});
test('取消生效不保存或切换，允许重启当前配置再次覆盖单品佣金', async () => {
  const cancelled = harness({ confirm: false });
  cancelled.page.setData({ configs: [{ id: '1' }], name: '配置', value: '3' });
  await cancelled.page.save(saveEvent(true));
  await cancelled.page.activateConfig(idEvent('1'));
  assert.equal(cancelled.calls.length, 0);
  const accepted = harness();
  accepted.page.setData({ configs: [{ id: '1', enabled: true }] });
  await accepted.page.activateConfig(idEvent('1'));
  assert.equal(accepted.calls[0].url, '/commission-configs/1/activate');
});
test('保存失败保留表单且忙碌期间不能重复提交、切换模式或关闭', async () => {
  let reject;
  const pending = new Promise((resolve, fail) => { reject = fail; });
  const { page, calls } = harness({ write: async () => pending });
  page.setData({ editing: true, name: '失败保留', value: '3' });
  const request = page.save(saveEvent(false));
  await new Promise(resolve => setImmediate(resolve));
  await page.save(saveEvent(false));
  page.changeMode({ detail: { value: 'percent' } });
  page.cancelEdit();
  assert.equal(calls.length, 1);
  assert.equal(page.data.mode, 'fixed');
  assert.equal(page.data.editing, true);
  reject(new Error('保存失败'));
  await request;
  assert.equal(page.data.error, '保存失败');
  assert.equal(page.data.name, '失败保留');
  assert.equal(page.data.value, '3');
  assert.equal(page.data.busy, false);
});
