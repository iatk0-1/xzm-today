// 按图片数量生成分享卡片：单图铺满、双图左右、三图三联拼图。
const SHARE_IMAGE_WIDTH = 500;
const SHARE_IMAGE_HEIGHT = 400;
const SHARE_GAP = 4;
const LEFT_WIDTH = (SHARE_IMAGE_WIDTH - SHARE_GAP) / 2;
const RIGHT_X = LEFT_WIDTH + SHARE_GAP;
const RIGHT_WIDTH = SHARE_IMAGE_WIDTH - RIGHT_X;
const RIGHT_HEIGHT = (SHARE_IMAGE_HEIGHT - SHARE_GAP) / 2;
const BOTTOM_Y = RIGHT_HEIGHT + SHARE_GAP;

function getImageInfo(src) {
  return new Promise(function(resolve, reject) {
    wx.getImageInfo({
      src: src,
      success: resolve,
      fail: reject
    });
  });
}

function getCoverCrop(sourceX, sourceY, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  var sourceRatio = sourceWidth / sourceHeight;
  var targetRatio = targetWidth / targetHeight;
  var cropWidth = sourceWidth;
  var cropHeight = sourceHeight;
  var cropX = sourceX;
  var cropY = sourceY;

  if (sourceRatio > targetRatio) {
    cropWidth = sourceHeight * targetRatio;
    cropX = sourceX + (sourceWidth - cropWidth) / 2;
  } else {
    cropHeight = sourceWidth / targetRatio;
    cropY = sourceY + (sourceHeight - cropHeight) / 2;
  }

  return {
    x: cropX,
    y: cropY,
    width: cropWidth,
    height: cropHeight
  };
}

function drawCover(context, imageResource, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height) {
  var crop = getCoverCrop(sourceX, sourceY, sourceWidth, sourceHeight, width, height);
  context.drawImage(
    imageResource,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    x,
    y,
    width,
    height
  );
}

function drawSingleImage(context, imageInfo, fallbackSource, x, y, width, height) {
  drawCover(
    context,
    imageInfo.path || fallbackSource,
    0,
    0,
    Number(imageInfo.width) || SHARE_IMAGE_WIDTH,
    Number(imageInfo.height) || SHARE_IMAGE_HEIGHT,
    x,
    y,
    width,
    height
  );
}

function createShareImage(page, sources, canvasId) {
  var imageSources = (Array.isArray(sources) ? sources : [sources])
    .filter(function(src) { return typeof src === 'string' && src; })
    .slice(0, 3);
  if (imageSources.length === 0) return Promise.resolve('');

  return Promise.all(imageSources.map(function(src) {
    return getImageInfo(src).then(function(imageInfo) {
      return { info: imageInfo, source: src };
    }).catch(function(err) {
      console.warn('读取分享图片失败:', err);
      return null;
    });
  })).then(function(images) {
    images = images.filter(function(image) { return image; });
    if (images.length === 0) return '';

    var context = wx.createCanvasContext(canvasId, page);
    context.setFillStyle('#f6f6f6');
    context.fillRect(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT);

    if (images.length === 1) {
      drawSingleImage(context, images[0].info, images[0].source, 0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT);
    } else if (images.length === 2) {
      drawSingleImage(context, images[0].info, images[0].source, 0, 0, LEFT_WIDTH, SHARE_IMAGE_HEIGHT);
      drawSingleImage(context, images[1].info, images[1].source, RIGHT_X, 0, RIGHT_WIDTH, SHARE_IMAGE_HEIGHT);
    } else {
      // 三张及以上只取前三张：第一张左边，第二张右上，第三张右下。
      drawSingleImage(context, images[0].info, images[0].source, 0, 0, LEFT_WIDTH, SHARE_IMAGE_HEIGHT);
      drawSingleImage(context, images[1].info, images[1].source, RIGHT_X, 0, RIGHT_WIDTH, RIGHT_HEIGHT);
      drawSingleImage(context, images[2].info, images[2].source, RIGHT_X, BOTTOM_Y, RIGHT_WIDTH, RIGHT_HEIGHT);
    }

    return new Promise(function(resolve) {
      context.draw(false, function() {
        wx.canvasToTempFilePath({
          canvasId: canvasId,
          x: 0,
          y: 0,
          width: SHARE_IMAGE_WIDTH,
          height: SHARE_IMAGE_HEIGHT,
          destWidth: SHARE_IMAGE_WIDTH,
          destHeight: SHARE_IMAGE_HEIGHT,
          fileType: 'jpg',
          quality: 0.92,
          success: function(result) {
            resolve(result.tempFilePath || '');
          },
          fail: function(err) {
            console.warn('生成分享图片失败:', err);
            resolve('');
          }
        }, page);
      });
    });
  });
}

module.exports = {
  createShareImage: createShareImage
};
