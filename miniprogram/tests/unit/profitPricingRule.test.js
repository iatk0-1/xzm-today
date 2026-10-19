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
      if (name.endsWith('/managerFinance')) return { ...finance, confirmAction: async () => true };
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

function bandEvent(index, field, value) {
  return { currentTarget: { dataset: { index, field } }, detail: { value } };
}

function splitLastBand(page, value) {
  const index = page.data.segments.length - 1;
  page.editBoundary({ currentTarget: { dataset: { index, side: 'right' } } });
  page.boundaryInput({ currentTarget: { dataset: { boundary: index + ':right' } }, detail: { value } });
  return page.finishBoundaryEdit();
}

test('分段加价封顶单独新增，各段填写比例和上限，保存和试算使用同一份配置', async () => {
  const { page, calls } = setup({ post: async () => ({ price: '230', markup: '30' }) });
  page.newCappedMarkupRule();
  assert.equal(page.data.cappedMarkupRule, true);
  assert.equal(page.data.profitRule, false);
  assert.equal(page.data.segments[0].maximumMarkup, '30');
  page.bandInput(bandEvent(0, 'profitPercent', '20'));
  assert.equal(splitLastBand(page, '100'), true);
  assert.equal(page.data.segments[1].profitPercent, '20');
  assert.equal(page.data.segments[1].maximumMarkup, '30');
  page.bandInput(bandEvent(0, 'maximumMarkup', '10'));
  page.bandInput(bandEvent(1, 'profitPercent', '15.5'));
  page.setData({ trialCost: '200' });
  await page.preview();
  assert.deepEqual(calls[0].data, { cost: '200.00', markupBands: [
    { lower: 0, upper: 100, lowerInclusive: false, upperInclusive: true, maximumMarkup: '10.00', profitPercent: '20.00', minimumProfit: '10.00' },
    { lower: 100, upper: null, lowerInclusive: false, upperInclusive: false, maximumMarkup: '30.00', profitPercent: '15.50', minimumProfit: '10.00' }
  ] });
  assert.equal(page.data.trialProfit, '');
  assert.equal(page.data.trialMarkup, '30.00');
  assert.equal(page.data.trialPrice, '230');
  await page.save();
  assert.deepEqual(calls[1].data.markupBands, calls[0].data.markupBands);
  assert.equal(Object.hasOwn(calls[1].data, 'segments'), false);
  assert.equal(Object.hasOwn(calls[1].data, 'minimumProfit'), false);
});

test('封顶规则编辑复制保留各段配置，列表显示所有区间及取较小值', async () => {
  const { page, calls } = setup();
  const markupBands = [
    { lower: 0, upper: 100, lowerInclusive: false, upperInclusive: true, maximumMarkup: '10', profitPercent: '20' },
    { lower: 100, upper: null, lowerInclusive: false, upperInclusive: false, maximumMarkup: '30', profitPercent: '15' }
  ];
  const rule = { id: '44', name: '封顶规则', enabled: true, markupBands,
    segments: [{ lower: 0, upper: 50, formula: '(x+0.2*x)/0.98' }, { lower: 50, upper: null, formula: '(x+10)/0.98' }] };
  page.setData({ rules: page.ruleRows([rule]) });
  assert.match(page.data.rules[0].firstCondition, /分段加价封顶.*2/);
  assert.equal(page.data.rules[0].bandSummaries.length, 2);
  assert.match(page.data.rules[0].bandSummaries[1].description, /15%.*总加价.*30元.*较小值.*2%/);
  page.edit({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.cappedMarkupRule, true);
  assert.equal(page.data.segments[0].upper, 100);
  page.bandInput(bandEvent(1, 'maximumMarkup', '40'));
  await page.save();
  assert.equal(calls[0].method, 'put');
  assert.equal(calls[0].data.markupBands[1].maximumMarkup, '40.00');
  page.setData({ rules: [rule] });
  page.copy({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.id, '');
  assert.equal(page.data.cappedMarkupRule, true);
  assert.equal(page.data.segments[1].maximumMarkup, '30');
  page.bandInput(bandEvent(0, 'maximumMarkup', '11'));
  assert.equal(rule.markupBands[0].maximumMarkup, '10');
  page.newProfitRule();
  assert.equal(page.data.cappedMarkupRule, false);
  page.newCappedMarkupRule();
  page.newRule();
  assert.equal(page.data.cappedMarkupRule, false);
});

test('上一版利润封顶列表保留原含义，编辑或复制时提示并保存为加价封顶的新配置', async () => {
  const { page, calls } = setup();
  const legacy = { id: '45', name: '旧版封顶', enabled: true, profitBands: [
    { lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, maximumProfit: '30', profitPercent: '20' }
  ], segments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: '(x+30)/0.98' }] };
  page.setData({ rules: page.ruleRows([legacy]) });
  assert.match(page.data.rules[0].firstCondition, /旧版利润封顶/);
  assert.match(page.data.rules[0].bandSummaries[0].description, /预期利润.*30元/);
  page.edit({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.legacyProfitCap, true);
  assert.equal(page.data.cappedMarkupRule, true);
  assert.equal(page.data.segments[0].maximumMarkup, '30');
  await page.save();
  assert.equal(calls[0].data.markupBands[0].maximumMarkup, '30.00');
  assert.equal(Object.hasOwn(calls[0].data, 'profitBands'), false);
  page.setData({ rules: [legacy] });
  page.copy({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.id, '');
  assert.equal(page.data.legacyProfitCap, true);
  assert.equal(page.data.segments[0].maximumMarkup, '30');
  page.newCappedMarkupRule();
  assert.equal(page.data.legacyProfitCap, false);
});

test('封顶区间可修改边界归属与分界点，合并保留上一段利润设置', async () => {
  const { page } = setup();
  page.newCappedMarkupRule();
  splitLastBand(page, '100');
  page.bandInput(bandEvent(1, 'maximumMarkup', '80'));
  page.toggle({ currentTarget: { dataset: { index: 0, side: 'right' } } });
  assert.equal(page.data.segments[0].upperInclusive, false);
  assert.equal(page.data.segments[1].lowerInclusive, true);
  page.editBoundary({ currentTarget: { dataset: { index: 1, side: 'left' } } });
  page.boundaryInput({ currentTarget: { dataset: { boundary: '1:left' } }, detail: { value: '150.50' } });
  assert.equal(page.finishBoundaryEdit(), true);
  assert.equal(page.data.segments[0].upper, 150.5);
  assert.equal(page.data.segments[1].lower, 150.5);
  await page.merge({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.segments.length, 1);
  assert.equal(page.data.segments[0].upper, null);
  assert.equal(page.data.segments[0].maximumMarkup, '30');
});

test('逐段校验封顶金额与比例，允许0比例但不允许0上限，非法配置不发请求', async () => {
  for (const [field, values, message] of [
    ['minimumProfit', ['', '0', '-1', '1.001', '100000000'], /第2段最低预期利润/],
    ['maximumMarkup', ['', '0', '-1', '1.001', '100000000'], /第2段最高预期加价/],
    ['profitPercent', ['', '-1', '1.001', '100000000'], /第2段利润比例/]
  ]) {
    for (const value of values) {
      const { page, calls } = setup();
      page.newCappedMarkupRule();
      splitLastBand(page, '100');
      page.bandInput(bandEvent(1, field, value));
      page.setData({ trialCost: '200' });
      await page.preview();
      assert.match(page.data.error, message);
      await page.save();
      assert.match(page.data.error, message);
      assert.equal(calls.length, 0);
    }
  }
  const { page } = setup();
  page.newCappedMarkupRule();
  page.bandInput(bandEvent(0, 'profitPercent', '0'));
  page.bandInput(bandEvent(0, 'maximumMarkup', '0.01'));
  assert.equal(page.pricingSettings().markupBands[0].profitPercent, '0.00');
  for (let index = 1; index < 50; index++) assert.equal(splitLastBand(page, String(index)), true);
  assert.equal(splitLastBand(page, '50'), false);
  assert.match(page.data.boundaryError, /最多50/);
});

test('改变封顶设置边界和归属时，旧试算响应不能再显示', async () => {
  for (const change of ['maximumMarkup', 'profitPercent', 'minimumProfit', 'boundary', 'toggle']) {
    let resolve;
    const { page } = setup({ post: () => new Promise(done => { resolve = done; }) });
    page.newCappedMarkupRule();
    splitLastBand(page, '100');
    page.setData({ trialCost: '200' });
    const pending = page.preview();
    if (change === 'boundary') splitLastBand(page, '300');
    else if (change === 'toggle') page.toggle({ currentTarget: { dataset: { index: 0, side: 'right' } } });
    else page.bandInput(bandEvent(0, change, '40'));
    resolve({ price: '224.49', expectedProfit: '20', markup: '24.49' });
    await pending;
    assert.equal(page.data.trialPrice, '');
    assert.equal(page.data.trialProfit, '');
  }
});

test('分段最低利润默认10元可单独改，分段复制与合并保留对应数值，上限低于保底不拦截', async () => {
  const { page, calls }=setup({ post:async()=>({price:'214.29',markup:'14.29'}) });
  page.newCappedMarkupRule();
  assert.equal(page.data.segments[0].minimumProfit,'10');
  page.bandInput(bandEvent(0,'minimumProfit','20'));
  splitLastBand(page,'100');
  assert.equal(page.data.segments[1].minimumProfit,'20');
  page.bandInput(bandEvent(1,'minimumProfit','10'));
  page.bandInput(bandEvent(1,'maximumMarkup','5'));
  page.setData({trialCost:'200'});
  await page.preview();
  assert.equal(page.data.trialPrice,'214.29');
  assert.equal(calls[0].data.markupBands[0].minimumProfit,'20.00');
  assert.equal(calls[0].data.markupBands[1].minimumProfit,'10.00');
  await page.merge({currentTarget:{dataset:{index:1}}});
  assert.equal(page.data.segments[0].minimumProfit,'20');
});

test('旧加价规则编辑默认补10元，已有最低利润编辑复制保存均保留，各版本列表如实展示', async()=>{
  const {page,calls}=setup();
  const old={id:'52',name:'旧加价规则',enabled:true,markupBands:[
    {lower:0,upper:null,lowerInclusive:false,upperInclusive:false,maximumMarkup:'30',profitPercent:'10'}]};
  page.setData({rules:page.ruleRows([old])});
  assert.match(page.data.rules[0].bandSummaries[0].description,/未设最低利润/);
  page.edit({currentTarget:{dataset:{index:0}}});
  assert.equal(page.data.segments[0].minimumProfit,'10');
  page.bandInput(bandEvent(0,'minimumProfit','20.55'));
  await page.save();
  assert.equal(calls[0].data.markupBands[0].minimumProfit,'20.55');
  old.markupBands[0].minimumProfit='20.55';
  page.setData({rules:page.ruleRows([old])});
  assert.match(page.data.rules[0].bandSummaries[0].description,/最低利润20.55元优先/);
  page.copy({currentTarget:{dataset:{index:0}}});
  assert.equal(page.data.segments[0].minimumProfit,'20.55');
  assert.equal(page.data.id,'');
});
