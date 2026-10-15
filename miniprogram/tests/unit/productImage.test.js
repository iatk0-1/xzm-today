const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripJpegIcc, productImageUrl, normalizeProductImages } = require('../../utils/productImage');
const { CDN_BASE_URL } = require('../../utils/config');

function segment(marker, payload) {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([255, marker]), length, payload]);
}
function icc(space, sequence = 1) {
  const profile = Buffer.alloc(40);
  profile.write(space, 16);
  return segment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.from([sequence, 2]), profile]));
}
const exif = segment(0xe1, Buffer.from('Exif\0\0方向数据'));
const otherApp2 = segment(0xe2, Buffer.from('其他非ICC数据'));
const scan = Buffer.from([255, 218, 0, 2, 1, 255, 0, 2, 255, 217]);
const makeJpeg = (...profiles) => Buffer.concat([Buffer.from([255, 216]), exif, ...profiles, otherApp2, scan]);
const arrayBuffer = buffer => Uint8Array.from(buffer).buffer;

test('灰度 ICC 全部分段被移除，EXIF、非 ICC APP2 和压缩像素逐字节保留', () => {
  const result = stripJpegIcc(arrayBuffer(makeJpeg(icc('GRAY'), icc('GRAY', 2))));
  assert.deepEqual(Buffer.from(result), makeJpeg());
});

test('彩色 ICC、无 ICC JPEG、PNG 和视频保持原始内容', () => {
  for (const buffer of [makeJpeg(icc('RGB ')), makeJpeg(), Buffer.from('PNG文件'), Buffer.from('视频')]) {
    const data = arrayBuffer(buffer);
    assert.equal(stripJpegIcc(data), data);
  }
});

test('截断 JPEG 在上传前报错，不发送不完整文件', () => {
  assert.throws(() => stripJpegIcc(arrayBuffer(Buffer.from([255, 216, 255, 226, 0, 30, 1]))), /不完整/);
});

test('历史图片去元数据处理限定自有 CDN JPEG，重复处理和其他地址保持原样', () => {
  const url = CDN_BASE_URL + '/xzm/products/gray.jpg';
  const safe = url + '?imageMogr2/strip';
  assert.equal(productImageUrl(url), safe);
  for (const other of [safe, url + '?sign=test', 'https://other.example/a.jpg',
    CDN_BASE_URL + '.example/a.jpg', 'http://tmp/a.jpg', 'wxfile://a.jpg', CDN_BASE_URL + '/a.png']) {
    assert.equal(productImageUrl(other), other);
  }
  const product = { coverUrl: url, bannerImages: [url], lookbookImages: [url], detailImages: [url],
    skuMatrix: [{ imageUrl: url, skuId: '1' }], videoUrl: CDN_BASE_URL + '/a.mp4' };
  const result = normalizeProductImages(product);
  assert.equal(result.coverUrl, safe);
  for (const key of ['bannerImages', 'lookbookImages', 'detailImages']) assert.deepEqual(result[key], [safe]);
  assert.equal(result.skuMatrix[0].imageUrl, safe);
  assert.equal(result.videoUrl, product.videoUrl);
  assert.equal(product.lookbookImages[0], url);
});

test('商品 COS 上传发送去灰度 ICC 后的数据，其他上传目录不改动', async () => {
  const source = arrayBuffer(makeJpeg(icc('GRAY')));
  const uploads = [];
  const module = { exports: {} };
  class FakeCOS {
    putObject(options, callback) {
      uploads.push(options);
      callback(null, { Location: 'example/' + options.Key });
    }
  }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/cos-upload.js'), 'utf8'), {
    module, console: { log() {}, error() {} },
    wx: { getFileSystemManager: () => ({ accessSync() {}, readFile: options => options.success({ data: source }) }) },
    require(name) {
      if (name === './productImage') return { stripJpegIcc };
      if (name === './error') return { normalizeApiError: error => error };
      if (name === 'cos-wx-sdk-v5') return FakeCOS;
      if (name === './api') return { getCosCredentials: async () => ({ cdnDomain: 'example' }) };
      throw new Error(name);
    }
  });
  await module.exports.uploadFile('/tmp/gray.jpg', 'products');
  await module.exports.uploadFile('/tmp/gray.jpg', 'chats');
  assert.deepEqual(Buffer.from(uploads[0].Body), makeJpeg());
  assert.equal(uploads[1].Body, source);
});
