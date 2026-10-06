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
  vm.runInNewContext(source, {
    Page(value) { config = value; }, Date, Set,
    console: { log() {}, error() {}, warn() {} },
    setTimeout() {},
    require(name) {
        if (name.endsWith('/error')) return require('../../utils/error');
      // 本文件验证档口记忆；计价集成由managerFinancePricing.test.js独立覆盖。
      if (name.endsWith('/productPricing')) return { integrateProductPricing(page) {
        page.canManuallyPrice = () => !manager;
        page.productCost = value => require('../../utils/managerFinance').money(value);
        page.skuCost = value => require('../../utils/managerFinance').money(value);
      } };
      if (name.endsWith('/purchaseNotice')) return require('../../utils/purchaseNotice');
      if (name.endsWith('/managerFinance')) return require('../../utils/managerFinance');
      if (name.endsWith('/auth')) return {
        ensureAuthenticated: async () => {}, isStallManager: () => manager,
        getUserInfo: () => ({ userId })
      };
      if (name.endsWith('/api')) return {
        get: async url => { requests.push(url); return assigned; },
        post: async () => { if (failPublish) throw new Error('模拟发布失败'); return { product: { id: 9 } }; }
      };
      return {};
    },
    wx: {
      getStorageSync: key => storage.get(key),
      setStorageSync: (key, value) => { writes += 1; storage.set(key, value); },
      removeStorageSync: key => storage.delete(key),
      showToast() {}, showLoading() {}, hideLoading() {}, showModal() {}
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
  return { page, storage, requests, writeCount: () => writes };
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
