// 首页 SKU 与详情页共用下载队列；缓存只保存当前实例会话中的临时文件路径。
function collectSkuImages(product, currentImage) {
  const urls = [currentImage, product.coverUrl, product.image];
  (product.skuMatrix || []).forEach(sku => urls.push(sku.imageUrl));
  (product.bundleGroups || []).forEach(group => {
    (group.skus || []).forEach(sku => urls.push(sku.imageUrl));
  });
  return [...new Set(urls.filter(url => typeof url === 'string' && /^https:\/\//i.test(url)))];
}

function createImagePreloader(runtime = typeof wx === 'undefined' ? {} : wx) {
  const cache = new Map();
  const active = new Set();
  let version = 0;
  let appendToQueue = null;

  function stop() {
    version++;
    appendToQueue = null;
    const requests = [...active];
    active.clear();
    requests.forEach(request => {
      if (request.task && request.task.abort) request.task.abort();
    });
  }

  function start(urls, onLoaded) {
    stop();
    const currentVersion = version;
    const queue = [...new Set(urls)];
    const seen = new Set(queue);
    let next = 0;

    function pump() {
      if (version !== currentVersion) return;
      while (active.size < 4 && next < queue.length) {
        const url = queue[next++];
        const request = { task: null, settled: false };
        active.add(request);

        function finish(path) {
          if (request.settled || version !== currentVersion) return;
          request.settled = true;
          active.delete(request);
          if (path) {
            cache.delete(url);
            cache.set(url, path);
            // 限制会话内索引大小，避免连续浏览商品时无限累积。
            if (cache.size > 120) cache.delete(cache.keys().next().value);
            onLoaded(url, path);
          }
          pump();
        }

        function download() {
          if (version !== currentVersion) return;
          if (typeof runtime.downloadFile !== 'function') return finish();
          try {
            request.task = runtime.downloadFile({
              url,
              timeout: 15000,
              success: res => finish(res.statusCode === 200 ? res.tempFilePath : ''),
              fail: () => finish()
            });
          } catch (error) {
            finish();
          }
        }

        const cachedPath = cache.get(url);
        if (cachedPath && typeof runtime.getFileSystemManager === 'function') {
          // 临时文件可能被微信清理，复用前先确认还在。
          try {
            runtime.getFileSystemManager().access({
              path: cachedPath,
              success: () => finish(cachedPath),
              fail: () => {
                if (version !== currentVersion) return;
                cache.delete(url);
                download();
              }
            });
          } catch (error) {
            cache.delete(url);
            download();
          }
        } else {
          download();
        }
      }
    }

    appendToQueue = moreUrls => {
      moreUrls.forEach(url => {
        if (!seen.has(url)) { seen.add(url); queue.push(url); }
      });
      pump();
    };
    pump();
  }

  return { start, stop, append: urls => { if (appendToQueue) appendToQueue(urls); }, invalidate: url => cache.delete(url) };
}

module.exports = { collectSkuImages, createImagePreloader, createSkuImagePreloader: createImagePreloader };
