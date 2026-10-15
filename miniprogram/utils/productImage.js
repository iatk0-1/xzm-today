const { CDN_BASE_URL } = require('./config');

// 只移除 JPEG 的灰度 ICC APP2 段；不重新编码像素，也不删除 EXIF 方向信息。
// 灰度 ICC 被 CDN 带入 AVIF 后，部分浏览器会拒绝解码。
function stripJpegIcc(data) {
  const bytes = new Uint8Array(data);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return data;
  const ranges = [];
  let grayProfile = false;
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) throw new Error('JPEG 图片结构异常，请重新选择图片');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    // 扫描数据及其后的内容必须原样保留。
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error('JPEG 图片数据不完整，请重新选择图片');
    const length = bytes[offset] * 256 + bytes[offset + 1];
    const end = offset + length;
    if (length < 2 || end > bytes.length) throw new Error('JPEG 图片数据不完整，请重新选择图片');
    const signature = 'ICC_PROFILE\0';
    if (marker === 0xe2 && length >= 16 &&
        Array.from(signature).every((char, i) => bytes[offset + 2 + i] === char.charCodeAt(0))) {
      ranges.push([start, end]);
      // ICC 第一段中，配置头的第 16..19 字节标识色彩空间。
      if (bytes[offset + 14] === 1 && length >= 36 &&
          bytes[offset + 32] === 0x47 && bytes[offset + 33] === 0x52 &&
          bytes[offset + 34] === 0x41 && bytes[offset + 35] === 0x59) grayProfile = true;
    }
    offset = end;
  }
  if (!grayProfile) return data;
  const removed = ranges.reduce((sum, range) => sum + range[1] - range[0], 0);
  const result = new Uint8Array(bytes.length - removed);
  let source = 0;
  let target = 0;
  ranges.forEach(([start, end]) => {
    result.set(bytes.subarray(source, start), target);
    target += start - source;
    source = end;
  });
  result.set(bytes.subarray(source), target);
  return result.buffer;
}

// 已上传图片也需兼容。限定自有 CDN 和无参数 JPEG，避免改写外链、签名及已有处理参数。
function productImageUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(CDN_BASE_URL + '/')) return url;
  if (!/\.jpe?g$/i.test(url)) return url;
  return url + '?imageMogr2/strip';
}

function normalizeProductImages(product) {
  const result = { ...product };
  ['coverUrl', 'image'].forEach(key => {
    if (result[key]) result[key] = productImageUrl(result[key]);
  });
  ['bannerImages', 'lookbookImages', 'detailImages'].forEach(key => {
    if (Array.isArray(result[key])) result[key] = result[key].map(productImageUrl);
  });
  if (Array.isArray(result.skuMatrix)) {
    result.skuMatrix = result.skuMatrix.map(sku => ({ ...sku, imageUrl: productImageUrl(sku.imageUrl) }));
  }
  return result;
}

module.exports = { stripJpegIcc, productImageUrl, normalizeProductImages };
