const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ live = false, options = {}, saved = [], upload, submit, failSave, beforeList, beforeDetail } = {}) {
  const rows = new Map(saved.map(row => [String(row.id), structuredClone(row)]));
  const requests = [], modals = [], events = [];
  let definition, serial = 10 + saved.length;
  const wx = {
    showModal(value) { modals.push(value); }, showToast(value) { events.push(['toast', value.title]); },
    showLoading() {}, hideLoading() {}, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
    navigateBack() { events.push(['back']); }, redirectTo(value) { events.push(['redirect', value.url]); },
    navigateTo(value) { events.push(['navigate', value.url]); }, reLaunch() {}
  };
  const api = {
    async get(url) {
      requests.push(['get', url]);
      if (url.includes('/context?')) return { token: 'server-context', sessionId: options.sessionId || null };
      if (url.includes('/summary')) return { total: rows.size };
      if (url.includes('/drafts/v2?')) {
        if (beforeList) await beforeList();
        const query = new URL('https://example.com' + url).searchParams;
        const filtered = [...rows.values()].filter(row => row.draftType === query.get('draftType')
          && (!query.has('relatedId') || String(row.relatedId) === query.get('relatedId'))
          && (!query.has('sessionId') || String(row.sessionId) === query.get('sessionId')))
          .sort((a, b) => Date.parse(b.savedAt || 0) - Date.parse(a.savedAt || 0));
        return { content: filtered.slice(0, Number(query.get('size') || 20)) };
      }
      if (beforeDetail) await beforeDetail();
      return rows.get(decodeURIComponent(url.split('/').at(-1)));
    },
    async post(url, body) {
      requests.push(['post', url, structuredClone(body)]);
      if (url === '/product-submissions/v2') return submit ? submit(body) : { product: { id: 'new-product' } };
      if (failSave) await failSave(body);
      const row = { ...structuredClone(body), id: String(++serial), version: 1, savedAt: '2026-10-17T04:00:00Z' };
      rows.set(row.id, row); return row;
    },
    async put(url, body) {
      requests.push(['put', url, structuredClone(body)]);
      if (failSave) await failSave(body);
      const id = url.split('/').at(-1), old = rows.get(id);
      const row = { ...old, ...structuredClone(body), id, version: Number(old.version) + 1, savedAt: '2026-10-17T05:00:00Z' };
      rows.set(id, row); return row;
    }
  };
  const draftModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/draft.js'), 'utf8'), {
    module: draftModule, require: () => api, console, URL, Map, Set
  });
  const draft = draftModule.exports;
  const exitModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/productDraftExit.js'), 'utf8'), {
    module: exitModule, wx, console: { error() {}, warn() {} }, getCurrentPages: () => [{}, {}],
    require(name) { return name === './draft' ? draft : name === './auth'
      ? { ensureAuthenticated: async () => {} } : require('../../utils/error'); }
  });
  definition = {
    data: { title: '', mediaList: [], lookbookImgs: [], detailImgs: [], skuList: [], selectedStalls: [],
      selectedTags: [], bundleGroups: [], colors: [], sizeOptions: [], activeGroupIndex: -1, isBundleMode: false },
    async onLoad(value) { this.options = value; }, onUnload() {},
    collectDraftData() { const { title, mediaList, lookbookImgs, detailImgs, skuList } = this.data; return { title, mediaList, lookbookImgs, detailImgs, skuList }; },
    restoreDraft(value) { this.setData(value); },
    async loadProductForEdit() { this.setData({ title: '当前商品' }); },
    uploadFile: upload || (async local => 'https://example.com/' + encodeURIComponent(local))
  };
  if (live) definition.getDraftType = function() { return options.productId ? 'live_edit' : 'live_create'; };
  exitModule.exports.integrateProductDraftExit(definition);
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  return { page, rows, requests, modals, events, draft, load: () => page.onLoad(options) };
}

test('独立新增流程各存一份，同页继续保存只更新原草稿', async () => {
  const env = harness(); await env.load();
  env.page.setData({ title: '棉袄A' }); assert.equal(await env.page.saveProductDraft(), true);
  const id = env.page._draftId;
  env.page.setData({ title: '棉袄A新版' }); await env.page.saveProductDraft();
  assert.equal(env.rows.size, 1); assert.equal(env.page._draftId, id); assert.equal(env.page._draftVersion, 2);
  const another = harness({ saved: [...env.rows.values()] }); await another.load();
  another.modals[0].success({ confirm: false });
  another.page.setData({ title: '棉袄B' }); await another.page.saveProductDraft();
  assert.equal(another.rows.size, 2);
  assert.equal(another.requests.filter(row => row[0] === 'post' && row[1] === '/drafts/v2').length, 1);
  assert.notEqual(another.page._clientDraftKey, env.page._clientDraftKey);
});

test('空白新增不创建草稿，错误请求不能显示为无草稿', async () => {
  const env = harness(); await env.load();
  assert.equal(await env.page.saveProductDraft(), false);
  assert.equal(env.requests.some(row => row[0] === 'post'), false);
  const failure = harness({ options: { draftId: 'missing' } }); await failure.load();
  assert.ok(failure.page.data.draftProblem);
});

test('指定草稿按服务端类型与来源打开，发布只携带当前编号和版本', async () => {
  let submission;
  const record = { id: '9007199254740993123', draftType: 'live_edit', relatedId: 'P1', sessionId: 'S1',
    version: 7, contextToken: 'original-context', capabilities: { edit: true }, draftData: { title: '直播草稿' } };
  const env = harness({ live: true, options: { draftId: record.id }, saved: [record], submit: body => { submission = body; return { product: { id: 'P1' } }; } });
  await env.load(); assert.equal(env.page.options.productId, 'P1'); assert.equal(env.page.options.sessionId, 'S1');
  assert.equal(env.page.data.title, '直播草稿'); assert.equal(env.page.hasUnsavedDraftChanges(), false);
  await env.page.submitDraftProduct({ name: '已修改的直播商品' });
  assert.equal(submission.sourceDraftId, record.id); assert.equal(submission.sourceDraftVersion, 7);
  assert.equal(submission.draftType, 'live_edit'); assert.equal(submission.contextToken, 'original-context');
  assert.equal(env.requests.some(row => row[0] === 'delete'), false);
});

test('不恢复编辑草稿仍保留它，使用当前商品提交只消费对应草稿', async () => {
  const record = { id: '31', draftType: 'edit', relatedId: 'P1', sessionId: null, version: 3,
    contextToken: 'old-context', draftData: { title: '旧草稿' } };
  const env = harness({ options: { editId: 'P1' }, saved: [record] }); await env.load();
  env.modals[0].success({ confirm: false });
  assert.equal(env.page._draftId, '31'); assert.equal(env.page._draftContextToken, 'server-context');
  assert.notEqual(env.page.data.title, '旧草稿'); assert.equal(env.rows.size, 1);
});

function newDraft(id, title, savedAt, extra = {}) {
  return { id, title, savedAt, draftType: 'create', relatedId: null, sessionId: null,
    version: 3, contextToken: 'saved-context-' + id, clientDraftKey: 'saved-key-' + id,
    capabilities: { edit: true }, draftData: { title }, ...extra };
}

test('普通新增提示最近保存的新增草稿，确认后绑定原稿编号与版本继续保存', async () => {
  const env = harness({ saved: [
    newDraft('21', '老新增', '2026-10-17T01:00:00Z'),
    newDraft('22', '最近新增', '2026-10-17T03:00:00Z'),
    newDraft('23', '其他编辑', '2026-10-17T04:00:00Z', { draftType: 'edit', relatedId: 'P1' }),
    newDraft('24', '直播新增', '2026-10-17T05:00:00Z', { draftType: 'live_create', sessionId: 'S1' })
  ] });
  await env.load();
  assert.equal(env.modals.length, 1);assert.match(env.modals[0].content, /最近新增/);
  assert.match(env.modals[0].content, /2026-10-17 11:00/);
  assert.equal(env.page._draftId, undefined);assert.equal(env.page.data.title, '');
  await env.modals[0].success({ confirm: true });
  assert.equal(env.page.data.title, '最近新增');assert.equal(env.page._draftId, '22');
  assert.equal(env.page._draftVersion, 3);assert.equal(env.page._draftContextToken, 'saved-context-22');
  assert.equal(env.page.hasUnsavedDraftChanges(), false);
  env.page.setData({ title: '接着修改' });await env.page.saveProductDraft();
  assert.equal(env.rows.size, 4);assert.equal(env.rows.get('22').draftData.title, '接着修改');
  assert.equal(env.requests.filter(row => row[0] === 'put').at(-1)[1], '/drafts/v2/22');
  assert.equal(env.rows.get('21').draftData.title, '老新增');
});

test('继续新建不绑定或删除最近草稿，保存和直接发布都不消费旧稿', async () => {
  const saved = [newDraft('21', '原草稿', '2026-10-17T01:00:00Z')];
  const env = harness({ saved });await env.load();await env.modals[0].success({ confirm: false });
  assert.equal(env.page._draftId, undefined);assert.equal(env.page._draftContextToken, 'server-context');
  env.page.setData({ title: '另一件商品' });await env.page.saveProductDraft();
  assert.equal(env.rows.size, 2);assert.equal(env.rows.get('21').draftData.title, '原草稿');
  assert.notEqual(env.page._clientDraftKey, 'saved-key-21');
  const publishing = harness({ saved });await publishing.load();await publishing.modals[0].success({ confirm: false });
  await publishing.page.submitDraftProduct({ name: '独立新建' });
  const body = publishing.requests.find(row => row[1] === '/product-submissions/v2')[2];
  assert.equal(body.sourceDraftId, null);assert.equal(body.sourceDraftVersion, null);
});

test('直播新增只提示当前场次最近草稿，不恢复普通新增或其他场次', async () => {
  const env = harness({ live: true, options: { sessionId: 'S1' }, saved: [
    newDraft('21', '本场较早', '2026-10-17T01:00:00Z', { draftType: 'live_create', sessionId: 'S1' }),
    newDraft('22', '本场最近', '2026-10-17T02:00:00Z', { draftType: 'live_create', sessionId: 'S1' }),
    newDraft('23', '其他场次', '2026-10-17T03:00:00Z', { draftType: 'live_create', sessionId: 'S2' }),
    newDraft('24', '普通新增', '2026-10-17T04:00:00Z')
  ] });
  await env.load();assert.equal(env.modals.length, 1);assert.match(env.modals[0].content, /本场最近/);
  await env.modals[0].success({ confirm: true });assert.equal(env.page._draftId, '22');
  await env.page.submitDraftProduct({ name: '发布本场草稿' });
  const body = env.requests.find(row => row[1] === '/product-submissions/v2')[2];
  assert.equal(body.sourceDraftId, '22');assert.equal(body.draftType, 'live_create');assert.equal(body.sessionId, 'S1');
  const other = harness({ live: true, options: { sessionId: 'S3' }, saved: [...env.rows.values()] });
  await other.load();assert.equal(other.modals.length, 0);
});

test('查询期间已经填写内容或退出页面，不再弹新增恢复提示', async () => {
  for (const exiting of [false, true]) {
    let release;
    const env = harness({ saved: [newDraft('21', '旧草稿', '2026-10-17T01:00:00Z')],
      beforeList: () => new Promise(resolve => { release = resolve; }) });
    const loading = env.load();
    while (!release) await Promise.resolve();
    if (exiting) env.page.onUnload();else env.page.setData({ title: '刚填写的内容' });
    release();await loading;
    assert.equal(env.modals.length, 0);assert.equal(env.page._draftId, undefined);
    if (!exiting) {
      assert.equal(env.page.data.title, '刚填写的内容');
      assert.equal(env.page.hasUnsavedDraftChanges(), true);
    }
  }
});

test('点击恢复时重新读取草稿最新版本，查询失败仍可继续新建', async () => {
  const env = harness({ saved: [newDraft('21', '初始版本', '2026-10-17T01:00:00Z')] });
  await env.load();
  env.rows.set('21', newDraft('21', '另一设备已更新', '2026-10-17T02:00:00Z', { version: 4 }));
  await env.modals[0].success({ confirm: true });
  assert.equal(env.page.data.title, '另一设备已更新');assert.equal(env.page._draftVersion, 4);
  const failed = harness({ beforeList: async () => { throw new Error('网络异常'); } });
  await failed.load();assert.equal(failed.page.data.draftProblem, '');
  assert.ok(failed.events.some(row => row[0] === 'toast' && /查询失败/.test(row[1])));
  failed.page.setData({ title: '照常新增' });assert.equal(await failed.page.saveProductDraft(), true);
});

test('恢复时草稿已删除或当前页已卸载，不绑定旧稿也不锁住新增表单', async () => {
  const removed = harness({ saved: [newDraft('21', '被删除', '2026-10-17T01:00:00Z')] });
  await removed.load();removed.rows.delete('21');await removed.modals[0].success({ confirm: true });
  assert.equal(removed.page._draftId, undefined);assert.equal(removed.page._draftRestoring, false);
  assert.equal(removed.page.data.title, '');assert.equal(removed.page.data.draftProblem, '');
  let release;
  const left = harness({ saved: [newDraft('21', '旧草稿', '2026-10-17T01:00:00Z')],
    beforeDetail: () => new Promise(resolve => { release = resolve; }) });
  await left.load();const restoring = left.modals[0].success({ confirm: true });
  while (!release) await Promise.resolve();
  left.page.onUnload();release();await restoring;
  assert.equal(left.page._draftId, undefined);assert.equal(left.page.data.title, '');
});

test('没有匹配新增草稿不提示，草稿箱指定打开也不再提示最近草稿', async () => {
  const saved = [newDraft('21', '编辑草稿', '2026-10-17T01:00:00Z', { draftType: 'edit', relatedId: 'P1' })];
  const fresh = harness({ saved });await fresh.load();assert.equal(fresh.modals.length, 0);
  const explicit = harness({ options: { draftId: '22' }, saved: [newDraft('22', '指定新增', '2026-10-17T01:00:00Z')] });
  await explicit.load();assert.equal(explicit.modals.length, 0);assert.equal(explicit.page.data.title, '指定新增');
  assert.equal(explicit.requests.some(row => row[1].startsWith('/drafts/v2?')), false);
});

test('媒体字符串数组、SKU和重复路径统一上传，保存后地址回填且不会重复上传', async () => {
  const uploads = [];
  const env = harness({ upload: async (local, type) => { uploads.push([local, type]); return 'https://example.com/' + uploads.length; } });
  await env.load(); env.page.setData({ title: '多媒体', mediaList: [{ url: 'wxfile://a' }],
    lookbookImgs: ['wxfile://b'], detailImgs: ['wxfile://b'], skuList: [{ image: 'wxfile://a' }] });
  await env.page.saveProductDraft();
  assert.equal(uploads.length, 2); assert.equal(env.page.data.mediaList[0].url, env.page.data.skuList[0].image);
  assert.equal(env.page.data.lookbookImgs[0], env.page.data.detailImgs[0]);
  assert.equal(env.page.hasUnsavedDraftChanges(), false);
  env.page.setData({ title: '只改标题' }); await env.page.saveProductDraft(); assert.equal(uploads.length, 2);
});

test('首次保存超时再试沿用流程标识，不在响应丢失时换新草稿', async () => {
  let first = true;
  const env = harness({ failSave: async () => { if (first) { first = false; throw { message: '请求超时' }; } } });
  await env.load(); env.page.setData({ title: '不能重复' });
  assert.equal(await env.page.saveProductDraft(), false); assert.equal(await env.page.saveProductDraft(), true);
  const bodies = env.requests.filter(row => row[0] === 'post').map(row => row[2]);
  assert.equal(bodies.length, 2); assert.equal(bodies[0].clientDraftKey, bodies[1].clientDraftKey);
  assert.equal(bodies[0].requestKey, bodies[1].requestKey);
});

test('商品提交超时重试同一个请求键，版本冲突保留输入和退出保护', async () => {
  let calls = 0;
  const env = harness({ submit: async () => { if (++calls === 1) throw { message: '请求超时' }; return { product: { id: '100' } }; } });
  await env.load();env.page.setData({ title: '原输入' });
  await assert.rejects(env.page.submitDraftProduct({ name: '商品' }));
  await env.page.submitDraftProduct({ name: '商品' });
  const writes = env.requests.filter(row => row[1] === '/product-submissions/v2');
  assert.equal(writes[0][2].requestKey, writes[1][2].requestKey);
  const conflict = harness({ submit: async () => { throw { statusCode: 409, code: 'DRAFT_VERSION_CONFLICT', message: '另一台设备更新了草稿' }; } });
  await conflict.load(); conflict.page.setData({ title: '保留输入' });
  await assert.rejects(conflict.page.submitDraftProduct({ name: '商品' }));
  assert.equal(conflict.page.data.title, '保留输入'); assert.equal(conflict.page.data.draftConflict, true);
  assert.equal(conflict.page.hasUnsavedDraftChanges(), true);
});

test('去草稿箱复用退出保护，放弃修改后不删除已有草稿', async () => {
  const env = harness();await env.load();env.page.setData({ title: '未保存内容' });
  env.page.openDraftBox();assert.equal(env.page.data.showExitConfirm, true);
  env.page.discardDraftAndExit();assert.equal(env.events.at(-1)[1], '/pages/productDrafts/index');
  assert.equal(env.requests.some(row => row[0] === 'delete'), false);
});

test('时间统一按北京时间显示，直播新增上下文不把场次混成商品编号', async () => {
  const env = harness({ live: true, options: { sessionId: 'S2' } });await env.load();
  env.page.setData({ title: '本场新增' });await env.page.saveProductDraft();
  const body = env.requests.find(row => row[0] === 'post')[2];
  assert.equal(body.relatedId, null);assert.equal(body.sessionId, 'S2');assert.equal(body.draftType, 'live_create');
  assert.equal(env.draft.formatTime('2026-12-31T16:01:00Z'), '2027-01-01 00:01');
});

test('超时后改了输入，先找回上次发布结果并明确保留后续修改，不另建商品', async () => {
  let calls = 0;
  const env = harness({ submit: async () => { if (++calls === 1) throw { message: '请求超时' }; return { product: { id: '100' } }; } });
  await env.load();env.page.setData({ title: '原稿' });
  await assert.rejects(env.page.submitDraftProduct({ name: '原稿' }));
  env.page.setData({ title: '超时后改动' });
  await assert.rejects(env.page.submitDraftProduct({ name: '超时后改动' }), error => error.code === 'PREVIOUS_SUBMISSION_COMPLETED');
  assert.equal(env.page.data.title, '超时后改动');assert.equal(env.page._completedProductId, '100');
  assert.equal(env.page.data.draftConflict, true);
  const requests = env.requests.filter(row => row[1] === '/product-submissions/v2');
  assert.equal(requests[0][2].requestKey, requests[1][2].requestKey);
  assert.equal(requests[1][2].productData.name, '原稿');
});

test('草稿保存结果未知时不能越过草稿直接发布，发布结果未知时不能另存草稿', async () => {
  const saving = harness({ failSave: async () => { throw { message: '请求超时' }; } });
  await saving.load();saving.page.setData({ title: '保存未确认' });await saving.page.saveProductDraft();
  await assert.rejects(saving.page.submitDraftProduct({ name: '商品' }), /保存结果尚未确认/);
  assert.equal(saving.requests.some(row => row[1] === '/product-submissions/v2'), false);
  const publishing = harness({ submit: async () => { throw { message: '提交超时' }; } });
  await publishing.load();publishing.page.setData({ title: '提交未确认' });
  await assert.rejects(publishing.page.submitDraftProduct({ name: '商品' }));
  assert.equal(await publishing.page.saveProductDraft(), false);
});

test('商品已经保存成功后再点提交复用成功结果，不重复创建', async () => {
  const env = harness();await env.load();
  await env.page.submitDraftProduct({ name: '商品' });await env.page.submitDraftProduct({ name: '商品' });
  assert.equal(env.requests.filter(row => row[1] === '/product-submissions/v2').length, 1);
});

function draftBox({ list, summary, remove, publish, pricingLoad, pricingSave } = {}) {
  let definition;
  const modals = [], routes = [];
  const draft = require('../../utils/draft');
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/productDrafts/index.js'), 'utf8'), {
    Page: value => { definition = value; }, console,
    wx: { showModal: value => modals.push(value), showToast() {}, navigateTo: value => routes.push(value) },
    require(name) {
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isAdmin: () => true, isStallManager: () => false };
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/productDraftPublisher')) return { publishDraft: publish || (async () => ({ product: { id: 'new-product' } })) };
      if (name.endsWith('/productDraftPricing')) return { createDraftPricingEditor: () => ({
        resetRules() {},
        load: pricingLoad || (async row => ({ record: { ...row, draftData: {} }, rules: [{ id: '30', name: '测试规则' }],
          costInput: '', mixedCosts: false, ruleId: '30', ruleName: '测试规则', revision: 0 })),
        save: pricingSave || (async (model, changes) => {
          model.record = { ...model.record, version: Number(model.record.version) + 1,
            draftData: { ...model.record.draftData, costPrice: changes.costInput } };
          return model.record;
        }) }) };
      return { ...draft, list: list || (async () => ({ content: [], hasNext: false })),
        summary: summary || (async () => ({ total: '2', limit: 100 })), batchDelete: remove || (async () => {}) };
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  page.onLoad({});page.data.authorized = true;
  return { page, modals, routes };
}

test('草稿箱延迟旧查询不能覆盖新筛选，错误和空列表分别显示', async () => {
  let resolveOld, calls = 0;
  const env = draftBox({ list: () => ++calls === 1 ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ content: [{ id: '2', title: '新筛选', draftType: 'edit', summary: {} }], hasNext: false }) });
  const old = env.page.reload();env.page.setData({ keyword: '新' });await env.page.reload();
  resolveOld({ content: [{ id: '1', title: '旧结果' }] });await old;
  assert.equal(env.page.data.items[0].title, '新筛选');assert.equal(env.page.data.total, 2);
  const failed = draftBox({ list: async () => { throw new Error('网络异常'); } });await failed.page.reload();
  assert.equal(failed.page.data.error, '网络异常');assert.equal(failed.page.data.items.length, 0);
  const empty = draftBox();await empty.page.reload();assert.equal(empty.page.data.error, '');
});

test('草稿箱跨页选择带各自版本，批量失败保留选择和原列表', async () => {
  let deleted;
  const env = draftBox({ list: async ({ page }) => ({ content: [{ id: String(page), version: page + 3, draftType: 'create', summary: {} }], hasNext: page === 1 }),
    remove: async items => { deleted = items;throw new Error('草稿版本已变化'); } });
  await env.page.reload();env.page.toggleSelectMode();env.page.toggleSelect({ currentTarget: { dataset: { id: '1' } } });
  await env.page.loadMore();env.page.toggleSelect({ currentTarget: { dataset: { id: '2' } } });
  env.page.deleteSelected();await env.modals[0].success({ confirm: true });
  assert.deepEqual(JSON.parse(JSON.stringify(deleted)), [{ id: '1', version: 4 }, { id: '2', version: 5 }]);
  assert.equal(env.page.data.selectedCount, 2);assert.equal(env.page.data.items.length, 2);
  assert.equal(env.page.data.deleting, false);assert.equal(env.modals[1].title, '删除失败');
});

test('草稿箱继续编辑只传草稿ID，普通编辑事件可以传回商品管理台', async () => {
  const forwarded = [];
  const env = draftBox({ list: async () => ({ content: [{ id: '9007199254740993123', version: 1, draftType: 'edit', summary: {} }], hasNext: false }) });
  env.page.getOpenerEventChannel = () => ({ emit: (...args) => forwarded.push(args) });
  await env.page.reload();await env.page.openDraft({ currentTarget: { dataset: { id: '9007199254740993123' } } });
  assert.equal(env.routes[0].url, '/pages/admin/admin?draftId=9007199254740993123');
  env.routes[0].events.productUpdated({ id: 'P1' });assert.equal(forwarded[0][0], 'productUpdated');
});

test('草稿箱全选覆盖当前筛选的全部分页，再点取消全选清空全部选择', async () => {
  const queries = [];
  const env = draftBox({ list: async query => {
    queries.push(query);
    return { content: [{ id: String(query.page), version: query.page, draftType: 'create' }], hasNext: query.page < 3 };
  } });
  env.page.setData({ keyword: '棉袄', typeIndex: 1, sessionId: '66' });
  await env.page.reload();
  env.page.toggleSelectMode();
  await env.page.toggleSelectAll();
  assert.equal(env.page.data.selectedCount, 3);
  assert.equal(env.page.data.allSelected, true);
  assert.ok(env.page.data.items.every(item => item.selected));
  assert.equal(queries.length, 3);
  assert.ok(queries.every(query => query.keyword === '棉袄' && query.draftType === 'create' && query.sessionId === '66'));
  await env.page.toggleSelectAll();
  assert.equal(env.page.data.selectedCount, 0);
  assert.equal(env.page.data.allSelected, false);
  assert.ok(env.page.data.items.every(item => !item.selected));
});

test('草稿箱全选加载失败保留原选择，不把未加载完误标成全部选中', async () => {
  const env = draftBox({ list: async ({ page }) => {
    if (page > 1) throw new Error('翻页失败');
    return { content: [{ id: '1', version: 3 }], hasNext: true };
  } });
  await env.page.reload();env.page.toggleSelectMode();
  env.page.toggleSelect({ currentTarget: { dataset: { id: '1' } } });
  await env.page.toggleSelectAll();
  assert.equal(env.page.data.selectedCount, 1);
  assert.equal(env.page.data.allSelected, false);
  assert.equal(env.page.data.selectingAll, false);
  assert.equal(env.page.data.moreError, '翻页失败');
});

test('批量发布逐份保存，成功项移走、失败项保留选中并展示原因', async () => {
  const rows = [{ id: '1', title: '棉袄A', version: 4, draftType: 'create' },
    { id: '2', title: '棉袄B', version: 8, draftType: 'edit' }];
  const submitted = [], forwarded = [];
  let inFlight = 0;
  const env = draftBox({ list: async () => ({ content: rows, hasNext: false }),
    summary: async () => ({ total: rows.length, limit: 100 }),
    publish: async item => {
      assert.equal(inFlight++, 0);
      submitted.push(item);
      await Promise.resolve();inFlight--;
      if (item.id === '2') throw new Error('请先填写商品名称');
      rows.splice(rows.findIndex(row => row.id === item.id), 1);
      return { product: { id: 'P1' } };
    } });
  env.page.getOpenerEventChannel = () => ({ emit: (...args) => forwarded.push(args) });
  await env.page.reload();env.page.toggleSelectMode();await env.page.toggleSelectAll();
  await env.page.publishSelected();
  assert.equal(submitted.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(submitted.map(({ id, version }) => ({ id, version })))), [{ id: '1', version: 4 }, { id: '2', version: 8 }]);
  assert.equal(env.page.data.items.length, 1);
  assert.equal(env.page.data.items[0].id, '2');
  assert.equal(env.page.data.items[0].selected, true);
  assert.match(env.page.data.items[0].warningText, /请先填写商品名称/);
  assert.equal(env.page.data.selectedCount, 1);
  assert.equal(env.page.data.total, 1);
  assert.equal(env.page.data.publishing, false);
  assert.equal(env.modals[0].title, '已发布 1 份，失败 1 份');
  assert.equal(forwarded[0][0], 'productUpdated');
});

test('批量发布期间锁住重复点击、选择、删除和新建，页面退出后不再发布下一份', async () => {
  let finish, count = 0;
  const env = draftBox({ list: async () => ({ content: [{ id: '1', version: 1 }, { id: '2', version: 2 }], hasNext: false }),
    publish: () => { count++;return new Promise(resolve => { finish = resolve; }); } });
  await env.page.reload();env.page.toggleSelectMode();await env.page.toggleSelectAll();
  const publishing = env.page.publishSelected();
  await env.page.publishSelected();
  env.page.toggleSelect({ currentTarget: { dataset: { id: '1' } } });
  env.page.toggleSelectMode();env.page.deleteSelected();env.page.createProduct();
  assert.equal(env.page.data.selectedCount, 2);
  assert.equal(env.page.data.selecting, true);
  assert.equal(env.modals.length, 0);
  assert.equal(env.routes.length, 0);
  env.page.onUnload();
  let writes = 0;
  env.page.setData = () => { writes++; };
  finish({ product: { id: 'P1' } });
  await publishing;
  assert.equal(count, 1);
  assert.equal(writes, 0);
});

test('草稿卡片修改成本失焦自动保存，批量所选版本同步为保存后的版本', async () => {
  const env = draftBox({ list: async () => ({ content: [{ id: '1', version: 7 }], hasNext: false }) });
  await env.page.reload();await env.page.ensurePricing(env.page.data.items[0]);
  env.page.toggleSelectMode();env.page.toggleSelect({ currentTarget: { dataset: { id: '1' } } });
  const event = { currentTarget: { dataset: { id: '1' } }, detail: { value: '12' } };
  env.page.onDraftCostInput(event);
  assert.equal(env.page.data.items[0].pricing.dirty, true);
  await env.page.onDraftCostBlur(event);
  assert.equal(env.page.data.items[0].version, 8);
  assert.equal(env.page._selected.get('1'), 8);
  assert.equal(env.page.data.items[0].pricing.saved, true);
  assert.equal(env.page.data.items[0].pricing.dirty, false);
});

test('草稿卡片保存尚未完成时直接发布，等待最新成本保存并使用最新版本提交', async () => {
  let finishSave, submitted;
  const env = draftBox({ list: async () => ({ content: [{ id: '1', version: 7, title: '棉袄' }], hasNext: false }),
    pricingSave: (model, changes) => new Promise(resolve => { finishSave = () => {
      model.record = { ...model.record, version: 8, draftData: { costPrice: changes.costInput } };
      resolve(model.record);
    }; }), publish: async item => { submitted = item;return { product: { id: 'P1' } }; } });
  await env.page.reload();await env.page.ensurePricing(env.page.data.items[0]);
  const event = { currentTarget: { dataset: { id: '1' } }, detail: { value: '12' } };
  env.page.onDraftCostInput(event);
  const saving = env.page.onDraftCostBlur(event);
  const publishing = env.page.publishOne(event);
  assert.equal(submitted, undefined);
  finishSave();
  await saving;
  await publishing;
  assert.equal(submitted.version, 8);
});

test('保存期间再次输入成本，旧响应不能把新输入标记为已保存，后续失焦保存新值', async () => {
  const pending = [], values = [];
  const env = draftBox({ list: async () => ({ content: [{ id: '1', version: 7 }], hasNext: false }),
    pricingSave: (model, changes) => new Promise(resolve => { values.push(changes.costInput);pending.push(() => {
      model.record = { ...model.record, version: model.record.version + 1, draftData: { costPrice: changes.costInput } };
      resolve(model.record);
    }); }) });
  await env.page.reload();await env.page.ensurePricing(env.page.data.items[0]);
  const event = value => ({ currentTarget: { dataset: { id: '1' } }, detail: { value } });
  env.page.onDraftCostInput(event('10'));
  const first = env.page.onDraftCostBlur(event('10'));
  env.page.onDraftCostInput(event('20'));
  pending[0]();await first;
  assert.equal(env.page.data.items[0].pricing.costInput, '20');
  assert.equal(env.page.data.items[0].pricing.dirty, true);
  const second = env.page.onDraftCostBlur(event('20'));
  pending[1]();await second;
  assert.deepEqual(values, ['10', '20']);
  assert.equal(env.page.data.items[0].pricing.dirty, false);
});

test('草稿卡片成本保存失败时保留输入并阻止发布，刷新也不能丢弃这次修改', async () => {
  let submitted = false;
  const env = draftBox({ list: async () => ({ content: [{ id: '1', version: 7 }], hasNext: false }),
    pricingSave: async () => { throw new Error('计价失败'); }, publish: async () => { submitted = true; } });
  await env.page.reload();await env.page.ensurePricing(env.page.data.items[0]);
  const event = { currentTarget: { dataset: { id: '1' } }, detail: { value: '12' } };
  env.page.onDraftCostInput(event);await env.page.onDraftCostBlur(event);
  assert.equal(env.page.data.items[0].pricing.error, '计价失败');
  await env.page.reload();
  assert.equal(env.page.data.items[0].pricing.costInput, '12');
  await env.page.publishOne(event);
  assert.equal(submitted, false);
  assert.equal(env.page._pricingModels.get('1').costInput, '12');
  assert.equal(env.modals.at(-1).title, '已发布 0 份，失败 1 份');
});
