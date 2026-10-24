const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const plain = value => JSON.parse(JSON.stringify(value));
const url = name => 'https://cdn.example/' + name + '.jpg';
const event = src => ({ currentTarget: { dataset: { src } } });

function setup(kind = 'product') {
  const requests = [], previews = [], storage = [], gets = [];
  let definition;
  let handler = async () => ({});
  const wx = {
    showLoading() {}, hideLoading() {}, showToast() {}, showModal() {}, hideKeyboard() {},
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 750, statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ left: 280, bottom: 70 }),
    previewImage: value => previews.push(value),
    setStorageSync: (key, value) => storage.push({ key, value }), navigateTo() {},
    downloadFile(options) {
      const request = { ...options, aborted: false };
      requests.push(request);
      return { abort() { request.aborted = true; options.fail(); } };
    }
  };
  const modules = new Map();
  const load = filename => {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, wx, console,
      Page: value => { definition = value; }, Component: value => { definition = value; },
      setTimeout: () => 1, clearTimeout() {}, getApp: () => ({}),
      require(name) {
        if (name.endsWith('/api')) return {
          get: async (address, params) => { gets.push(address); return handler(address, params); }, post: async () => ({})
        };
        if (name.endsWith('/auth')) return {
          isAdmin: () => false, isStallManager: () => false, getUserInfo: () => ({}), ensureAuthenticated: async () => {}
        };
        if (name.endsWith('/shareImage')) return { createShareImage: async () => '' };
        if (name.endsWith('/pageSync')) return { wrap: config => config };
        const target = path.resolve(path.dirname(filename), name + '.js');
        if (['controller.js', 'detailImagePreload.js', 'skuImagePreloader.js'].includes(path.basename(target))) return load(target);
        return require(target);
      }
    }, { filename });
    return module.exports;
  };
  if (kind === 'wish') load(path.join(root, 'pages/wishDetail/wishDetail.js'));
  else if (kind === 'sheet') load(path.join(root, 'components/productDetail/index.js'));
  else definition = load(path.join(root, 'components/productDetail/controller.js')).createProductDetailConfig();
  const page = {
    ...(kind === 'sheet' ? definition.methods : definition), data: plain(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
    selectComponent: () => null, triggerEvent() {}
  };
  return {
    page, requests, previews, storage, gets,
    setHandler(value) { handler = value; },
    finishAll() {
      for (let index = 0; index < requests.length; index++) {
        if (!requests[index].aborted) requests[index].success({ statusCode: 200, tempFilePath: '/tmp/' + index });
      }
    },
    unload() {
      if (kind === 'sheet') definition.lifetimes.detached.call(page);
      else page.onUnload();
    }
  };
}

function product(id = '1') {
  return { product: {
    id, name: '商品', coverUrl: url(id + '-cover'), bannerImages: [url(id + '-banner')],
    lookbookImages: [url(id + '-lookbook')], detailImages: [url(id + '-detail')],
    skuMatrix: [
      { skuId: 1, color: '红色', stock: 5, price: 20, imageUrl: url(id + '-red') },
      { skuId: 2, color: '蓝色', stock: 5, price: 20, imageUrl: url(id + '-blue') }
    ]
  } };
}

for (const kind of ['product', 'sheet']) {
  test(`${kind}：进入详情即排队下载整页及 SKU 图片，弹窗与放大复用本地文件，结算保留远程地址`, async () => {
    const env = setup(kind);
    const response = product();
    env.setHandler(async () => response);
    await env.page.getProductDetail('1');
    assert.equal(env.page.data.showSku, false);
    assert.equal(env.requests.length, 4);
    env.finishAll();
    assert.deepEqual(env.requests.map(request => request.url), [
      url('1-cover'), url('1-banner'), url('1-red'), url('1-blue'), url('1-lookbook'), url('1-detail')
    ]);
    assert.equal(Object.keys(env.page.data.imagePaths).length, 6);
    env.page.openSkuPanel({ currentTarget: { dataset: { action: 'cart' } } });
    assert.equal(env.page.data.showSku, true);
    assert.equal(env.requests.length, 6);
    env.page.selectColor({ currentTarget: { dataset: { color: '蓝色' } } });
    env.page.previewSkuPanelImage(event(''));
    assert.equal(env.previews.at(-1).current, '/tmp/3');
    assert.equal(env.page.data.currentSkuImage, url('1-blue'));
    env.page.previewLookbookImage({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(env.previews.at(-1).current, '/tmp/4');
    env.page.previewDetailImage({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(env.previews.at(-1).current, '/tmp/5');
    env.page.confirmSkuAction({ currentTarget: { dataset: { action: 'buy' } } });
    assert.equal(env.storage[0].value[0].coverUrl, url('1-blue'));
    assert.deepEqual(plain(env.page.data.product.skuMatrix), response.product.skuMatrix);
  });

  test(`${kind}：套装顶层分组的所有规格图片也在打开弹窗前下载`, async () => {
    const env = setup(kind);
    const response = product();
    response.bundleGroups = [{ name: '上衣', skus: [
      { skuId: 5, color: '绿色', stock: 3, price: 20, imageUrl: url('bundle-green') },
      { skuId: 6, color: '黄色', stock: 3, price: 20, imageUrl: url('bundle-yellow') }
    ] }];
    response.product.skuMatrix = response.bundleGroups[0].skus;
    env.setHandler(async () => response);
    await env.page.getProductDetail('1');
    env.finishAll();
    assert.ok(env.requests.some(request => request.url === url('bundle-green')));
    assert.ok(env.requests.some(request => request.url === url('bundle-yellow')));
    env.page.openSkuPanel({ currentTarget: { dataset: { action: 'cart' } } });
    assert.equal(env.page.data.bundleSelections[0].selectedSku.imageUrl, url('bundle-green'));
    assert.equal(env.page.resolvePreloadedImage(url('bundle-yellow')), '/tmp/3');
  });

  test(`${kind}：换商品和卸载中止下载，旧回调不污染新详情`, async () => {
    const env = setup(kind);
    env.setHandler(async address => product(address.split('/').at(-1)));
    await env.page.loadProductSafe('1');
    const old = env.requests.slice();
    await env.page.loadProductSafe('2');
    assert.ok(old.every(request => request.aborted));
    old.forEach(request => request.success({ statusCode: 200, tempFilePath: '/tmp/old' }));
    assert.deepEqual(plain(env.page.data.imagePaths), {});
    env.unload();
    assert.ok(env.requests.every(request => request.aborted));
    env.requests.at(-1).success({ statusCode: 200, tempFilePath: '/tmp/late' });
    assert.deepEqual(plain(env.page.data.imagePaths), {});
  });
}

test('详情关联封面追加下载，不重启整页队列；本地图片失效回退原地址', async () => {
  const env = setup();
  const response = product();
  response.product.relatedProductIds = ['2'];
  env.setHandler(async address => address === '/products/related' ? [{ id: '2', coverUrl: url('related') }] : response);
  await env.page.getProductDetail('1');
  await new Promise(resolve => setImmediate(resolve));
  env.finishAll();
  assert.ok(env.requests.some(request => request.url === url('related')));
  assert.ok(env.requests.every(request => !request.aborted));
  env.page.onPreloadedImageError(event(url('1-detail')));
  assert.equal(env.page.resolvePreloadedImage(url('1-detail')), url('1-detail'));
  env.page.onPreloadedImageError({ detail: { url: url('1-banner') } });
  assert.equal(env.page.resolvePreloadedImage(url('1-banner')), url('1-banner'));
});

test('心愿进入即下载全部图片，关联封面追加下载，原数据保留远程地址，卸载丢弃旧回调', async () => {
  const env = setup('wish');
  const images = Array.from({ length: 6 }, (_, index) => url('wish-' + index));
  env.page.data.wishId = 'wish';
  env.setHandler(async address => address.startsWith('/wishes/')
    ? { id: 'wish', images, image: images[0], linkedProductIds: ['1'] }
    : product());
  await env.page.loadWishDetail();
  assert.equal(env.requests.length, 4);
  env.finishAll();
  assert.deepEqual(env.requests.map(request => request.url), [...images, url('1-cover')]);
  assert.deepEqual(plain(env.page.data.wish.images), images);
  assert.equal(env.page.resolvePreloadedImage(images[5]), '/tmp/5');
  assert.equal(env.page.resolvePreloadedImage(url('1-cover')), '/tmp/6');
  env.page.onPreloadedImageError({ detail: { url: images[5] } });
  assert.equal(env.page.resolvePreloadedImage(images[5]), images[5]);
  await env.page.loadWishDetail();
  const before = plain(env.page.data.imagePaths);
  env.unload();
  env.requests.at(-1).success({ statusCode: 200, tempFilePath: '/tmp/late' });
  assert.deepEqual(plain(env.page.data.imagePaths), before);
});
