// 固定工具栏按滚动距离收放；列表保留完整占位，避免高度变化造成滚动抖动。
function wrap(config, options = {}) {
  const ready = config.onReady;
  const resize = config.onResize;
  const show = config.onShow;
  const unload = config.onUnload;
  const scroll = config.onPageScroll;
  const backToTop = config.backToTop;
  return {
    ...config,
    data: {
      ...config.data,
      toolbarSectionStyles: [], toolbarCollapseHeight: 0,
      toolbarCollapseOffset: 0, toolbarPlaceholderHeight: 0
    },
    onReady(...args) {
      this._collapsibleToolbarReady = true;
      const result = ready && ready.apply(this, args);
      this.measureCollapsibleToolbar();
      return result;
    },
    onResize(...args) {
      const result = resize && resize.apply(this, args);
      this.measureCollapsibleToolbar();
      return result;
    },
    onShow(...args) {
      const result = show && show.apply(this, args);
      this.measureCollapsibleToolbar();
      return result;
    },
    onUnload(...args) {
      this._collapsibleToolbarReady = false;
      return unload && unload.apply(this, args);
    },
    measureCollapsibleToolbar() {
      if (!this._collapsibleToolbarReady || typeof wx.createSelectorQuery !== 'function') return;
      const version = (this._toolbarMeasurementVersion || 0) + 1;
      this._toolbarMeasurementVersion = version;
      const measure = () => {
        if (!this._collapsibleToolbarReady || version !== this._toolbarMeasurementVersion) return;
        const oldHeight = this.data.toolbarCollapseHeight;
        const oldOffset = this.data.toolbarCollapseOffset;
        const query = wx.createSelectorQuery().in(this);
        query.select('#collapsible-toolbar').boundingClientRect();
        query.selectAll('.collapsible-panel-content').boundingClientRect();
        query.exec(results => {
          if (!this._collapsibleToolbarReady || version !== this._toolbarMeasurementVersion) return;
          const [toolbar, sections] = results || [];
          if (!toolbar || !Array.isArray(sections) || !sections.length) return;
          this._toolbarSectionHeights = sections.map(section => Math.max(0, Number(section.height) || 0));
          const height = this._toolbarSectionHeights.reduce((sum, value) => sum + value, 0);
          const currentOffset = this.data.toolbarCollapseOffset;
          const offset = oldHeight > 0 && currentOffset >= oldHeight ? height : Math.min(currentOffset, height);
          this.setData({
            toolbarCollapseHeight: height,
            toolbarPlaceholderHeight: toolbar.height + oldOffset + (oldHeight > 0 ? height - oldHeight : 0)
          });
          this.setToolbarCollapseOffset(offset);
        });
      };
      if (typeof wx.nextTick === 'function') wx.nextTick(measure);
      else measure();
    },
    setToolbarCollapseOffset(offset) {
      const height = this.data.toolbarCollapseHeight;
      this.setData({
        toolbarCollapseOffset: offset,
        toolbarSectionStyles: (this._toolbarSectionHeights || []).map(value =>
          `height:${height > 0 ? Math.max(0, Math.round(value * (1 - offset / height) * 100) / 100) : value}px;`)
      });
    },
    handleToolbarScroll(scrollTop) {
      const top = Math.max(0, Number(scrollTop) || 0);
      const previousTop = this._toolbarScrollTop || 0;
      this._toolbarScrollTop = top;
      if (this._toolbarReturningToTop || top === 0) {
        if (this.data.toolbarCollapseOffset !== 0) this.setToolbarCollapseOffset(0);
        if (top === 0) this._toolbarReturningToTop = false;
        return;
      }
      if (!this.data.toolbarCollapseHeight || (options.blockedFields || []).some(field => this.data[field])) return;
      const offset = Math.max(0, Math.min(this.data.toolbarCollapseHeight,
        this.data.toolbarCollapseOffset + top - previousTop));
      if (offset !== this.data.toolbarCollapseOffset) this.setToolbarCollapseOffset(offset);
    },
    onPageScroll(event) {
      if (!options.scrollView) this.handleToolbarScroll(event.scrollTop);
      if (scroll) return scroll.call(this, event);
    },
    onToolbarScroll(event) { this.handleToolbarScroll(event.detail.scrollTop); },
    onToolbarTouchStart() { this._toolbarReturningToTop = false; },
    ...(backToTop ? { backToTop(...args) {
      this._toolbarReturningToTop = (this._toolbarScrollTop || 0) > 0;
      this.setToolbarCollapseOffset(0);
      return backToTop.apply(this, args);
    } } : {})
  };
}

module.exports = { wrap };
