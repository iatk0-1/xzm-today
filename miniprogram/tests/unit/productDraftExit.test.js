const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(file, { save, record, manager = false } = {}) {
  let definition;
  const events = [];
  const wx = {
    showToast: value => events.push(['toast', value.title]),
    showLoading() {}, hideLoading() {},
    showModal: options => events.push(['modal', options]),
    getStorageSync() {}, setStorageSync() {},
    enableAlertBeforeUnload: options => events.push(['guard', options.message]),
    disableAlertBeforeUnload: () => events.push(['unguard']),
    navigateBack: options => events.push(['back', options]),
    reLaunch: options => events.push(['home', options]),
    pageScrollTo() {}
  };
  const api = {
    get: async url => {
      if (url === '/pricing-rules') return [];
      if (url.endsWith('/preference/mine')) return {};
      if (url === '/sizes/categories') return [{ id: '7', name: '默认尺码', sizes: [{ id: '8', name: '均码' }] }];
      if (url === '/stall-managers/mine') return { active: true };
      if (url.startsWith('/products/')) return { product: { name: '原商品', stallIds: [] },
        skus: [{ id: '20', spec: '白', size: '均码', retailPrice: '20', costPrice: '10', stockMain: 5 }] };
      return [];
    },
    post: async url => url.endsWith('/preview') ? { price: '20' } : {}
  };
  const draft = {
    loadDraft: async () => record || null,
    removeDraft: async () => events.push(['delete']),
    saveDraft: async (data, upload, opts) => { events.push(['save', structuredClone(data), opts]); if (save) await save(data, upload, opts); }
  };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, wx, Page: page => { definition = page; },
      console: { log() {}, warn() {}, error() {} }, getCurrentPages: () => [{}, {}],
      setTimeout: () => 0, clearTimeout() {},
      require(name) {
        if (name.endsWith('/error')) return require('../../utils/error');
        if (name.endsWith('/api') || name === './api') return api;
        if (name.endsWith('/draft') || name === './draft') return draft;
        if (name.endsWith('/auth') || name === './auth') return {
          ensureAuthenticated: async () => {}, isAdmin: () => !manager, isStallManager: () => manager,
          getUserInfo: () => ({ userId: '42' })
        };
        if (name.endsWith('/productPricing') || name.endsWith('/productDraftExit') || name.endsWith('/managerFinance') || name.endsWith('/productSchedule') || name.endsWith('/purchaseNotice')) {
          return load(path.resolve(path.dirname(filename), name + '.js'));
        }
        if (name.endsWith('/stock')) return { UNLIMITED_THRESHOLD: 999999999 };
        return {};
      }
    }, { filename });
    cache.set(filename, module.exports);
    return module.exports;
  }
  load(path.resolve(__dirname, file));
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
  page.uploadFile = async () => 'https://example.com/image.jpg';
  return { page, events };
}

for (const [label, file, options] of [
  ['普通商品新增', '../../pages/admin/admin.js', {}],
  ['普通商品编辑', '../../pages/admin/admin.js', { editId: '10' }],
  ['直播商品新增', '../../pages/liveRoomPublish/publish.js', { sessionId: '9' }],
  ['直播商品编辑', '../../pages/liveRoomPublish/publish.js', { sessionId: '9', productId: '10' }]
]) {
  test(label + '默认内容和加载资料不算改动，未编辑直接返回且卸载不保存', async () => {
    const { page, events } = harness(file);
    await page.onLoad(options);
    assert.equal(page.hasUnsavedDraftChanges(), false);
    page.requestEditorExit();
    page.onUnload();
    assert.equal(events.filter(event => event[0] === 'back').length, 1);
    assert.equal(events.filter(event => event[0] === 'save').length, 0);
  });

  test(label + '改动返回三选项，取消保留输入、不保存退出不覆盖草稿', async () => {
    const { page, events } = harness(file);
    await page.onLoad(options);
    page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '修改内容' } });
    page.requestEditorExit();
    assert.equal(page.data.showExitConfirm, true);
    page.cancelEditorExit();
    assert.equal(page.data.showExitConfirm, false);
    assert.equal(page.data.title, '修改内容');
    assert.equal(events.filter(event => event[0] === 'back').length, 0);
    page.requestEditorExit();
    page.discardDraftAndExit();
    page.onUnload();
    assert.equal(events.filter(event => event[0] === 'back').length, 1);
    assert.equal(events.filter(event => event[0] === 'save' || event[0] === 'delete').length, 0);
  });

  test(label + '主动保存只保存，保存后没再修改返回不询问', async () => {
    const { page, events } = harness(file);
    await page.onLoad(options);
    page.setData({ title: '半成品' });
    assert.equal(await page.saveDraft(), true);
    assert.equal(page.hasUnsavedDraftChanges(), false);
    assert.equal(events.filter(event => event[0] === 'back').length, 0);
    page.requestEditorExit();
    assert.equal(page.data.showExitConfirm, false);
    assert.equal(events.filter(event => event[0] === 'back').length, 1);
  });

  test(label + '保存并退出只在保存成功后返回，重复点击只保存一次', async () => {
    let complete;
    const { page, events } = harness(file, { save: () => new Promise(resolve => { complete = resolve; }) });
    await page.onLoad(options);
    page.setData({ title: '待保存' });
    page.requestEditorExit();
    const saving = page.saveDraftAndExit();
    await page.saveDraftAndExit();
    page.discardDraftAndExit();
    page.cancelEditorExit();
    assert.equal(page.data.showExitConfirm, true);
    assert.equal(events.filter(event => event[0] === 'save').length, 1);
    assert.equal(events.filter(event => event[0] === 'back').length, 0);
    complete();
    await saving;
    page.onUnload();
    assert.equal(events.filter(event => event[0] === 'save').length, 1);
    assert.equal(events.filter(event => event[0] === 'back').length, 1);
  });

  test(label + '保存失败留在当前页且保留内容，可以重试', async () => {
    let fail = true;
    const { page, events } = harness(file, { save: async () => { if (fail) throw new Error('图片上传失败'); } });
    await page.onLoad(options);
    page.setData({ title: '不能丢' });
    page.requestEditorExit();
    await page.saveDraftAndExit();
    assert.equal(page.data.draftSaving, false);
    assert.equal(page.data.showExitConfirm, true);
    assert.equal(page.data.title, '不能丢');
    assert.equal(page.hasUnsavedDraftChanges(), true);
    assert.equal(events.filter(event => event[0] === 'back').length, 0);
    fail = false;
    await page.saveDraftAndExit();
    assert.equal(events.filter(event => event[0] === 'back').length, 1);
  });

  test(label + '原样还原修改关闭退出提醒，系统卸载也绝不保存', async () => {
    const { page, events } = harness(file);
    await page.onLoad(options);
    const title = page.data.title;
    page.setData({ title: '新内容' });
    assert.equal(page._alertEnabled, true);
    page.setData({ title });
    assert.equal(page.hasUnsavedDraftChanges(), false);
    assert.equal(page._alertEnabled, false);
    page.setData({ title: '没保存的内容' });
    page.onUnload();
    assert.equal(events.filter(event => event[0] === 'save').length, 0);
  });
}

test('保存上传期间继续修改不会被当成已保存，保存并退出保留页面', async () => {
  let complete;
  const { page, events } = harness('../../pages/admin/admin.js', { save: () => new Promise(resolve => { complete = resolve; }) });
  await page.onLoad({});
  page.setData({ title: '保存版本A' });
  page.requestEditorExit();
  const saving = page.saveDraftAndExit();
  page.setData({ title: '后改版本B' });
  complete();
  await saving;
  assert.equal(events.find(event => event[0] === 'save')[1].title, '保存版本A');
  assert.equal(page.hasUnsavedDraftChanges(), true);
  assert.equal(events.filter(event => event[0] === 'back').length, 0);
});

for (const file of ['../../pages/admin/admin.js', '../../pages/liveRoomPublish/publish.js']) {
  test(file + '切换查看套装子项不算修改，另一子项成本改动仍会提示', async () => {
    const { page } = harness(file);
    await page.onLoad({ sessionId: '9' });
    const groups = ['上衣', '裤子'].map(name => ({ name, colors: ['白'], sizeCategoryId: '7',
      sizeOptions: [{ id: '8', name: '均码', selected: true }],
      skuList: [{ color: '白', size: '均码', costPrice: '10', price: '20', stock: '5' }] }));
    page.setData({ isBundleMode: true, bundleGroups: groups, activeGroupIndex: 0 });
    page.loadGroupState(0);
    page.captureDraftBaseline();
    page.selectBundleGroup({ currentTarget: { dataset: { index: 1 } } });
    assert.equal(page.hasUnsavedDraftChanges(), false);
    page.setData({ skuList: [{ ...page.data.skuList[0], costPrice: '15' }] });
    page.selectBundleGroup({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(page.hasUnsavedDraftChanges(), true);
    page.requestEditorExit();
    assert.equal(page.data.showExitConfirm, true);
  });

  test(file + '发布成功后退出不询问、不重存草稿，退出失败恢复提醒', async () => {
    const { page, events } = harness(file);
    await page.onLoad({ sessionId: '9' });
    page.setData({ title: '有改动' });
    page._submitted = true;
    page.requestEditorExit();
    assert.equal(page.data.showExitConfirm, false);
    assert.equal(events.some(event => event[0] === 'save'), false);
    const other = harness(file);
    await other.page.onLoad({ sessionId: '9' });
    other.page.setData({ title: '有改动' });
    other.page.discardDraftAndExit();
    other.events.find(event => event[0] === 'back')[1].fail(new Error('路由失败'));
    assert.equal(other.page._draftExiting, false);
    assert.equal(other.page._alertEnabled, true);
  });
}

test('管理员恢复草稿保留手填价格，不自动改成规则价', async () => {
  const { page } = harness('../../pages/admin/admin.js');
  await page.onLoad({});
  await page.restoreDraft({ title: '手填价格', costPrice: '10', pricingRuleId: '30',
    pricingRuleSegments: [{ lower: 0, upper: null, formula: 'x+5' }],
    skuList: [{ price: '88.88', costPrice: '10' }] });
  assert.equal(page.data.skuList[0].price, '88.88');
  assert.equal(page.hasUnsavedDraftChanges(), false);
});

test('草稿恢复只匹配当前商品，忽略保留草稿，恢复后未改动不询问', async () => {
  const record = { draftType: 'edit', relatedId: '10', draftData: { title: '已存草稿', skuList: [], selectedStalls: [] } };
  const { page, events } = harness('../../pages/admin/admin.js', { record });
  await page.onLoad({ editId: '10' });
  const modal = events.find(event => event[0] === 'modal')[1];
  modal.success({ confirm: false });
  assert.equal(events.some(event => event[0] === 'delete'), false);
  modal.success({ confirm: true });
  await page._draftRestorePromise;
  assert.equal(page.data.title, '已存草稿');
  assert.equal(page.hasUnsavedDraftChanges(), false);
  const other = harness('../../pages/admin/admin.js', { record });
  await other.page.onLoad({ editId: '11' });
  assert.equal(other.events.some(event => event[0] === 'modal'), false);
});

test('草稿媒体上传失败拒绝整次保存，不提交缺失图片的草稿，视频按视频类型上传', async () => {
  const events = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/draft.js'), 'utf8'), {
    module, exports: module.exports, console,
    require: () => ({ post: async (url, body) => events.push([url, body]) })
  });
  await assert.rejects(module.exports.saveDraft({ mediaList: [{ url: 'wx://tmp/image' }] },
    async () => { throw new Error('上传失败'); }), /上传失败/);
  assert.equal(events.length, 0);
  const types = [];
  await module.exports.saveDraft({ videoUrl: 'wx://tmp/video', mediaList: [{ url: 'https://tmp/image' }] },
    async (file, type) => { types.push(type); return 'https://example.com/' + types.length; });
  assert.deepEqual(types, ['video/mp4', 'image/jpeg']);
  assert.equal(events.length, 1);
});


test('购买须知改动参与草稿保存与退出保护，旧草稿恢复默认文案', async () => {
  const { DEFAULT_PURCHASE_NOTICE } = require('../../utils/purchaseNotice');
  const { page, events } = harness('../../pages/admin/admin.js');
  page.setData({ colors: [] });
  assert.equal(page.hasFormContent(), false);
  await page.onLoad({});
  assert.equal(page.data.purchaseNotice, DEFAULT_PURCHASE_NOTICE);
  page.onInput({ currentTarget: { dataset: { field: 'purchaseNotice' } }, detail: { value: '自定义购买须知' } });
  assert.equal(page.hasUnsavedDraftChanges(), true);
  assert.equal(page.hasFormContent(), true);
  await page.saveDraft();
  assert.equal(events.find(event => event[0] === 'save')[1].purchaseNotice, '自定义购买须知');
  await page.restoreDraft({ purchaseNotice: '恢复的购买须知' });
  assert.equal(page.data.purchaseNotice, '恢复的购买须知');
  await page.restoreDraft({ title: '旧草稿' });
  assert.equal(page.data.purchaseNotice, DEFAULT_PURCHASE_NOTICE);
});
