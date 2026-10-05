const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 执行真实页面、api 和 COS 工具，模拟微信 API 与 COS 网络，验证整个上传链路。
function harness({ credentialsFail = false, putFail = false, compressionFail = false } = {}) {
  const config = require('../../utils/config');
  const requests = [], uploads = [], cache = new Map();
  let definition;
  const wx = {
    chooseMedia: options => options.success({ tempFiles: [{ tempFilePath: '/tmp/source.jpg' }] }),
    getStorageSync: key => key === config.TOKEN_KEY ? 'test-access' : { selectedRole: 'admin' },
    request(options) {
      requests.push(options);
      options.success(credentialsFail ? { statusCode: 500, data: { message: '获取凭证失败' } } : {
        statusCode: 200, data: { tmpSecretId: 'temporary-test', tmpSecretKey: 'temporary-test-key',
          sessionToken: 'test-session', expiredTime: 1999999999, bucket: 'test-bucket',
          region: 'ap-guangzhou', cdnDomain: 'upload-dev.xianzaimai.com' }
      });
    },
    uploadFile() { throw new Error('凭证图片不能走后端 multipart 上传'); },
    getFileSystemManager: () => ({ accessSync() {}, readFile: options => options.success({ data: new Uint8Array([1, 2, 3]).buffer }) })
  };
  class FakeCOS {
    constructor(options) { this.options = options; }
    putObject(options, callback) {
      uploads.push(options);
      this.options.getAuthorization({}, credentials => assert.equal(credentials.SecurityToken, 'test-session'));
      callback(putFail ? new Error('COS 上传失败') : null, { Location: 'test.cos.example/' + options.Key });
    }
  }
  const auth = { ensureAuthenticated: async () => {}, isAdmin: () => true, getUserInfo: () => ({ userId: '42' }) };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, wx, console: { log() {}, warn() {}, error() {} },
      Page: value => { definition = value; },
      require(name) {
        if (name === 'cos-wx-sdk-v5') return FakeCOS;
        if (name.endsWith('/auth')) return auth;
        if (name.endsWith('/config')) return config;
        if (name.endsWith('/pageSync')) return { recordMutation() {} };
        if (name.endsWith('/media')) return { compressImage: async () => {
          if (compressionFail) throw new Error('压缩失败');
          return { path: '/tmp/compressed.jpg' };
        } };
        return load(path.resolve(path.dirname(filename), name + '.js'));
      }
    }, { filename });
    return module.exports;
  }
  load(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.js'));
  const page = { ...definition, data: structuredClone(definition.data), _authorized: true };
  page.setData = patch => Object.assign(page.data, patch);
  page.data.userId = '7'; page.data.voucherImages = ['https://example.com/saved.jpg'];
  return { page, requests, uploads, config };
}

test('凭证图片使用指定目录的临时凭证和 COS PUT，压缩图片并保存 CDN 地址', async () => {
  const env = harness();
  await env.page.uploadVoucherImages();
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].url, env.config.API_BASE_URL + '/files/cos-credentials?dir=commission-vouchers');
  assert.equal(env.requests[0].method, 'GET');
  assert.equal(env.requests[0].header.Authorization, 'Bearer test-access');
  assert.equal(env.requests[0].header['X-Active-Role'], 'admin');
  assert.equal(env.uploads.length, 1);
  assert.equal(env.uploads[0].Bucket, 'test-bucket');
  assert.match(env.uploads[0].Key, /^xzm\/commission-vouchers\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9]+\.jpg$/);
  assert.equal(env.uploads[0].Body.byteLength, 3);
  assert.equal(env.page.data.voucherImages[1], 'https://upload-dev.xianzaimai.com/' + env.uploads[0].Key);
  assert.equal(env.page.data.busy, false);
  assert.equal(env.page.data.error, '');
});

test('COS 临时凭证失败保留已有图片并显示错误，不回退到后端上传', async () => {
  const env = harness({ credentialsFail: true });
  await env.page.uploadVoucherImages();
  assert.equal(env.uploads.length, 0);
  assert.equal(env.page.data.voucherImages.length, 1);
  assert.match(env.page.data.error, /获取凭证失败/);
  assert.equal(env.page.data.busy, false);
});

test('COS PUT 失败保留已有图片并显示错误，不回退到后端上传', async () => {
  const env = harness({ putFail: true });
  await env.page.uploadVoucherImages();
  assert.equal(env.page.data.voucherImages.length, 1);
  assert.match(env.page.data.error, /COS 上传失败/);
  assert.equal(env.page.data.busy, false);
});

test('压缩失败仍使用原图片通过 COS 上传', async () => {
  const env = harness({ compressionFail: true });
  await env.page.uploadVoucherImages();
  assert.equal(env.page.data.voucherImages.length, 2);
  assert.equal(env.uploads.length, 1);
  assert.equal(env.page.data.error, '');
});
