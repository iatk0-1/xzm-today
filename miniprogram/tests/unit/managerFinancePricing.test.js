const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const finance = require('../../utils/managerFinance');

function pageHarness(file, { get, post, put, del, upload, manager = false } = {}) {
  let definition;
  const calls = [];
  const api = {
    get: async (url, data) => { calls.push({ method: 'get', url, data }); return get ? get(url, data) : {}; },
    post: async (url, data) => { calls.push({ method: 'post', url, data }); return post ? post(url, data) : {}; },
    put: async (url, data) => { calls.push({ method: 'put', url, data }); return put ? put(url, data) : {}; },
    delete: async url => { calls.push({ method: 'delete', url }); return del ? del(url) : {}; },
    uploadFile: async (url, file, data) => { calls.push({ method: 'upload', url, file, data }); return upload ? upload(url, file, data) : { url: 'https://example.com/voucher.jpg' }; },
    request: async options => { calls.push({ method: options.method.toLowerCase(), url: options.url, data: options.data, idempotencyKey: options.idempotencyKey }); return post ? post(options.url, options.data) : {}; }
  };
  const storage = new Map();
  const wx = {
    showToast() {}, showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
    showModal(options) { options.success({ confirm: true }); },
    getStorageSync(key) { return storage.get(key); }, setStorageSync(key, value) { storage.set(key, value); }, removeStorageSync(key) { storage.delete(key); }, disableAlertBeforeUnload() {}, enableAlertBeforeUnload() {}
  };
  const auth = {
    ensureAuthenticated: async () => {}, isAdmin: () => !manager, isStallManager: () => manager,
    getUserInfo: () => ({ userId: '42' })
  };
  const cache = new Map();
  const runModule = filename => {
    const target = path.resolve(__dirname, filename);
    if (cache.has(target)) return cache.get(target);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(target, 'utf8'), {
      module, exports: module.exports, Page(value) { definition = value; },
      wx, console, setTimeout: () => 0, clearTimeout() {},
      require(name) {
        if (name.endsWith('/api') || name === './api') return api;
        if (name.endsWith('/auth') || name === './auth') return auth;
        if (name.endsWith('/managerFinance') || name === './managerFinance') {
          return runModule('../../utils/managerFinance.js');
        }
        if (name.endsWith('/productPricing')) return runModule('../../utils/productPricing.js');
        if (name.endsWith('/stock')) return { UNLIMITED_THRESHOLD: 999999999 };
        if (name.endsWith('/config')) return {};
        if (name.endsWith('/draft')) return { loadDraft: async () => null, removeDraft: async () => {} };
        return {};
      }
    }, { filename: target });
    cache.set(target, module.exports);
    return module.exports;
  };
  runModule(file);
  const page = {
    ...definition, data: structuredClone(definition.data),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { if (!target[part]) target[part] = {}; target = target[part]; });
        target[parts[parts.length - 1]] = value;
      }
      if (callback) callback();
    }
  };
  page._authorized = true;
  return { page, calls, wx, auth, storage };
}

test('金额零值仅佣金允许，成本和提现严格大于零且精确到分', () => {
  assert.equal(finance.money('0', true), '0.00');
  assert.equal(finance.money('12.3'), '12.30');
  for (const input of ['0', '-1', '0.001', '1e3', 'NaN', '99999999999']) {
    assert.throws(() => finance.money(input));
  }
});

test('边界点击互补且变更分界点同步相邻区间', () => {
  const segments = [
    { lower: 0, upper: 100, lowerInclusive: false, upperInclusive: true, formula: 'x' },
    { lower: 100, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x' }
  ];
  const changed = finance.toggleBoundary(segments, 0);
  assert.equal(changed[0].upperInclusive, false);
  assert.equal(changed[1].lowerInclusive, true);
  assert.equal(finance.toggleBoundary(changed, 0)[0].upperInclusive, true);
  const moved = finance.changeBoundary(segments, 0, '50.50');
  assert.equal(moved[0].upper, 50.5);
  assert.equal(moved[1].lower, 50.5);
  assert.throws(() => finance.changeBoundary(segments, 0, '0'));
});

test('分账状态独立于历史转账，未知或处理中不能视为到账', () => {
  assert.equal(finance.profitSharingRow({ status: 'PROCESSING' }).terminal, false);
  assert.equal(finance.profitSharingRow({ status: 'NEW_STATE' }).terminal, false);
  assert.equal(finance.profitSharingRow({ status: 'SUCCESS' }).terminal, true);
  assert.equal(finance.profitSharingRow({ status: 'CLOSED' }).terminal, true);
  assert.match(finance.profitSharingStatus('NEW_STATE'), /待查询/);
  assert.equal(typeof finance.confirmTransfer, 'undefined');
});

function pricingEvent(index, side, value) {
  return {
    currentTarget: { dataset: { index, side, boundary: index + ':' + side } },
    detail: { value }
  };
}

test('档口可追加多条规则、解除一条保留其他规则，禁用规则也可解除', async () => {
  const first = { id: '31', name: '规则一', enabled: true, segments: [] };
  const second = { id: '32', name: '规则二', enabled: false, segments: [] };
  const third = { id: '33', name: '规则三', enabled: true, segments: [] };
  const { page, calls } = pageHarness('../../pages/pricingRules/pricingRules.js', {
    get: async url => url === '/pricing-rules' ? [first, second, third] : [first, second],
    put: async () => third
  });
  page.setData({ stallId: '2' });
  await page.load();
  assert.deepEqual(Array.from(page.data.currentRuleIds), ['31', '32']);
  assert.equal(page.data.rules[0].assigned, true);
  await page.assign({ currentTarget: { dataset: { id: '33' } } });
  assert.deepEqual(Array.from(page.data.currentRuleIds), ['31', '32', '33']);
  await page.assign({ currentTarget: { dataset: { id: '32' } } });
  assert.deepEqual(Array.from(page.data.currentRuleIds), ['31', '33']);
  assert.equal(calls.find(call => call.method === 'delete').url, '/stalls/2/pricing-rules/32');
  assert.equal(page.data.rules[1].assigned, false);
  await page.assign({ currentTarget: { dataset: { id: '' } } });
  assert.equal(page.data.currentRules.length, 0);
  assert.equal(calls.at(-1).data.ruleId, null);
});

test('负责人新增商品遇到多规则档口必须明确选择，选择后按对应规则重算售价', async () => {
  const rules = [
    { id: '31', name: '规则一', enabled: true, currentVersion: 1, segments: [{ lower: 0, upper: null, formula: 'x+5' }] },
    { id: '32', name: '规则二', enabled: true, currentVersion: 1, segments: [{ lower: 0, upper: null, formula: 'x+8' }] },
    { id: '33', name: '已禁用', enabled: false, segments: [] }
  ];
  const { page, calls } = pageHarness('../../pages/admin/admin.js', { manager: true,
    get: async () => rules,
    post: async (_, body) => ({ price: Number(body.cost) + (body.segments[0].formula === 'x+8' ? 8 : 5) })
  });
  page.setData({ isStallManager: true, selectedStalls: [{ id: '2', name: '档口' }], skuList: [{ costPrice: '10', price: '' }] });
  await page.useStallPricing();
  assert.equal(page.data.pricingRuleId, '');
  assert.match(page.data.pricingError, /请选择其中一个/);
  assert.deepEqual(Array.from(page.data.pricingRules, rule => rule.id), ['31', '32']);
  await page.choosePricingRule({ detail: { value: 1 } });
  assert.equal(page.data.pricingRuleId, '32');
  assert.equal(page.data.skuList[0].price, '18');
  assert.equal(calls[0].url, '/stalls/2/pricing-rules');
  await page.choosePricingRule({ detail: { value: 0 } });
  assert.equal(page.data.skuList[0].price, '15');
});

test('已分配的历史禁用规则仍保留旧商品版本，多条规则不替换旧商品选中规则', async () => {
  const historical = [{ lower: 0, upper: null, formula: 'x+5' }];
  const assigned = [
    { id: '31', name: '旧规则', enabled: false, currentVersion: 2, segments: [{ lower: 0, upper: null, formula: 'x+9' }] },
    { id: '32', name: '新规则', enabled: true, currentVersion: 1, segments: historical }
  ];
  const { page } = pageHarness('../../pages/admin/admin.js', { manager: true,
    get: async url => url.startsWith('/stalls/') ? assigned : {
      product: { stallIds: ['2'] }, pricingRuleId: '31', pricingRuleVersion: 1, pricingRuleSegments: historical
    }
  });
  page.setData({ editId: '10', isStallManager: true, selectedStalls: [{ id: '2' }], pricingRuleId: '31' });
  await page.useStallPricing();
  assert.equal(page.data.pricingRuleId, '31');
  assert.equal(page.data.pricingRuleVersion, 1);
  assert.equal(page.data.pricingRuleSegments[0].formula, 'x+5');
});

function enterPricingBoundary(page, index, side, value) {
  page.editBoundary(pricingEvent(index, side));
  page.boundaryInput(pricingEvent(index, side, value));
  page.updateBoundary(pricingEvent(index, side));
}

test('计价公式点击后才打开计算器，关闭保留公式且再次打开可编辑另一段', () => {
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.newRule();
  assert.equal(page.data.calculatorOpen, false);
  enterPricingBoundary(page, 0, 'right', '100');
  page.openCalculator(pricingEvent(1));
  assert.equal(page.data.calculatorOpen, true);
  assert.equal(page.data.activeIndex, 1);
  for (const key of ['×', '2', '+', '1', '÷', '2']) {
    page.key({ currentTarget: { dataset: { key } } });
  }
  assert.equal(page.data.segments[1].formula, 'x*2+1/2');
  assert.equal(page.data.segments[0].formula, 'x');
  page.backspace();
  assert.equal(page.data.segments[1].formula, 'x*2+1/');
  page.closeCalculator();
  assert.equal(page.data.calculatorOpen, false);
  assert.equal(page.data.segments[1].formula, 'x*2+1/');
  page.openCalculator(pricingEvent(0));
  page.clear();
  assert.equal(page.data.segments[0].formula, '');
  assert.equal(page.data.segments[1].formula, 'x*2+1/');
});

test('无上限改为数字自动接上下一段并复制公式，确认后的失焦不会重复新增', () => {
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.newRule();
  page.openCalculator(pricingEvent(0));
  page.key({ currentTarget: { dataset: { key: '+' } } });
  page.key({ currentTarget: { dataset: { key: '5' } } });
  page.closeCalculator();
  page.data.trialPrice = '旧试算';
  page.editBoundary(pricingEvent(0, 'right'));
  page.boundaryInput(pricingEvent(0, 'right', '100.50'));
  assert.equal(page.data.segments.length, 1);
  page.updateBoundary(pricingEvent(0, 'right'));
  page.updateBoundary(pricingEvent(0, 'right'));
  assert.equal(page.data.segments.length, 2);
  assert.equal(page.data.segments[0].upper, 100.5);
  assert.equal(page.data.segments[0].upperInclusive, true);
  assert.equal(page.data.segments[1].lower, 100.5);
  assert.equal(page.data.segments[1].lowerInclusive, false);
  assert.equal(page.data.segments[1].upper, null);
  assert.equal(page.data.segments[1].formula, 'x+5');
  assert.equal(page.data.editingBoundary, '');
  assert.equal(page.data.trialPrice, '');
  assert.equal(page.data.calculatorOpen, false);
  enterPricingBoundary(page, 1, 'right', '200');
  assert.equal(page.data.segments.length, 3);
  assert.equal(page.data.segments[2].lower, 200);
  assert.equal(page.data.segments[2].upper, null);
  assert.equal(page.data.segments[2].formula, 'x+5');
});

test('价格公式可在中间插入，退格仅删除光标前的字符，连续编辑不跳到末尾', () => {
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.newRule();
  page.data.segments[0].formula = '(x+15)/0.98';
  page.openCalculator(pricingEvent(0));
  page.selectFormulaCursor({ currentTarget: { dataset: { cursor: 4 } }, detail: {} });
  page.backspace();
  assert.equal(page.data.segments[0].formula, '(x+5)/0.98');
  assert.equal(page.data.formulaCursor, 3);
  page.key({ currentTarget: { dataset: { key: '8' } } });
  assert.equal(page.data.segments[0].formula, '(x+85)/0.98');
  assert.equal(page.data.formulaCursor, 4);
  page.key({ currentTarget: { dataset: { key: '0' } } });
  assert.equal(page.data.segments[0].formula, '(x+805)/0.98');
  assert.equal(page.data.formulaCursor, 5);
  assert.equal(page.data.formulaCells.map(item => item.character).join(''), '(x+805)/0.98');
});

test('公式光标支持开头末尾和左右微调，开头退格不删末尾，清空后可继续输入', () => {
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.newRule();
  page.data.segments[0].formula = 'x+5';
  page.openCalculator(pricingEvent(0));
  page.moveFormulaCursor({ currentTarget: { dataset: { position: 'start' } } });
  page.backspace();
  assert.equal(page.data.segments[0].formula, 'x+5');
  assert.equal(page.data.formulaCursor, 0);
  page.moveFormulaCursor({ currentTarget: { dataset: { offset: -1 } } });
  assert.equal(page.data.formulaCursor, 0);
  page.key({ currentTarget: { dataset: { key: '(' } } });
  assert.equal(page.data.segments[0].formula, '(x+5');
  page.moveFormulaCursor({ currentTarget: { dataset: { offset: 1 } } });
  assert.equal(page.data.formulaCursor, 2);
  page.moveFormulaCursor({ currentTarget: { dataset: { offset: -1 } } });
  assert.equal(page.data.formulaCursor, 1);
  page.moveFormulaCursor({ currentTarget: { dataset: { position: 'end' } } });
  page.moveFormulaCursor({ currentTarget: { dataset: { offset: 1 } } });
  assert.equal(page.data.formulaCursor, 4);
  page.key({ currentTarget: { dataset: { key: ')' } } });
  assert.equal(page.data.segments[0].formula, '(x+5)');
  page.clear();
  assert.equal(page.data.formulaCursor, 0);
  assert.equal(page.data.formulaCells.length, 0);
  page.key({ currentTarget: { dataset: { key: 'x' } } });
  assert.equal(page.data.segments[0].formula, 'x');
  assert.equal(page.data.formulaCursor, 1);
});

test('点击公式字符左右半边定位到字符前后，过期测量结果不会覆盖后续光标', () => {
  const { page, wx } = pageHarness('../../pages/pricingRules/pricingRules.js');
  const measurements = [];
  wx.createSelectorQuery = () => {
    const query = {
      select(selector) { this.selector = selector; return this; },
      boundingClientRect(callback) { measurements.push({ selector: this.selector, callback }); return this; },
      exec() {}
    };
    return query;
  };
  const tap = x => page.selectFormulaCursor({
    currentTarget: { dataset: { cursor: 1 } }, detail: { x }
  });
  page.newRule();
  page.data.segments[0].formula = 'x+5';
  page.openCalculator(pricingEvent(0));
  tap(102);
  assert.equal(measurements[0].selector, '#formula-char-1');
  measurements[0].callback({ left: 100, width: 10 });
  assert.equal(page.data.formulaCursor, 1);
  tap(108);
  measurements[1].callback({ left: 100, width: 10 });
  assert.equal(page.data.formulaCursor, 2);
  tap(102);
  page.formulaEnd();
  measurements[2].callback({ left: 100, width: 10 });
  assert.equal(page.data.formulaCursor, 3);
  tap(102);
  page.key({ currentTarget: { dataset: { key: '0' } } });
  measurements[3].callback({ left: 100, width: 10 });
  assert.equal(page.data.segments[0].formula, 'x+50');
  assert.equal(page.data.formulaCursor, 4);
  tap(102);
  page.closeCalculator();
  measurements[4].callback({ left: 100, width: 10 });
  assert.equal(page.data.formulaCursor, 4);
});

test('换段打开公式重置光标和显示内容，超出长度限制时保留原公式及光标', () => {
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.newRule();
  enterPricingBoundary(page, 0, 'right', '100');
  page.data.segments[0].formula = 'x+5';
  page.data.segments[1].formula = 'x*2';
  page.openCalculator(pricingEvent(0));
  page.setFormulaCursor(1);
  page.closeCalculator();
  page.openCalculator(pricingEvent(1));
  assert.equal(page.data.formulaCursor, 3);
  assert.equal(page.data.formulaCells.map(item => item.character).join(''), 'x*2');
  page.data.segments[1].formula = 'x'.repeat(512);
  page.openCalculator(pricingEvent(1));
  page.setFormulaCursor(10);
  page.key({ currentTarget: { dataset: { key: '+' } } });
  assert.equal(page.data.segments[1].formula.length, 512);
  assert.equal(page.data.formulaCursor, 10);
  assert.match(page.data.error, /512/);
  page.backspace();
  assert.equal(page.data.segments[1].formula.length, 511);
  assert.equal(page.data.formulaCursor, 9);
  assert.equal(page.data.segments[0].formula, 'x+5');
});

test('从左右两侧原地修改同一边界同步相邻区间，符号点击只变包含关系', () => {
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.newRule();
  enterPricingBoundary(page, 0, 'right', '100');
  enterPricingBoundary(page, 1, 'right', '200');
  enterPricingBoundary(page, 0, 'right', '80.25');
  assert.equal(page.data.segments[0].upper, 80.25);
  assert.equal(page.data.segments[1].lower, 80.25);
  enterPricingBoundary(page, 1, 'left', '90.50');
  assert.equal(page.data.segments[0].upper, 90.5);
  assert.equal(page.data.segments[1].lower, 90.5);
  assert.equal(page.data.segments[1].upper, 200);
  assert.equal(page.data.segments.length, 3);
  page.toggle(pricingEvent(0, 'right'));
  assert.equal(page.data.segments[0].upperInclusive, false);
  assert.equal(page.data.segments[1].lowerInclusive, true);
  page.toggle(pricingEvent(1, 'left'));
  assert.equal(page.data.segments[0].upperInclusive, true);
  assert.equal(page.data.segments[1].lowerInclusive, false);
  assert.equal(page.data.segments[0].upper, 90.5);
  assert.equal(page.data.segments[1].lower, 90.5);
  assert.equal(page.data.segments[0].lowerInclusive, false);
});

test('无上限未输入数字保持原样，非法边界保留原区间并阻止保存及试算', async () => {
  const { page, calls } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.newRule();
  enterPricingBoundary(page, 0, 'right', '');
  assert.equal(page.data.segments.length, 1);
  assert.equal(page.data.segments[0].upper, null);
  assert.equal(page.data.boundaryError, '');
  enterPricingBoundary(page, 0, 'right', '100');
  page.data.name = '边界校验';
  page.data.trialCost = '20';
  for (const value of ['0', '99', '100', '-1', 'abc', '100.001']) {
    enterPricingBoundary(page, 1, 'right', value);
    assert.equal(page.data.segments.length, 2);
    assert.equal(page.data.segments[1].upper, null);
    assert.ok(page.data.boundaryError);
    await page.preview();
    await page.save();
  }
  assert.equal(calls.length, 0);
  enterPricingBoundary(page, 1, 'right', '200');
  assert.equal(page.data.boundaryError, '');
  for (const value of ['0', '200', '201', '']) {
    enterPricingBoundary(page, 0, 'right', value);
    assert.equal(page.data.segments[0].upper, 100);
    assert.equal(page.data.segments[1].lower, 100);
    assert.equal(page.data.segments.length, 3);
    assert.ok(page.data.boundaryError);
  }
});

test('自动新增区间遵守100段上限，达到上限仍能修改已有边界', () => {
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.newRule();
  for (let index = 0; index < 99; index++) {
    enterPricingBoundary(page, index, 'right', String((index + 1) * 10));
  }
  enterPricingBoundary(page, 99, 'right', '1000');
  assert.equal(page.data.segments.length, 100);
  assert.equal(page.data.segments[99].upper, null);
  assert.match(page.data.boundaryError, /最多100/);
  page.boundaryInput(pricingEvent(99, 'right', ''));
  page.updateBoundary(pricingEvent(99, 'right'));
  enterPricingBoundary(page, 98, 'right', '995');
  assert.equal(page.data.segments[98].upper, 995);
  assert.equal(page.data.segments[99].lower, 995);
});

test('保存和试算先应用正在编辑的边界，请求只包含原有区间字段', async () => {
  for (const method of ['save', 'preview']) {
    const { page, calls } = pageHarness('../../pages/pricingRules/pricingRules.js', {
      get: async () => [], post: async () => ({ price: '15.00' })
    });
    page.newRule();
    page.data.name = '原地编辑规则';
    page.data.trialCost = '10';
    page.editBoundary(pricingEvent(0, 'right'));
    page.boundaryInput(pricingEvent(0, 'right', '100'));
    await page[method]();
    const request = calls.find(call => call.method === 'post');
    assert.equal(request.url, method === 'save' ? '/pricing-rules' : '/pricing-rules/preview');
    assert.equal(request.data.segments.length, 2);
    assert.equal(request.data.segments[0].upper, 100);
    assert.equal(request.data.segments[1].lower, 100);
    assert.deepEqual(Object.keys(request.data.segments[0]).sort(),
      ['formula', 'lower', 'lowerInclusive', 'upper', 'upperInclusive']);
  }
});

test('列表编辑进入原规则，复制进入新建并完整复制规则数据', () => {
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js');
  const rule = {
    id: '77', name: '基础规则', enabled: false, currentVersion: 3,
    segments: [
      { lower: 0, upper: 100, lowerInclusive: false, upperInclusive: true, formula: '(x+15)/0.98' },
      { lower: 100, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+25' }
    ]
  };
  page.setData({ rules: [rule] });
  page.edit({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.id, '77');
  assert.equal(page.data.name, '基础规则');
  assert.equal(page.data.enabled, false);
  assert.equal(page.data.segments[0].formula, '(x+15)/0.98');
  page.copy({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.id, '');
  assert.equal(page.data.name, '基础规则');
  assert.equal(page.data.enabled, false);
  assert.equal(page.data.segments.length, 2);
  assert.equal(page.data.segments[1].upper, null);
  assert.equal(page.data.segments[1].formula, 'x+25');
  assert.equal(page.data.segments[0].label, '0 < x ≤ 100');
  assert.notEqual(page.data.segments, rule.segments);
  assert.notEqual(page.data.segments[0], rule.segments[0]);
});

test('新增或复制保存时不允许重名，编辑原规则保留原名，重名时不发请求', async () => {
  const { page, calls } = pageHarness('../../pages/pricingRules/pricingRules.js', {
    get: async () => [], post: async () => ({})
  });
  page.setData({
    rules: [{ id: '1', name: '基础规则', enabled: true, segments: [] }],
    name: '基础规则', segments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x' }],
    editing: true, id: '',
  });
  await page.save();
  assert.equal(calls.length, 0);
  assert.equal(page.data.error, '规则名称已存在，请换个名称后再保存');
  page.setData({ id: '1', error: '' });
  await page.save();
  assert.equal(calls.filter(call => call.method === 'put').length, 1);
  page.setData({ id: '', name: ' 新规则 ' });
  await page.save();
  assert.equal(calls.filter(call => call.method === 'post').length, 1);
  assert.equal(calls.find(call => call.method === 'post').data.name, '新规则');
});

test('保存先应用正在编辑的边界再检查重名，重名时不丢失用户边界输入', async () => {
  const { page, calls } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.setData({
    rules: [{ id: '1', name: '基础规则', enabled: true, segments: [] }],
    name: '基础规则', editing: true, id: '',
    segments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x' }]
  });
  page.editBoundary({ currentTarget: { dataset: { index: 0, side: 'right', boundary: '0:right' } } });
  page.boundaryInput({ currentTarget: { dataset: { boundary: '0:right' } }, detail: { value: '100' } });
  await page.save();
  assert.equal(page.data.segments.length, 2);
  assert.equal(page.data.segments[0].upper, 100);
  assert.equal(page.data.error, '规则名称已存在，请换个名称后再保存');
  assert.equal(calls.length, 0);
});

test('档口名称跳转解码一次，中文、特殊字符和非法编码都能打开页面', async () => {
  const name = '花棉袄 & 100% + 档口';
  for (const [input, expected] of [[encodeURIComponent(name), name], ['中文档口', '中文档口'],
    ['100%档口', '100%档口'], ['%E6%E5', '%E6%E5'], [encodeURIComponent('%E6'), '%E6']]) {
    const { page } = pageHarness('../../pages/pricingRules/pricingRules.js', {
      get: async url => url === '/pricing-rules' ? [] : { id: '21', name: '加价规则', enabled: false, segments: [] }
    });
    await page.onLoad({ stallId: '11', stallName: input });
    assert.equal(page.data.stallName, expected);
    assert.equal(page.data.currentRule.name, '加价规则');
    assert.equal(page.data.currentRule.enabled, false);
    assert.equal(page.data.assignmentLoaded, true);
    assert.equal(page.data.error, '');
  }
});

test('分配和解除立即更新当前规则，重复点击拦住，失败保留原分配', async () => {
  const rule = { id: '21', name: '加价规则', enabled: true, segments: [] };
  let resolve, reject;
  const { page, calls } = pageHarness('../../pages/pricingRules/pricingRules.js', {
    put: () => new Promise((done, fail) => { resolve = done; reject = fail; })
  });
  page.setData({ stallId: '11' });
  const event = { currentTarget: { dataset: { id: '21' } } };
  const assigning = page.assign(event);
  await page.assign(event);
  assert.equal(calls.length, 1);
  resolve(rule);
  await assigning;
  assert.equal(page.data.currentRule.name, '加价规则');
  const failed = page.assign({ currentTarget: { dataset: {} } });
  reject(new Error('解除失败'));
  await failed;
  assert.equal(page.data.currentRule.id, '21');
  assert.equal(page.data.error, '解除失败');
  const clearing = page.assign({ currentTarget: { dataset: {} } });
  resolve(null);
  await clearing;
  assert.equal(calls.at(-1).data.ruleId, null);
  assert.equal(page.data.currentRule, null);
  assert.equal(page.data.assigning, false);
  assert.equal(page.data.error, '');
});

test('当前分配规则被禁用或删除后保留名称并更新状态', async () => {
  const rule = { id: '21', name: '加价规则', enabled: true, segments: [] };
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js', {
    put: async () => ({ ...rule, enabled: false })
  });
  page.setData({ rules: [rule], currentRule: rule });
  await page.changeRuleStatus({ currentTarget: { dataset: { index: 0 } }, detail: { value: false } });
  assert.equal(page.data.currentRule.enabled, false);
  await page.deleteRule({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.currentRule.name, '加价规则');
  assert.equal(page.data.currentRule.deleted, true);
});

test('规则列表只显示未删除规则和第一段公式，无上限有明确标识', async () => {
  const { page } = pageHarness('../../pages/pricingRules/pricingRules.js', { get: async () => [
    { id: '1', enabled: true, segments: [
      { lower: 0, upper: 100, lowerInclusive: false, upperInclusive: true, formula: 'x+5' },
      { lower: 100, upper: null, lowerInclusive: false, formula: 'x+10' }
    ] },
    { id: '2', enabled: false, segments: [{ lower: 0, upper: null, lowerInclusive: false, formula: 'x' }] },
    { id: '3', deleted: true, segments: [] }
  ] });
  await page.load();
  assert.equal(page.data.rules.length, 2);
  assert.equal(page.data.rules[0].firstCondition, '0 < x ≤ 100');
  assert.equal(page.data.rules[0].firstFormula, 'x+5');
  assert.equal(page.data.rules[1].firstCondition, '0 < x 无上限');
});

test('列表状态开关调用专用接口，失败恢复开关，重复点击只请求一次', async () => {
  let reject;
  const { page, calls } = pageHarness('../../pages/pricingRules/pricingRules.js', {
    put: () => new Promise((_, fail) => { reject = fail; })
  });
  page.setData({ rules: [{ id: '1', enabled: true, currentVersion: 2, segments: [] }] });
  const event = { currentTarget: { dataset: { index: 0 } }, detail: { value: false } };
  const pending = page.changeRuleStatus(event);
  assert.equal(page.data.rules[0].enabled, false);
  await page.changeRuleStatus(event);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/pricing-rules/1/enabled');
  assert.equal(calls[0].data.enabled, false);
  reject(new Error('状态更新失败'));
  await pending;
  assert.equal(page.data.rules[0].enabled, true);
  assert.equal(page.data.rules[0].currentVersion, 2);
  assert.equal(page.data.ruleBusy, '');
  assert.equal(page.data.error, '状态更新失败');
});

test('规则逻辑删除确认后调用接口并移出列表，取消或失败保留规则', async () => {
  const { page, wx, calls } = pageHarness('../../pages/pricingRules/pricingRules.js');
  page.setData({ rules: [{ id: '1', name: '基础规则' }, { id: '2', name: '另一规则' }] });
  const event = { currentTarget: { dataset: { index: 0 } } };
  wx.showModal = options => options.success({ confirm: false });
  await page.deleteRule(event);
  assert.equal(calls.length, 0);
  assert.equal(page.data.rules.length, 2);
  wx.showModal = options => options.success({ confirm: true });
  await page.deleteRule(event);
  assert.equal(calls[0].method, 'delete');
  assert.equal(calls[0].url, '/pricing-rules/1');
  assert.equal(page.data.rules.length, 1);
  assert.equal(page.data.rules[0].id, '2');
  assert.equal(page.data.ruleBusy, '');
  const failed = pageHarness('../../pages/pricingRules/pricingRules.js', { del: async () => { throw new Error('删除失败'); } });
  failed.page.setData({ rules: [{ id: '1', name: '基础规则' }] });
  await failed.page.deleteRule(event);
  assert.equal(failed.page.data.rules.length, 1);
  assert.equal(failed.page.data.error, '删除失败');
});

test('已有商品可以保留禁用或删除规则的原版本，复制或换档口不能复用', async () => {
  for (const deleted of [false, true]) {
    const historical = [{ lower: 0, upper: null, lowerInclusive: false, formula: 'x+5' }];
    const rule = { id: '30', enabled: false, deleted, currentVersion: 2, segments: [{ formula: 'x+50' }] };
    const { page } = pageHarness('../../pages/admin/admin.js', { get: async () => ({
      product: { stallIds: ['2'] }, pricingRuleId: '30', pricingRuleVersion: 1, pricingRuleSegments: historical
    }) });
    page.setData({ editId: '10', selectedStalls: [{ id: '2' }] });
    assert.equal(await page.useExistingPricing(rule), true);
    assert.equal(page.data.pricingRuleVersion, 1);
    assert.equal(page.data.pricingRuleSegments[0].formula, 'x+5');
    page.setData({ selectedStalls: [{ id: '3' }] });
    assert.equal(await page.useExistingPricing(rule), false);
    page.setData({ editId: null, selectedStalls: [{ id: '2' }] });
    assert.equal(await page.useExistingPricing(rule), false);
  }
});

test('禁用或删除规则不进入新增商品选项，新增提交前拦住失效规则', async () => {
  for (const deleted of [false, true]) {
    const unavailable = { id: '30', enabled: !deleted ? false : true, deleted, segments: [{ formula: 'x' }] };
    const { page, calls } = pageHarness('../../pages/admin/admin.js', { manager: true, get: async url =>
      url === '/pricing-rules' ? [unavailable, { id: '40', enabled: true, segments: [] }] : unavailable
    });
    await page.loadPricingChoices();
    assert.equal(page.data.pricingRules.length, 1);
    assert.equal(page.data.pricingRules[0].id, '40');
    page.setData({ selectedStalls: [{ id: '2' }], pricingRuleId: '30' });
    await page.submitProduct();
    assert.match(page.data.pricingError, /不能用于新增/);
    assert.equal(calls.filter(call => call.method !== 'get').length, 0);
  }
});

test('负责人列表第一页为1，只有后续页追加', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagers/stallManagers.js', {
    get: async (_, params) => ({ content: [{ userId: String(params.page) }], totalPages: 2 })
  });
  await page.load(true);
  await page.load(false);
  assert.deepEqual(calls.map(call => call.data.page), [1, 2]);
  assert.equal(page.data.managers.length, 2);
  assert.equal(page.data.hasNext, false);
});

test('批量佣金全筛选收集所有页并保持雪花ID字符串', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', {
    get: async (url, params) => url.endsWith('commission-products')
      ? { content: [{ productId: params.page === 1 ? '9007199254740993' : '9007199254740995' }], totalPages: 2, totalElements: 2 } : {},
    put: async () => {}
  });
  page.setData({ userId: '42', tab: 'products', unitCommission: '3.00' });
  page.refresh = async () => {};
  await page.selectFiltered();
  assert.deepEqual(Array.from(page.data.selectedProducts), ['9007199254740993', '9007199254740995']);
  await page.setCommission();
  const call = calls.find(item => item.method === 'put');
  assert.equal(call.data.unitCommission, '3.00');
  assert.deepEqual(Array.from(call.data.productIds), ['9007199254740993', '9007199254740995']);
});

test('历史缺创建人不能核对；任职时间区间包含下单；套装传明确套数与完整ID', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  page.setData({
    userId: '42',
    historyForm: {
      orderItemId: '101', createdAt: '2026-09-01T09:00:00+08:00',
      eligible: true, reason: '历史凭证', unitCommission: '3', creatorConfirmed: false,
      assignmentStartedAt: '2026-08-01T00:00:00+08:00', assignmentEndedAt: '',
      activeStartedAt: '2026-08-01T00:00:00+08:00', activeEndedAt: '',
      isBundle: true, bundleProductName: null, saleUnits: '2', memberIds: '101,102'
    }
  });
  page.refresh = async () => {};
  await page.confirmHistory();
  assert.equal(calls.length, 0);
  assert.match(page.data.error, /创建/);
  page.setData({ 'historyForm.creatorUserId': '42' });
  await page.confirmHistory();
  const item = calls[0].data.items[0];
  assert.equal(item.creatorUserId, '42');
  assert.equal(item.saleUnits, 2);
  assert.deepEqual(Array.from(item.memberOrderItemIds), ['101', '102']);
});

test('分账原交易与历史转账独立查询，无旧转账申请或姓名', async () => {
  const { page, calls, wx } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  wx.requestMerchantTransfer = () => { throw new Error('不应调用旧转账'); };
  page.refresh = async () => {};
  await page.query({ currentTarget: { dataset: { id: '9007199254740993', channel: 'PROFIT_SHARING' } } });
  await page.query({ currentTarget: { dataset: { id: '999', channel: 'LEGACY_TRANSFER' } } });
  assert.deepEqual(calls.map(call => call.url), ['/stall-managers/profit-sharing/mine/9007199254740993', '/stall-managers/withdrawals/mine/999']);
  assert.equal(calls.every(call => call.method === 'get'), true);
  assert.equal(typeof page.withdraw, 'undefined');
  assert.equal(typeof page.confirm, 'undefined');
  assert.equal(Object.hasOwn(page.data, 'realName'), false);
});

test('历史待确认转账只确认已有原单且客户端成功后仍查原单，不新增转账', async () => {
  let queries = 0, confirmation;
  const { page, calls, wx } = pageHarness('../../pages/managerIncome/managerIncome.js', {
    manager: true, get: async () => {
      queries += 1;
      return queries === 1 ? { status: 'WAIT_USER_CONFIRM', mchId: 'old-mch', appId: 'old-app', packageInfo: 'old-package' }
        : { status: 'PROCESSING' };
    }
  });
  page.refresh = async () => {};
  wx.requestMerchantTransfer = options => { confirmation = options; options.success({}); };
  const event = { currentTarget: { dataset: { id: '9007199254740993' } } };
  page.setData({ tab: 'sharing' });
  await page.confirmLegacyTransfer(event);
  assert.equal(calls.length, 0);
  page.setData({ tab: 'withdrawals' });
  await page.confirmLegacyTransfer(event);
  assert.equal(confirmation.mchId, 'old-mch');
  assert.equal(confirmation.package, 'old-package');
  assert.equal(calls.length, 2);
  assert.equal(calls.every(call => call.method === 'get' && call.url === '/stall-managers/withdrawals/mine/9007199254740993'), true);
  assert.equal(page.data.busy, false);
});

test('管理员编辑保留接口售价，允许手工修改SKU价格', async () => {
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    get: async url => url.includes('/products/') ? {
      product: { id: '10', name: '测试', stallIds: [], bannerImages: [], relateTagIds: [] },
      skus: [{ id: '20', spec: '白', size: '均码', retailPrice: '15', costPrice: '10', stockMain: 1 }],
      costPrice: '10', pricingRuleId: '30', pricingRuleName: '基础', pricingRuleVersion: 1,
      pricingRuleSegments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }]
    } : [],
    post: async () => ({ price: '15.00' })
  });
  page.checkDraft = async () => {};
  page.refreshGrid = () => {};
  await page.loadProductForEdit('10');
  assert.equal(calls[0].url, '/products/10?manage=true');
  assert.equal(page.data.costPrice, '10');
  assert.equal(page.data.skuList[0].costPrice, '10');
  assert.equal(page.data.skuList[0].price, '15');
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'price' } }, detail: { value: '1' } });
  assert.equal(page.data.skuList[0].price, '1');
});

test('一键应用按SKU自身成本计价，默认成本为空也能计算且空成本SKU保持原样', async () => {
  const { page, calls, wx } = pageHarness('../../pages/admin/admin.js', {
    post: async (_, data) => ({ price: (Number(data.cost) + 5).toFixed(2) })
  });
  const toasts = [];
  let dirtyCount = 0;
  wx.showToast = options => toasts.push(options.title);
  page._markDirty = () => { dirtyCount += 1; };
  const emptySku = { costPrice: '', price: '99', stock: '3', image: '原图' };
  const removedSku = { costPrice: '30', price: '88', _toBeRemoved: true };
  page.setData({
    pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ costPrice: '10', price: '', stock: '0' }, emptySku,
      { costPrice: '10.00', price: '80' }, removedSku]
  });
  await page.applyPricingRule();
  assert.equal(page.data.skuList[0].price, '15.00');
  assert.equal(page.data.skuList[0].stock, '0');
  assert.equal(page.data.skuList[2].price, '15.00');
  assert.deepEqual(structuredClone(page.data.skuList[1]), emptySku);
  assert.deepEqual(structuredClone(page.data.skuList[3]), removedSku);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.cost, '10.00');
  assert.equal(page.data.pricingError, '');
  assert.equal(page.data.pricingBusy, false);
  assert.equal(dirtyCount, 1);
  assert.deepEqual(toasts, ['已更新2条SKU售价']);

  // 即使商品默认成本已填，一键应用也不能拿它替空成本SKU补价。
  page.setData({ costPrice: '40' });
  await page.applyPricingRule();
  assert.deepEqual(structuredClone(page.data.skuList[1]), emptySku);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].data.cost, '10.00');
});

test('一键应用覆盖全部套装分组，未填写成本的SKU跳过', async () => {
  const { page } = pageHarness('../../pages/admin/admin.js', {
    post: async (_, data) => ({ price: (Number(data.cost) + 5).toFixed(2) })
  });
  page._markDirty = () => {};
  page.setData({
    costPrice: '999', pricingRuleId: '30',
    pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    isBundleMode: true, activeGroupIndex: 0,
    skuList: [{ costPrice: '20', price: '99' }, { costPrice: '', price: '' }],
    bundleGroups: [{ id: '7', skuList: [] }, { id: '8', skuList: [
      { costPrice: '30', price: '99' }, { price: '旧售价' }
    ] }]
  });
  await page.applyPricingRule();
  assert.equal(page.data.bundleGroups[0].skuList[0].price, '25.00');
  assert.equal(page.data.skuList[0].price, '25.00');
  assert.equal(page.data.bundleGroups[0].skuList[1].costPrice, '');
  assert.equal(page.data.bundleGroups[0].skuList[1].price, '');
  assert.equal(page.data.bundleGroups[1].skuList[0].price, '35.00');
  assert.equal(page.data.bundleGroups[1].skuList[1].costPrice, undefined);
  assert.equal(page.data.bundleGroups[1].skuList[1].price, '旧售价');
});

test('一键应用没有成本时提示填写，计价失败保留原价，计算中不重复请求', async () => {
  const { page, calls, wx } = pageHarness('../../pages/admin/admin.js', {
    post: async () => { throw new Error('计价预览失败'); }
  });
  let dirtyCount = 0;
  const toasts = [];
  page._markDirty = () => { dirtyCount += 1; };
  wx.showToast = options => toasts.push(options.title);
  page.setData({
    pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ costPrice: ' ', price: '99' }]
  });
  await page.applyPricingRule();
  assert.equal(calls.length, 0);
  assert.equal(page.data.pricingError, '');
  assert.equal(toasts[0], '请先填写SKU成本');
  page.setData({ skuList: [{ costPrice: '10', price: '99' }] });
  await page.applyPricingRule();
  assert.equal(page.data.skuList[0].price, '99');
  assert.equal(page.data.pricingBusy, false);
  assert.equal(page.data.pricingError, '计价预览失败');
  assert.equal(toasts[1], '计价预览失败');
  assert.equal(dirtyCount, 0);
  page.setData({ pricingBusy: true });
  await page.applyPricingRule();
  assert.equal(calls.length, 1);
});

test('一键应用等待计价时保留新库存和图片，过期请求不能覆盖后续成本输入', async () => {
  let completePreview;
  const { page } = pageHarness('../../pages/admin/admin.js', {
    post: () => new Promise(resolve => { completePreview = resolve; })
  });
  page._markDirty = () => {};
  page.setData({
    pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ costPrice: '10', price: '99', stock: '1', image: '旧图' }]
  });
  const applying = page.applyPricingRule();
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'stock' } }, detail: { value: '7' } });
  page.setData({ 'skuList[0].image': '新图' });
  completePreview({ price: '15.00' });
  await applying;
  assert.equal(page.data.skuList[0].price, '15.00');
  assert.equal(page.data.skuList[0].stock, '7');
  assert.equal(page.data.skuList[0].image, '新图');

  const outdated = page.applyPricingRule();
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'costPrice' } }, detail: { value: '20' } });
  completePreview({ price: '15.00' });
  await outdated;
  assert.equal(page.data.skuList[0].costPrice, '20');
  assert.equal(page.data.skuList[0].price, '15.00');
});

test('编辑预览忽略空成本SKU，保存仍保留成本完整校验', async () => {
  const { page } = pageHarness('../../pages/admin/admin.js', {
    post: async (_, data) => ({ price: (Number(data.cost) + 5).toFixed(2) })
  });
  page.setData({
    pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ costPrice: '10', price: '' }, { costPrice: '', price: '旧售价' }]
  });
  await page.recalculatePricing(false);
  assert.equal(page.data.skuList[0].price, '15.00');
  assert.equal(page.data.skuList[1].price, '旧售价');
  assert.equal(page.data.pricingError, '');
  await assert.rejects(page.recalculatePricing(true), /每条SKU的成本/);
});

test('单档口选择替换，默认成本不会覆盖已有SKU成本，规则重算整个套装', async () => {
  const { page } = pageHarness('../../pages/admin/admin.js', {
    get: async () => null,
    post: async (_, data) => ({ price: (Number(data.cost) + 5).toFixed(2) })
  });
  page._markDirty = () => {};
  page.useStallPricing = async () => {};
  page.setData({ selectedStalls: [{ id: '1' }] });
  await page.selectStall({ currentTarget: { dataset: { item: { id: '2', name: '档口二' } } } });
  assert.equal(page.data.selectedStalls.length, 1);
  assert.equal(page.data.selectedStalls[0].id, '2');
  page.setData({
    costPrice: '10', pricingRuleId: '30', pricingRuleSegments: [
      { lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }
    ],
    isBundleMode: true, activeGroupIndex: 0,
    skuList: [{ costPrice: '20', price: '999', color: '白', size: '均码' }],
    bundleGroups: [{ id: '7', skuList: [] }, { id: '8', skuList: [{ costPrice: '30', price: '999' }] }]
  });
  await page.recalculatePricing(true);
  assert.equal(page.data.bundleGroups[0].skuList[0].price, '25.00');
  assert.equal(page.data.bundleGroups[1].skuList[0].price, '35.00');
  assert.equal(page.data.skuList[0].costPrice, '20.00');
  const draft = page.collectDraftData();
  assert.equal(draft.costPrice, '10');
  assert.equal(draft.pricingRuleId, '30');
  assert.equal(draft.bundleGroups[1].skuList[0].costPrice, '30.00');
});

test('发布套装编辑提交平铺SKU成本/分组/ID，复制商品清理旧SKU身份', async () => {
  let request;
  const { page } = pageHarness('../../pages/admin/admin.js', {
    get: async () => ({
      id: '30', name: '基础', enabled: true, currentVersion: 1,
      segments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }]
    }),
    post: async (url, body) => url === '/pricing-rules/preview' ? { price: (Number(body.cost) + 5).toFixed(2) } : {},
    put: async (_, body) => { request = body; return {}; }
  });
  page._markDirty = () => {};
  page._saveLastStallSelection = () => {};
  page.clearDraft = async () => {};
  page.uploadMediaList = async () => ['https://example.com/cover.jpg'];
  page.uploadImageList = async () => [];
  page.uploadSkuImages = async rows => rows.map(sku => sku.image || null);
  page.setData({
    editId: '10', title: '套装', selectedStalls: [{ id: '2' }],
    mediaList: [{ url: 'https://example.com/cover.jpg' }], costPrice: '10',
    pricingRuleId: '30', isBundleMode: true, activeGroupIndex: 0,
    skuList: [{ skuId: '20', costPrice: '10', price: '15', stock: 0, image: 'https://example.com/top' }],
    bundleGroups: [{ id: '7', name: '上衣', skuList: [] }, { id: '8', name: '裤子', skuList: [{ skuId: '21', costPrice: '20', price: '25', stock: '3', image: 'https://example.com/trousers' }] }]
  });
  await page.submitProduct();
  assert.equal(request.skus[0].id, '20');
  assert.equal(request.skus[0].bundleGroupId, '7');
  assert.equal(request.skus[0].costPrice, '10.00');
  assert.equal(request.skus[0].retailPrice, 15);
  assert.equal(request.skus[0].stockMain, 0);
  assert.equal(request.skus[0].isUnlimitedStock, false);
  assert.equal(request.skus[0].imageUrl, 'https://example.com/top');
  assert.equal(request.skus[1].imageUrl, 'https://example.com/trousers');
  assert.equal(request.skus[1].bundleGroupId, '8');
  page.copyCurrentProduct();
  assert.equal(page.data.editId, null);
  assert.equal(page.data.skuList[0].skuId, null);
  assert.equal(page.data.skuList[0].costPrice, '10');
});

function preparePricingSubmit(page) {
  page._markDirty = () => {};
  page._saveLastStallSelection = () => {};
  page.clearDraft = async () => {};
  page.uploadMediaList = async () => ['https://example.com/cover.jpg'];
  page.uploadImageList = async () => [];
  page.uploadSkuImages = async rows => rows.map(sku => sku.image || null);
  page.setData({ title: '定价商品', selectedStalls: [{ id: '2' }],
    mediaList: [{ url: 'https://example.com/cover.jpg' }] });
}

test('负责人默认成本留空，SKU成本1元按规则算9.18元并可新增和编辑', async () => {
  const rule = { id: '30', name: 'oker', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, formula: '(x+8)/0.98' }] };
  for (const editId of [null, '10']) {
    for (const withStall of [false, true]) {
      const { page, calls } = pageHarness('../../pages/admin/admin.js', { manager: true,
        get: async () => rule,
        post: async (_, body) => ({ price: ((Number(body.cost) + 8) / 0.98).toFixed(2) }),
        put: async () => ({}) });
      preparePricingSubmit(page);
      page.setData({ editId, isStallManager: true, assignedStalls: [{ id: '2' }],
        selectedStalls: withStall ? [{ id: '2' }] : [], costPrice: '', pricingRuleId: '30',
        skuList: [{ skuId: '20', costPrice: '1.00', price: '9.18', stock: '' }] });
      await page.submitProduct();
      const saved = calls.find(call => call.url === (editId ? '/products/10' : '/products'));
      assert.ok(saved, page.data.pricingError);
      assert.equal(saved.data.costPrice, null);
      assert.equal(saved.data.skus[0].costPrice, '1.00');
      assert.equal(saved.data.skus[0].retailPrice, 9.18);
      assert.equal(saved.data.skus[0].isUnlimitedStock, true);
      assert.equal(page.data.defaultPrice, '');
      assert.equal(page.data.pricingError, '');
    }
  }
});

test('负责人套装默认成本留空，所有分组按各自SKU成本保存', async () => {
  const rule = { id: '30', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, formula: '(x+8)/0.98' }] };
  for (const editId of [null, '10']) {
    const { page, calls } = pageHarness('../../pages/admin/admin.js', { manager: true,
      get: async () => rule,
      post: async (_, body) => ({ price: ((Number(body.cost) + 8) / 0.98).toFixed(2) }),
      put: async () => ({}) });
    preparePricingSubmit(page);
    page.setData({ editId, isStallManager: true, selectedStalls: [], costPrice: '', pricingRuleId: '30',
      isBundleMode: true, activeGroupIndex: 0,
      skuList: [{ skuId: '20', costPrice: '1', price: '888', stock: '0' }],
      bundleGroups: [{ id: '7', name: '上衣', skuList: [] },
        { id: '8', name: '裤子', skuList: [{ skuId: '21', costPrice: '2', price: '888', stock: '' }] }] });
    await page.submitProduct();
    const saved = calls.find(call => call.url === (editId ? '/products/10' : '/products'));
    assert.ok(saved, page.data.pricingError);
    assert.equal(saved.data.costPrice, null);
    const rows = editId ? saved.data.skus : saved.data.bundleGroups.flatMap(group => group.skus);
    assert.deepEqual(Array.from(rows, row => row.costPrice), ['1.00', '2.00']);
    assert.deepEqual(Array.from(rows, row => row.retailPrice), [9.18, 10.20]);
  }
});

test('负责人保存逐条校验有效成本，默认成本可补空值但不能掩盖非法成本', async () => {
  const rule = { id: '30', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, formula: 'x+5' }] };
  for (const invalid of ['', '0', '-1', '1.001']) {
    const { page, calls } = pageHarness('../../pages/admin/admin.js', { manager: true,
      get: async () => rule, post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) }) });
    preparePricingSubmit(page);
    page.setData({ isStallManager: true, selectedStalls: [], pricingRuleId: '30',
      skuList: [{ costPrice: '1', price: '6' }, { costPrice: invalid, price: '888' }] });
    await page.submitProduct();
    assert.match(page.data.pricingError, /SKU.*成本/);
    assert.equal(calls.filter(call => call.url === '/products').length, 0);
    if (invalid !== '') continue;
    page.setData({ costPrice: '2' });
    await page.submitProduct();
    const saved = calls.find(call => call.url === '/products');
    assert.ok(saved, page.data.pricingError);
    assert.equal(saved.data.skus[0].costPrice, '1.00');
    assert.equal(saved.data.skus[1].costPrice, '2.00');
    page.setData({ costPrice: '1.001' });
    await page.submitProduct();
    assert.match(page.data.pricingError, /默认成本/);
    assert.equal(calls.filter(call => call.url === '/products').length, 1);
  }
});

test('直播发布默认成本留空仍可保存各SKU成本和规则售价', async () => {
  const rule = { id: '30', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, formula: '(x+8)/0.98' }] };
  for (const bundle of [false, true]) {
    const { page, calls } = pageHarness('../../pages/liveRoomPublish/publish.js', {
      get: async () => rule,
      post: async (_, body) => ({ price: ((Number(body.cost) + 8) / 0.98).toFixed(2) }),
      put: async () => ({}) });
    preparePricingSubmit(page);
    page.setData({ editMode: true, productId: '10', sessionId: '9', costPrice: '', pricingRuleId: '30',
      isBundleMode: bundle, activeGroupIndex: bundle ? 0 : -1,
      skuList: [{ costPrice: '1', price: '9.18', stock: '' }],
      bundleGroups: bundle ? [{ name: '上衣', skuList: [] },
        { name: '裤子', skuList: [{ costPrice: '2', price: '10.20', stock: '0' }] }] : [] });
    await page.submitProduct();
    const saved = calls.find(call => call.url === '/live-products/10');
    assert.ok(saved, page.data.pricingError);
    assert.equal(saved.data.costPrice, null);
    const rows = bundle ? saved.data.bundleGroups.flatMap(group => group.skus) : saved.data.skus;
    assert.equal(rows[0].costPrice, '1.00');
    assert.equal(rows[0].retailPrice, 9.18);
    if (bundle) assert.equal(rows[1].retailPrice, 10.20);
  }
});

test('管理员不选择档口可发布和编辑，提交空档口列表并保存手填价', async () => {
  for (const editId of [null, '10']) {
    const { page, calls } = pageHarness('../../pages/admin/admin.js', { post: async () => ({}), put: async () => ({}) });
    preparePricingSubmit(page);
    page.setData({ editId, selectedStalls: [], skuList: [{ skuId: '20', price: '29.90', costPrice: '', stock: '0' }] });
    await page.submitProduct();
    const saved = calls.find(call => call.url === (editId ? '/products/10' : '/products'));
    assert.ok(saved);
    assert.equal(saved.data.stallIds.length, 0);
    assert.equal(saved.data.skus[0].retailPrice, 29.9);
    assert.equal(page.data.pricingError, '');
  }
});

test('管理员与负责人均拒绝多个档口', async () => {
  for (const manager of [false, true]) {
    const { page, calls } = pageHarness('../../pages/admin/admin.js', { manager });
    preparePricingSubmit(page);
    page.setData({ isStallManager: manager, selectedStalls: [{ id: '2' }, { id: '3' }] });
    await page.submitProduct();
    assert.equal(page.data.pricingError, '商品最多只能选择一个档口');
    assert.equal(calls.length, 0);
  }
});

test('负责人选择档口时仍不能提交未分配的档口', async () => {
  const { page, calls, wx } = pageHarness('../../pages/admin/admin.js', { manager: true,
    get: async () => ({ id: '30', enabled: true, currentVersion: 1,
      segments: [{ lower: 0, upper: null, formula: 'x+5' }] }),
    post: async () => ({ price: '15.00' }) });
  preparePricingSubmit(page);
  let toast;
  wx.showToast = options => { toast = options.title; };
  page.setData({ isStallManager: true, assignedStalls: [{ id: '3' }], costPrice: '10',
    skuList: [{ costPrice: '10', price: '15', stock: '0' }] });
  await page.submitProduct();
  assert.equal(toast, '请选择已分配给您的档口');
  assert.equal(calls.filter(call => call.url === '/products').length, 0);
});

test('负责人不选档口可以选择规则并保存，仍强制填写成本且不允许手改价格', async () => {
  const rule = { id: '30', name: '基础', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, formula: 'x+5' }] };
  const { page, calls } = pageHarness('../../pages/admin/admin.js', { manager: true,
    get: async () => rule, post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) }) });
  preparePricingSubmit(page);
  page.setData({ isStallManager: true, selectedStalls: [], pricingRules: [rule], costPrice: '10',
    skuList: [{ costPrice: '10', price: '99', stock: '0' }] });
  await page.choosePricingRule({ detail: { value: 0 } });
  assert.equal(page.data.pricingRuleId, '30');
  assert.equal(page.data.skuList[0].price, '15.00');
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'price' } }, detail: { value: '88' } });
  assert.equal(page.data.skuList[0].price, '15.00');
  await page.submitProduct();
  const saved = calls.find(call => call.url === '/products');
  assert.ok(saved);
  assert.equal(saved.data.stallIds.length, 0);
  assert.equal(saved.data.skus[0].retailPrice, 15);
  page.setData({ costPrice: '', 'skuList[0].costPrice': '' });
  await page.submitProduct();
  assert.match(page.data.pricingError, /每条SKU的成本/);
  assert.equal(calls.filter(call => call.url === '/products').length, 1);
  page.setData({ costPrice: '10', pricingRuleId: '' });
  await page.submitProduct();
  assert.equal(page.data.pricingError, '请选择有效计价规则');
});

test('负责人移除档口保留当前规则，未选档口加载不会清除规则，有档口不能手动换规则', async () => {
  const { page } = pageHarness('../../pages/admin/admin.js', { manager: true });
  page._saveLastStallSelection = () => {};
  page.setData({ isStallManager: true, selectedStalls: [{ id: '2' }], pricingRuleId: '30',
    pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    pricingRules: [{ id: '40', name: '其他', enabled: true, segments: [] }] });
  await page.choosePricingRule({ detail: { value: 0 } });
  assert.equal(page.data.pricingRuleId, '30');
  page.removeStall({ currentTarget: { dataset: { id: '2' } } });
  await page.useStallPricing();
  assert.equal(page.data.selectedStalls.length, 0);
  assert.equal(page.data.pricingRuleId, '30');
  assert.equal(page.data.pricingRuleSegments.length, 1);
});

test('管理员仅填写售价可以发布，批量价格不要求成本或规则', async () => {
  let request;
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    post: async (_, body) => { request = body; return {}; }
  });
  preparePricingSubmit(page);
  page.setData({ skuList: [{ price: '', costPrice: '', stock: '0' }], quickPrice: '29.90' });
  page.applyQuickFillAll();
  assert.equal(page.data.skuList[0].price, '29.90');
  assert.equal(page.data.quickPrice, '');
  await page.submitProduct();
  assert.equal(request.skus[0].retailPrice, 29.9);
  assert.equal(request.skus[0].costPrice, null);
  assert.equal(request.costPrice, null);
  assert.equal(request.pricingRuleId, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/products');
});

test('管理员一键填充只填成本时自动按规则计算SKU售价，保存保留计算结果', async () => {
  let request;
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    post: async (url, body) => {
      if (url === '/pricing-rules/preview') return { price: (Number(body.cost) + 5).toFixed(2) };
      request = body;
      return {};
    }
  });
  preparePricingSubmit(page);
  page.setData({ pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ costPrice: '', price: '', stock: '0' }, { costPrice: '20', price: '99', stock: '3' }],
    quickCost: '10', quickPrice: '' });
  await page.applyQuickFillAll();
  assert.equal(page.data.quickCost, '');
  assert.equal(page.data.skuList[0].costPrice, '10.00');
  assert.equal(page.data.skuList[0].price, '15.00');
  assert.equal(page.data.skuList[1].price, '15.00');
  assert.equal(page.data.skuList[0].stock, '0');
  assert.equal(calls.filter(call => call.url === '/pricing-rules/preview').length, 1);
  await page.submitProduct();
  assert.equal(request.skus[0].retailPrice, 15);
  assert.equal(request.skus[1].retailPrice, 15);
});

test('管理员同时填成本和售价以手填为准，只填库存图片不重算售价', async () => {
  const { page, calls } = pageHarness('../../pages/admin/admin.js');
  page._markDirty = () => {};
  page.setData({ pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ costPrice: '', price: '', stock: '1' }], quickCost: '10', quickPrice: '88.88' });
  await page.applyQuickFillAll();
  assert.equal(page.data.skuList[0].costPrice, '10');
  assert.equal(page.data.skuList[0].price, '88.88');
  page.setData({ quickStock: '7', quickImage: '新图' });
  await page.applyQuickFillAll();
  assert.equal(page.data.skuList[0].price, '88.88');
  assert.equal(page.data.skuList[0].stock, '7');
  assert.equal(page.data.skuList[0].image, '新图');
  assert.equal(calls.length, 0);
});

test('管理员批量只填成本仅重算选中SKU，套装其他组和未选中SKU保留手填价', async () => {
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) })
  });
  page._markDirty = () => {};
  page.setData({ pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    isBundleMode: true, activeGroupIndex: 0,
    skuList: [{ color: '红', size: '均码', costPrice: '10', price: '99' },
      { color: '蓝', size: '均码', costPrice: '非法成本', price: '88' }],
    bundleGroups: [{ id: '7', skuList: [] }, { id: '8', skuList: [{ costPrice: '20', price: '77' }] }],
    batchCost: '30', batchPrice: '', batchSelectedColors: [{ name: '红', selected: true }], batchSelectedSizes: [] });
  await page.confirmBatch();
  assert.equal(page.data.skuList[0].price, '35.00');
  assert.equal(page.data.bundleGroups[0].skuList[0].price, '35.00');
  assert.equal(page.data.skuList[1].price, '88');
  assert.equal(page.data.skuList[1].costPrice, '非法成本');
  assert.equal(page.data.bundleGroups[1].skuList[0].price, '77');
  assert.equal(calls.length, 1);
});

test('管理员未选规则仅填充成本并提示，接口失败保留原价且显示错误', async () => {
  const { page, wx, calls } = pageHarness('../../pages/admin/admin.js', {
    post: async () => { throw new Error('计价预览失败'); }
  });
  const toasts = [];
  wx.showToast = options => toasts.push(options.title);
  page._markDirty = () => {};
  page.setData({ skuList: [{ costPrice: '', price: '99' }], quickCost: '10' });
  await page.applyQuickFillAll();
  assert.equal(page.data.skuList[0].costPrice, '10');
  assert.equal(page.data.skuList[0].price, '99');
  assert.match(toasts.at(-1), /请选择计价规则或手动填写售价/);
  assert.equal(calls.length, 0);
  page.setData({ pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }], quickCost: '20' });
  await page.applyQuickFillAll();
  assert.equal(page.data.skuList[0].costPrice, '20');
  assert.equal(page.data.skuList[0].price, '99');
  assert.equal(page.data.pricingBusy, false);
  assert.equal(page.data.pricingError, '计价预览失败');
  assert.equal(toasts.at(-1), '计价预览失败');
});

test('成本一键填充计算期间不能提前保存，后续手改售价优先于晚返回的计价结果', async () => {
  let completePreview;
  const { page, calls, wx } = pageHarness('../../pages/admin/admin.js', {
    post: () => new Promise(resolve => { completePreview = resolve; })
  });
  preparePricingSubmit(page);
  const toasts = [];
  wx.showToast = options => toasts.push(options.title);
  page.setData({ pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ costPrice: '', price: '99' }], quickCost: '10' });
  const filling = page.applyQuickFillAll();
  await page.submitProduct();
  assert.equal(calls.filter(call => call.url === '/products').length, 0);
  assert.equal(toasts.at(-1), '正在计算售价，请稍后保存');
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'price' } }, detail: { value: '88.88' } });
  completePreview({ price: '15.00' });
  await filling;
  assert.equal(page.data.skuList[0].price, '88.88');
});

test('管理员档口没有可用规则时保留手填价格，不显示负责人规则必填错误', async () => {
  for (const rule of [null, { id: '30', enabled: false, deleted: false }]) {
    const { page } = pageHarness('../../pages/admin/admin.js', { get: async () => rule });
    page.setData({ selectedStalls: [{ id: '2' }], skuList: [{ price: '29.90', costPrice: '' }] });
    await page.useStallPricing();
    assert.equal(page.data.pricingRuleId, '');
    assert.equal(page.data.pricingError, '');
    assert.equal(page.data.skuList[0].price, '29.90');
  }
});

test('管理员先应用规则后手改价格，保存以手改为准，再次应用则以规则为准', async () => {
  let request;
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) }),
    put: async (_, body) => { request = body; return {}; }
  });
  preparePricingSubmit(page);
  page.setData({ editId: '10', costPrice: '10', pricingRuleId: '30',
    pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ skuId: '20', costPrice: '10', price: '99', stock: '3' }] });
  await page.applyPricingRule();
  assert.equal(page.data.skuList[0].price, '15.00');
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'price' } }, detail: { value: '18.88' } });
  await page.submitProduct();
  assert.equal(request.skus[0].retailPrice, 18.88);
  assert.equal(calls.filter(call => call.url === '/pricing-rules/preview').length, 1);
  await page.applyPricingRule();
  await page.submitProduct();
  assert.equal(request.skus[0].retailPrice, 15);
});

test('管理员批量改价仅修改选中的SKU，改变成本和库存不触发重新计价', () => {
  const { page, calls } = pageHarness('../../pages/admin/admin.js');
  page._markDirty = () => {};
  page.setData({
    skuList: [{ color: '红', size: '均码', costPrice: '10', price: '15' },
      { color: '蓝', size: '均码', costPrice: '20', price: '25' }],
    batchPrice: '19.90', batchCost: '12', batchStock: '0',
    batchSelectedColors: [{ name: '红', selected: true }], batchSelectedSizes: []
  });
  page.confirmBatch();
  assert.equal(page.data.skuList[0].price, '19.90');
  assert.equal(page.data.skuList[0].costPrice, '12');
  assert.equal(page.data.skuList[0].stock, '0');
  assert.equal(page.data.skuList[1].price, '25');
  page.onCostInput({ detail: { value: '30' } });
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'costPrice' } }, detail: { value: '35' } });
  assert.equal(page.data.skuList[0].price, '19.90');
  assert.equal(calls.length, 0);
});

test('计价请求等待期间手动改价，晚返回的规则价格不能覆盖手填价格', async () => {
  let completePreview;
  const { page } = pageHarness('../../pages/admin/admin.js', {
    post: () => new Promise(resolve => { completePreview = resolve; })
  });
  page._markDirty = () => {};
  page.setData({ pricingRuleId: '30', pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ costPrice: '10', price: '99' }] });
  const applying = page.applyPricingRule();
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'price' } }, detail: { value: '88.88' } });
  completePreview({ price: '15.00' });
  await applying;
  assert.equal(page.data.skuList[0].price, '88.88');
  assert.equal(page.data.pricingBusy, false);
});

test('管理员套装的手动价格同步到当前分组并保存所有分组最终售价', async () => {
  let request;
  const { page } = pageHarness('../../pages/admin/admin.js', {
    put: async (_, body) => { request = body; return {}; }
  });
  preparePricingSubmit(page);
  page.setData({ editId: '10', isBundleMode: true, activeGroupIndex: 0,
    skuList: [{ skuId: '20', price: '15', costPrice: '', stock: '0' }],
    bundleGroups: [{ id: '7', name: '上衣', skuList: [] },
      { id: '8', name: '裤子', skuList: [{ skuId: '21', price: '25', costPrice: '', stock: '3' }] }] });
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'price' } }, detail: { value: '18.80' } });
  assert.equal(page.data.bundleGroups[0].skuList[0].price, '18.80');
  await page.submitProduct();
  assert.equal(request.skus[0].retailPrice, 18.8);
  assert.equal(request.skus[1].retailPrice, 25);
  assert.equal(request.displayPrice, '18.8 - 25');
  assert.equal(request.skus[0].costPrice, null);
});

test('负责人单条与批量手工改价都被拦住，保存仍强制校验成本并按规则算价', async () => {
  const { page, calls } = pageHarness('../../pages/admin/admin.js', { manager: true,
    get: async () => ({ id: '30', enabled: true, currentVersion: 1,
      segments: [{ lower: 0, upper: null, formula: 'x+5' }] }),
    post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) })
  });
  preparePricingSubmit(page);
  page.setData({ isStallManager: true, assignedStalls: [{ id: '2' }],
    skuList: [{ costPrice: '10', price: '15', color: '红', size: '均码' }], quickPrice: '88',
    batchPrice: '99', batchSelectedColors: [{ name: '红', selected: true }], batchSelectedSizes: [] });
  page.onSkuInput({ currentTarget: { dataset: { index: 0, field: 'price' } }, detail: { value: '1' } });
  page.applyQuickFillAll();
  page.confirmBatch();
  assert.equal(page.data.skuList[0].price, '15');
  page.setData({ 'skuList[0].costPrice': '' });
  await page.submitProduct();
  assert.match(page.data.pricingError, /每条SKU的成本/);
  assert.equal(calls.filter(call => call.url === '/products').length, 0);
  page.setData({ costPrice: '10', 'skuList[0].price': '88' });
  await page.submitProduct();
  const saved = calls.find(call => call.url === '/products');
  assert.equal(saved.data.skus[0].retailPrice, 15);
  assert.equal(saved.data.skus[0].costPrice, '10.00');
});

test('管理员非法售价在上传前拦住，每条SKU都校验', async () => {
  for (const price of ['', '0', '-1', '1.001']) {
    const { page, calls } = pageHarness('../../pages/admin/admin.js');
    preparePricingSubmit(page);
    page.setData({ skuList: [{ price: '10' }, { price }] });
    await page.submitProduct();
    assert.match(page.data.pricingError, /SKU售价/);
    assert.equal(calls.length, 0);
  }
});

test('管理员手动结算逐条分配总额，凭证、付款时间和冲正原因传后端', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  page.refresh = async () => {};
  page.setData({
    userId: '42', income: { settleableIncome: '100' }, allocations: { '9007199254740993': '20', '2': '15' },
    settlementTotal: '35.00', paidAt: '2026-10-02T09:00:00+08:00',
    paymentMethod: '银行转账', voucher: '凭证123', settlementReason: '核对已付款'
  });
  await page.settleOffline();
  assert.equal(calls[0].url, '/stall-managers/42/offline-settlements');
  assert.equal(calls[0].data.amount, '35.00');
  assert.equal(calls[0].data.allocations[1].recordId, '9007199254740993');
  page.setData({ settlementReason: '核对已付款' });
  await page.reverseSettlement({ currentTarget: { dataset: { id: '10' } } });
  assert.equal(calls[1].url, '/stall-managers/42/offline-settlements/10/reverse');
  assert.equal(calls[1].data.reason, '核对已付款');
});

test('管理员冻结表单和所有请求入口取消，历史审计与线下结算保留', () => {
  const { page } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  for (const method of ['freezeAmount', 'toggleWithdrawalBlock', 'releaseFreeze', 'loadFreezes']) assert.equal(typeof page[method], 'undefined');
  assert.equal(typeof page.settleOffline, 'function');
  assert.equal(typeof page.reverseSettlement, 'function');
  const template = fs.readFileSync(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.wxml'), 'utf8');
  assert.doesNotMatch(template, /bindtap="(freezeAmount|toggleWithdrawalBlock|releaseFreeze)"|data-tab="freeze"/);
  assert.match(template, /财务审计/);
});

test('未知微信提现人工核验完整发送账单依据和原单绑定信息', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  page.refresh = async () => {};
  page.setData({
    userId: '42', reconciliation: { id: '88' }, reconciliationStatus: 'CANCELLED',
    verifiedMerchantBillNo: 'SM123', verifiedOpenId: 'openid', verifiedAmount: '12.34',
    proof: '商户资金账单凭证123', reconciliationReason: '核验确定未付款'
  });
  await page.reconcileWithdrawal();
  assert.equal(calls[0].url, '/stall-managers/42/withdrawals/88/reconciliation');
  assert.equal(calls[0].data.status, 'CANCELLED');
  assert.equal(calls[0].data.verifiedMerchantBillNo, 'SM123');
  assert.equal(calls[0].data.proof, '商户资金账单凭证123');
});

test('管理员新建规则先账号偏好后档口，选规则仅更新展示，点击应用才重算', async () => {
  const preferred = {
    id: '30', name: '上次规则', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }]
  };
  const assigned = { ...preferred, id: '40', name: '档口规则' };
  const { page } = pageHarness('../../pages/admin/admin.js', {
    get: async url => {
      if (url === '/pricing-rules') return [preferred, assigned];
      if (url.endsWith('/preference/mine')) return { ruleId: '30' };
      if (url.endsWith('/pricing-rule')) return assigned;
      return [];
    },
    post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) })
  });
  page.refreshGrid = () => {};
  page.loadRecentStallsAndTags = () => {};
  page.loadSizeCategories = () => {};
  page._loadLastStallSelection = () => page.setData({ selectedStalls: [{ id: '2', name: '档口二' }] });
  page.checkDraft = async () => {};
  page._markDirty = () => {};
  page.setData({ costPrice: '10' });
  await page.onLoad({});
  assert.equal(page.data.pricingRuleId, '40');
  page.setData({ skuList: [{ costPrice: '10', price: '90' }] });
  await page.choosePricingRule({ detail: { value: 1 } });
  assert.equal(page.data.pricingRuleId, '30');
  assert.equal(page.data.skuList[0].price, '90');
  await page.applyPricingRule();
  assert.equal(page.data.skuList[0].price, '15.00');
  await page.choosePricingRule({ detail: { value: 0 } });
  assert.equal(page.data.pricingRuleId, '');
  assert.equal(page.data.skuList[0].price, '15.00');
});

test('负责人已下线显示状态并禁止新商品保存', async () => {
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    manager: true,
    get: async url => url === '/stall-managers/mine' ? { active: false } : []
  });
  page.refreshGrid = () => {};
  page.loadSizeCategories = () => {};
  page.checkDraft = async () => {};
  page._loadLastStallSelection = () => {};
  await page.onLoad({});
  assert.equal(page.data.managerInactive, true);
  await page.submitProduct();
  assert.equal(calls.filter(call => call.method === 'post').length, 0);
});

module.exports = { pageHarness };


test('收入与负责人详情慢请求切页不会把旧佣金写入提现页', async () => {
  for (const file of ['../../pages/managerIncome/managerIncome.js', '../../pages/stallManagerDetail/stallManagerDetail.js']) {
    let finishOld;
    const old = new Promise(resolve => { finishOld = resolve; });
    const { page } = pageHarness(file, {
      get: async url => url.includes('commission-records') ? old : { content: [{ id: 'withdrawal1', status: 'PROCESSING' }], totalPages: 1 }
    });
    page.setData({ userId: '42', tab: 'records' });
    const pending = page.loadList(true);
    await page.changeTab({ currentTarget: { dataset: { tab: 'withdrawals' } } });
    assert.equal(page.data.rows[0].id, 'withdrawal1');
    finishOld({ content: [{ id: 'oldCommission' }], totalPages: 1 });
    await pending;
    assert.equal(page.data.rows[0].id, 'withdrawal1');
    assert.equal(page.data.tab, 'withdrawals');
  }
});

test('直播编辑读取管理成本保留零库存和全套装，提交创建结构且售价禁止手填', async () => {
  const rule = { id: '30', name: '基础', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' }] };
  const sku = { id: '20', spec: '白', size: '均码', costPrice: '10', retailPrice: '15', stockMain: 0, unlimitedStock: false };
  const { page, calls } = pageHarness('../../pages/liveRoomPublish/publish.js', {
    get: async url => {
      if (url.startsWith('/products/')) return { product: { name: '直播套装', coverUrl: 'https://example.com/cover', stallIds: ['2'] },
        skus: [sku], bundleGroups: [{ name: '上衣', skus: [sku] }, { name: '裤子', skus: [{ ...sku, id: '21', costPrice: '20', retailPrice: '25' }] }],
        costPrice: '10', pricingRuleId: '30', pricingRuleName: '基础', pricingRuleVersion: 1, pricingRuleSegments: rule.segments };
      if (url === '/stalls/all') return [{ id: '2', name: '档口' }];
      if (url === '/pricing-rules/30') return rule;
      return [];
    },
    post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) })
  });
  page.refreshGrid = () => {};
  page.checkDraft = async () => {};
  page.uploadMediaList = async rows => rows.map(row => row.url);
  page.uploadSkuImages = async rows => rows.map(row => row.image || null);
  page.setData({ productId: '10', editMode: true, sessionId: '9' });
  await page.loadProductForEdit('10');
  assert.equal(calls[0].url, '/products/10?manage=true');
  assert.equal(page.data.skuList[0].stock, '0');
  assert.equal(page.data.bundleGroups[1].skuList[0].price, '25.00');
  page.onSkuInput({ currentTarget: { dataset: { field: 'price', index: 0 } }, detail: { value: '999' } });
  assert.equal(page.data.skuList[0].price, '15.00');
  const draft = page.collectDraftData();
  assert.equal(draft.costPrice, '10');
  assert.equal(draft.bundleGroups[1].skuList[0].costPrice, '20.00');
  await page.submitProduct();
  const request = calls.find(call => call.method === 'put' && call.url === '/live-products/10').data;
  assert.equal(request.costPrice, '10.00');
  assert.equal(request.pricingRuleId, '30');
  assert.equal(request.skus.length, 0);
  assert.equal(request.bundleGroups[0].skus[0].stockMain, 0);
  assert.equal(request.bundleGroups[0].skus[0].isUnlimitedStock, false);
  assert.equal(request.bundleGroups[1].skus[0].costPrice, '20.00');
  assert.equal(request.bundleGroups[1].skus[0].retailPrice, 25);
});

test('直播转普通商品保留成本规则及所有分组并清除旧SKU身份', async () => {
  const rule = { lower: 0, upper: null, lowerInclusive: false, upperInclusive: false, formula: 'x+5' };
  const { page, calls } = pageHarness('../../pages/admin/admin.js', {
    get: async url => url.startsWith('/products/') ? {
      product: { name: '直播套装' }, skus: [], costPrice: '10', pricingRuleId: '30',
      pricingRuleName: '基础', pricingRuleVersion: 1, pricingRuleSegments: [rule],
      bundleGroups: [{ id: '7', name: '上衣', skus: [{ id: '20', costPrice: '10', retailPrice: '15', stockMain: 0 }] }]
    } : [],
    post: async (_, body) => ({ price: (Number(body.cost) + 5).toFixed(2) })
  });
  page.refreshGrid = () => {};
  page.checkDraft = async () => {};
  await page.loadLiveProductForConvert('10');
  assert.equal(calls[0].url, '/products/10?manage=true');
  assert.equal(page.data.pricingRuleId, '30');
  assert.equal(page.data.bundleGroups[0].id, null);
  assert.equal(page.data.skuList[0].skuId, null);
  assert.equal(page.data.skuList[0].stock, '0');
  assert.equal(page.data.skuList[0].costPrice, '10');
  assert.equal(page.data.skuList[0].price, '15');
});


test('负责人收入时间兼容时间戳和北京时间字符串，不随手机时区偏移', () => {
  const millis = Date.parse('2026-10-05T04:46:33Z');
  for (const value of [millis, String(millis), millis / 1000, String(millis / 1000),
    '2026-10-05T04:46:33Z', '2026-10-05T12:46:33+08:00', '2026-10-05 12:46:33', '2026/10/05 12:46:33']) {
    assert.equal(finance.displayTime(value), '2026-10-05 12:46');
  }
  for (const value of [null, '', '不是时间', Infinity, 1e20]) assert.equal(finance.displayTime(value), '时间未记录');
  const request = finance.withdrawalRequestRow({ createdAt: millis, status: 'SUCCESS', items: [{ deadline: millis }] });
  assert.equal(request.requestedTime, '2026-10-05 12:46');
  assert.equal(request.items[0].deadlineLabel, '2026-10-05 12:46');
});

test('本人佣金和交易资格展示商品快照与时间，缺失字段不伪造下单时间', async () => {
  const orderId = '9007199254740993';
  const row = { id: '1', orderId, orderItemId: '2', productName: '秋季上衣', productImage: 'https://example.com/cover.jpg',
    skuSpec: '米白', skuSize: 'XL', qty: 3, orderedAt: '2026-10-04 19:12:27', createdAt: '2026-10-05T04:00:00Z' };
  const { page, calls } = pageHarness('../../pages/managerIncome/managerIncome.js', { get: async url => {
    if (url.endsWith('eligibility/mine')) return [{ orderId, orderedAt: row.orderedAt,
      deadline: Date.parse('2026-11-03T11:12:27Z'), items: [row], eligible: false, blockedReason: '已结清' }];
    if (url.endsWith('withdrawals/mine')) return { content: [{ id: '5', status: 'SUCCESS', createdAt: '2026-10-05 10:51:27' }], totalPages: 1 };
    return { content: [row], totalPages: 1 };
  } });
  await page.loadList(true);
  assert.equal(page.data.rows[0].specLabel, '米白 / XL');
  assert.equal(page.data.rows[0].orderedTime, '2026-10-04 19:12');
  assert.equal(page.data.rows[0].productImage, row.productImage);
  assert.equal(page.data.rows[0].orderId, orderId);
  page.productImageError({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.rows[0].productImage, '');
  await page.changeTab({ currentTarget: { dataset: { tab: 'eligibility' } } });
  assert.equal(page.data.rows[0].items[0].specLabel, '米白 / XL');
  assert.equal(page.data.rows[0].items[0].qty, 3);
  assert.equal(page.data.rows[0].deadlineLabel, '2026-11-03 19:12');
  page.productImageError({ currentTarget: { dataset: { index: 0, detailIndex: 0 } } });
  assert.equal(page.data.rows[0].items[0].productImage, '');
  await page.changeTab({ currentTarget: { dataset: { tab: 'requests' } } });
  assert.equal(page.data.rows[0].requestedTime, '2026-10-05 10:51');
  assert.equal(calls.every(call => call.method === 'get'), true);
  assert.equal(finance.incomeRecordRow({ createdAt: row.createdAt }).orderedTime, '时间未记录');
  const missing = finance.incomeEligibilityRow({});
  assert.deepEqual(missing.items, []);
  assert.equal(missing.deadlineLabel, '不适用');
  assert.equal(finance.incomeRecordRow({ skuSpec: 'null', skuSize: 'undefined' }).specLabel, '规格未记录');
});

test('逐交易资格数组完整显示不自动分账原因，不伪造分页或发资金请求', async () => {
  for (const [file, prefix] of [['../../pages/managerIncome/managerIncome.js', '/stall-managers/profit-sharing/eligibility/mine'], ['../../pages/stallManagerDetail/stallManagerDetail.js', '/stall-managers/42/profit-sharing/eligibility']]) {
    const { page, calls } = pageHarness(file, { get: async () => [
      { orderId: '1', transactionId: null, availableAmount: '10', eligible: false, blockedReason: '原微信支付未启用分账' },
      { orderId: '2', transactionId: 'wx2', availableAmount: '20', eligible: false, blockedReason: '超过普通分账30天期限，需线下结算' },
      { orderId: '3', transactionId: 'test3', availableAmount: '30', eligible: false, blockedReason: '不是已验签确认的真实微信支付' }
    ] });
    page.setData({ userId: '42', tab: 'eligibility' });
    await page.loadList(true);
    assert.equal(calls[0].url, prefix);
    assert.equal(page.data.rows.length, 3);
    assert.equal(page.data.rows[1].eligible, false);
    assert.match(page.data.rows[1].blockedReason, /30天/);
    assert.equal(page.data.hasNext, false);
    assert.equal(calls.every(call => call.method === 'get'), true);
  }
});

test('自动分账记录一基分页和历史通道独立，管理员查原单不生成新单', async () => {
  const { page, calls } = pageHarness('../../pages/managerIncome/managerIncome.js', { get: async (_, params) => ({
    content: [{ id: String(params.page), status: 'PROCESSING', transactionId: 'wx1' }], totalPages: 2
  }) });
  page.setData({ tab: 'sharing' });
  await page.loadList(true);
  await page.loadList(false);
  assert.deepEqual(calls.map(call => call.data.page), [1, 2]);
  assert.equal(page.data.rows[0].channel, 'PROFIT_SHARING');
  assert.equal(page.data.rows[0].terminal, false);
  assert.match(page.data.rows[0].statusLabel, /分账/);
  const admin = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  admin.page.setData({ userId: '42' });
  admin.page.refresh = async () => {};
  await admin.page.querySharing({ currentTarget: { dataset: { id: '9007199254740993' } } });
  assert.equal(admin.calls[0].method, 'get');
  assert.equal(admin.calls[0].url, '/stall-managers/42/profit-sharing/9007199254740993');
});

test('分账接收关系没有员工默认，必须本人实际核验、CUSTOM限10字符、无需姓名openid输入', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  page.setData({ userId: '42', receiverReason: '已核实合同' });
  page.refresh = async () => {};
  await page.saveReceiver();
  assert.equal(calls.length, 0);
  assert.match(page.data.error, /先选择/);
  page.receiverTypeChange({ detail: { value: 9 } });
  page.setData({ customRelation: '档口合作方' });
  await page.saveReceiver();
  assert.equal(calls.length, 0);
  page.receiverVerification({ detail: { value: true } });
  page.setData({ customRelation: '一二三四五六七八九十一' });
  await page.saveReceiver();
  assert.equal(calls.length, 0);
  assert.match(page.data.error, /10/);
  page.setData({ customRelation: '档口合作方' });
  await page.saveReceiver();
  assert.equal(calls[0].url, '/stall-managers/42/profit-sharing/receiver');
  assert.equal(calls[0].method, 'put');
  assert.equal(calls[0].data.relationType, 'CUSTOM');
  assert.equal(calls[0].data.customRelation, '档口合作方');
  assert.equal(Object.hasOwn(calls[0].data, 'realName'), false);
  assert.equal(Object.hasOwn(calls[0].data, 'openId'), false);
  assert.equal(page.data.receiverVerified, false);
  assert.equal(page.data.receiverTypeIndex, -1);
});

test('收入页面说明手动提现与功能未开启，取消旧转账及冻结不混淆余额', () => {
  const template = fs.readFileSync(path.resolve(__dirname, '../../pages/managerIncome/managerIncome.wxml'), 'utf8');
  assert.match(template, /分账提现功能未开启/);
  assert.match(template, /income.manualWithdrawalAvailable/);
  assert.match(template, /income.profitSharingUnavailable/);
  assert.match(template, /income.profitSharingSettled/);
  assert.match(template, /income.legacyTransferHeld/);
  assert.match(template, /income.legacyTransferSettled/);
  assert.match(template, /item.debtOffsetAmount/);
  assert.match(template, /现金已付/);
  assert.match(template, /退款欠款抵扣/);
  assert.doesNotMatch(template, /income.withdrawalHeld|income.wechatSettled/);
  assert.match(template, /历史商家转账/);
  assert.doesNotMatch(template, /bindtap="withdraw"|bindtap="confirm"|realName|data-field="realName"/);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../../utils/managerFinance.js'), 'utf8'), /requestMerchantTransfer/);
});


test('管理员异常分账账单核验绑定原支付与接收人，不能套用历史转账CANCELLED', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', {
    get: async () => ({ id: '77', transactionId: 'wxT', outOrderNo: 'PS77', amount: '12.00', openId: 'mp本人', status: 'PROCESSING' })
  });
  page.setData({ userId: '42' });
  page.refresh = async () => {};
  await page.openReconciliation({ currentTarget: { dataset: { id: '77', channel: 'PROFIT_SHARING' } } });
  assert.equal(calls[0].url, '/stall-managers/42/profit-sharing/77/reconciliation');
  assert.equal(page.data.reconciliationKind, 'PROFIT_SHARING');
  page.setData({ reconciliationStatus: 'CANCELLED', verifiedMerchantBillNo: 'PS77', verifiedOpenId: 'mp本人',
    verifiedAmount: '12', verifiedTransactionId: 'wxT', proof: '商户原支付分账账单本人未到账凭证', reconciliationReason: '核对该接收人未付款' });
  await page.reconcileWithdrawal();
  assert.equal(calls.length, 1);
  assert.match(page.data.error, /通道/);
  page.setData({ reconciliationStatus: 'CLOSED' });
  await page.reconcileWithdrawal();
  const req = calls[1];
  assert.equal(req.method, 'post');
  assert.equal(req.url, '/stall-managers/42/profit-sharing/77/reconciliation');
  assert.equal(req.data.status, 'CLOSED');
  assert.equal(req.data.transactionId, 'wxT');
  assert.equal(req.data.outOrderNo, 'PS77');
  assert.equal(req.data.openId, 'mp本人');
  assert.equal(req.data.amount, '12.00');
  assert.equal(Object.hasOwn(req.data, 'verifiedMerchantBillNo'), false);
});


const manualPath = '/stall-managers/profit-sharing/withdrawals/mine';
function pendingWithdrawal(key, overrides = {}) {
  return { id: '9007199254740993', requestKey: key, status: 'PROCESSING', requestedAmount: '20', settledAmount: '0', heldAmount: '20', unpaidAmount: '20',
    items: [{ id: '1', orderId: '2', transactionId: 'wx2', snapshotAmount: '20', status: 'WAITING' }], ...overrides };
}

function readyAdminWithdrawal(page) {
  page.setData({ userId: '99', profile: { userId: '99', nickname: '测试负责人' }, tab: 'eligibility',
    income: { profitSharingEnabled: true, selfWithdrawalEnabled: false },
    rows: [{ orderId: '365088797156708352', availableAmount: '0.07', eligible: true },
      { orderId: '365088797156708353', availableAmount: '1.02', eligible: true },
      { orderId: '365088797156708354', availableAmount: '2.00', eligible: false }] });
  page.refresh = async () => {};
}

function readyOrderPayment(page, mode = 'OFFLINE') {
  readyAdminWithdrawal(page);
  page.setData({ tab: 'records', paymentVisible: true, settlementMode: mode, income: { profitSharingEnabled: true, settleableIncome: '100', selfWithdrawalEnabled: false },
    settlementRows: page.data.rows, paidDate: '2026-10-01', paidTime: '09:00', paidAt: '2026-10-01T09:00:00+08:00', paymentMethod: '银行转账', voucher: '流水001' });
}

test('线下付款按钮打开选单弹窗，接口按管理员目标与结算通道隔离', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { get: async url =>
    url.endsWith('/stalls') ? [{ id: '1', name: '一号档口' }, { id: '2', name: '二号档口' }]
      : { content: [{ orderId: '365088797156708352', orderStatus: 'completed', availableAmount: '0.07', eligible: true, settlementStatus: '可结算', items: [] }], totalPages: 1 } });
  readyAdminWithdrawal(page);page.setData({ tab: 'records' });
  await page.openSettlement({ currentTarget: { dataset: { mode: 'OFFLINE' } } });
  assert.equal(page.data.paymentVisible, true);assert.equal(page.data.settlementMode, 'OFFLINE');
  assert.equal(page.data.settlementStallOptions.length, 3);
  assert.equal(calls[1].url, '/stall-managers/99/settlement-orders');assert.equal(calls[1].data.channel, 'OFFLINE');
  assert.equal(page.data.settlementRows[0].orderStatusLabel, '已完成');
  page.closeSettlement();assert.equal(page.data.paymentVisible, false);
});

test('选单筛选按日期档口和商品关键词请求，筛选变化清空选择，分页保留已选合计', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { get: async (_, params) => ({
    content: [{ orderId: 'order-' + params.page, eligible: true, availableAmount: params.page === 1 ? '0.07' : '1.02' }], totalPages: 2 }) });
  readyOrderPayment(page);
  page.setData({ settlementStartDate: '2026-10-01', settlementEndDate: '2026-10-05', settlementKeyword: ' 白衬衫 ', settlementStallOptions: [{ value: '', label: '全部' }, { value: '9007199254740993', label: '档口' }], settlementStallIndex: 1 });
  await page.filterSettlementOrders();
  assert.equal(calls[0].data.stallId, '9007199254740993');assert.equal(calls[0].data.startDate, '2026-10-01');assert.equal(calls[0].data.endDate, '2026-10-05');assert.equal(calls[0].data.keyword, '白衬衫');
  page.withdrawalOrderChange({ detail: { value: ['order-1'] } });await page.loadMoreSettlementOrders();
  assert.equal(page.data.selectedWithdrawalTotal, '0.07');assert.equal(page.data.settlementRows.length, 2);
  page.withdrawalOrderChange({ detail: { value: ['order-1', 'order-2'] } });assert.equal(page.data.selectedWithdrawalTotal, '1.09');
  await page.resetSettlementFilters();assert.equal(page.data.selectedOrders.length, 0);assert.equal(calls[2].data.stallId, undefined);
});

test('选单截止日期错误不查询，已关闭弹窗的迟到响应不会覆盖页面', async () => {
  let done;
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { get: async () => new Promise(resolve => { done = resolve; }) });
  readyOrderPayment(page);page.setData({ settlementStartDate: '2026-10-05', settlementEndDate: '2026-10-01' });
  await page.loadSettlementOrders(true);assert.equal(calls.length, 0);assert.match(page.data.error, /开始日期/);
  page.setData({ settlementStartDate: '', settlementEndDate: '', settlementRows: [] });
  const request = page.loadSettlementOrders(true);await Promise.resolve();
  page.closeSettlement();done({ content: [{ orderId: 'late', eligible: true, availableAmount: '10' }], totalPages: 1 });await request;
  assert.equal(page.data.settlementRows.length, 0);assert.equal(page.data.paymentVisible, false);
});

test('线下选单自动计算总佣金并提交整单编号，图片选填，成功关闭弹窗', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  readyOrderPayment(page);page.withdrawalOrderChange({ detail: { value: ['365088797156708352', '365088797156708353', '365088797156708354'] } });
  page.setData({ voucherImages: ['https://example.com/receipt.jpg'] });
  await page.settleOffline();
  const request = calls.find(call => call.method === 'post');assert.equal(request.url, '/stall-managers/99/offline-settlements/by-orders');
  assert.deepEqual(Array.from(request.data.orderIds), ['365088797156708352', '365088797156708353']);assert.equal(request.data.expectedAmount, '1.09');
  assert.equal(request.data.allocations, undefined);assert.equal(request.data.amount, undefined);
  assert.deepEqual(Array.from(request.data.voucherImages), ['https://example.com/receipt.jpg']);
  assert.equal(page.data.paymentVisible, false);assert.equal(page.data.voucherImages.length, 0);
});

test('线下付款失败保留订单和凭证，未选择或取消确认不登记', async () => {
  const { page, calls, wx } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { post: async () => { throw new Error('金额已变化'); } });
  readyOrderPayment(page);await page.settleOffline();assert.equal(calls.length, 0);
  page.updateOrderSelection(['365088797156708352']);wx.showModal = options => options.success({ confirm: false });
  await page.settleOffline();assert.equal(calls.length, 0);
  wx.showModal = options => options.success({ confirm: true });await page.settleOffline();
  assert.equal(page.data.paymentVisible, true);assert.equal(page.data.voucher, '流水001');assert.equal(page.data.selectedOrders.length, 1);
});

test('凭证选择图片经管理员上传接口保存地址，可移除，上传失败保留已有凭证', async () => {
  const { page, calls, wx } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { upload: async () => ({ url: 'https://example.com/receipt-new.jpg' }) });
  readyOrderPayment(page);wx.chooseMedia = options => options.success({ tempFiles: [{ tempFilePath: '/tmp/image.jpg' }] });
  await page.uploadVoucherImages();assert.equal(calls[0].method, 'upload');assert.equal(calls[0].url, '/admin/files/upload');assert.equal(calls[0].data.dir, 'commission-vouchers');
  assert.deepEqual(Array.from(page.data.voucherImages), ['https://example.com/receipt-new.jpg']);
  page.removeVoucherImage({ currentTarget: { dataset: { index: 0 } } });assert.equal(page.data.voucherImages.length, 0);
  const failed = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { upload: async () => { throw new Error('上传失败'); } });
  readyOrderPayment(failed.page);failed.page.setData({ voucherImages: ['https://example.com/existing.jpg'] });failed.wx.chooseMedia = wx.chooseMedia;
  await failed.page.uploadVoucherImages();assert.equal(failed.page.data.voucherImages.length, 1);assert.match(failed.page.data.error, /上传失败/);
});

test('微信弹窗只允许核验成功订单被选中，分账提交使用同一订单选择', async () => {
  const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { post: async (_, data) => pendingWithdrawal(data.requestKey) });
  readyOrderPayment(page, 'WECHAT');page.withdrawalOrderChange({ detail: { value: ['365088797156708352', '365088797156708354'] } });
  await page.withdrawSelectedOrders();const request = calls.find(call => call.method === 'post');
  assert.deepEqual(Array.from(request.data.orderIds), ['365088797156708352']);assert.equal(page.data.paymentVisible, false);
});

test('缺失自助开关字段时负责人不能新提现，默认关闭并提示联系管理员', async () => {
  const { page, calls } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  readyToWithdraw(page);page.setData({ income: { profitSharingEnabled: true, manualWithdrawalAvailable: '20' } });
  await page.withdrawAll();assert.equal(calls.length, 0);assert.match(page.data.error, /未开启自助提现/);
});

test('管理员选单仅接受合格订单并按分汇总，订单ID保持字符串', () => {
  const { page } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  readyAdminWithdrawal(page);
  page.withdrawalOrderChange({ detail: { value: ['365088797156708352', '365088797156708353', '365088797156708354', '365088797156708352'] } });
  assert.deepEqual(Array.from(page.data.selectedOrders), ['365088797156708352', '365088797156708353']);
  assert.equal(page.data.selectedWithdrawalTotal, '1.09');
  page.selectWithdrawalOrders(); assert.equal(page.data.selectedOrders.length, 0);
  page.selectWithdrawalOrders(); assert.equal(page.data.selectedOrders.length, 2);
});

test('管理员代提现仅提交选定范围，关闭自助开关仍可代提，双击只提交一次', async () => {
  let complete;
  const response = new Promise(resolve => { complete = resolve; });
  const { page, calls, storage } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { post: async () => response });
  readyAdminWithdrawal(page);
  page.updateOrderSelection(['365088797156708352']);
  const first = page.withdrawSelectedOrders();
  await Promise.resolve(); await Promise.resolve();
  await page.withdrawSelectedOrders();
  const posts = calls.filter(call => call.method === 'post');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/stall-managers/99/profit-sharing/withdrawals');
  assert.deepEqual(Array.from(posts[0].data.orderIds), ['365088797156708352']);
  assert.deepEqual(Object.keys(posts[0].data).sort(), ['expectedAmount', 'orderIds', 'requestKey']);
  assert.equal(posts[0].data.expectedAmount, '0.07');
  assert.equal(posts[0].idempotencyKey, posts[0].data.requestKey);
  assert.equal(storage.get('adminManagerWithdrawal:42:99').requestKey, posts[0].data.requestKey);
  complete(pendingWithdrawal(posts[0].data.requestKey, { source: 'ADMIN' })); await first;
  assert.equal(page.data.currentWithdrawal.sourceLabel, '管理员代发起');
});

test('管理员提交超时重试保留原key及订单，未知结果不能清除本机记录', async () => {
  let attempts = 0;
  const { page, calls, storage } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', {
    get: async () => { throw { statusCode: 404 }; },
    post: async (_, body) => { if (++attempts === 1) throw new Error('timeout'); return pendingWithdrawal(body.requestKey); }
  });
  readyAdminWithdrawal(page);page.updateOrderSelection(['365088797156708352']);
  await page.withdrawSelectedOrders();
  const original = page.data.pendingAdminRequest;
  await page.queryAdminWithdrawal();await page.clearMissingAdminWithdrawal();
  assert.equal(page.data.pendingAdminRequest.requestKey, original.requestKey);
  assert.ok(storage.get('adminManagerWithdrawal:42:99'));
  page.withdrawalOrderChange({ detail: { value: ['365088797156708353'] } });
  await page.withdrawSelectedOrders();
  const posts = calls.filter(call => call.method === 'post');
  assert.equal(posts.length, 2);assert.equal(posts[0].data.requestKey, posts[1].data.requestKey);
  assert.deepEqual(Array.from(posts[1].data.orderIds), ['365088797156708352']);
});

test('管理员已受理或查询未知的原申请不会重提，恢复和查看只GET', async () => {
  const key = 'mw_admin_recover_123456789';
  for (const unknown of [false, true]) {
    const { page, calls } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', {
      get: async () => { if (unknown) throw new Error('network'); return pendingWithdrawal(key); }
    });
    readyAdminWithdrawal(page);page.setData({ pendingAdminRequest: { requestKey: key, orderIds: ['365088797156708352'] } });
    await page.withdrawSelectedOrders();await page.clearMissingAdminWithdrawal();
    assert.equal(calls.filter(call => call.method === 'post').length, 0);
    assert.equal(page.data.pendingAdminRequest.requestKey, key);
  }
});

test('管理员取消或存储失败不提交资金请求，非管理员不能代提或改开关', async () => {
  const { page, calls, wx } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js');
  readyAdminWithdrawal(page);page.updateOrderSelection(['365088797156708352']);
  wx.showModal = options => options.success({ confirm: false });
  await page.withdrawSelectedOrders();assert.equal(calls.length, 0);
  wx.showModal = options => options.success({ confirm: true });
  wx.setStorageSync = () => { throw new Error('存储失败'); };
  await page.withdrawSelectedOrders();assert.equal(calls.length, 0);
  const denied = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { manager: true });
  readyAdminWithdrawal(denied.page);denied.page.updateOrderSelection(['365088797156708352']);
  await denied.page.withdrawSelectedOrders();await denied.page.toggleSelfWithdrawal({ detail: { value: true } });
  assert.equal(denied.calls.length, 0);assert.match(denied.page.data.error, /仅管理员/);
});

test('管理员明确拒绝且查询404才可重新选单，重试超时会撤销拒绝标记', async () => {
  let attempts = 0;
  const { page, storage } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', {
    get: async () => { throw { statusCode: 404 }; },
    post: async () => { if (++attempts === 1) throw { statusCode: 400, message: '订单已不合格' }; throw new Error('timeout'); }
  });
  readyAdminWithdrawal(page);page.updateOrderSelection(['365088797156708352']);
  await page.withdrawSelectedOrders();assert.equal(page.data.pendingAdminRequest.rejected, true);
  await page.queryAdminWithdrawal();await page.clearMissingAdminWithdrawal();
  assert.equal(page.data.pendingAdminRequest, null);assert.equal(storage.get('adminManagerWithdrawal:42:99'), null);
  page.updateOrderSelection(['365088797156708353']);await page.withdrawSelectedOrders();
  assert.equal(page.data.pendingAdminRequest.rejected, false);
  await page.clearMissingAdminWithdrawal();assert.ok(page.data.pendingAdminRequest);
});

test('自助开关关闭会拦住负责人新提交，已有申请仍可查询', async () => {
  const { page, calls } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  readyToWithdraw(page);page.setData({ 'income.selfWithdrawalEnabled': false });
  await page.withdrawAll();assert.equal(calls.length, 0);assert.match(page.data.error, /未开启自助提现/);
  const key = 'mw_disabled_read_12345678';
  page.setData({ pendingRequestKey: key });
  page.acceptRequest(pendingWithdrawal(key));
  assert.equal(page.data.currentRequest.status, 'PROCESSING');
});

test('管理员开关请求单独作用于负责人，取消或接口失败会恢复显示状态', async () => {
  const { page, calls, wx } = pageHarness('../../pages/stallManagerDetail/stallManagerDetail.js', { put: async () => { throw new Error('保存失败'); } });
  readyAdminWithdrawal(page);page.setData({ selfWithdrawalChecked: false });
  wx.showModal = options => options.success({ confirm: false });
  await page.toggleSelfWithdrawal({ detail: { value: true } });
  assert.equal(calls.length, 0);assert.equal(page.data.selfWithdrawalChecked, false);
  wx.showModal = options => options.success({ confirm: true });
  await page.toggleSelfWithdrawal({ detail: { value: true } });
  assert.equal(calls[0].url, '/stall-managers/99/self-withdrawal');
  assert.deepEqual(Object.keys(calls[0].data), ['enabled']);assert.equal(calls[0].data.enabled, true);
  assert.equal(page.data.selfWithdrawalChecked, false);
});
function readyToWithdraw(page) {
  page.setData({ profile: { userId: '42', active: false }, income: { selfWithdrawalEnabled: true, profitSharingEnabled: true, manualWithdrawalAvailable: '20' } });
  page.restoreRequestPointer();
}

test('未点击和刷新返回只GET恢复原申请，订单完成或负责人下线都不自动POST', async () => {
  const key = 'mw_cached_key_1234567890';
  const { page, calls, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', {
    manager: true, get: async url => {
      if (url === '/stall-managers/mine') return { userId: '42', active: false };
      if (url === '/stall-managers/income/mine') return { profitSharingEnabled: true, manualWithdrawalAvailable: '20' };
      if (url.includes('/by-key/')) return pendingWithdrawal(key);
      return { content: [], totalPages: 1 };
    }
  });
  storage.set('managerWithdrawalRequest:42', { requestKey: key });
  await page.onLoad();
  await page.onShow();
  assert.equal(calls.every(call => call.method === 'get'), true);
  assert.equal(page.data.pendingRequestKey, key);
  assert.equal(page.data.currentRequest.status, 'PROCESSING');
  assert.equal(page.data.profile.active, false);
});

test('一键提现全部仅明确确认POST，双击只发一次，body和幂等头同key不输入任意金额', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const { page, calls, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true, post: async () => pending });
  readyToWithdraw(page);
  page.refresh = async () => {};
  const first = page.withdrawAll();
  await Promise.resolve(); await Promise.resolve();
  await page.withdrawAll();
  const posts = calls.filter(call => call.method === 'post');
  assert.equal(posts.length, 1);
  const key = posts[0].data.requestKey;
  assert.match(key, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(posts[0].idempotencyKey, key);
  assert.equal(Object.keys(posts[0].data).length, 1);
  assert.equal(storage.get('managerWithdrawalRequest:42').requestKey, key);
  complete(pendingWithdrawal(key)); await first;
  assert.equal(page.data.currentRequest.status, 'PROCESSING');
  assert.equal(page.data.pendingRequestKey, key);
});

test('用户取消确认不POST不存申请，存储失败也不能先发资金请求', async () => {
  const { page, calls, wx, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  readyToWithdraw(page);
  wx.showModal = options => options.success({ confirm: false });
  await page.withdrawAll();
  assert.equal(calls.length, 0); assert.equal(storage.size, 0);
  wx.showModal = options => options.success({ confirm: true });
  wx.setStorageSync = () => { throw new Error('本地持久化不可用'); };
  await page.withdrawAll();
  assert.equal(calls.length, 0); assert.match(page.data.error, /持久化/);
});

test('POST超时保留原key，查询404后仅再次用户确认才同key提交，不因刷新生成新申请', async () => {
  let count = 0;
  const { page, calls, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', {
    manager: true, get: async () => { throw { statusCode: 404 }; },
    post: async (_, body) => { count++; if (count === 1) throw new Error('timeout'); return pendingWithdrawal(body.requestKey); }
  });
  readyToWithdraw(page); page.refresh = async () => {};
  await page.withdrawAll();
  const key = page.data.pendingRequestKey;
  assert.ok(key); assert.equal(page.data.requestUncertain, true);
  await page.recoverRequest();
  assert.equal(page.data.requestMissing, true);
  assert.equal(calls.filter(call => call.method === 'post').length, 1);
  await page.withdrawAll();
  const posts = calls.filter(call => call.method === 'post');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].data.requestKey, posts[1].data.requestKey);
  assert.equal(posts[0].idempotencyKey, posts[1].idempotencyKey);
  assert.equal(storage.get('managerWithdrawalRequest:42').requestKey, key);
});

test('提交返回丢失而by-key已有单时重试只查原申请，unknown与held不清持久key', async () => {
  let key;
  const { page, calls } = pageHarness('../../pages/managerIncome/managerIncome.js', {
    manager: true, get: async () => pendingWithdrawal(key, { status: 'FUTURE_STATE' }),
    post: async (_, body) => { key = body.requestKey; throw new Error('connection lost'); }
  });
  readyToWithdraw(page); page.refresh = async () => {};
  await page.withdrawAll(); await page.withdrawAll();
  assert.equal(calls.filter(call => call.method === 'post').length, 1);
  assert.equal(page.data.pendingRequestKey, key);
  assert.equal(page.data.currentRequest.terminal, false);
  assert.match(page.data.currentRequest.statusLabel, /待查询/);
});

test('后台SUCCESS到账才展示到账，PARTIAL分清已付和未付，终态才清key且不触发下一次申请', async () => {
  const { page, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  readyToWithdraw(page);
  const key = 'mw_terminal_key_123456789';
  page.rememberRequest(key);
  page.acceptRequest(pendingWithdrawal(key, { status: 'PARTIAL', settledAmount: '5', heldAmount: '0', unpaidAmount: '15' }));
  assert.equal(page.data.currentRequest.statusLabel, '部分到账，请核对快照差额');
  assert.equal(page.data.currentRequest.settledAmount, '5');
  assert.equal(page.data.currentRequest.unpaidAmount, '15');
  assert.equal(page.data.pendingRequestKey, '');
  assert.equal(storage.get('managerWithdrawalRequest:42'), null);
  const success = finance.withdrawalRequestRow(pendingWithdrawal(key, { status: 'SUCCESS', heldAmount: '0', settledAmount: '20', unpaidAmount: '0' }));
  assert.equal(success.statusLabel, '全部到账');
  assert.equal(finance.withdrawalRequestRow(pendingWithdrawal(key, { status: 'SUCCESS', heldAmount: '1' })).terminal, false);
});

test('本地申请仅profile.userId字符串scope，切账号不承接另一用户key，旧profile禁止POST', async () => {
  const { page, calls, auth, storage } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true });
  readyToWithdraw(page);
  page.rememberRequest('mw_owner42_key_123456789');
  auth.getUserInfo = () => ({ userId: '43' });
  await page.withdrawAll(); assert.equal(calls.length, 0);
  assert.match(page.data.error, /账号已经变化/);
  page.setData({ profile: { userId: '43' } }); page.restoreRequestPointer();
  assert.equal(page.data.pendingRequestKey, '');
  assert.equal(storage.get('managerWithdrawalRequest:42').requestKey, 'mw_owner42_key_123456789');
});


test('by-key查询网络失败不会POST也不换key，不同POST返回key保留原提交待核对', async () => {
  const key = 'mw_queryfail_key_123456789';
  const lookup = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true, get: async () => { throw new Error('network'); } });
  readyToWithdraw(lookup.page); lookup.page.rememberRequest(key);
  await lookup.page.withdrawAll();
  assert.equal(lookup.calls.filter(call => call.method === 'post').length, 0);
  assert.equal(lookup.page.data.pendingRequestKey, key);
  assert.equal(lookup.page.data.requestUncertain, true);
  const mismatch = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true,
    post: async () => pendingWithdrawal('mw_mismatch_key_123456789', { status: 'SUCCESS', heldAmount: '0' }) });
  readyToWithdraw(mismatch.page);
  await mismatch.page.withdrawAll();
  const posted = mismatch.calls.find(call => call.method === 'post').data.requestKey;
  assert.equal(mismatch.page.data.pendingRequestKey, posted);
  assert.equal(mismatch.storage.get('managerWithdrawalRequest:42').requestKey, posted);
  assert.match(mismatch.page.data.error, /不一致/);
});

test('申请记录一基分页和逐单状态只来自服务器，管理页使用独立选单提现入口', async () => {
  const { page, calls } = pageHarness('../../pages/managerIncome/managerIncome.js', { manager: true,
    get: async (_, params) => ({ content: [pendingWithdrawal('mw_list_key_123456789', { id: String(params.page) })], totalPages: 2 }) });
  page.setData({ tab: 'requests' });
  await page.loadList(true); await page.loadList(false);
  assert.deepEqual(calls.map(call => call.data.page), [1, 2]);
  assert.equal(page.data.rows[0].statusLabel, '提现处理中');
  assert.equal(page.data.rows[0].items[0].statusLabel, '申请已记录，等待处理');
  assert.equal(page.data.rows[0].settledAmount, '0');
  const own = fs.readFileSync(path.resolve(__dirname, '../../pages/managerIncome/managerIncome.wxml'), 'utf8');
  assert.match(own, /bindtap="withdrawAll"/);
  assert.match(own, /currentRequest.items/);
  assert.match(own, /快照未到账/);
  assert.match(own, /不代表仍然应付/);
  assert.doesNotMatch(own, /data-field="amount"|data-field="openId"|data-field="realName"/);
  const admin = fs.readFileSync(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.wxml'), 'utf8');
  assert.doesNotMatch(admin, /bindtap="withdrawAll"/);
  assert.match(admin, /bindtap="withdrawSelectedOrders"/);
  assert.match(admin, /bindchange="toggleSelfWithdrawal"/);
  assert.doesNotMatch(admin, /自动分账会|自动分账功能/);
});
