// 本地与远程视频共用同一条取帧路径；不使用选视频时附带的系统缩略图。
function extractVideoCover(source) {
  if (!wx.createVideoDecoder || !wx.createOffscreenCanvas) {
    return Promise.reject(new Error('当前微信版本不支持生成视频封面，请升级微信后重试'));
  }
  return new Promise((resolve, reject) => {
    let decoder;
    let poll;
    let timeout;
    let finished = false;
    const finish = (error, path) => {
      if (finished) return;
      finished = true;
      clearTimeout(poll);
      clearTimeout(timeout);
      if (decoder) Promise.resolve().then(() => decoder.remove()).catch(() => {});
      if (error) reject(error); else resolve(path);
    };
    const read = () => {
      if (finished) return;
      try {
        const frame = decoder.getFrameData();
        if (!frame || !frame.data) { poll = setTimeout(read, 30); return; }
        // 第一次读到的画面就是第一个可解码画面；等待导出期间停止读帧。
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: frame.width, height: frame.height });
        const context = canvas.getContext('2d');
        const pixels = context.createImageData(frame.width, frame.height);
        pixels.data.set(new Uint8ClampedArray(frame.data));
        context.putImageData(pixels, 0, 0);
        const scale = Math.min(1, 1280 / Math.max(frame.width, frame.height));
        wx.canvasToTempFilePath({
          canvas, fileType: 'jpg', quality: 0.9,
          destWidth: Math.max(1, Math.round(frame.width * scale)),
          destHeight: Math.max(1, Math.round(frame.height * scale)),
          success: result => result.tempFilePath
            ? finish(null, result.tempFilePath) : finish(new Error('视频封面导出失败，请重试')),
          fail: () => finish(new Error('视频封面导出失败，请重试'))
        });
      } catch (error) { finish(new Error('视频封面生成失败，请重试')); }
    };
    try {
      decoder = wx.createVideoDecoder();
      timeout = setTimeout(() => finish(new Error('视频封面生成超时，请检查网络后重试')), 20000);
      Promise.resolve(decoder.start({ source, mode: 0, abortAudio: true }))
        .then(read).catch(() => finish(new Error('视频读取失败，请检查网络后重试')));
    } catch (error) { finish(new Error('视频封面生成失败，请重试')); }
  });
}

module.exports = { extractVideoCover };
