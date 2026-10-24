const { collectSkuImages, createImagePreloader } = require('./skuImagePreloader');

function remoteImages(urls) {
  return [...new Set(urls.filter(url => typeof url === 'string' && /^https:\/\//i.test(url)))];
}

function collectProductImages(product) {
  return remoteImages([
    product.coverUrl, product.image,
    ...(product.bannerImages || []),
    ...collectSkuImages(product),
    ...(product.lookbookImages || []),
    ...(product.detailImages || [])
  ]);
}

const imagePreloadMethods = {
  startImagePreload(urls, runtime) {
    if (!this._detailImagePreloader) this._detailImagePreloader = createImagePreloader(runtime);
    this.setData({ imagePaths: {} });
    this._detailImagePreloader.start(remoteImages(urls), (url, path) => {
      this.setData({ imagePaths: { ...this.data.imagePaths, [url]: path } });
    });
  },

  appendImagePreload(urls) {
    if (this._detailImagePreloader) this._detailImagePreloader.append(remoteImages(urls));
  },

  stopImagePreload() {
    if (this._detailImagePreloader) this._detailImagePreloader.stop();
  },

  onPreloadedImageError(e) {
    const url = (e.detail && e.detail.url) || (e.currentTarget.dataset || {}).src;
    if (!url || !this.data.imagePaths[url]) return;
    if (this._detailImagePreloader) this._detailImagePreloader.invalidate(url);
    const paths = { ...this.data.imagePaths };
    delete paths[url];
    this.setData({ imagePaths: paths });
  },

  resolvePreloadedImage(url) {
    return this.data.imagePaths[url] || url;
  }
};

module.exports = { collectProductImages, imagePreloadMethods };
