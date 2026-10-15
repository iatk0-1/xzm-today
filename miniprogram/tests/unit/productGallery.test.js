const test = require('node:test');
const assert = require('node:assert/strict');
const { getGalleryLayout, getBannerImageMode, getDetailImageMode } = require('../../utils/productGallery');

test('顶部商品图按保留面积选择模式，80% 边界允许铺满', () => {
  for (const [width, height] of [[800, 1000], [750, 1000], [1000, 1000], [640, 1000]]) {
    assert.equal(getBannerImageMode(width, height), 'aspectFill');
  }
  for (const [width, height] of [[714, 102], [354, 99], [1200, 900], [500, 1000], [639, 1000], [1001, 1000]]) {
    assert.equal(getBannerImageMode(width, height), 'aspectFit');
  }
});

test('尺寸缺失或异常时完整显示，尺寸等比改变不影响判断', () => {
  for (const pair of [[0, 100], [100, 0], [-1, 100], [NaN, 100], [100, Infinity], [undefined, 100]]) {
    assert.equal(getBannerImageMode(...pair), 'aspectFit');
  }
  assert.equal(getBannerImageMode(80, 100), getBannerImageMode(1600, 2000));
});

test('半屏到全屏画廊始终保持 4:5，不根据当前图片调整高度', () => {
  for (const progress of [0, 0.5, 1]) {
    const layout = getGalleryLayout(375, progress, 3, 0);
    assert.equal(layout.galleryHeight / layout.galleryItemWidth, 1.25);
    assert.equal(layout.galleryBaseWidth, 375);
    assert.equal(layout.galleryBaseHeight, 468.75);
    assert.ok(Math.abs(layout.galleryBaseWidth * layout.galleryScale - layout.galleryItemWidth) < 1e-9);
    assert.ok(Math.abs(layout.galleryBaseHeight * layout.galleryScale - layout.galleryHeight) < 1e-9);
  }
});

test('细节轮播取消预览后按整页宽和 130vw 高判断，80% 边界允许铺满', () => {
  assert.equal(getDetailImageMode(714, 102), 'aspectFit');
  assert.equal(getDetailImageMode(750, 1000), 'aspectFill');
  assert.equal(getDetailImageMode(1000, 1000), 'aspectFit');
  assert.equal(getDetailImageMode(800, 1300), 'aspectFill');
  assert.equal(getDetailImageMode(799, 1300), 'aspectFit');
  assert.equal(getDetailImageMode(750, 1300), 'aspectFit');
});
