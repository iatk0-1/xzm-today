/**
 * 压缩图片，失败时降级返回原图路径
 * @param {string} filePath 图片临时路径
 * @param {number} quality 压缩质量 0-100，默认 80
 * @returns {Promise<{path: string, ok: boolean, reason?: string}>}
 */
function compressImage(filePath, quality = 80) {
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return Promise.resolve({ path: filePath, ok: false, reason: '网络图片无需压缩' });
  }
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality: quality,
      success: (res) => {
        console.log('[compressImage] 成功:', filePath, '→', res.tempFilePath);
        resolve({ path: res.tempFilePath, ok: true });
      },
      fail: (err) => {
        console.warn('[compressImage] 失败:', err.errMsg || JSON.stringify(err));
        resolve({ path: filePath, ok: false, reason: err.errMsg || 'compressImage 失败' });
      }
    });
  });
}

/**
 * 压缩视频，失败时降级返回原视频路径
 * @param {string} filePath 视频临时路径
 * @param {'low'|'medium'|'high'} quality 压缩质量，默认 medium
 * @returns {Promise<{path: string, ok: boolean, reason?: string}>}
 */
function compressVideo(filePath, quality = 'medium') {
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return Promise.resolve({ path: filePath, ok: false, reason: '网络视频无需压缩' });
  }
  return new Promise((resolve) => {
    wx.compressVideo({
      src: filePath,
      quality: quality,
      success: (res) => {
        console.log('[compressVideo] 成功:', filePath, '→', res.tempFilePath);
        resolve({ path: res.tempFilePath, ok: true });
      },
      fail: (err) => {
        console.warn('[compressVideo] 失败:', err.errMsg || JSON.stringify(err));
        resolve({ path: filePath, ok: false, reason: err.errMsg || 'compressVideo 失败' });
      }
    });
  });
}

/**
 * 将图片转换为 WebP 格式，失败时降级返回原图
 * @param {string} filePath 图片临时路径
 * @param {number} quality 质量 0-1，默认 0.8
 * @returns {Promise<{path: string, ok: boolean, reason?: string}>}
 */
function toWebp(filePath, quality = 0.8) {
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return Promise.resolve({ path: filePath, ok: false, reason: '网络图片无需转换' });
  }
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: filePath,
      success: (imgInfo) => {
        try {
          const canvas = wx.createOffscreenCanvas({
            type: '2d',
            width: imgInfo.width,
            height: imgInfo.height
          });
          const ctx = canvas.getContext('2d');
          const img = canvas.createImage();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, imgInfo.width, imgInfo.height);
            wx.canvasToTempFilePath({
              canvas: canvas,
              fileType: 'webp',
              quality: quality,
              success: (res) => {
                console.log('[toWebp] 成功:', filePath, '→', res.tempFilePath);
                resolve({ path: res.tempFilePath, ok: true });
              },
              fail: (err) => {
                console.warn('[toWebp] canvasToTempFilePath 失败:', err.errMsg || JSON.stringify(err));
                resolve({ path: filePath, ok: false, reason: 'canvasToTempFilePath: ' + (err.errMsg || 'unknown') });
              }
            });
          };
          img.onerror = (err) => {
            console.warn('[toWebp] 图片加载失败:', err);
            resolve({ path: filePath, ok: false, reason: '离屏canvas图片加载失败' });
          };
          img.src = filePath;
        } catch (err) {
          console.warn('[toWebp] 离屏Canvas不可用:', err);
          resolve({ path: filePath, ok: false, reason: '离屏Canvas不可用: ' + (err.message || err) });
        }
      },
      fail: (err) => {
        console.warn('[toWebp] getImageInfo 失败:', err.errMsg || JSON.stringify(err));
        resolve({ path: filePath, ok: false, reason: 'getImageInfo: ' + (err.errMsg || 'unknown') });
      }
    });
  });
}

module.exports = { compressImage, compressVideo, toWebp };
