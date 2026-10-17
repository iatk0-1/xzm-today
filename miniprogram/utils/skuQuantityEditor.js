// 数量输入期间保留原文；一次点击只负责收键盘，不能顺带触发按钮。
module.exports = {
  resetSkuQuantityEditing() {
    this._skuQuantityEditor = null;
    this._skuQuantityDismissTap = false;
  },

  skuQuantityInputFocus(e) {
    const dataset = e.currentTarget.dataset || {};
    this._skuQuantityEditor = {
      id: e.currentTarget.id,
      index: dataset.index == null ? null : Number(dataset.index)
    };
    // 从另一个数量框点过来时，这一下仍只收键盘。
    if (this._skuQuantityDismissTap) this.dismissSkuQuantityKeyboard();
  },

  onSkuQuantityTouchStart(e) {
    const editor = this._skuQuantityEditor;
    // 在原生 blur 之前记住本次点击的用途，避免 blur 后按钮继续执行。
    this._skuQuantityDismissTap = !!editor && (!e.target || e.target.id !== editor.id);
  },

  onSkuPanelTap(e) {
    this.dismissSkuQuantityKeyboard(e);
  },

  dismissSkuQuantityKeyboard(e) {
    const editor = this._skuQuantityEditor;
    if (!this._skuQuantityDismissTap && (!editor || (e && e.target && e.target.id === editor.id))) return false;
    if (editor) {
      if (editor.index == null) {
        this.skuQuantityInputBlur({ detail: { value: this.data.quantity } });
      } else {
        const selection = this.data.bundleSelections[editor.index];
        this.bundleInputBlur({ currentTarget: { dataset: { index: editor.index } }, detail: { value: selection.quantity } });
      }
      wx.hideKeyboard();
    }
    // 保留到下一次 touchstart，同一点击在父子节点间传递时都要被拦住。
    return true;
  },

  normalizeSkuQuantity(value, stock, unlimitedStock) {
    let quantity = parseInt(value, 10);
    if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
    if (!unlimitedStock && stock != null && Number(stock) > 0) {
      quantity = Math.min(quantity, Number(stock));
    }
    return quantity;
  },

  skuQuantityInput(e) {
    this.setData({ quantity: e.detail.value });
  },

  skuQuantityInputBlur(e) {
    this._skuQuantityEditor = null;
    const { currentSkuStock, currentSkuUnlimited } = this.data;
    this.setData({ quantity: this.normalizeSkuQuantity(e.detail.value, currentSkuStock, currentSkuUnlimited) });
  }
};
