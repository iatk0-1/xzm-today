const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ manager = false, data = {}, record = {}, rules, preview, save } = {}) {
  let stored = { id: '9007199254740993123', version: 7, draftType: 'create',
    clientDraftKey: 'client-draft-key', contextToken: 'baseline', capabilities: { edit: true },
    draftData: { title: '花棉袄', pricingRuleId: '30', pricingRuleName: '基础规则', selectedStalls: [{ id: '22' }],
      skuList: [{ skuId: '11', costPrice: '10', price: '88', stock: '0', image: 'https://cdn.example.com/a.jpg' },
        { skuId: '12', costPrice: '20', price: '99', stock: '' }], ...data }, ...record };
  const calls = [], writes = [], receipts = new Map();
  let serial = 0;
  const active = rules || [{ id: '30', name: '基础规则', enabled: true, currentVersion: 2,
    segments: [{ lower: 0, upper: null, formula: 'x+5' }] }, { id: '31', name: '新规则', enabled: true, currentVersion: 1,
    segments: [{ lower: 0, upper: null, formula: 'x+8' }] }];
  const api = {
    get: async url => {
      calls.push(['get', url]);
      if (url === '/pricing-rules' || url.startsWith('/stalls/')) return structuredClone(active);
      return structuredClone(active.find(rule => String(rule.id) === url.split('/').at(-1)));
    },
    post: async (url, body) => {
      calls.push(['post', url, structuredClone(body)]);
      return preview ? preview(body) : { price: (Number(body.cost) + (body.segments[0].formula === 'x+8' ? 8 : 5)).toFixed(2) };
    }
  };
  const draft = { ...require('../../utils/draft'),
    loadDraft: async () => structuredClone(stored), context: async () => ({ token: 'new-baseline' }),
    createKey: () => 'save-key-' + (++serial),
    saveDraft: async (value, upload, options) => {
      const request = { data: structuredClone(value), options: { ...options, mediaCache: undefined } };
      writes.push(request);
      if (receipts.has(options.requestKey)) return structuredClone(receipts.get(options.requestKey));
      if (String(options.version) !== String(stored.version)) throw { statusCode: 409, message: '草稿版本冲突' };
      stored = { ...stored, draftData: structuredClone(value), version: stored.version + 1, savedAt: '2026-10-18T00:00:00Z' };
      receipts.set(options.requestKey, structuredClone(stored));
      if (save) await save(request);
      return structuredClone(stored);
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/productDraftPricing.js'), 'utf8'), {
    module, console, require(name) {
      if (name === './api') return api;
      if (name === './auth') return { isAdmin: () => !manager, isStallManager: () => manager };
      if (name === './draft') return draft;
      return require('../../utils/' + name.slice(2));
    }
  });
  const editor = module.exports.createDraftPricingEditor();
  return { editor, calls, writes, load: () => editor.load({ id: stored.id, version: 7 }), record: () => stored };
}

test('普通草稿统一全部SKU成本后重算售价，保留SKU身份、库存、图片和其他资料', async () => {
  const env = harness({ data: { description: '原详情', selectedTags: [{ id: '88' }] } });
  const model = await env.load();
  assert.equal(model.mixedCosts, true);
  const result = await env.editor.save(model, { costInput: '12.5', costChanged: true, ruleId: '30', ruleChanged: false });
  assert.equal(result.version, 8);
  const data = result.draftData;
  assert.equal(data.costPrice, '12.50');
  assert.equal(data.skuList[0].costPrice, '12.50');assert.equal(data.skuList[1].costPrice, '12.50');
  assert.equal(data.skuList[0].price, '17.50');assert.equal(data.skuList[1].price, '17.50');
  assert.equal(data.skuList[0].skuId, '11');assert.equal(data.skuList[0].stock, '0');assert.equal(data.skuList[1].stock, '');
  assert.equal(data.skuList[0].image, 'https://cdn.example.com/a.jpg');assert.equal(data.description, '原详情');
  assert.equal(data.selectedTags[0].id, '88');
  assert.equal(data.pricingRuleVersion, 2);
  assert.equal(env.calls.filter(call => call[0] === 'post').length, 1);
  assert.equal(env.writes[0].options.clientDraftKey, 'client-draft-key');
  assert.equal(env.writes[0].options.contextToken, 'baseline');
});

for (const type of ['create', 'edit', 'convert', 'live_create', 'live_edit']) {
  test(`${type}套装各组统一成本和规则，当前组与草稿主SKU保持一致且已删除规格不改`, async () => {
    const env = harness({ record: { draftType: type, relatedId: type.includes('edit') || type === 'convert' ? '100' : null,
      sessionId: type.startsWith('live_') ? '66' : null }, data: { isBundleMode: true, activeGroupIndex: 1,
      bundleGroups: [{ id: '77', name: '上衣', skuList: [{ skuId: '11', costPrice: '10', price: '88' }] },
        { id: '78', name: '裤子', skuList: [{ skuId: '12', costPrice: '20', price: '99' },
          { skuId: '13', costPrice: '无效成本', price: '1', _toBeRemoved: true }] }] } });
    const model = await env.load();
    const result = await env.editor.save(model, { costInput: '30', costChanged: true, ruleId: '31', ruleChanged: true });
    assert.equal(result.draftData.bundleGroups[0].skuList[0].price, '38.00');
    assert.equal(result.draftData.bundleGroups[1].skuList[0].costPrice, '30.00');
    assert.equal(result.draftData.bundleGroups[1].skuList[1].costPrice, '无效成本');
    assert.equal(result.draftData.skuList[0].price, '38.00');
    assert.equal(result.draftData.pricingRuleName, '新规则');
    assert.equal(env.writes[0].options.relatedId, env.record().relatedId);
    assert.equal(env.writes[0].options.sessionId, env.record().sessionId);
  });
}

test('仅切换规则保留各SKU原成本，分别计算售价，空成本规格留待补齐', async () => {
  const env = harness({ data: { skuList: [{ costPrice: '10', price: '99' }, { costPrice: '20', price: '99' }, { costPrice: '', price: '' }] } });
  const model = await env.load();
  const record = await env.editor.save(model, { costChanged: false, ruleChanged: true, ruleId: '31' });
  assert.equal(record.draftData.skuList[0].costPrice, '10.00');
  assert.equal(record.draftData.skuList[1].costPrice, '20.00');
  assert.equal(record.draftData.skuList[0].price, '18.00');assert.equal(record.draftData.skuList[1].price, '28.00');
  assert.equal(record.draftData.skuList[2].price, '');
});

test('先填成本再选规则可分步保存，空白草稿也能设置规则但不伪造规格', async () => {
  const env = harness({ data: { pricingRuleId: '', pricingRuleName: '', skuList: [{ costPrice: '', price: '88' }] } });
  const model = await env.load();
  await env.editor.save(model, { costInput: '20', costChanged: true, ruleId: '', ruleChanged: false });
  assert.equal(model.record.draftData.skuList[0].price, '88');
  await env.editor.save(model, { costChanged: false, ruleId: '30', ruleChanged: true });
  assert.equal(model.record.draftData.skuList[0].price, '25.00');
  const blank = harness({ data: { skuList: [] } });
  const blankModel = await blank.load();
  await blank.editor.save(blankModel, { costInput: '10', costChanged: true, ruleId: '30', ruleChanged: true });
  assert.equal(blankModel.record.draftData.skuList.length, 0);
  assert.equal(blankModel.record.draftData.costPrice, '10.00');
});

test('管理员规则只加载一次且过滤禁用项，负责人仅使用对应档口分配的规则', async () => {
  const disabled = { id: '40', name: '禁用规则', enabled: false };
  const env = harness({ rules: [disabled] });
  const first = await env.load();await env.load();
  assert.equal(first.rules.length, 1);assert.equal(first.rules[0].id, '');
  assert.equal(env.calls.filter(call => call[1] === '/pricing-rules').length, 1);
  env.editor.resetRules();await env.load();
  assert.equal(env.calls.filter(call => call[1] === '/pricing-rules').length, 2);
  const manager = harness({ manager: true });const managed = await manager.load();
  assert.ok(managed.rules.every(rule => rule.id !== ''));
  assert.equal(manager.calls[0][1], '/stalls/22/pricing-rules');
  await assert.rejects(manager.editor.save(managed, { costInput: '10', costChanged: true, ruleId: '999', ruleChanged: true }), /规则已失效/);
  assert.equal(manager.writes.length, 0);
  assert.equal(manager.calls.some(call => call[1] === '/pricing-rules' || call[1] === '/pricing-rules/999'), false);
});

test('成本不合法、规则失效、售价预览失败时不保存半份改动', async () => {
  for (const value of ['', '0', '-1', '1.001']) {
    const env = harness();const model = await env.load();
    await assert.rejects(env.editor.save(model, { costInput: value, costChanged: true, ruleId: '30' }));
    assert.equal(env.writes.length, 0);
  }
  const invalid = harness({ rules: [{ id: '30', enabled: false, segments: [{ formula: 'x' }] }] });
  await assert.rejects(invalid.editor.save(await invalid.load(), { costInput: '10', costChanged: true, ruleId: '30' }), /规则已失效/);
  assert.equal(invalid.writes.length, 0);
  const failed = harness({ preview: async () => { throw new Error('计价服务暂不可用'); } });
  await assert.rejects(failed.editor.save(await failed.load(), { costInput: '10', costChanged: true, ruleId: '30' }), /计价服务暂不可用/);
  assert.equal(failed.writes.length, 0);
});

test('保存响应丢失后先原样重试，再用新版本保存后续成本，不能覆盖其他内容', async () => {
  let count = 0;
  const env = harness({ save: async () => { if (++count === 1) throw new Error('网络超时'); } });
  const model = await env.load();
  const changes = { costInput: '20', costChanged: true, ruleId: '30' };
  await assert.rejects(env.editor.save(model, changes), /网络超时/);
  await env.editor.save(model, { ...changes, costInput: '30' });
  assert.equal(env.writes[0].options.requestKey, env.writes[1].options.requestKey);
  assert.deepEqual(env.writes[0].data, env.writes[1].data);
  assert.notEqual(env.writes[1].options.requestKey, env.writes[2].options.requestKey);
  assert.equal(env.writes[2].options.version, 8);
  assert.equal(model.record.version, 9);
  assert.equal(model.record.draftData.skuList[0].costPrice, '30.00');
});

test('旧版本草稿与不可编辑草稿不能加载设置，缺少编辑基线不能越过核对直接保存', async () => {
  const changed = harness({ record: { version: 8 } });
  await assert.rejects(changed.load(), /草稿已更新/);
  const readonly = harness({ record: { capabilities: { edit: false }, warnings: ['直播场次已结束'] } });
  await assert.rejects(readonly.load(), /直播场次已结束/);
  const legacy = harness({ record: { draftType: 'edit', relatedId: '100', contextToken: null } });
  await assert.rejects(legacy.editor.save(await legacy.load(), { costInput: '10', costChanged: true, ruleId: '30' }), /核对当前商品/);
  assert.equal(legacy.writes.length, 0);
});
