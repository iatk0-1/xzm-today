const test = require('node:test');
const assert = require('node:assert/strict');
const { resize } = require('../../utils/afterSaleSheet');

test('弹层短内容按实际高度展示，长内容给安全区和固定按钮留足空间', () => {
  const previous = global.wx;
  const pending = [];
  global.wx = {
    nextTick: callback => callback(),
    getWindowInfo: () => ({ windowHeight: 800, screenHeight: 900, safeArea: { bottom: 870 } }),
    createSelectorQuery() {
      const query = { select: () => query, boundingClientRect: () => query, exec: callback => pending.push(callback) };
      return query;
    }
  };
  try {
    const page = { data: { showReviewModal: true }, setData(patch) { Object.assign(this.data, patch); } };
    resize(page);
    pending.shift()([{ height: 180 }, { height: 50 }, { height: 60 }, { height: 3 }]);
    assert.equal(page.data.sheetBodyHeight, 180);
    resize(page);
    pending.shift()([{ height: 1800 }, { height: 50 }, { height: 60 }, { height: 3 }]);
    assert.equal(page.data.sheetBodyHeight, 545);
    resize(page);
    page.data.showReviewModal = false;
    pending.shift()([{ height: 120 }]);
    assert.equal(page.data.sheetBodyHeight, 545);
  } finally { global.wx = previous; }
});
