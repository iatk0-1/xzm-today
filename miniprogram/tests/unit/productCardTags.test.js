const test = require('node:test');
const assert = require('node:assert/strict');
const { cardTags, managedCardTags, loadCardTags } = require('../../utils/productCardTags');

const readyProduct = id => ({ id, skuMatrix: [{ stock: 5, freeStockQty: 2 }] });
const offer = (type, status = 'AVAILABLE') => ({ type, status });
const labels = product => product.cardTags.map(tag => tag.label);
function createPage(products, field = 'productList') {
  return {
    data: { [field]: products, leftColumn: products.filter((_, i) => i % 2 === 0),
      rightColumn: products.filter((_, i) => i % 2 === 1) },
    // 微信数据传输可能复制对象，校验不应依赖对象引用。
    setData(patch) { Object.assign(this.data, structuredClone(patch)); }
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('管理标签按启用配置展示优惠，不使用管理者个人资格；停用优惠和售罄现货不展示', () => {
  assert.deepEqual(managedCardTags(readyProduct('p'), {
    firstScheme: { type: 'FIRST', enabled: true }, otherScheme: { type: 'QUANTITY', enabled: true }
  }).map(tag => tag.label), ['首单优惠', '多件优惠', '现货']);
  assert.deepEqual(managedCardTags({ skuMatrix: [{ stock: 0, freeStockQty: 8 }] }, {
    firstScheme: { type: 'FIRST', enabled: false }, otherScheme: { type: 'AMOUNT', enabled: false }
  }), []);
});

test('优惠按首单、满减、多件多折、多件优惠排列并去重，现货始终在最后', () => {
  const tags = cardTags(readyProduct('p'), ['QUANTITY', 'RATE', 'FIRST', 'AMOUNT', 'FIRST'].map(type => offer(type)));
  assert.deepEqual(tags.map(tag => tag.label), ['首单优惠', '满减优惠', '多件多折', '多件优惠', '现货']);
  for (const type of ['AMOUNT', 'RATE', 'QUANTITY']) {
    assert.deepEqual(cardTags(readyProduct('p'), [offer(type), offer('FIRST')]).map(tag => tag.type),
      ['FIRST', type, 'READY_STOCK']);
  }
});

test('不可用优惠不展示，现货只认未售罄规格的正常空闲库存', () => {
  assert.deepEqual(cardTags({ skuMatrix: [
    { stock: 0, freeStockQty: 9 }, { stock: 5 }, { unlimitedStock: true },
    { stock: 5, freeStockQty: -1 }, { stock: 5, abnormalStockQty: 8 }
  ] }, ['USED', 'RESERVED', 'EXPIRED', 'FULL'].map(status => offer('FIRST', status))), []);
  assert.deepEqual(cardTags({}), []);
  assert.deepEqual(cardTags({ skuMatrix: [{ unlimitedStock: true, freeStockQty: '2' }] }),
    [{ type: 'READY_STOCK', label: '现货' }]);
});

test('后台补充优惠不阻塞列表，两列与主列表一致，同时最多发出四个请求', async () => {
  const products = Array.from({ length: 7 }, (_, i) => readyProduct(String(i)));
  const page = createPage(products);
  let active = 0, maxActive = 0;
  const task = loadCardTags(page, products, 'productList', async () => {
    active++; maxActive = Math.max(maxActive, active);
    await flush(); active--;
    return [offer('RATE'), offer('FIRST')];
  });
  assert.equal(page.data.productList.length, 7);
  assert.equal(active, 4);
  await task;
  assert.equal(maxActive, 4);
  for (const product of [...page.data.productList, ...page.data.leftColumn, ...page.data.rightColumn]) {
    assert.deepEqual(labels(product), ['首单优惠', '多件多折', '现货']);
  }
  assert.equal(page._cardTagRequests.size, 0);
});

test('刷新后同一商品的新优惠优先，旧响应不回写，保留分页追加商品', async () => {
  const product = readyProduct('same');
  const page = createPage([product], 'results');
  let resolveOld;
  const oldTask = loadCardTags(page, [product], 'results', () => new Promise(resolve => { resolveOld = resolve; }));
  const fresh = { ...readyProduct('same'), name: '刷新后的商品' };
  const appended = readyProduct('page2');
  Object.assign(page.data, { results: [fresh, appended], leftColumn: [fresh], rightColumn: [appended] });
  await loadCardTags(page, [fresh], 'results', async () => [offer('AMOUNT')]);
  resolveOld([offer('FIRST')]);
  await oldTask;
  assert.deepEqual(labels(page.data.results[0]), ['满减优惠', '现货']);
  assert.equal(page.data.leftColumn[0].name, '刷新后的商品');
  assert.equal(page.data.results[1].id, 'page2');
});

test('单个优惠请求失败不影响其他卡片和现货，卸载后不再回写或继续请求', async t => {
  t.mock.method(console, 'error', () => {});
  const products = [readyProduct('bad'), readyProduct('good')].map(product => ({ ...product, cardTags: cardTags(product) }));
  const page = createPage(products);
  await loadCardTags(page, products, 'productList', async id => {
    if (id === 'bad') throw new Error('模拟优惠加载失败');
    return [offer('QUANTITY')];
  });
  assert.deepEqual(labels(page.data.productList[0]), ['现货']);
  assert.deepEqual(labels(page.data.rightColumn[0]), ['多件优惠', '现货']);

  const closedProducts = Array.from({ length: 8 }, (_, i) => readyProduct(String(i)));
  const closedPage = createPage(closedProducts);
  let calls = 0;
  const resolvers = [];
  const task = loadCardTags(closedPage, closedProducts, 'productList', () => {
    calls++;
    return new Promise(resolve => resolvers.push(resolve));
  });
  closedPage._pageClosed = true;
  resolvers.forEach(resolve => resolve([offer('FIRST')]));
  await task;
  assert.equal(calls, 4);
  assert.equal(closedPage.data.productList[0].cardTags, undefined);
});
