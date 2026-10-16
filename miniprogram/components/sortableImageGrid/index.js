const ITEM_SIZE = 105;
const COLUMNS = 3;

Component({
  properties: {
    images: {
      type: Array,
      value: [],
      observer(images) {
        this._drag = null;
        const items = (images || []).map((url, index) => ({ id: index, url }));
        this.layout(items);
      }
    }
  },
  data: { items: [], dragIndex: -1, areaHeight: ITEM_SIZE, addX: 0, addY: 0 },
  methods: {
    layout(items) {
      this.setData({
        items: items.map((item, index) => ({
          ...item, x: (index % COLUMNS) * ITEM_SIZE, y: Math.floor(index / COLUMNS) * ITEM_SIZE
        })),
        dragIndex: -1,
        areaHeight: Math.ceil((items.length + 1) / COLUMNS) * ITEM_SIZE,
        addX: (items.length % COLUMNS) * ITEM_SIZE,
        addY: Math.floor(items.length / COLUMNS) * ITEM_SIZE
      });
    },
    add() { this.triggerEvent('add'); },
    preview(e) {
      if (this._drag || Date.now() < (this._suppressPreviewUntil || 0)) return;
      this.triggerEvent('preview', { index: Number(e.currentTarget.dataset.index) });
    },
    remove(e) {
      const items = this.data.items.slice();
      items.splice(Number(e.currentTarget.dataset.index), 1);
      this._drag = null;
      this.layout(items);
      this.triggerEvent('change', { images: items.map(item => item.url) });
    },
    start(e) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.items[index];
      if (!item) return;
      // 从当前格子起算，长按后直接松手也不会把图片移到第一格。
      this._drag = { index, x: item.x, y: item.y };
      this.setData({ dragIndex: index });
      wx.vibrateShort();
    },
    move(e) {
      if (!this._drag || Number(e.currentTarget.dataset.index) !== this._drag.index
          || e.detail.source !== 'touch') return;
      this._drag.x = e.detail.x;
      this._drag.y = e.detail.y;
    },
    end() {
      if (!this._drag) return;
      const { index, x, y } = this._drag;
      const items = this.data.items.slice();
      const col = Math.max(0, Math.min(COLUMNS - 1, Math.round(x / ITEM_SIZE)));
      const row = Math.max(0, Math.round(y / ITEM_SIZE));
      const target = Math.min(items.length - 1, row * COLUMNS + col);
      if (target !== index) items.splice(target, 0, items.splice(index, 1)[0]);
      this._drag = null;
      this._suppressPreviewUntil = Date.now() + 300;
      this.layout(items);
      if (target !== index) this.triggerEvent('change', { images: items.map(item => item.url) });
    },
    cancel() {
      this._drag = null;
      this._suppressPreviewUntil = Date.now() + 300;
      this.layout(this.data.items);
    }
  }
});
