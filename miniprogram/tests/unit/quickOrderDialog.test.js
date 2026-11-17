const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const quick = require('../../utils/quickOrder');
const plain = value => JSON.parse(JSON.stringify(value));
const draft = { name: '上衣', articleNo: 'A1', costPrice: '50', price: '100' };
const image = 'https://example.com/first.jpg';
const key = 'quick_order_last_product:42';

function setup({ storage = new Map(), storageError = false, failed = false } = {}) {
  let definition, userId = '42';
  const modals = [], posts = [], uploads = [], navigation = [];
  const runtime = {
    getStorageSync(name) { if (storageError) throw new Error('读取失败'); return storage.get(name); },
    setStorageSync(name, value) { if (storageError) throw new Error('写入失败'); storage.set(name, plain(value)); },
    showModal: options => modals.push(options), showToast() {},
    navigateTo: options => navigation.push(options.url)
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../components/quickOrderDialog/index.js'), 'utf8'), {
    Component: value => { definition = value; }, wx: runtime, console: { warn() {} },
    require(name) {
      if (name.endsWith('/auth')) return { isAdmin: () => true, canAccessMenu: () => true,
        getUserInfo: () => ({ userId }) };
      if (name.endsWith('/api')) return { post: async (url, body) => {
        posts.push({ url, body: plain(body) });
        if (failed) throw new Error('创建失败');
        return { productId: String(posts.length) };
      } };
      if (name.endsWith('/quickOrder')) return quick;
      if (name.endsWith('/error')) return { getErrorMessage: error => error.message };
      if (name.endsWith('/cos-upload')) return { uploadFile: async file => { uploads.push(file); return 'https://example.com/new.jpg'; } };
      throw new Error('未知依赖：' + name);
    }
  });
  const component = { ...definition.methods, data: plain(definition.data),
    setData(patch) { Object.assign(this.data, patch); } };
  return { component, storage, modals, posts, uploads, navigation, setUser: id => { userId = id; } };
}

test('首次开单直接空表，成功后保存账号数据与远程图片；下次先询问再回填', async () => {
  const env = setup();
  env.component.open();
  assert.equal(env.modals.length, 0);
  assert.equal(env.component.data.visible, true);
  env.component.setData({ draft: { ...draft }, images: [{ path: '/tmp/first.jpg' }] });
  await env.component.save();
  assert.deepEqual(env.uploads, ['/tmp/first.jpg']);
  assert.deepEqual(env.storage.get(key), { draft, images: ['https://example.com/new.jpg'] });
  const next = setup({ storage: env.storage });
  next.component.open();
  next.component.open();
  assert.equal(next.modals.length, 1);
  assert.equal(next.component.data.visible, false);
  assert.equal(next.modals[0].content, '是否恢复上次开单数据？');
  next.modals[0].success({ confirm: true });
  assert.deepEqual(plain(next.component.data.draft), draft);
  assert.deepEqual(plain(next.component.data.images), [{ path: 'https://example.com/new.jpg', url: 'https://example.com/new.jpg' }]);
});

test('恢复后保存仍新建商品，重新生成请求号，复用原图并支持替换图片和改信息', async () => {
  const env = setup({ storage: new Map([[key, { draft, images: [image] }]]) });
  env.component.open(); env.modals[0].success({ confirm: true });
  const firstRequest = env.component._requestId;
  await env.component.save();
  env.component.open(); env.modals[1].success({ confirm: true });
  assert.notEqual(env.component._requestId, firstRequest);
  env.component.setData({ draft: { ...env.component.data.draft, articleNo: 'A2' } });
  env.component.removeImage({ currentTarget: { dataset: { index: 0 } } });
  env.component.setData({ images: [{ path: '/tmp/replacement.jpg' }] });
  await env.component.save();
  assert.deepEqual(env.posts.map(post => post.url), ['/quick-orders', '/quick-orders']);
  assert.deepEqual(env.uploads, ['/tmp/replacement.jpg']);
  assert.deepEqual(env.posts[0].body.images, [image]);
  assert.equal(env.posts[1].body.articleNo, 'A2');
  assert.notEqual(env.posts[0].body.requestId, env.posts[1].body.requestId);
  assert.equal('productId' in env.posts[1].body, false);
  assert.deepEqual(env.navigation, ['/pages/detail/detail?id=1', '/pages/detail/detail?id=2']);
});

test('选择否打开空表且保留上次记录，不同账号互不回填', () => {
  const env = setup({ storage: new Map([[key, { draft, images: [image] }]]) });
  env.component.open(); env.modals[0].success({ cancel: true });
  assert.deepEqual(plain(env.component.data.draft), { name: '', articleNo: '', costPrice: '', price: '' });
  assert.deepEqual(plain(env.component.data.images), []);
  assert.deepEqual(env.storage.get(key), { draft, images: [image] });
  env.component.close(); env.setUser('43'); env.component.open();
  assert.equal(env.modals.length, 1);
  assert.equal(env.component.data.draft.name, '');
});

test('开单失败不覆盖上次成功记录，重试保留原请求号', async () => {
  const previous = { draft, images: [image] };
  const env = setup({ failed: true, storage: new Map([[key, plain(previous)]]) });
  env.component.open(); env.modals[0].success({ confirm: false });
  env.component.setData({ draft: { ...draft, name: '新商品' }, images: [{ path: image, url: image }] });
  await env.component.save(); await env.component.save();
  assert.deepEqual(env.storage.get(key), previous);
  assert.equal(env.posts[0].body.requestId, env.posts[1].body.requestId);
  assert.equal(env.component.data.visible, true);
});

test('缓存损坏或存储故障仍可空表新建，记忆失败不影响成功跳转', async () => {
  for (const options of [{ storageError: true }, { storage: new Map([[key, { draft, images: ['/tmp/expired.jpg'] }]]) }]) {
    const env = setup(options);
    env.component.open();
    assert.equal(env.modals.length, 0);
    env.component.setData({ draft, images: [{ path: image, url: image }] });
    await env.component.save();
    assert.deepEqual(env.navigation, ['/pages/detail/detail?id=1']);
    assert.equal(env.component.data.visible, false);
  }
});
