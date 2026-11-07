const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../pages/admin/admin.js'), 'utf8');
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function setup({ manager = true, userId = 8, saved, assigned = [], failPublish = false } = {}) {
  let config;
  let writes = 0;
  const storage = new Map(saved ? [['last_stall_selection', saved]] : []);
  const requests = [];
  const submissions = [];
  const toasts = [];
  vm.runInNewContext(source, {
    Page(value) { config = value; }, Date, Set,
    console: { log() {}, error() {}, warn() {} },
    setTimeout() {},
    require(name) {
        if (name.endsWith('/productPromotions')) return require('../../utils/productPromotions');
        if (name.endsWith('/error')) return require('../../utils/error');
      // 本文件验证档口记忆；计价集成由managerFinancePricing.test.js独立覆盖。
      if (name.endsWith('/productPricing')) return { integrateProductPricing(page) {
        page.canManuallyPrice = () => !manager;
        page.productCost = value => require('../../utils/managerFinance').money(value);
        page.skuCost = value => require('../../utils/managerFinance').money(value);
        page.submitDraftProduct = async body => {
          submissions.push({ url: page.data.editId ? '/products/' + page.data.editId : '/products', body });
          if (failPublish) throw new Error('模拟发布失败');
          return { product: { id: 9 } };
        };
      } };
      if (name.endsWith('/purchaseNotice')) return require('../../utils/purchaseNotice');
      if (name.endsWith('/draft')) return require('../../utils/draft');
      if (name.endsWith('/productSchedule')) return require('../../utils/productSchedule');
      if (name.endsWith('/managerFinance')) return require('../../utils/managerFinance');
      if (name.endsWith('/auth')) return {
        ensureAuthenticated: async () => {}, isStallManager: () => manager,
        getUserInfo: () => ({ userId })
      };
      if (name.endsWith('/api')) return {
        get: async url => { requests.push(url); return assigned; },
        put: async (url, body) => { submissions.push({ url, body }); return { product: { id: 9 } }; },
        post: async (url, body) => { submissions.push({ url, body }); if (failPublish) throw new Error('模拟发布失败'); return { product: { id: 9 } }; }
      };
      return {};
    },
    wx: {
      getStorageSync: key => storage.get(key),
      setStorageSync: (key, value) => { writes += 1; storage.set(key, value); },
      removeStorageSync: key => storage.delete(key),
      showToast(value) { toasts.push(value.title); }, showLoading() {}, hideLoading() {}, showModal() {}
    }
  });
  const page = { ...config, data: structuredClone(config.data), setData(patch) { Object.assign(this.data, patch); } };
  // 屏蔽与档口选择无关的初始化和上传，保留页面加载及发布流程。
  page.refreshGrid = () => {};
  page.loadRecentStallsAndTags = () => {};
  page.loadSizeCategories = () => {};
  page.generateSkuMatrix = () => {};
  page.checkDraft = () => {};
  page.clearDraft = () => {};
  page.uploadMediaList = async () => ['https://example.com/product.jpg'];
  page.uploadImageList = async () => [];
  page.uploadSkuImages = async () => ({});
  return { page, storage, requests, submissions, toasts, writeCount: () => writes };
}

test('负责人再次发布自动恢复当天使用过且仍分配的档口，使用当前名称', async () => {
  const { page, requests } = setup({
    assigned: [{ id: 1, name: '新名称' }, { id: 2, name: '二档口' }],
    saved: { date: today(), stalls: [{ id: '1', name: '旧名称' }, { id: 3, name: '已收回' }] }
  });
  await page.onLoad({});
  assert.deepEqual(requests, ['/stall-managers/stalls/mine']);
  assert.equal(page.data.selectedStalls.length, 1);
  assert.equal(page.data.selectedStalls[0].id, 1);
  assert.equal(page.data.selectedStalls[0].name, '新名称');
});

test('历史多档口记忆只恢复一个有效档口，无历史或档口全被收回时保持未选择', async () => {
  const assigned = [{ id: 1, name: '一' }, { id: 2, name: '二' }];
  const { page } = setup({ assigned, saved: { date: today(), userId: 8, stalls: [{ id: 1 }, { id: '2' }] } });
  await page.onLoad({});
  assert.equal(page.data.selectedStalls.length, 1);
  for (const saved of [undefined, { date: today(), stalls: [{ id: 3 }] }]) {
    const { page: empty } = setup({ assigned, saved });
    await empty.onLoad({});
    assert.equal(empty.data.selectedStalls.length, 0);
  }
});

test('过期缓存和其他账号的缓存不会恢复，管理员当天记忆照常使用', async () => {
  for (const saved of [
    { date: '2000-01-01', stalls: [{ id: 1 }] },
    { date: today(), userId: 9, stalls: [{ id: 1 }] }
  ]) {
    const { page } = setup({ assigned: [{ id: 1 }], saved });
    await page.onLoad({});
    assert.equal(page.data.selectedStalls.length, 0);
  }
  const { page } = setup({ manager: false, saved: { date: today(), stalls: [{ id: 99, name: '管理员档口' }] } });
  await page.onLoad({});
  assert.equal(page.data.selectedStalls[0].id, 99);
});

test('编辑和直播转商品时保留商品自身档口，不套用上次发布选择', async () => {
  for (const options of [{ editId: '9' }, { convertFromLiveProductId: '10' }]) {
    const { page } = setup({ assigned: [{ id: 1 }], saved: { date: today(), stalls: [{ id: 1 }] } });
    page.loadProductForEdit = () => {};
    page.loadLiveProductForConvert = () => {};
    await page.onLoad(options);
    assert.equal(page.data.selectedStalls.length, 0);
  }
});

test('发布成功记录实际档口及账号，失败不覆盖上次记忆', async () => {
  for (const failPublish of [false, true]) {
    const { page, storage, writeCount } = setup({ failPublish });
    Object.assign(page.data, {
      isStallManager: true, assignedStalls: [{ id: 2, name: '二档口' }],
      selectedStalls: [{ id: 2, name: '二档口' }],
      title: '测试商品', mediaList: [{ url: 'https://example.com/product.jpg' }],
      costPrice: '5', pricingRuleId: '30',
      skuList: [{ costPrice: '5', price: '10', stock: '5', color: '图片色', size: '均码' }]
    });
    await page.submitProduct();
    assert.equal(writeCount(), failPublish ? 0 : 1);
    if (!failPublish) {
      const saved = storage.get('last_stall_selection');
      assert.equal(saved.userId, 8);
      assert.equal(saved.date, today());
      assert.equal(saved.stalls[0].id, 2);
      assert.equal(page._submitted, true);
    }
  }
});

for (const editId of ['', '9']) {
  test(`现货同步${editId ? '编辑' : '新增'}默认关闭，开启必须逐规格填写具体库存，支持0`, async () => {
    for (const stock of ['', '0', '8', '-1', '1.5', '1000000000']) {
      const { page, submissions, toasts } = setup({ manager: false });
      assert.equal(page.data.syncReadyStock, false);
      Object.assign(page.data, { editId, costPrice: '5', title: '现货商品',
        mediaList: [{ url: 'https://example.com/product.jpg' }],
        skuList: [{ price: '10', costPrice: '5', stock, color: '白', size: 'M' }] });
      page.toggleSyncReadyStock({ detail: { value: true } });
      await page.submitProduct();
      const valid = ['0', '8'].includes(stock);
      assert.equal(submissions.length, valid ? 1 : 0);
      if (valid) {
        assert.equal(submissions[0].body.syncReadyStock, true);
        assert.equal(submissions[0].body.skus[0].stockMain, Number(stock));
        assert.equal(submissions[0].body.skus[0].isUnlimitedStock, false);
      } else assert.ok(toasts.some(text => text.includes('具体库存')));
    }
    const { page, submissions } = setup({ manager: false });
    Object.assign(page.data, { editId, costPrice: '5', title: '无限商品',
      mediaList: [{ url: 'https://example.com/product.jpg' }], skuList: [{ price: '10', stock: '' }] });
    await page.submitProduct();
    assert.equal(submissions[0].body.syncReadyStock, false);
    assert.equal(submissions[0].body.skus[0].isUnlimitedStock, true);
  });

  test(`视频封面${editId ? '编辑' : '新增'}保存参数跟随勾选，缺失封面不静默保存为false`, async () => {
    for (const selected of [true, false]) {
      const { page, submissions } = setup({ manager: false });
      Object.assign(page.data, { editId, costPrice: '5', title: '视频商品',
        mediaList: [{ url: 'https://example.com/product.jpg' }],
        videoUrl: 'https://example.com/video.mp4', videoThumbPath: 'https://example.com/thumb.jpg',
        useVideoCover: selected, skuList: [{ price: '10', stock: '5', color: '白', size: 'M' }] });
      await page.submitProduct();
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].body.useVideoCover, selected);
      assert.equal(submissions[0].body.coverUrl,
        selected ? 'https://example.com/thumb.jpg' : 'https://example.com/product.jpg');
    }
    const { page, submissions, toasts } = setup({ manager: false });
    Object.assign(page.data, { editId, costPrice: '5', title: '视频商品',
      mediaList: [{ url: 'https://example.com/product.jpg' }],
      videoUrl: 'https://example.com/video.mp4', videoThumbPath: '', useVideoCover: true,
      skuList: [{ price: '10', stock: '5', color: '白', size: 'M' }] });
    page.ensureVideoCover = async () => { toasts.push('生成失败'); throw new Error('生成失败'); };
    await page.submitProduct();
    assert.equal(submissions.length, 0);
    assert.equal(page.data.useVideoCover, true);
    assert.ok(toasts.includes('生成失败'));
  });
}

test('现货开关写入草稿，旧草稿默认关闭，保存期间不允许切换', () => {
  const { page } = setup();
  page.toggleSyncReadyStock({ detail: { value: true } });
  const saved = page.collectDraftData();
  assert.equal(saved.syncReadyStock, true);
  page.restoreDraft(saved);
  assert.equal(page.data.syncReadyStock, true);
  page.restoreDraft({});
  assert.equal(page.data.syncReadyStock, false);
  page.data.draftSaving = true;
  page.toggleSyncReadyStock({ detail: { value: true } });
  assert.equal(page.data.syncReadyStock, false);
});

test('套装同步校验包含未显示子项，跳过已移除规格，提交前保存当前子项输入', async () => {
  const { page, submissions, toasts } = setup({ manager: false });
  Object.assign(page.data, { syncReadyStock: true, isBundleMode: true, activeGroupIndex: 0,
    costPrice: '5', title: '套装', mediaList: [{ url: 'https://example.com/product.jpg' }],
    skuList: [{ price: '10', stock: '0', costPrice: '5' }],
    bundleGroups: [{ name: '上衣', skuList: [] }, { name: '裤子', skuList: [{ price: '10', stock: '' }] }] });
  await page.submitProduct();
  assert.equal(submissions.length, 0);
  assert.equal(page.data.bundleGroups[0].skuList[0].stock, '0');
  assert.ok(toasts.some(text => text.includes('具体库存')));
  page.data.bundleGroups[1].skuList = [{ price: '10', costPrice: '5', stock: '2' }, { stock: '', _toBeRemoved: true }];
  await page.submitProduct();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].body.syncReadyStock, true);
  assert.equal(submissions[0].body.bundleGroups[0].skus[0].stockMain, 0);
  assert.equal(submissions[0].body.bundleGroups[1].skus[0].stockMain, 2);
});
