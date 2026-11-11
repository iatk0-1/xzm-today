// 统一使用视口坐标：滚出屏幕上方的条目仍在虚线以上，跨线的条目暂不选中。
function getKeysAboveLine(page) {
  return new Promise(resolve => {
    const query = wx.createSelectorQuery().in(page);
    query.select('#selection-divider').boundingClientRect();
    query.selectAll('.above-selection-item').boundingClientRect();
    query.exec(results => {
      const [divider, items] = results || [];
      if (!divider || !Array.isArray(items)) return resolve(new Set());
      const lineY = divider.top + divider.height / 2;
      resolve(new Set(items
        .filter(item => item && item.height > 0 && item.bottom <= lineY
          && item.dataset && item.dataset.selectionKey != null)
        .map(item => String(item.dataset.selectionKey))));
    });
  });
}

module.exports = { getKeysAboveLine };
