const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ type = 'create', manager = false, data = {}, record = {}, get, submit } = {}) {
  const calls = [], submissions = [];
  const row = { id: '9007199254740993123', version: 7, draftType: type,
    relatedId: ['edit', 'live_edit', 'convert'].includes(type) ? '9007199254740993222' : null,
    sessionId: type.startsWith('live_') ? '66' : null, contextToken: 'baseline',
    capabilities: { edit: true }, draftData: { title: '花棉袄',
      mediaList: [{ url: 'https://cdn.example.com/cover.jpg' }], selectedStalls: [{ id: '22' }],
      skuList: [{ color: '红', size: 'M', price: '19.90', costPrice: '10', stock: '0' }], ...data }, ...record };
  const api = { get: async url => {
    calls.push(['get', url]);
    return get ? get(url) : { enabled: true, segments: [{ lower: 0, upper: null, formula: 'x+5' }] };
  }, post: async (url, body) => {
    calls.push(['post', url, body]);return { price: (Number(body.cost) + 5).toFixed(2) };
  } };
  const sourceDraft = require('../../utils/draft');
  let sequence = 0;
  const draft = { ...sourceDraft,
    loadDraft: async id => { calls.push(['load', id]);return row; },
    context: async context => { calls.push(['context', context]);return { token: 'new-baseline' }; },
    createKey: () => 'request-' + (++sequence),
    submit: async body => { submissions.push(structuredClone(body));return submit ? submit(body) : { product: { id: 'new-product' } }; }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/productDraftPublisher.js'), 'utf8'), {
    module, console, require(name) {
      if (name === './api') return api;
      if (name === './auth') return { isAdmin: () => !manager, isStallManager: () => manager, getUserInfo: () => ({ userId: '42' }) };
      if (name === './draft') return draft;
      return require('../../utils/' + name.slice(2));
    }
  });
  return { publish: () => module.exports.publishDraft({ id: row.id, version: 7 }), row, calls, submissions };
}

for (const type of ['create', 'edit', 'convert', 'live_create', 'live_edit']) {
  test(`${type}草稿直接保存发布，携带来源、版本和原始大整数ID`, async () => {
    const env = harness({ type, data: { pricingRuleId: '30', skuList: [
      { skuId: '9007199254740993333', bundleGroupId: '77', price: '19.90', costPrice: '10', stock: '0' }
    ] } });
    await env.publish();
    const body = env.submissions[0];
    assert.equal(body.draftType, type);
    assert.equal(body.sourceDraftId, '9007199254740993123');
    assert.equal(body.sourceDraftVersion, 7);
    assert.equal(body.relatedId, env.row.relatedId);
    assert.equal(body.sessionId, env.row.sessionId);
    assert.equal(body.contextToken, 'baseline');
    assert.equal(body.productData.status, 'on');
    assert.equal(body.productData.skus[0].stockMain, 0);
    assert.equal(body.productData.skus[0].isUnlimitedStock, false);
    assert.equal(body.productData.skus[0].retailPrice, type.startsWith('live_') ? 15 : 19.9);
    assert.equal(body.productData.skus[0].id, ['edit', 'live_edit'].includes(type) ? '9007199254740993333' : undefined);
  });
}

test('管理员普通商品保留手填价和高级资料，视频封面、零库存与无限库存分别保留', async () => {
  const env = harness({ data: { mediaList: [], videoUrl: 'https://cdn.example.com/video.mp4',
    videoThumbPath: 'https://cdn.example.com/thumb.jpg', useVideoCover: true,
    skuList: [{ price: '19.90', stock: '' }],
    description: '商品详情', shippingInfo: '48小时', purchaseNotice: '购买须知',
    manualRelated: [{ id: '9007199254740993666' }], lookbookImgs: ['https://cdn.example.com/look.jpg'],
    productScheduleDirty: true, productSchedule: { enabled: true } } });
  await env.publish();
  const body = env.submissions[0].productData;
  assert.equal(body.coverUrl, 'https://cdn.example.com/thumb.jpg');
  assert.equal(body.useVideoCover, true);
  assert.equal(body.skus[0].costPrice, null);
  assert.equal(body.skus[0].isUnlimitedStock, true);
  assert.equal(body.description, '商品详情');
  assert.equal(body.shippingInfo, '48小时');
  assert.equal(body.relatedProductIds[0], '9007199254740993666');
  assert.equal(body.schedule.enabled, true);
  assert.equal(env.calls.some(call => call[0] === 'post'), false);
});

test('负责人按当前分配规则重算每组成本，套装新建保留分组、编辑保留SKU身份', async () => {
  for (const type of ['create', 'edit']) {
    const env = harness({ type, manager: true, get: async () => [{ id: '30', enabled: true,
      segments: [{ lower: 0, upper: null, formula: 'x+5' }] }], data: { pricingRuleId: '30', isBundleMode: true,
      bundleGroups: [{ id: '77', name: '上衣', skuList: [{ skuId: '11', price: '99', costPrice: '10', stock: '0' }] },
        { id: '78', name: '裤子', skuList: [{ skuId: '12', price: '99', costPrice: '20', stock: '' },
          { costPrice: '坏成本', _toBeRemoved: true }] }] } });
    await env.publish();
    const body = env.submissions[0].productData;
    assert.equal(body.retailPrice, 15);
    assert.equal(body.displayPrice, '15 - 25');
    if (type === 'create') {
      assert.equal(body.skus.length, 0);
      assert.equal(body.bundleGroups[1].skus[0].retailPrice, 25);
      assert.equal(body.bundleGroups[1].skus[0].id, undefined);
    } else {
      assert.equal(body.bundleGroups, undefined);
      assert.equal(body.skus[0].id, '11');assert.equal(body.skus[1].bundleGroupId, '78');
    }
  }
});

test('草稿版本变化、不可编辑、空白资料、媒体未上传、非法价格库存均不提交', async () => {
  const cases = [
    { record: { version: 8 } }, { record: { capabilities: { edit: false }, warnings: ['来源商品已删除'] } },
    { data: { title: '' } }, { data: { mediaList: [] } },
    { data: { mediaList: [{ url: 'http://tmp/cover.jpg' }] } },
    { data: { skuList: [{ price: '0', costPrice: '10' }] } },
    { data: { skuList: [{ price: '10', stock: '-1' }] } },
    { type: 'edit', record: { contextToken: null } }
  ];
  for (const options of cases) {
    const env = harness(options);
    await assert.rejects(env.publish());
    assert.equal(env.submissions.length, 0);
  }
});

test('发布超时重试原样重发同一请求，不能因草稿或规则变化另建商品', async () => {
  let count = 0;
  const env = harness({ submit: async () => {
    if (++count === 1) throw new Error('网络超时');
    return { product: { id: 'already-created' } };
  } });
  await assert.rejects(env.publish(), /网络超时/);
  env.row.draftData.title = '超时后的新内容';
  await env.publish();
  assert.deepEqual(env.submissions[0], env.submissions[1]);
  assert.equal(env.calls.filter(call => call[0] === 'load').length, 1);
});

test('新增历史草稿可补发上下文，负责人禁用规则不能发布，已有商品可保留原规则快照', async () => {
  const legacy = harness({ record: { contextToken: null } });
  await legacy.publish();
  assert.equal(legacy.submissions[0].contextToken, 'new-baseline');
  const inactive = { id: '30', enabled: false, segments: [{ formula: 'x+99' }] };
  const create = harness({ manager: true, data: { pricingRuleId: '30' }, get: async () => [inactive] });
  await assert.rejects(create.publish(), /规则已失效/);
  const edit = harness({ type: 'edit', manager: true, data: { pricingRuleId: '30' }, get: async url =>
    url.startsWith('/products/') ? { product: { stallIds: ['22'] }, pricingRuleId: '30',
      pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }] } : [inactive] });
  await edit.publish();
  assert.equal(edit.submissions[0].productData.skus[0].retailPrice, 15);
});

test('普通商品草稿发布时保存选填货号并去掉首尾空格，缺失字段兼容旧草稿', async () => {
  const withArticle = harness({ data: { articleNo: ' HN-001 ' } });
  await withArticle.publish();
  assert.equal(withArticle.submissions[0].productData.articleNo, 'HN-001');
  const legacy = harness();
  await legacy.publish();
  assert.equal(legacy.submissions[0].productData.articleNo, '');
});
