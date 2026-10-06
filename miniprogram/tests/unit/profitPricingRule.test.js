const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const finance = require('../../utils/managerFinance');

function setup({ post, put, get } = {}) {
  let config;
  const calls = [];
  const api = {};
  for (const [method, handler] of Object.entries({ post, put, get })) {
    api[method] = async (url, data) => {
      calls.push({ method, url, data: data && structuredClone(data) });
      return handler ? handler(url, data) : [];
    };
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/pricingRules/pricingRules.js'), 'utf8'), {
    Page(value) { config = value; }, wx: { showToast() {} },
    require(name) {
        if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/api')) return api;
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => true };
      if (name.endsWith('/managerFinance')) return finance;
      throw new Error('未配置的测试依赖：' + name);
    }
  });
  const page = { ...config, data: structuredClone(config.data),
    setData(patch) { Object.assign(this.data, patch); }, _authorized: true };
  return { page, calls };
}

test('新增利润规则默认10元，可快捷选20、30元，试算显示预期利润加价和售价', async () => {
  const { page, calls } = setup({ post: async () => ({ price: '234.69', expectedProfit: '30', markup: '34.69' }) });
  page.newProfitRule();
  assert.equal(page.data.minimumProfit, '10');
  assert.equal(page.data.profitPercent, '10');
  assert.equal(page.data.profitRule, true);
  page.chooseProfit({ currentTarget: { dataset: { amount: 20 } } });
  assert.equal(page.data.minimumProfit, '20');
  page.chooseProfit({ currentTarget: { dataset: { amount: 30 } } });
  page.input({ currentTarget: { dataset: { field: 'trialCost' } }, detail: { value: '200' } });
  await page.preview();
  assert.deepEqual(calls[0].data, { minimumProfit: '30.00', profitPercent: '10.00', cost: '200.00' });
  assert.equal(page.data.trialProfit, '30');
  assert.equal(page.data.trialMarkup, '34.69');
  assert.equal(page.data.trialPrice, '234.69');
});

test('特殊规则编辑与复制保留最低利润，保存只传最低利润由后端生成公式', async () => {
  const { page, calls } = setup();
  page.setData({ rules: [{ id: '42', name: '默认利润保底规则', enabled: true, minimumProfit: 20, profitPercent: 15,
    segments: [{ lower: 0, upper: 200, formula: '(x+20)/0.98' }] }] });
  page.edit({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.profitRule, true);
  assert.equal(page.data.minimumProfit, '20');
  assert.equal(page.data.profitPercent, '15');
  page.chooseProfit({ currentTarget: { dataset: { amount: 30 } } });
  await page.save();
  assert.deepEqual(calls[0].data, { name: '默认利润保底规则', enabled: true, minimumProfit: '30.00', profitPercent: '15.00' });
  assert.equal(calls[0].url, '/pricing-rules/42');
  page.setData({ rules: [{ id: '42', name: '默认利润保底规则', enabled: true, minimumProfit: '30.00', profitPercent: '15.00', segments: [] }] });
  page.copy({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.id, '');
  assert.equal(page.data.minimumProfit, '30.00');
  assert.equal(page.data.profitPercent, '15.00');
  const before = calls.length;
  await page.save();
  assert.equal(calls.length, before);
  assert.match(page.data.error, /名称已存在/);
  page.input({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '利润30元副本' } });
  await page.save();
  assert.equal(calls[before].method, 'post');
  assert.equal(calls[before].data.minimumProfit, '30.00');
  assert.equal(calls[before].data.profitPercent, '15.00');
});

test('普通规则仍使用原区间公式，特殊规则列表完整表达利润取较大值', async () => {
  const { page, calls } = setup();
  const rows = page.ruleRows([{ id: '42', minimumProfit: 10, segments: [] },
    { id: '43', segments: [{ lower: 0, upper: null, lowerInclusive: false, formula: 'x+5' }] }]);
  assert.match(rows[0].firstCondition, /10 元.*10%.*较大值/);
  assert.equal(rows[0].firstFormula, '(成本 + 预期利润) ÷ 0.98');
  assert.equal(rows[1].firstFormula, 'x+5');
  page.newProfitRule();
  page.newRule();
  assert.equal(page.data.profitRule, false);
  page.input({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '普通规则' } });
  await page.save();
  assert.ok(calls[0].data.segments);
  assert.equal(Object.hasOwn(calls[0].data, 'minimumProfit'), false);
});

test('最低预期利润非法时试算和保存都不发请求，允许两位小数利润', async () => {
  for (const value of ['', '0', '-1', '10.001', '100000000']) {
    const { page, calls } = setup();
    page.newProfitRule();
    page.setData({ minimumProfit: value, trialCost: '1' });
    await page.preview();
    assert.match(page.data.error, /最低预期利润/);
    await page.save();
    assert.match(page.data.error, /最低预期利润/);
    assert.equal(calls.length, 0);
  }
  const { page, calls } = setup();
  page.newProfitRule();
  page.setData({ minimumProfit: '10.01' });
  await page.save();
  assert.equal(calls[0].data.minimumProfit, '10.01');
});

test('修改利润成本或离开编辑后，过期试算结果不能覆盖当前状态', async () => {
  for (const change of ['profit', 'percent', 'cost', 'close']) {
    let resolve;
    const { page } = setup({ post: () => new Promise(done => { resolve = done; }) });
    page.newProfitRule();
    page.setData({ trialCost: '200' });
    const pending = page.preview();
    if (change === 'profit') page.chooseProfit({ currentTarget: { dataset: { amount: 30 } } });
    else if (change === 'percent') page.input({ currentTarget: { dataset: { field: 'profitPercent' } }, detail: { value: '20' } });
    else if (change === 'cost') page.input({ currentTarget: { dataset: { field: 'trialCost' } }, detail: { value: '50' } });
    else page.close();
    resolve({ price: '224.49', expectedProfit: '20', markup: '24.49' });
    await pending;
    assert.equal(page.data.trialPrice, '');
    assert.equal(page.data.trialProfit, '');
  }
});

test('比例可输入小数和0，试算保存携带填写比例，列表不写死10%', async () => {
  for (const value of ['15.5', '0', '150']) {
    const { page, calls } = setup({ post: async () => ({ price: '71.43', expectedProfit: 20, markup: '21.43' }) });
    page.newProfitRule();
    page.input({ currentTarget: { dataset: { field: 'profitPercent' } }, detail: { value } });
    page.setData({ trialCost: '50', minimumProfit: '20' });
    await page.preview();
    assert.equal(calls[0].data.profitPercent, Number(value).toFixed(2));
    await page.save();
    assert.equal(calls[1].data.profitPercent, Number(value).toFixed(2));
    assert.match(page.ruleRows([{ minimumProfit: '20', profitPercent: value }])[0].firstCondition,
      new RegExp('成本的' + value.replace('.', '\\.') + '%'));
  }
});

test('比例为空负数超精度或超范围时拦住，旧利润规则未带比例时恢复10%', async () => {
  for (const value of ['', '-1', '15.001', '100000000', 'abc']) {
    const { page, calls } = setup();
    page.newProfitRule();
    page.setData({ profitPercent: value, trialCost: '50' });
    await page.preview();
    assert.match(page.data.error, /利润比例/);
    await page.save();
    assert.match(page.data.error, /利润比例/);
    assert.equal(calls.length, 0);
  }
  const { page } = setup();
  page.setData({ rules: [{ id: '42', name: '旧利润规则', minimumProfit: 20, segments: [] }] });
  page.edit({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.profitPercent, '10');
});
