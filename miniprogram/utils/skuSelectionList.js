const api = require('../utils/api');
const { getErrorMessage } = require('./error');
const { isSkuSoldOut, isProductSoldOut, formatStock, getFreeStockQty } = require('./stock');
const { getSkuOptions, findSelectedSku, getSkuOptionSelection } = require('./skuSelection');
const drafts = require('./skuSelectionDraft');
const promotionDisplay = require('../utils/skuPromotionDisplay');
const skuMoneyText = require('./skuMoneyText');
const { normalizeProductImages } = require('./productImage');

const productListFields = ['productList', 'results', 'leftColumn', 'rightColumn', 'products', 'filteredProducts'];

function productSource(page, product) {
  for (const field of productListFields) {
    const found = Array.isArray(page.data[field]) && page.data[field].find(item => String(item.id) === String(product.id));
    if (found) return found;
  }
  return page._skuUpdatedProducts && page._skuUpdatedProducts.get(String(product.id)) || product;
}

function rememberProduct(page, product) {
  if (!page._skuUpdatedProducts) page._skuUpdatedProducts = new Map();
  page._skuUpdatedProducts.delete(String(product.id));
  page._skuUpdatedProducts.set(String(product.id), product);
  if (page._skuUpdatedProducts.size > 20) page._skuUpdatedProducts.delete(page._skuUpdatedProducts.keys().next().value);
  const patch = {};
  for (const field of productListFields) {
    if (Array.isArray(page.data[field]) && page.data[field].some(item => String(item.id) === String(product.id)))
      patch[field] = page.data[field].map(item => String(item.id) === String(product.id) ? { ...item, ...product } : item);
  }
  if (page.data.product && String(page.data.product.id) === String(product.id)) patch.product = product;
  if (Object.keys(patch).length) page.setData(patch);
}

const initialData = {
  pickedSkuItems: [], pickedTotalCount: 0, pickedTotalPrice: '0.00',
  pickedCountText: '0', showPickedSkus: false, purchasePending: false, quantity: 0, skuAction: 'buy',
  skuDataLoading: false, skuDataError: '',
  promotionOffers: [], promotionOffersReady: false, promotionOffersLoading: false, promotionOffersError: '',
  showSkuPromotions: false, skuQuoteLoading: false, skuQuoteError: '',
  pickedOriginalPrice: '0.00', pickedDiscountPrice: '0.00', pickedGoodsPrice: '0.00', pickedDiscountRows: [],
  pickedHasDiscount: false, pickedAverageUnitPrice: '0.00', pickedPromotionRows: [],
  currentSkuDiscounted: false, currentSkuUnitPrice: '', currentSkuUnitApproximate: false,
  currentSkuOriginalPriceText: '0', skuMoneyText: {}
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

function latestProduct(previous, response) {
  const product = response && response.product;
  if (!product || String(product.id) !== String(previous.id) || !Array.isArray(product.skuMatrix))
    throw new Error('商品规格数据无效，请稍后重试');
  const result = normalizedProduct(normalizeProductImages({ ...previous, ...product,
    title: product.name || previous.title,
    bundleGroups: response.bundleGroups || product.bundleGroups || null,
    offSale: product.status != null ? String(product.status).toLowerCase() !== 'on' : !!product.offSale
  }));
  result.soldOut = isProductSoldOut(result);
  return result;
}

function stockModal(title, content) {
  return new Promise(resolve => wx.showModal({ title, content, showCancel: false, success: resolve, fail: resolve }));
}

function badgeText(count) { return count > 99 ? '99+' : String(count || 0); }

function buildPickedPatch(page, state = page.data) {
  if (!page._pickedSkus) return {};
  const product = getProduct({ data: state });
  const quantities = page._pickedQuantities;
  const originalPrice = [state.currentSkuPrice, product.retailPrice, product.displayPrice]
    .find(value => value != null && value !== '');
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
    currentSkuOriginalPriceText: skuMoneyText(originalPrice),
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
    patch.bundlePriceRange = min === max ? `¥${skuMoneyText(min)}` : `¥${skuMoneyText(min)} - ¥${skuMoneyText(max)}`;
  } else Object.assign(patch, decorateOptions(product.skuMatrix || [], state.selectedColor, quantities));
  const signature = selectionSignature(page, items);
  Object.assign(patch, promotionDisplay.pricing(items, page._skuQuote && page._skuQuote.signature === signature ? page._skuQuote.value : null));
  patch.pickedHasDiscount = Number(patch.pickedDiscountPrice) > 0;
  patch.pickedAverageUnitPrice = totalCount ? (Math.round(Math.round(Number(patch.pickedGoodsPrice) * 100) / totalCount) / 100).toFixed(2) : '0.00';
  patch.pickedPromotionRows = promotionDisplay.pickerDiscountRows(state.promotionOffers, patch.pickedDiscountRows);
  // 数量立即更新；新报价返回前保留上次金额，避免先闪回原价再显示优惠价。
  if (totalCount && state.pickedTotalCount && page._skuQuote && page._skuQuote.signature !== signature) {
    for (const key of ['pickedOriginalPrice', 'pickedDiscountPrice', 'pickedGoodsPrice', 'pickedDiscountRows',
      'pickedHasDiscount', 'pickedAverageUnitPrice', 'pickedPromotionRows']) patch[key] = state[key];
    const previousItems = new Map((state.pickedSkuItems || []).map(sku => [String(sku.skuId), sku]));
    patch.pickedSkuItems = patch.pickedSkuItems.map(sku => {
      const previous = previousItems.get(String(sku.skuId));
      return previous ? { ...sku, unitPriceText: previous.unitPriceText,
        discounted: previous.discounted, unitApproximate: previous.unitApproximate } : sku;
    });
  }
  patch.skuMoneyText = {};
  for (const key of ['pickedOriginalPrice', 'pickedGoodsPrice', 'pickedDiscountPrice', 'pickedAverageUnitPrice']) {
    patch.skuMoneyText[key] = skuMoneyText(patch[key]);
  }
  patch.pickedSkuItems = patch.pickedSkuItems.map(sku => ({ ...sku,
    unitPriceDisplay: skuMoneyText(sku.unitPriceText), priceDisplay: skuMoneyText(sku.priceText) }));
  patch.pickedPromotionRows = patch.pickedPromotionRows.map(row => ({ ...row, amountDisplay: skuMoneyText(row.amount) }));
  const current = patch.pickedSkuItems.find(sku => String(sku.skuId) === String(state.currentSkuId));
  patch.currentSkuDiscounted = !!(current && current.discounted);
  patch.currentSkuUnitPrice = current ? current.unitPriceText : '';
  patch.currentSkuUnitApproximate = !!(current && current.unitApproximate);
  if (patch.bundleSelections) patch.bundleSelections = patch.bundleSelections.map(group => ({ ...group,
    originalPriceDisplay: skuMoneyText(group.selectedSku && group.selectedSku.price != null ? group.selectedSku.price :
      group.skus[0] && (group.skus[0].price != null ? group.skus[0].price : group.skus[0].retailPrice)),
    promotionPrice: patch.pickedSkuItems.find(sku => group.selectedSku && String(sku.skuId) === String(group.selectedSku.skuId)) || null }));
  return patch;
}

function selectionSignature(page, items = page.data.pickedSkuItems || []) {
  return JSON.stringify([String(getProduct(page).id || ''), (page.data.bundleSelections || []).length > 0,
    items.map(sku => [String(sku.skuId), sku.count, sku.price])]);
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
  async refreshSkuProduct() {
    const id = String(getProduct(this).id);
    const version = this._skuDataVersion = (this._skuDataVersion || 0) + 1;
    const current = () => !this._skuPickerDisposed && this.data.showSku
      && String(getProduct(this).id) === id && this._skuDataVersion === version;
    this.setData({ skuDataLoading: true, skuDataError: '' });
    try {
      const product = getProduct(this);
      const response = await api.get((product.productType === 'live' ? '/live-products/' : '/products/') + id);
      if (!current()) return false;
      const fresh = latestProduct(product, response);
      this.applySkuProductUpdate(fresh);
      return true;
    } catch (error) {
      if (current()) {
        const message = getErrorMessage(error, '规格加载失败，请重新打开商品');
        this.setData({ skuDataError: message });
        wx.showToast({ title: message, icon: 'none' });
      }
      return false;
    } finally {
      if (current()) this.setData({ skuDataLoading: false });
    }
  },

  disposeSkuPromotions() {
    this._skuPickerDisposed = true;
    this._skuDataVersion = (this._skuDataVersion || 0) + 1;
    this._skuOfferVersion = (this._skuOfferVersion || 0) + 1;
    this._skuQuoteVersion = (this._skuQuoteVersion || 0) + 1;
  },
  initializePickedSkus(quantities) {
    const product = getProduct(this);
    this._pickedDraftKey = drafts.draftKey(product.id || product._id);
    this._pickedSkus = new Map();
    (product.skuMatrix || []).forEach(sku => this._pickedSkus.set(String(sku.skuId), { ...sku }));
    (this.data.bundleSelections || []).forEach(group => (group.skus || []).forEach(sku => {
      const key = String(sku.skuId || sku.id);
      this._pickedSkus.set(key, { ...normalizedSku(sku), ...this._pickedSkus.get(key), bundleGroupName: group.bundleGroupName });
    }));
    const cached = quantities ? { quantities } : drafts.readDraft(this._pickedDraftKey);
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
    this.refreshSkuPromotionQuote();
  },

  clearPickedSkus(e) {
    if (this.data.purchasePending || this.dismissSkuQuantityKeyboard(e) || !this._pickedSkus) return;
    this._pickedQuantities = {};
    this._skuQuote = null;
    this._skuQuoteVersion = (this._skuQuoteVersion || 0) + 1;
    this._pickedDraft = drafts.writeDraft(this._pickedDraftKey, this._pickedQuantities);
    this.refreshPickedSkus();
  },

  async loadSkuPromotions() {
    if (this._skuPickerDisposed || !this.data.showSku) return;
    const version = this._skuOfferVersion = (this._skuOfferVersion || 0) + 1;
    this._skuQuote = null;
    this._skuQuoteVersion = (this._skuQuoteVersion || 0) + 1;
    this.setData({ promotionOffersReady: false, promotionOffersLoading: true, promotionOffersError: '', skuQuoteError: '' });
    applyPickerPatch(this, buildPickedPatch(this));
    try {
      const offers = await api.get('/products/' + getProduct(this).id + '/promotions');
      if (this._skuPickerDisposed || !this.data.showSku || version !== this._skuOfferVersion) return;
      if (!Array.isArray(offers)) throw new Error('优惠信息加载失败，请重试');
      this.setData({ promotionOffers: promotionDisplay.offersForDisplay(offers), promotionOffersReady: true });
    } catch (error) {
      if (!this._skuPickerDisposed && this.data.showSku && version === this._skuOfferVersion)
        this.setData({ promotionOffersError: getErrorMessage(error, '优惠信息加载失败，请重试') });
    } finally {
      if (!this._skuPickerDisposed && this.data.showSku && version === this._skuOfferVersion) {
        this.setData({ promotionOffersLoading: false });this.refreshPickedSkus();
      }
    }
  },

  async refreshSkuPromotionQuote() {
    const signature = selectionSignature(this);
    if (this._skuPickerDisposed || !this.data.showSku) return;
    if (!this.data.pickedTotalCount || !this.data.promotionOffersReady || !this.data.promotionOffers.length) {
      this._skuQuoteVersion = (this._skuQuoteVersion || 0) + 1;
      this.setData({ skuQuoteLoading: false, skuQuoteError: '' });return;
    }
    if (this._skuQuote && this._skuQuote.signature === signature) {
      if (this._skuQuoteRequest && this._skuQuoteRequest !== signature) this._skuQuoteVersion++;
      this.setData({ skuQuoteLoading: false, skuQuoteError: '' });return;
    }
    if (this._skuQuoteRequest === signature) return;
    this._skuQuoteVersion = (this._skuQuoteVersion || 0) + 1;
    this.setData({ skuQuoteLoading: true, skuQuoteError: '' });
    // 连续加减时只保留当前请求和最新清单，旧响应不能覆盖新金额。
    if (this._skuQuoteRequest) return;
    const version = this._skuQuoteVersion;
    this._skuQuoteRequest = signature;
    try {
      const value = await api.post('/orders/goods-quote', {
        items: promotionDisplay.quoteItems(this.data.pickedSkuItems, (this.data.bundleSelections || []).length > 0),
        includeReadyStock: false
      });
      if (this._skuPickerDisposed || !this.data.showSku || version !== this._skuQuoteVersion || signature !== selectionSignature(this)) return;
      promotionDisplay.pricing(this.data.pickedSkuItems, value);
      this._skuQuote = { signature, value };
      const offers = value.offers && value.offers[String(getProduct(this).id)];
      if (Array.isArray(offers)) this.setData({ promotionOffers: promotionDisplay.offersForDisplay(offers) });
      this.setData({ skuQuoteLoading: false });
      applyPickerPatch(this, buildPickedPatch(this));
    } catch (error) {
      if (!this._skuPickerDisposed && this.data.showSku && version === this._skuQuoteVersion && signature === selectionSignature(this))
        this.setData({ skuQuoteLoading: false, skuQuoteError: getErrorMessage(error, '优惠计算失败，请重试') });
    } finally {
      this._skuQuoteRequest = null;
      if (!this._skuPickerDisposed && this.data.showSku && version !== this._skuQuoteVersion) this.refreshSkuPromotionQuote();
    }
  },

  retrySkuPromotionQuote() { return this.refreshSkuPromotionQuote(); },
  openSkuPromotions(e) {
    if (this.dismissSkuQuantityKeyboard(e)) return;
    this.setData({ showSkuPromotions: true });
    if (!this.data.promotionOffersReady) this.loadSkuPromotions();
  },
  closeSkuPromotions() { this.setData({ showSkuPromotions: false }); },

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
    if (this.data.skuDataLoading || this.data.skuDataError)
      return wx.showToast({ title: this.data.skuDataLoading ? '规格加载中，请稍候' : '规格加载失败，请重新打开商品', icon: 'none' });
    let product = getProduct(this);
    if (!product.id || product.offSale || product.soldOut) return;
    if (product.productType === 'live') {
      if (product.convertedToProductId) return wx.navigateTo({ url: '/pages/detail/detail?id=' + product.convertedToProductId });
      const sessionStatus = this.data.session && this.data.session.status || product.sessionStatus;
      if (sessionStatus !== 'live') return wx.showToast({ title: '直播已结束，无法购买', icon: 'none' });
    }
    let groups = this.data.bundleSelections || [];
    if (!this.data.pickedTotalCount) {
      const current = groups.length ? groups.map(group => group.selectedSku) : [this._pickedSkus.get(String(this.data.currentSkuId))];
      if (current.some(sku => !sku || isSkuSoldOut(sku))) return wx.showToast({ title: '请选择完整的可售规格', icon: 'none' });
      current.forEach(sku => this.setPickedSkuQuantity(sku.skuId, 1));
    }
    let selected = this.data.pickedSkuItems;
    if (groups.length && groups.some(group => !selected.some(sku => group.skus.some(candidate => String(candidate.skuId) === sku.skuId)))) {
      return wx.showToast({ title: '请为套装每个子项至少选择一件商品', icon: 'none' });
    }
    const action = e.currentTarget.dataset.action || this.data.skuAction;
    this.setData({ purchasePending: true });
    wx.showLoading({ title: action === 'buy' ? '加载中...' : '添加中...', mask: true });
    try {
      product = getProduct(this);groups = this.data.bundleSelections || [];selected = this.data.pickedSkuItems;
      if (!selected.length || groups.some(group => !selected.some(sku => group.skus.some(candidate => String(candidate.skuId) === sku.skuId)))) {
        wx.showToast({ title: '请重新选择完整的可售规格', icon: 'none' });return;
      }
      const snapshot = { key: this._pickedDraftKey, revision: this._pickedDraft.revision };
      const checkoutItems = selected.map(sku => ({ productId: product.id, skuId: sku.skuId,
        name: product.name || product.title, image: sku.imageUrl, coverUrl: sku.imageUrl,
        selectedColor: sku.color, selectedSize: sku.size, price: Number(sku.price), finalPrice: Number(sku.price),
        count: sku.count, readyStockQty: Math.min(sku.count, getFreeStockQty(sku)), selected: true, skuSelectionDraft: snapshot }));
      if (groups.length) {
        const first = checkoutItems[0];
        const bundleConfig = selected.map(sku => ({ bundleGroupName: sku.bundleGroupName, skuId: sku.skuId,
          color: sku.color, size: sku.size, price: Number(sku.price), imageUrl: sku.imageUrl, count: sku.count,
          ...(action === 'buy' ? { readyStockQty: Math.min(sku.count, getFreeStockQty(sku)) } : {}) }));
        checkoutItems.splice(0, checkoutItems.length, { ...first, count: 1, bundleConfig,
          readyStockQty: bundleConfig.reduce((sum, item) => sum + (item.readyStockQty || 0), 0),
          name: product.name, image: product.coverUrl, price: Number(this.data.pickedTotalPrice), finalPrice: Number(this.data.pickedTotalPrice) });
      }
      if (action === 'buy') {
        wx.setStorageSync('checkoutSource', 'sku');
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
      const message = getErrorMessage(err, action === 'buy' ? '打开结算页失败，请重试' : '添加失败，请稍后重试');
      if (action !== 'buy' && /(现货|库存).*(不足|售罄)/.test(message)) {
        wx.hideLoading();await stockModal(/现货/.test(message) ? '现货不足' : '库存不足', message);
      } else wx.showToast({ title: message, icon: 'none' });
    } finally {
      wx.hideLoading();
      if (!this._skuPickerDisposed) this.setData({ purchasePending: false });
    }
  }
};

// 首页/搜索共用弹窗和详情组件共用一份清单、数量及提交逻辑。
function enhancePicker(config, isDetail = false) {
  const original = { ...config };
  const enhanced = { ...config, ...methods };
  enhanced.applySkuProductUpdate = function(product) {
    rememberProduct(this, product);
    const quantities = { ...this._pickedQuantities };
    const color = this.data.selectedColor, size = this.data.selectedSize;
    const chosen = new Map((this.data.bundleSelections || []).map(group => [group.bundleGroupName,
      group.selectedSku && String(group.selectedSku.skuId)]));
    const action = this.data.skuAction;
    this._pickedSkus = null;this._pickedQuantities = {};
    this._skuQuote = null;
    this._skuOfferVersion = (this._skuOfferVersion || 0) + 1;
    this._skuQuoteVersion = (this._skuQuoteVersion || 0) + 1;
    this.setData({ currentProduct: product, ...(isDetail ? { product } : {}), skuPanelImagePaths: {},
      promotionOffers: [], promotionOffersReady: false, skuQuoteError: '', skuQuoteLoading: false });
    original.openSkuPanel.call(this, { currentTarget: { dataset: { product, action, skuRefresh: true } } });
    if ((this.data.bundleSelections || []).length) {
      const groups = this.data.bundleSelections.map(group => {
        const sku = group.skus.find(item => String(item.skuId) === chosen.get(group.bundleGroupName) && !isSkuSoldOut(item));
        return sku ? { ...group, selectedColor: sku.color, selectedSize: sku.size } : group;
      });
      this.setData(this._computeBundleSelections(groups, -1, null, null));
    } else if (findSelectedSku(product.skuMatrix, color, size)) {
      this.setData({ selectedColor: color, selectedSize: size });this.checkSkuMatch();
    }
    this.initializePickedSkus(quantities);this.loadSkuPromotions();
  };
  enhanced.openSkuPanel = function(e) {
    if (this.data.purchasePending) return;
    this._skuPickerDisposed = false;
    this._pickedSkus = null;
    this._pickedQuantities = {};
    this._skuQuote = null;
    this._skuOfferVersion = (this._skuOfferVersion || 0) + 1;
    this._skuQuoteVersion = (this._skuQuoteVersion || 0) + 1;
    this.setData({ ...initialData, skuDetailMode: isDetail });
    const action = e.currentTarget.dataset.action === 'cart' ? 'cart' : 'buy';
    let event = { ...e, currentTarget: { ...e.currentTarget, dataset: { ...e.currentTarget.dataset, action } } };
    if (isDetail) {
      const product = normalizedProduct(this.data.product);
      this.setData({ product, currentProduct: product, skuPanelImagePaths: {} });
    }
    else event.currentTarget.dataset.product = normalizedProduct(productSource(this, e.currentTarget.dataset.product));
    original.openSkuPanel.call(this, event);
    this.setData({ skuAction: action });
    if (this.data.showSku) { this.initializePickedSkus();return this.refreshSkuProduct(); }
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
    if (!this.data.showSku) {
      this._skuDataVersion = (this._skuDataVersion || 0) + 1;
      this._skuOfferVersion = (this._skuOfferVersion || 0) + 1;
      this._skuQuoteVersion = (this._skuQuoteVersion || 0) + 1;
      this.setData({ showPickedSkus: false, showSkuPromotions: false });
    }
  };
  enhanced[isDetail ? 'confirmSkuAction' : 'confirmAddToCart'] = methods.submitPickedSkus;
  if (original.onUnload) enhanced.onUnload = function(...args) {
    this.disposeSkuPromotions();
    return original.onUnload.apply(this, args);
  };
  if (isDetail) {
    enhanced.confirmAddToCart = methods.submitPickedSkus;
    enhanced.onSkuPanelImageError = function(e) {
      this.onPreloadedImageError({ currentTarget: { dataset: { src: e.currentTarget.dataset.url } } });
    };
  }
  return enhanced;
}

module.exports = { initialData, enhancePicker, normalizedProduct, quantityFor, decorateOptions, badgeText };
