// 短表单按内容撑开，长表单限制到可视区；不触发任何业务请求。
function resize(page) {
  if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
  const version = page._sheetMeasureVersion = (page._sheetMeasureVersion || 0) + 1;
  const measure = () => {
    if (!page.data.showReviewModal && !page.data.showReceiveModal && !page.data.showNegotiatedRefundModal) return;
    const query = wx.createSelectorQuery();
    query.select('.modal-body-inner').boundingClientRect();
    query.select('.modal-title').boundingClientRect();
    query.select('.modal-actions').boundingClientRect();
    query.select('.sheet-handle').boundingClientRect();
    query.exec(rects => {
      if (version !== page._sheetMeasureVersion || !rects || !rects[0]
        || (!page.data.showReviewModal && !page.data.showReceiveModal && !page.data.showNegotiatedRefundModal)) return;
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const chromeHeight = rects.slice(1).reduce((total, rect) => total + (rect ? rect.height : 0), 0);
      const safeBottom = info.safeArea && info.screenHeight ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0;
      const maxBody = Math.max(80, info.windowHeight * 0.88 - chromeHeight - safeBottom - 16);
      const height = Math.ceil(Math.min(rects[0].height, maxBody));
      if (height !== page.data.sheetBodyHeight) page.setData({ sheetBodyHeight: height });
    });
  };
  if (typeof wx.nextTick === 'function') wx.nextTick(measure);
  else measure();
}

module.exports = { resize };
