const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness({ manager = false, get, patch, post } = {}) {
  const calls = [], notices = [], updates = [];
  const detail = { product: { id: '90071992547409931', name: '花棉袄' }, costPrice: 8,
    skus: [
      { id: '90071992547409932', spec: '红', size: 'M', retailPrice: 20, costPrice: 10, stockMain: 5, imageUrl: '图片' },
      { id: '90071992547409933', spec: '蓝', size: 'M', retailPrice: 30, costPrice: null, bundleGroupName: '裤子' },
      { id: '90071992547409934', spec: '红', size: 'L', retailPrice: 40, costPrice: 15 }
    ] };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/productQuickEdit.js'), 'utf8'), {
    module, wx: { showToast: options => notices.push(options.title) }, require(name) {
      if (name === './api') return {
        get: async url => { calls.push(['get', url]); return get ? get(url) : detail; },
        post: async (url, body) => { calls.push(['post', url, body]); return post ? post(url, body) : { price: Number(body.cost) + 5 }; },
        patch: async (url, body) => { calls.push(['patch', url, structuredClone(body)]); return patch ? patch(url, body) : { product: { id: detail.product.id, articleNo: body.articleNo, costPrice: 12 } }; }
      };
      return require('../../utils/' + name.slice(2));
    }
  });
  const page = module.exports.integrateProductQuickEdit({
    data: { products: [{ ...detail.product, articleNo: 'A-01' }], isStallManager: manager },
    setData(patch) { Object.assign(this.data, patch); },
    updateVisibleProduct(product) { updates.push(product); },
    toggleProductSelect() { calls.push(['select']); }
  });
  const event = { currentTarget: { dataset: { id: detail.product.id } } };
  const input = (field, value, index) => ({ currentTarget: { dataset: { field, index } }, detail: { value } });
  return { page, event, input, calls, notices, updates, detail };
}

test('加载所有规格含套装子项，成本回退到商品默认成本，取消不提交', async () => {
  const env = harness();
  await env.page.openSkuPricing(env.event);
  assert.equal(env.page.data.quickEditSkus.length, 3);
  assert.equal(env.page.data.quickEditSkus[1].costPrice, '8');
  assert.equal(env.page.data.quickEditSkus[1].bundleGroupName, '裤子');
  env.page.closeQuickEdit();
  assert.equal(env.page.data.quickEditVisible, false);
  assert.equal(env.calls.filter(call => call[0] === 'patch').length, 0);
});

test('一键填充全部成本，按颜色尺码批量设售价，库存图片规格身份保留', async () => {
  const { page, event, input } = harness();
  await page.openSkuPricing(event);
  page.onQuickEditInput(input('quickEditCost', '12.50'));
  page.fillAllSkuPricing();
  assert.ok(page.data.quickEditSkus.every(sku => sku.costPrice === '12.50'));
  page.togglePricingOption(input('quickEditColors', '', 0));
  page.togglePricingOption(input('quickEditSizes', '', 0));
  page.onQuickEditInput(input('quickEditPrice', '25'));
  page.applySkuPricingBatch();
  assert.deepEqual(Array.from(page.data.quickEditSkus, sku => sku.retailPrice), ['25', '30', '40']);
  assert.equal(page.data.quickEditSkus[0].stockMain, 5);
  assert.equal(page.data.quickEditSkus[0].imageUrl, '图片');
});

test('改单条仅提交变更规格及成本售价，大整数编号不转数字，成功就地回显', async () => {
  const { page, event, input, calls, updates } = harness();
  await page.openSkuPricing(event);
  page.onQuickSkuInput(input('retailPrice', '25.90', 0));
  await page.saveQuickEdit();
  const request = calls.find(call => call[0] === 'patch');
  assert.match(request[1], /90071992547409931\/sku-pricing$/);
  assert.deepEqual(request[2], { skus: [{ id: '90071992547409932', costPrice: 10, retailPrice: 25.9 }] });
  assert.equal(updates.length, 1);
  assert.equal(page.data.quickEditVisible, false);
});

test('非法金额不能提交，保存失败保留弹窗与输入，允许重试', async () => {
  const { page, event, input, calls, notices } = harness({ patch: async () => { throw new Error('保存失败'); } });
  await page.openSkuPricing(event);
  page.onQuickSkuInput(input('retailPrice', '0', 0));
  await page.saveQuickEdit();
  assert.equal(calls.filter(call => call[0] === 'patch').length, 0);
  page.onQuickSkuInput(input('retailPrice', '26', 0));
  await page.saveQuickEdit();
  assert.equal(page.data.quickEditVisible, true);
  assert.equal(page.data.quickEditSkus[0].retailPrice, '26');
  assert.equal(page.data.quickEditSaving, false);
  assert.ok(notices.length >= 2);
});

test('货号支持修改、去除首尾空格和清空，保存独立字段', async () => {
  const { page, event, input, calls } = harness();
  await page.openArticleNoEditor(event);
  page.onQuickEditInput(input('quickEditArticleNo', ' B-02 '));
  await page.saveQuickEdit();
  assert.deepEqual(calls[0].slice(1), ['/products/90071992547409931/article-no', { articleNo: 'B-02' }]);
  await page.openArticleNoEditor(event);
  page.onQuickEditInput(input('quickEditArticleNo', ''));
  await page.saveQuickEdit();
  assert.equal(calls[1][2].articleNo, '');
});

test('负责人不能手填售价，批量选择模式沿用商品勾选', async () => {
  const { page, event, input, calls } = harness({ manager: true });
  await page.openSkuPricing(event);
  page.onQuickSkuInput(input('retailPrice', '999', 0));
  assert.equal(page.data.quickEditSkus[0].retailPrice, '20');
  page.closeQuickEdit();
  page.data.selectMode = true;
  await page.openSkuPricing(event);
  assert.equal(calls.at(-1)[0], 'select');
  assert.equal(page.data.quickEditVisible, false);
});

test('关闭后迟到的加载响应不能覆盖新货号弹窗', async () => {
  let resolve;
  const { page, event } = harness({ get: () => new Promise(done => { resolve = done; }) });
  const pending = page.openSkuPricing(event);
  page.closeQuickEdit();
  await page.openArticleNoEditor(event);
  resolve({ skus: [{ id: '旧规格' }] });
  await pending;
  assert.equal(page.data.quickEditType, 'articleNo');
  assert.equal(page.data.quickEditSkus.length, 0);
});

test('单条成本失焦及批量成本按已保存规则计算，显式批量售价优先', async () => {
  const { page, event, input, detail } = harness();
  detail.pricingRuleSegments = [{ lower: 0, upper: null, formula: 'x+5' }];
  await page.openSkuPricing(event);
  page.onQuickSkuInput(input('costPrice', '11', 0));
  await page.onQuickSkuCostBlur(input('costPrice', '11', 0));
  assert.equal(page.data.quickEditSkus[0].retailPrice, '16');
  page.onQuickEditInput(input('quickEditCost', '12'));
  await page.fillAllSkuPricing();
  assert.ok(page.data.quickEditSkus.every(sku => sku.retailPrice === '17'));
  page.onQuickEditInput(input('quickEditCost', '20'));
  page.onQuickEditInput(input('quickEditPrice', '88'));
  await page.fillAllSkuPricing();
  assert.ok(page.data.quickEditSkus.every(sku => sku.retailPrice === '88'));
});

test('成本试算期间不能保存，迟到的试算响应不覆盖手填售价', async () => {
  let resolve;
  const { page, event, input, detail, calls } = harness({ post: () => new Promise(done => { resolve = done; }) });
  detail.pricingRuleSegments = [{ lower: 0, formula: 'x+5' }];
  await page.openSkuPricing(event);
  page.onQuickSkuInput(input('costPrice', '12', 0));
  const pending = page.onQuickSkuCostBlur(input('costPrice', '12', 0));
  await page.saveQuickEdit();
  assert.equal(calls.filter(call => call[0] === 'patch').length, 0);
  page.onQuickSkuInput(input('retailPrice', '99', 0));
  resolve({ price: 17 });
  await pending;
  assert.equal(page.data.quickEditSkus[0].retailPrice, '99');
  assert.equal(page.data.quickEditPricingBusy, false);
});
