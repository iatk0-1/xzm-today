const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const requests = [];
  const files = new Set();
  const accesses = [];
  const module = { exports: {} };
  const wx = {
    downloadFile(options) {
      const request = { ...options, aborted: false };
      requests.push(request);
      return { abort() { request.aborted = true; options.fail(); } };
    },
    getFileSystemManager: () => ({
      access(options) {
        accesses.push(options.path);
        if (files.has(options.path)) options.success();
        else options.fail();
      }
    })
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/skuImagePreloader.js'), 'utf8'), { module, wx });
  const loaded = [];
  const preloader = module.exports.createSkuImagePreloader();
  return {
    ...module.exports, preloader, requests, files, accesses, loaded, wx,
    start(urls) { preloader.start(urls, (url, file) => loaded.push({ url, file })); },
    succeed(request, file = '/tmp/' + requests.indexOf(request)) {
      files.add(file);
      request.success({ statusCode: 200, tempFilePath: file });
    }
  };
}

test('收齐普通规格与套装图片，当前图片优先，按完整 URL 去重并忽略本地图片', () => {
  const env = setup();
  const urls = env.collectSkuImages({
    coverUrl: 'https://cdn/cover.jpg', image: '/images/default.png',
    skuMatrix: [{ imageUrl: 'https://cdn/red.jpg' }, { imageUrl: 'https://cdn/red.jpg' }, {}],
    bundleGroups: [{ skus: [{ imageUrl: 'https://cdn/blue.jpg?version=2' }] }]
  }, 'https://cdn/red.jpg');
  assert.deepEqual(Array.from(urls), ['https://cdn/red.jpg', 'https://cdn/cover.jpg', 'https://cdn/blue.jpg?version=2']);
});

test('不切规格也下载全部图片，同时最多四个请求，失败后继续队列', () => {
  const env = setup();
  env.start(['a', 'b', 'c', 'd', 'e', 'f', 'a']);
  assert.equal(env.requests.length, 4);
  env.succeed(env.requests[0]);
  assert.equal(env.requests.length, 5);
  env.requests[1].fail();
  assert.equal(env.requests.length, 6);
  for (const request of env.requests.slice(2)) env.succeed(request);
  assert.equal(env.loaded.length, 5);
  assert.equal(new Set(env.requests.map(request => request.url)).size, 6);
});

test('只接受成功响应与本地路径，失败图片下次打开会重试', () => {
  const env = setup();
  env.start(['a', 'b', 'c']);
  env.requests[0].success({ statusCode: 404, tempFilePath: '/tmp/error' });
  env.requests[1].success({ statusCode: 200 });
  env.requests[2].fail();
  assert.equal(env.loaded.length, 0);
  env.start(['a', 'b', 'c']);
  assert.equal(env.requests.length, 6);
});

test('再次打开复用有效临时文件，文件失效后重新下载，图片显示失败可清掉索引', () => {
  const env = setup();
  env.start(['a']);
  env.succeed(env.requests[0], '/tmp/a');
  env.start(['a']);
  assert.equal(env.requests.length, 1);
  assert.deepEqual(env.accesses, ['/tmp/a']);
  assert.equal(env.loaded.length, 2);
  env.files.clear();
  env.start(['a']);
  assert.equal(env.requests.length, 2);
  env.succeed(env.requests[1], '/tmp/a2');
  env.preloader.invalidate('a');
  env.start(['a']);
  assert.equal(env.requests.length, 3);
});

test('切商品和关闭时中止旧下载，忽略迟到回调，旧队列不再启动', () => {
  const env = setup();
  env.start(['a', 'b', 'c', 'd', 'e']);
  const old = env.requests.slice();
  env.start(['new']);
  assert.ok(old.every(request => request.aborted));
  old.forEach(request => env.succeed(request));
  assert.equal(env.loaded.length, 0);
  assert.equal(env.requests.length, 5);
  env.preloader.stop();
  assert.equal(env.requests[4].aborted, true);
  env.succeed(env.requests[4]);
  assert.equal(env.loaded.length, 0);
});

test('会话缓存限制为 120 张，清掉最久未用的索引', () => {
  const env = setup();
  env.start(Array.from({ length: 121 }, (_, index) => String(index)));
  for (let index = 0; index < env.requests.length; index++) env.succeed(env.requests[index]);
  assert.equal(env.loaded.length, 121);
  env.start(['120']);
  assert.equal(env.requests.length, 121);
  env.start(['0']);
  assert.equal(env.requests.length, 122);
});

test('关联图片追加到当前队列，不中断已有下载，重复地址不重复下载', () => {
  const env = setup();
  env.start(['a', 'b', 'c', 'd', 'e']);
  env.preloader.append(['a', 'f', 'f']);
  assert.equal(env.requests.length, 4);
  assert.ok(env.requests.every(request => !request.aborted));
  for (let index = 0; index < env.requests.length; index++) env.succeed(env.requests[index]);
  assert.deepEqual(env.requests.map(request => request.url), ['a', 'b', 'c', 'd', 'e', 'f']);
  env.preloader.append(['g']);
  assert.equal(env.requests[6].url, 'g');
  env.preloader.stop();
  env.preloader.append(['h']);
  assert.equal(env.requests.length, 7);
});
