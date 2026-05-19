/**
 * 压缩图片，失败时降级返回原图路径
 * @param {string} filePath 图片临时路径
 * @param {number} quality 压缩质量 0-100，默认 80
 * @returns {Promise<string>} 压缩后的图片临时路径
 */
function compressImage(filePath, quality = 80) {
  // 网络图片不需要压缩
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return Promise.resolve(filePath);
  }
  return new Promise((resolve) => {
    wx.compressImage({
      src: filePath,
      quality: quality,
      success: (res) => {
        console.log('图片压缩成功:', filePath, '→', res.tempFilePath);
        resolve(res.tempFilePath);
      },
      fail: (err) => {
        console.warn('图片压缩失败，使用原图:', err);
        resolve(filePath); // 降级：部分旧版本不支持 compressImage
      }
    });
  });
}

/**
 * 压缩视频，失败时降级返回原视频路径
 * @param {string} filePath 视频临时路径
 * @param {'low'|'medium'|'high'} quality 压缩质量，默认 medium
 * @returns {Promise<string>} 压缩后的视频临时路径
 */
function compressVideo(filePath, quality = 'medium') {
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return Promise.resolve(filePath);
  }
  return new Promise((resolve) => {
    wx.compressVideo({
      src: filePath,
      quality: quality,
      success: (res) => {
        console.log('视频压缩成功:', filePath, '→', res.tempFilePath);
        resolve(res.tempFilePath);
      },
      fail: (err) => {
        console.warn('视频压缩失败，使用原视频:', err);
        resolve(filePath); // 降级
      }
    });
  });
}

module.exports = { compressImage, compressVideo };
