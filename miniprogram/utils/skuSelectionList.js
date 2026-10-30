const api = require('../utils/api');
const { getErrorMessage } = require('./error');
const { isSkuSoldOut, isProductSoldOut, formatStock, getFreeStockQty } = require('./stock');
const { getSkuOptions, findSelectedSku, getSkuOptionSelection } = require('./skuSelection');
const drafts = require('./skuSelectionDraft');

const initialData = {
  pickedSkuItems: [], pickedTotalCount: 0, pickedTotalPrice: '0.00',
  pickedCountText: '0', showPickedSkus: false, purchasePending: false, quantity: 0, skuAction: 'buy'
};

function normalizedSku(sku) {
  let color = String(sku.color || sku.spec || '').trim();
  if (!color || color === '默认') color = '图片色';
  return { ...sku, skuId: sku.skuId || sku.id, color, size: String(sku.size || '').trim() || '均码',
    price: sku.price != null ? sku.price : sku.retailPrice,
    stock: sku.stock != null ? sku.stock : (sku.availableMain != null ? sku.availableMain : sku.stockMain),
    unlimitedStock: sku.unlimitedStock === true || sku.isUnlimitedStock === true };
}

function normalizedProduct(product) {
  const matrix = (product.skuMatrix || []).map(normalizedSku);
  const byId = new Map(matrix.map(sku => [String(sku.skuId), sku]));
  return { ...product, skuMatrix: matrix,
    bundleGroups: product.bundleGroups && product.bundleGroups.map(group => ({ ...group,
      skus: (group.skus || []).map(sku => normalizedSku({ ...sku, ...byId.get(String(sku.skuId || sku.id)) })) })) };
}

function quantityFor(value, sku) {
  const quantity = Math.max(0, Math.min(2147483647, parseInt(value, 10) || 0));
  if (!sku || isSkuSoldOut(sku)) return 0;
  return sku.unlimitedStock ? quantity : Math.min(quantity, Math.max(0, Number(sku.stock) || 0));
}

function decorateOptions(skus, color, quantities) {
  const options = getSkuOptions(skus, color);
  const colorCount = options.uniqueColors.length;
  const sizeCount = options.uniqueSizes.length;
  const sum = predicate => skus.reduce((total, sku) => total + (predicate(sku) ? quantities[String(sku.skuId)] || 0 : 0), 0);
  return { ...options,
    colorOptions: options.colorOptions.map(option => ({ ...option,
      pickedCount: sum(sku => sku.color === option.value),
      pickedCountText: badgeText(sum(sku => sku.color === option.value)),
      showPickedCount: colorCount > 1 })),
    sizeOptions: options.sizeOptions.map(option => ({ ...option,
      pickedCount: sum(sku => sku.size === option.value && (!color || sku.color === color)),
      pickedCountText: badgeText(sum(sku => sku.size === option.value && (!color || sku.color === color))),
      showPickedCount: sizeCount > 1 })) };
}

function getProduct(page) { return page.data.currentProduct || page.data.product || {}; }

function badgeText(count) { return count > 99 ? '99+' : String(count || 0); }

function buildPickedPatch(page, state = page.data) {
  if (!page._pickedSkus) return {};
  const product = getProduct({ data: state });
  const quantities = page._pickedQuantities;
  const items = [];
  let totalCents = 0;
  let totalCount = 0;
  for (const [id, sku] of page._pickedSkus) {
    const count = quantities[id] || 0;
    if (!count) continue;
    const cents = Math.round(Number(sku.price || 0) * 100);
    totalCents += cents * count;
    totalCount += count;
    items.push({ ...sku, skuId: id, count, priceText: (cents / 100).toFixed(2),
      imageUrl: sku.imageUrl || product.coverUrl || product.image || '',
      atLimit: !sku.unlimitedStock && count >= Number(sku.stock) });
  }
  const patch = { pickedSkuItems: items, pickedTotalCount: totalCount, pickedCountText: badgeText(totalCount), pickedTotalPrice: (totalCents / 100).toFixed(2),
    quantity: quantities[String(state.currentSkuId)] || 0 };
  if ((state.bundleSelections || []).length) {
    patch.bundleSelections = state.bundleSelections.map(group => {
      const quantity = group.selectedSku ? quantities[String(group.selectedSku.skuId)] || 0 : 0;
      return { ...group, ...decorateOptions(group.skus, group.selectedColor, quantities), quantity,
        computedPrice: Number(group.selectedSku && group.selectedSku.price || 0) * quantity };
    });
    patch.bundleTotalCount = totalCount;
    patch.bundleTotalPrice = patch.pickedTotalPrice;
    patch.bundleNamesStr = items.length ? [...new Set(items.map(sku => sku.bundleGroupName))].join('，') : '待选择';
    const prices = [...page._pickedSkus.values()].map(sku => Number(sku.price || 0));
    const min = Math.min(...prices), max = Math.max(...prices);
    patch.bundlePriceRange = min === max ? `¥${min.toFixed(2)}` : `¥${min.toFixed(2)} - ¥${max.toFixed(2)}`;
  } else Object.assign(patch, decorateOptions(product.skuMatrix || [], state.selectedColor, quantities));
  return patch;
}

// 一次提交完整的选中规格、数量和角标；跳过没有变化的整份列表。
function applyPickerPatch(page, patch) {
  const changed = {};
  for (const key of Object.keys(patch)) {
    if (JSON.stringify(page.data[key]) !== JSON.stringify(patch[key])) changed[key] = patch[key];
  }
  if (Object.keys(changed).length) page.setData(changed);
}

const methods = {
  initializePickedSkus() {
    const product = getProduct(this);
    this._pickedDraftKey = drafts.draftKey(product.id || product._id);
    this._pickedSkus = new Map();
    (product.skuMatrix || []).forEach(sku => this._pickedSkus.set(String(sku.skuId), { ...sku }));
    (this.data.bundleSelections || []).forEach(group => (group.skus || []).forEach(sku => {
      const key = String(sku.skuId || sku.id);
      this._pickedSkus.set(key, { ...normalizedSku(sku), ...this._pickedSkus.get(key), bundleGroupName: group.bundleGroupName });
    }));
    const cached = drafts.readDraft(this._pickedDraftKey);
    this._pickedQuantities = {};
    for (const [id, sku] of this._pickedSkus) {
      const quantity = quantityFor(cached.quantities[id], sku);
      if (quantity > 0) this._pickedQuantities[id] = quantity;
    }
    this._pickedDraft = drafts.writeDraft(this._pickedDraftKey, this._pickedQuantities);
    this.refreshPickedSkus();
  },

  refreshPickedSkus() {
    applyPickerPatch(this, buildPickedPatch(this));
  },

  setPickedSkuQuantity(skuId, value) {
    if (this.data.purchasePending) return;
    const key = String(skuId);
    const sku = this._pickedSkus && this._pickedSkus.get(key);
    if (!sku) return;
    const count = quantityFor(value, sku);
    if (count > 0) this._pickedQuantities[key] = count;
    else delete this._pickedQuantities[key];
    this._pickedDraft = drafts.writeDraft(this._pickedDraftKey, this._pickedQuantities);
    this.refreshPickedSkus();
  },

  normalizeSkuQuantity(value, stock, unlimitedStock) {
    return quantityFor(value, { stock, unlimitedStock });
  },
  skuQuantityInput(e) { if (!this.data.purchasePending) this.setData({ quantity: e.detail.value }); },
  skuQuantityInputBlur(e) {
    this._skuQuantityEditor = null;
    this.setPickedSkuQuantity(this.data.currentSkuId, e.detail.value);
  },
  skuQuantityMinus(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    this.setPickedSkuQuantity(this.data.currentSkuId, Number(this.data.quantity) - 1);
  },
  skuQuantityPlus(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    this.increasePickedQuantity(this.data.currentSkuId);
  },
  increasePickedQuantity(id) {
    const key = String(id);
    const sku = this._pickedSkus && this._pickedSkus.get(key);
    if (!sku || isSkuSoldOut(sku)) return;
    const count = this._pickedQuantities[key] || 0;
    if (quantityFor(count + 1, sku) <= count) {
      wx.showToast({ title: '已达到库存上限', icon: 'none' });
      return;
    }
    this.setPickedSkuQuantity(key, count + 1);
  },
  bundleMinus(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    const group = this.data.bundleSelections[e.currentTarget.dataset.index];
    if (group && group.selectedSku) this.setPickedSkuQuantity(group.selectedSku.skuId, group.quantity - 1);
  },
  bundlePlus(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    const group = this.data.bundleSelections[e.currentTarget.dataset.index];
    if (group && group.selectedSku) this.increasePickedQuantity(group.selectedSku.skuId);
  },
  bundleInput(e) {
    if (this.data.purchasePending) return;
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ bundleSelections: this.data.bundleSelections.map((group, i) => i === index ? { ...group, quantity: e.detail.value } : group) });
  },
  bundleInputBlur(e) {
    this._skuQuantityEditor = null;
    const group = this.data.bundleSelections[e.currentTarget.dataset.index];
    if (group && group.selectedSku) this.setPickedSkuQuantity(group.selectedSku.skuId, e.detail.value);
  },

  openPickedSkus(e) {
    if (this.dismissSkuQuantityKeyboard(e) || this.data.purchasePending) return;
    this.setData({ showPickedSkus: !this.data.showPickedSkus });
  },
  closePickedSkus(e) {
    if (this.dismissSkuQuantityKeyboard(e) || this.data.purchasePending) return;
    this.setData({ showPickedSkus: false });
  },
  stopPickedTouchMove() {},
  pickedQuantityInputFocus(e) {
    this._skuQuantityEditor = { id: e.currentTarget.id, pickedSkuId: String(e.currentTarget.dataset.skuId) };
  },
  pickedQuantityInput(e) {
    if (this.data.purchasePending) return;
    const id = String(e.currentTarget.dataset.skuId);
    this.setData({ pickedSkuItems: this.data.pickedSkuItems.map(item => item.skuId === id ? { ...item, count: e.detail.value } : item) });
  },
  pickedQuantityInputBlur(e) {
    this._skuQuantityEditor = null;
    this.setPickedSkuQuantity(e.currentTarget.dataset.skuId, e.detail.value);
  },
  pickedQuantityMinus(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    const id = String(e.currentTarget.dataset.skuId);
    this.setPickedSkuQuantity(id, (this._pickedQuantities[id] || 0) - 1);
  },
  pickedQuantityPlus(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    this.increasePickedQuantity(e.currentTarget.dataset.skuId);
  },
  previewPickedSku(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    const url = e.currentTarget.dataset.url;
    const paths = { ...this.data.imagePaths, ...this.data.skuPanelImagePaths };
    if (url) wx.previewImage({ current: paths[url] || url, urls: [paths[url] || url] });
  },
  previewBundleImage(e) { return this.previewPickedSku(e); },
  dismissSkuQuantityKeyboard(e) {
    const editor = this._skuQuantityEditor;
    if (!this._skuQuantityDismissTap && (!editor || e && e.target && e.target.id === editor.id)) return false;
    if (editor) {
      if (editor.pickedSkuId != null) {
        const item = this.data.pickedSkuItems.find(row => row.skuId === editor.pickedSkuId);
        if (item) this.pickedQuantityInputBlur({ currentTarget: { dataset: { skuId: editor.pickedSkuId } }, detail: { value: item.count } });
      } else if (editor.index != null) {
        const group = this.data.bundleSelections[editor.index];
        this.bundleInputBlur({ currentTarget: { dataset: { index: editor.index } }, detail: { value: group.quantity } });
      } else this.skuQuantityInputBlur({ detail: { value: this.data.quantity } });
      wx.hideKeyboard();
    }
    return true;
  },

  async submitPickedSkus(e) {
    if (this.dismissSkuQuantityKeyboard(e) || this.data.purchasePending || Date.now() < (this._suppressTapUntil || 0)) return;
    const product = getProduct(this);
    if (!product.id || product.offSale || product.soldOut) return;
    if (product.productType === 'live') {
      if (product.convertedToProductId) return wx.navigateTo({ url: '/pages/detail/detail?id=' + product.convertedToProductId });
      const sessionStatus = this.data.session && this.data.session.status || product.sessionStatus;
      if (sessionStatus !== 'live') return wx.showToast({ title: '直播已结束，无法购买', icon: 'none' });
    }
    const groups = this.data.bundleSelections || [];
    if (!this.data.pickedTotalCount) {
      const current = groups.length ? groups.map(group => group.selectedSku) : [this._pickedSkus.get(String(this.data.currentSkuId))];
      if (current.some(sku => !sku || isSkuSoldOut(sku))) return wx.showToast({ title: '请选择完整的可售规格', icon: 'none' });
      current.forEach(sku => this.setPickedSkuQuantity(sku.skuId, 1));
    }
    const selected = this.data.pickedSkuItems;
    if (groups.length && groups.some(group => !selected.some(sku => group.skus.some(candidate => String(candidate.skuId) === sku.skuId)))) {
      return wx.showToast({ title: '请为套装每个子项至少选择一件商品', icon: 'none' });
    }
    const snapshot = { key: this._pickedDraftKey, revision: this._pickedDraft.revision };
    const checkoutItems = selected.map(sku => ({ productId: product.id, skuId: sku.skuId,
      name: product.name || product.title, image: sku.imageUrl, coverUrl: sku.imageUrl,
      selectedColor: sku.color, selectedSize: sku.size, price: Number(sku.price), finalPrice: Number(sku.price),
      count: sku.count, selected: true, skuSelectionDraft: snapshot }));
    if (groups.length) {
      const first = checkoutItems[0];
      const bundleConfig = selected.map(sku => ({ bundleGroupName: sku.bundleGroupName, skuId: sku.skuId,
        color: sku.color, size: sku.size, price: Number(sku.price), imageUrl: sku.imageUrl, count: sku.count }));
      checkoutItems.splice(0, checkoutItems.length, { ...first, count: 1, bundleConfig,
        name: product.name, image: product.coverUrl, price: Number(this.data.pickedTotalPrice), finalPrice: Number(this.data.pickedTotalPrice) });
    }
    const action = e.currentTarget.dataset.action || this.data.skuAction;
    this.setData({ purchasePending: true });
    try {
      if (action === 'buy') {
        wx.setStorageSync('checkoutItems', checkoutItems);
        await new Promise((resolve, reject) => wx.navigateTo({ url: '/pages/checkout/checkout', success: resolve, fail: reject }));
        this.setData({ showSku: false, showPickedSkus: false });
      } else {
        wx.showLoading({ title: '添加中...', mask: true });
        await api.post('/cart/items/batch', { items: checkoutItems.map(item => ({ productId: item.productId,
          skuId: item.skuId, color: item.selectedColor, size: item.selectedSize, count: item.count,
          ...(item.bundleConfig ? { bundleConfig: item.bundleConfig } : {}) })) });
        drafts.clearSubmittedDraft(snapshot);
        if (this._pickedDraftKey === snapshot.key && String(getProduct(this).id) === String(product.id)) {
          this._pickedQuantities = {};
          this.refreshPickedSkus();
          this.setData({ showSku: false, showPickedSkus: false });
        }
        wx.showToast({ title: '已加入购物车', icon: 'success' });
      }
    } catch (err) {
      console.error('提交已选规格失败:', err);
      wx.showToast({ title: getErrorMessage(err, action === 'buy' ? '打开结算页失败，请重试' : '添加失败，请稍后重试'), icon: 'none' });
    } finally {
      if (action !== 'buy') wx.hideLoading();
      this.setData({ purchasePending: false });
    }
  }
};

// 首页/搜索共用弹窗和详情组件共用一份清单、数量及提交逻辑。
function enhancePicker(config, isDetail = false) {
  const original = { ...config };
  const enhanced = { ...config, ...methods };
  enhanced.openSkuPanel = function(e) {
    if (this.data.purchasePending) return;
    this._pickedSkus = null;
    this._pickedQuantities = {};
    this.setData({ ...initialData, skuDetailMode: isDetail });
    const action = e.currentTarget.dataset.action === 'cart' ? 'cart' : 'buy';
    let event = { ...e, currentTarget: { ...e.currentTarget, dataset: { ...e.currentTarget.dataset, action } } };
    if (isDetail) {
      const product = normalizedProduct(this.data.product);
      this.setData({ product, currentProduct: product, skuPanelImagePaths: {} });
    }
    else event.currentTarget.dataset.product = normalizedProduct(e.currentTarget.dataset.product);
    original.openSkuPanel.call(this, event);
    this.setData({ skuAction: action });
    if (this.data.showSku) this.initializePickedSkus();
  };
  enhanced.checkSkuMatch = function(selection = {}) {
    if (!this._pickedSkus || !this.data.showSku) return original.checkSkuMatch.call(this);
    const state = { ...this.data, ...selection };
    const product = getProduct({ data: state });
    const skus = product.skuMatrix || [];
    const match = findSelectedSku(skus, state.selectedColor, state.selectedSize);
    const soldOut = !match && isProductSoldOut(product);
    const patch = {
      ...selection,
      currentSkuPrice: match ? match.price : (isDetail ? product.retailPrice || product.displayPrice || null : null),
      currentSkuStock: match ? match.stock : (soldOut ? 0 : null),
      currentSkuFreeStockQty: match ? getFreeStockQty(match) : 0,
      currentSkuUnlimited: match ? match.unlimitedStock || false : false,
      currentSkuSoldOut: soldOut,
      currentSkuStockText: match ? formatStock(match.stock, match.unlimitedStock) : (soldOut ? '0' : null),
      currentSkuId: match ? match.skuId : null,
      currentSkuImage: match && match.imageUrl || product.coverUrl || product.image
    };
    applyPickerPatch(this, { ...patch, ...buildPickedPatch(this, { ...state, ...patch }) });
  };
  enhanced._computeBundleSelections = function(...args) {
    const result = original._computeBundleSelections.apply(this, args);
    result.bundleSelections = result.bundleSelections.map(group => ({ ...group,
      ...decorateOptions(group.skus, group.selectedColor, this._pickedQuantities || {}),
      isOutOfStock: !group.skus.length || group.skus.every(isSkuSoldOut),
      quantity: group.selectedSku && this._pickedQuantities ? this._pickedQuantities[String(group.selectedSku.skuId)] || 0 : 0 }));
    return result;
  };
  for (const [name, field, datasetKey] of [
    ['selectColor', 'selectedColor', 'color'], ['selectSize', 'selectedSize', 'size']
  ]) {
    enhanced[name] = function(e) {
      if (this.data.purchasePending || this.dismissSkuQuantityKeyboard(e)) return;
      if (isDetail && Date.now() < (this._suppressTapUntil || 0)) return;
      const product = getProduct(this);
      const selection = getSkuOptionSelection(product.skuMatrix || [], this.data.selectedColor,
        this.data.selectedSize, field, e.currentTarget.dataset[datasetKey]);
      if (selection) this.checkSkuMatch(selection);
    };
  }
  for (const [name, field, datasetKey] of [
    ['selectBundleColor', 'selectedColor', 'color'], ['selectBundleSize', 'selectedSize', 'size']
  ]) {
    enhanced[name] = function(e) {
      if (this.data.purchasePending || this.dismissSkuQuantityKeyboard(e)) return;
      if (isDetail && Date.now() < (this._suppressTapUntil || 0)) return;
      const result = this._computeBundleSelections(this.data.bundleSelections, e.currentTarget.dataset.index,
        field, e.currentTarget.dataset[datasetKey]);
      applyPickerPatch(this, { ...result, ...buildPickedPatch(this, { ...this.data, ...result }) });
    };
  }
  enhanced.closeSkuPanel = function(e) {
    if (this.data.purchasePending) return;
    original.closeSkuPanel.call(this, e);
    if (!this.data.showSku) this.setData({ showPickedSkus: false });
  };
  enhanced[isDetail ? 'confirmSkuAction' : 'confirmAddToCart'] = methods.submitPickedSkus;
  if (isDetail) {
    enhanced.confirmAddToCart = methods.submitPickedSkus;
    enhanced.onSkuPanelImageError = function(e) {
      this.onPreloadedImageError({ currentTarget: { dataset: { src: e.currentTarget.dataset.url } } });
    };
  }
  return enhanced;
}

module.exports = { initialData, enhancePicker, normalizedProduct, quantityFor, decorateOptions, badgeText };
