const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveArticleNo, attachArticleNos } = require('../../utils/adminProductArticleNo');

function loadPage(name, get) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, `../../pages/${name}/${name}.js`), 'utf8'), {
    Page(value) { definition = value; }, console, setTimeout, clearTimeout,
    wx: { showToast() {}, hideLoading() {}, showLoading() {} },
    require(name) {
      if (name.endsWith('/api')) return { get };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, isStallManager: () => false };
      if (name.endsWith('/pageSync')) return { wrap: page => page, publish() {} };
      return require(path.resolve(__dirname, '../../utils', name.split('/').at(-1)));
    }
  });
  const page = { ...definition, data: structuredClone(definition.data) };
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

test('物流和改价明细按订单商品、SKU或商品编号补货号，大整数编号不转数字', () => {
  const rows = [
    { id: '90071992547409931', skuId: '90071992547409932', productId: '90071992547409933', articleNo: 'HN-001' },
    { id: '90071992547409934', skuId: '90071992547409935', productId: '90071992547409936', articleNo: 'HN-002' }
  ];
  assert.equal(resolveArticleNo({ orderItemId: rows[0].id }, rows), 'HN-001');
  assert.equal(resolveArticleNo({ skuId: rows[1].skuId }, rows), 'HN-002');
  assert.equal(resolveArticleNo({ productId: rows[0].productId }, rows), 'HN-001');
  assert.equal(resolveArticleNo({ articleNo: '', skuId: rows[0].skuId }, rows), '');
  const original = { orderItemId: rows[0].id, shipQty: 2 };
  assert.deepEqual(attachArticleNos([original], rows), [{ ...original, articleNo: 'HN-001' }]);
  assert.equal(original.articleNo, undefined);
  assert.equal(resolveArticleNo({ skuId: '不存在' }, rows), '');
});

for (const name of ['adminSalesDetail', 'adminShippingSalesDetail']) {
  test(name + '详情标题从概览接口读取当前货号，未填时清除上一次值', async () => {
    let articleNo = 'HN-CURRENT';
    const page = loadPage(name, async () => ({ articleNo, soldQty: 1, sold_qty: 1 }));
    page.data.productId = '90071992547409933';
    await page.loadOverview();
    assert.equal(page.data.productArticleNo, 'HN-CURRENT');
    articleNo = null;
    await page.loadOverview();
    assert.equal(page.data.productArticleNo, '');
  });
}

test('库存多规格合并商品、入库预览与本地恢复保留货号', async () => {
  const page = loadPage('skuInventory', async () => ({ content: [
    { productId: '90071992547409933', productName: '花棉袄', articleNo: 'HN-STOCK', skuId: '31', spec: '红', size: 'M', qty: 2 },
    { productId: '90071992547409933', productName: '花棉袄', articleNo: 'HN-STOCK', skuId: '32', spec: '蓝', size: 'L', qty: 3 }
  ], hasNext: false }));
  await page.loadProducts();
  assert.equal(page.data.productList.length, 1);
  const product = page.data.productList[0];
  assert.equal(product.articleNo, 'HN-STOCK');
  assert.equal(product.skus.length, 2);
  const row = page.receiveItem(product, { ...product.skus[0], receiveQty: '1' });
  assert.equal(row.articleNo, 'HN-STOCK');
  assert.equal(row.productId, product.id);
});

test('拣货报单详情和编辑商品返回后保留新货号', async () => {
  const page = loadPage('pickingList', async () => ({
    product: { id: '101', name: '新商品名称', articleNo: 'HN-NEW' }, skus: [{ id: '201', spec: '红', size: 'M', retailPrice: 20, costPrice: 10 }]
  }));
  page.data.recommendList = [{ productId: '101', skuId: '201', articleNo: 'HN-OLD', selected: true, qty: '1', recommendQty: 1, costPrice: 10 }];
  page.data.filteredList = page.data.recommendList;
  await page.refreshOrderProduct('101');
  assert.equal(page.data.recommendList[0].articleNo, 'HN-NEW');
  await page.createPurchaseOrder();
  assert.equal(page.data.orderPreviewList[0].articleNo, 'HN-NEW');
});
