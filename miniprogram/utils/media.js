/**
 * 判断是否为远程网络 URL（非本地临时文件）
 */
function isRemoteUrl(path) {
  if (path.startsWith('https://')) return true;
  if (path.startsWith('http://')) {
    // 开发者工具中本地临时文件路径以 http://tmp/ 开头，不是远程 URL
    if (path.startsWith('http://tmp/') || path.startsWith('http://localhost') || path.startsWith('http://127.0.0.1')) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * 压缩图片，失败时降级返回原图路径
 * @param {string} filePath 图片临时路径
 * @param {number} quality 压缩质量 0-100，默认 80
 * @returns {Promise<{path: string, ok: boolean, reason?: string}>}
 */
function compressImage(filePath, quality = 80) {
  if (isRemoteUrl(filePath)) {
    return Promise.resolve({ path: filePath, ok: false, reason: '远程图片无需压缩' });
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
  if (isRemoteUrl(filePath)) {
    return Promise.resolve({ path: filePath, ok: false, reason: '远程视频无需压缩' });
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
 * 确保临时文件路径包含 .webp 后缀（用于 COS 上传时提取正确的扩展名）
 */
function ensureWebpExt(filePath) {
  if (/\.webp$/i.test(filePath)) return filePath;
  var base = filePath.replace(/\.[^.]+$/, '');
  if (base === filePath) base = filePath;
  var newPath = base + '.webp';
  try {
    var fs = wx.getFileSystemManager();
    // 先验证原文件存在（macOS temp 路径可能已失效）
    try { fs.accessSync(filePath); }
    catch (e) { console.warn('[ensureWebpExt] 原文件不存在，跳过重命名'); return filePath; }
    fs.renameSync(filePath, newPath);
    return newPath;
  } catch (e) {
    console.warn('[ensureWebpExt] 重命名失败，使用原路径:', e);
    return filePath;
  }
}

/**
 * 将图片转换为 WebP 格式，失败时降级返回原图
 * 超宽/超高图会自动等比缩放，避免 Canvas 内存溢出
 * @param {string} filePath 图片临时路径
 * @param {number} quality 质量 0-1，默认 0.8
 * @returns {Promise<{path: string, ok: boolean, reason?: string}>}
 */
function toWebp(filePath, quality = 0.8) {
  if (isRemoteUrl(filePath)) {
    return Promise.resolve({ path: filePath, ok: false, reason: '远程图片无需转换' });
  }

  const MAX_DIMENSION = 2048;

  return new Promise((resolve) => {
    wx.getImageInfo({
      src: filePath,
      success: (imgInfo) => {
        try {
          var drawWidth = imgInfo.width;
          var drawHeight = imgInfo.height;

          if (drawWidth > MAX_DIMENSION || drawHeight > MAX_DIMENSION) {
            var scale = MAX_DIMENSION / Math.max(drawWidth, drawHeight);
            drawWidth = Math.round(drawWidth * scale);
            drawHeight = Math.round(drawHeight * scale);
            console.log('[toWebp] 缩放: ' + imgInfo.width + 'x' + imgInfo.height + ' → ' + drawWidth + 'x' + drawHeight);
          }

          const canvas = wx.createOffscreenCanvas({
            type: '2d',
            width: drawWidth,
            height: drawHeight
          });
          const ctx = canvas.getContext('2d');
          const img = canvas.createImage();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, drawWidth, drawHeight);
            wx.canvasToTempFilePath({
              canvas: canvas,
              fileType: 'webp',
              quality: quality,
              success: (res) => {
                var webpPath = ensureWebpExt(res.tempFilePath);
                console.log('[toWebp] 成功:', filePath, '→', webpPath);
                resolve({ path: webpPath, ok: true });
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
