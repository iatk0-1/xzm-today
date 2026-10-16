const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({ startFails = false, exportFails = false, noFrames = false } = {}) {
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const decoder = {
    start(options) { calls.push(['start', options]); return startFails ? Promise.reject(new Error('读取失败')) : Promise.resolve(); },
    getFrameData() {
      calls.push(['frame']);
      return noFrames ? null : { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]).buffer };
    },
    remove() { calls.push(['remove']); return Promise.resolve(); }
  };
  const wx = {
    createVideoDecoder: () => decoder,
    createOffscreenCanvas(options) {
      calls.push(['canvas', options]);
      return { getContext: () => ({
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: pixels => calls.push(['pixels', Array.from(pixels.data)])
      }) };
    },
    canvasToTempFilePath(options) {
      calls.push(['export', options]);
      if (exportFails) options.fail({}); else options.success({ tempFilePath: 'wx://first-frame.jpg' });
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/videoCover.js'), 'utf8'), {
    module, wx, Uint8ClampedArray,
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  return { extract: module.exports.extractVideoCover, calls, timers };
}

test('本地和已有远程视频共用第一帧解码和JPEG导出规则，不上传视频', async () => {
  for (const source of ['wx://video.mp4', 'https://example.com/video.mp4']) {
    const { extract, calls, timers } = setup();
    assert.equal(await extract(source), 'wx://first-frame.jpg');
    assert.equal(calls.find(row => row[0] === 'start')[1].source, source);
    assert.equal(calls.filter(row => row[0] === 'frame').length, 1);
    assert.deepEqual(calls.find(row => row[0] === 'pixels')[1], [255, 0, 0, 255, 0, 255, 0, 255]);
    const output = calls.find(row => row[0] === 'export')[1];
    assert.equal(output.fileType, 'jpg');
    assert.equal(output.quality, 0.9);
    assert.equal(calls.filter(row => row[0] === 'remove').length, 1);
    assert.equal(timers.size, 0);
  }
});

test('视频读取与封面导出失败均释放解码器，不返回假封面', async () => {
  for (const options of [{ startFails: true }, { exportFails: true }]) {
    const { extract, calls, timers } = setup(options);
    await assert.rejects(extract('https://example.com/video.mp4'), /失败/);
    assert.equal(calls.filter(row => row[0] === 'remove').length, 1);
    assert.equal(timers.size, 0);
  }
});

test('没有可解码画面时超时退出并清理重试计时器', async () => {
  const { extract, calls, timers } = setup({ noFrames: true });
  const pending = extract('https://example.com/video.mp4');
  await Promise.resolve();
  const timeout = Array.from(timers.values()).find(item => item.delay === 20000);
  timeout.fn();
  await assert.rejects(pending, /超时/);
  assert.equal(calls.filter(row => row[0] === 'remove').length, 1);
  assert.equal(timers.size, 0);
});
