const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const setup = require('./helpers/mediaGallery');
const plain = value => JSON.parse(JSON.stringify(value));
const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
const metadata = (src, width, height, index = 0) => ({ currentTarget: { dataset: { src, index } }, detail: { width, height } });

test('图片按4:5保留面积规则逐张适配，横图完整显示，旧数据回调不覆盖新图', () => {
  const { instance: gallery } = setup({ images: ['portrait', 'wide'] });
  gallery.onImageLoad(metadata('portrait', 800, 1000));
  gallery.onImageLoad(metadata('wide', 1600, 900, 1));
  assert.deepEqual(plain(gallery.data.bannerImageModes), ['aspectFill', 'aspectFit']);
  gallery.data.images = ['new']; gallery.resetMedia();
  gallery.onImageLoad(metadata('portrait', 800, 1000));
  assert.deepEqual(plain(gallery.data.bannerImageModes), ['aspectFit']);
});

test('视频在首位计入横滑索引，滑离视频自动暂停且末尾不循环', () => {
  const env = setup({ images: ['photo'], videoUrl: 'video' });
  const gallery = env.instance;
  const before = env.pauses();
  gallery.onTouchStart(touch(200, 100)); gallery.onTouchMove(touch(100, 102)); gallery.onTouchEnd();
  assert.equal(gallery.data.bannerIndex, 1);
  assert.equal(gallery.data.bannerTranslateX, -375);
  assert.equal(env.pauses(), before + 1);
  gallery.onTouchStart(touch(200, 100)); gallery.onTouchMove(touch(100, 102)); gallery.onTouchEnd();
  assert.equal(gallery.data.bannerIndex, 1);
  assert.ok(env.events.some(event => event.name === 'scrolllockchange' && event.detail.locked));
  assert.equal(env.events.at(-2).detail.locked, false);
});

test('宽屏视频按实际画面缩小播放器并保留白边，忽略旧视频元数据', () => {
  const { instance: gallery } = setup({ videoUrl: 'video' });
  gallery.onVideoMetadata(metadata('video', 720, 1280));
  assert.equal(gallery.data.bannerVideoFit, 'contain');
  assert.equal(gallery.data.bannerVideoStyle, 'width: 70.3125%; height: 100%;');
  gallery.onVideoMetadata(metadata('video', 800, 1000));
  assert.equal(gallery.data.bannerVideoFit, 'cover');
  gallery.data.videoUrl = 'new'; gallery.resetMedia();
  gallery.onVideoMetadata(metadata('video', 800, 1000));
  assert.equal(gallery.data.bannerVideoFit, 'contain');
});

test('尺寸变化保持当前媒体索引，切换记录回到首项并解除滚动锁', () => {
  const { instance: gallery, windowInfo } = setup({ images: ['a', 'b'], mediaKey: '1' });
  gallery.onTouchStart(touch(200, 100)); gallery.onTouchMove(touch(100, 100)); gallery.onTouchEnd();
  windowInfo.windowWidth = 430; gallery.resizeGallery();
  assert.equal(gallery.data.bannerBaseHeight, 537.5);
  assert.equal(gallery.data.bannerTranslateX, -430);
  gallery.onTouchStart(touch(200, 100)); gallery.onTouchMove(touch(100, 100));
  gallery.data.mediaKey = '2'; gallery.resetMedia();
  assert.equal(gallery.data.scrollLocked, false);
  assert.equal(gallery.data.bannerIndex, 0);
  assert.equal(gallery.data.bannerTranslateX, 0);
});

test('普通图片点击预览全组，拖动和禁用状态不误触预览，空组安全处理', () => {
  const { instance: gallery, previews } = setup({ images: ['a', '', 'b'] });
  gallery.previewImage({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(previews[0].current, 'b');
  assert.deepEqual(plain(previews[0].urls), ['a', 'b']);
  gallery.onTouchStart(touch(200, 100)); gallery.onTouchMove(touch(100, 100)); gallery.onTouchEnd();
  gallery.previewImage({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(previews.length, 1);
  gallery.data.images = []; gallery.resetMedia();
  gallery.previewImage({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(previews.length, 1);
});

test('打开外层弹窗、页面隐藏和卸载都暂停视频并释放横滑锁', () => {
  const { instance: gallery, definition, pauses } = setup({ images: ['a'], videoUrl: 'video' });
  for (const stop of [() => definition.observers.inactive.call(gallery, true),
    () => definition.pageLifetimes.hide.call(gallery), () => definition.lifetimes.detached.call(gallery)]) {
    gallery.onTouchStart(touch(200, 100)); gallery.onTouchMove(touch(100, 100));
    const count = pauses(); stop();
    assert.equal(gallery.data.scrollLocked, false);
    assert.equal(pauses(), count + 1);
  }
});

test('商品和心愿详情注册并使用同一组件，横滑事件连接各自外层scroll-view', () => {
  const root = path.resolve(__dirname, '../..');
  for (const page of ['detail', 'wishDetail']) {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'pages', page, page + '.json'), 'utf8'));
    assert.equal(config.usingComponents['media-gallery'], '../../components/mediaGallery/index');
  }
  const product = fs.readFileSync(path.join(root, 'components/productDetail/document.wxml'), 'utf8');
  const wish = fs.readFileSync(path.join(root, 'pages/wishDetail/wishDetail.wxml'), 'utf8');
  assert.match(product, /<media-gallery[^>]*bindscrolllockchange="onGalleryScrollLockChange"/);
  assert.match(wish, /<media-gallery[^>]*bindscrolllockchange="onGalleryScrollLockChange"/);
  assert.doesNotMatch(wish, /wish-swiper|swiper-item/);
  assert.match(wish, /scroll-y="[^"\n]*!pageBannerScrollLocked/);
});
