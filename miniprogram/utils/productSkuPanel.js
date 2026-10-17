// 首页和搜索页共用规格选择、数量控制及购物车操作。
const api = require('../utils/api');
const { getErrorMessage, isUnauthorized } = require('../utils/error');
const { formatStock, hasStock, isSkuSoldOut } = require('../utils/stock');
const { findSelectedSku, getSkuOptions, getDefaultSkuSelection, getSkuOptionSelection } = require('../utils/skuSelection');

module.exports = {
  initialData: {
    // 4. 底部 SKU (颜色/尺码) 弹窗参数
    showSku: false,
    currentProduct: null,
    uniqueColors: [],
    uniqueSizes: [],
    colorOptions: [],
    sizeOptions: [],
    selectedColor: '',
    selectedSize: '',
    currentSkuPrice: null,
    currentSkuStock: null,
    currentSkuImage: null,
    currentSkuId: null,
    currentSkuUnlimited: false,
    currentSkuSoldOut: false,
    quantity: 1,

    // 套装子项选择
    bundleSelections: [],
    bundleAllSelected: false,


  },
  methods: {
  // SKU 选规格与购物车逻辑
  openSkuPanel(e) {
    const product = e.currentTarget.dataset.product;

    // Build bundle groups from API or from skuMatrix
    var bundleGroups = product.bundleGroups;
    if (!bundleGroups || bundleGroups.length === 0) {
      var matrix = product.skuMatrix || [];
      if (matrix.length > 0 && matrix[0].bundleGroupName) {
        var groupMap = {};
        matrix.forEach(function(s) { var k = s.bundleGroupId || s.bundleGroupName; if (!groupMap[k]) groupMap[k] = { name: s.bundleGroupName, skus: [] }; groupMap[k].skus.push({ skuId: s.skuId, color: s.color, size: s.size, price: s.price, stock: s.stock, unlimitedStock: s.unlimitedStock, imageUrl: s.imageUrl }); });
        bundleGroups = Object.values(groupMap);
      }
    }

// 套装商品：初始化子项选择
if (bundleGroups && bundleGroups.length > 0) {
  // ✨ 新增逻辑 1：提取所有真实价格算区间，提取所有单品名称做拼接
  var allPrices = [];
  var bundleNames = [];
  bundleGroups.forEach(function(bg) {
    bundleNames.push(bg.name); // 收集商品名称（如上衣、裤子）
    if (bg.skus) {
      bg.skus.forEach(function(sku) {
        if (sku.price) allPrices.push(Number(sku.price));
        else if (sku.retailPrice) allPrices.push(Number(sku.retailPrice));
      });
    }
  });
  // 算最高和最低价
  var minP = allPrices.length > 0 ? Math.min.apply(null, allPrices) : 0;
  var maxP = allPrices.length > 0 ? Math.max.apply(null, allPrices) : 0;
  var rangeStr = (minP === maxP) ? '¥' + minP : '¥' + minP + ' - ¥' + maxP;
  var joinedNames = bundleNames.join('，'); // 拼接文案，如：上衣，裤子，牛仔裤

  var rawSel = bundleGroups.map(function(bg) {
    var skus = (bg.skus || []).map(function(sku) {
      return Object.assign({}, sku, {
        skuId: sku.skuId || sku.id,
        color: sku.color || sku.spec,
        price: sku.price != null ? sku.price : sku.retailPrice,
        stock: sku.stock != null ? sku.stock : sku.stockMain,
        unlimitedStock: sku.unlimitedStock === true || sku.isUnlimitedStock === true
      });
    });
    return Object.assign({ bundleGroupName: bg.name, skus: skus, selectedSku: null, quantity: 1,
      isOutOfStock: skus.length === 0 || skus.every(isSkuSoldOut) }, getDefaultSkuSelection(skus));
  });
  var result = this._computeBundleSelections(rawSel, -1, null, null);
  this.setData({
    currentProduct: product,
    currentSkuImage: product.coverUrl || product.image,
    currentSkuId: null,
    currentSkuUnlimited: false,
    currentSkuSoldOut: false,
    quantity: 1,
    showSku: true,
    ...result,
    bundlePriceRange: rangeStr, // ✨ 价格区间下发到前端
  });
  return;
}

    const selection = getDefaultSkuSelection(product.skuMatrix || []);

    this.setData({
      currentProduct: product,
      ...selection,
      currentSkuPrice: null,
      currentSkuStock: null,
      currentSkuImage: product.coverUrl || product.image,
      currentSkuId: null,
      currentSkuUnlimited: false,
      currentSkuSoldOut: false,
      quantity: 1,
      bundleSelections: [],
      bundleAllSelected: false,
      showSku: true
    });
    this.checkSkuMatch();
  },

  closeSkuPanel() {
    this.setData({ showSku: false });
  },

  selectColor(e) {
    const selection = getSkuOptionSelection(this.data.currentProduct.skuMatrix || [],
      this.data.selectedColor, this.data.selectedSize, 'selectedColor', e.currentTarget.dataset.color);
    if (!selection) return;
    this.setData(selection);
    this.checkSkuMatch();
  },

  selectSize(e) {
    const selection = getSkuOptionSelection(this.data.currentProduct.skuMatrix || [],
      this.data.selectedColor, this.data.selectedSize, 'selectedSize', e.currentTarget.dataset.size);
    if (!selection) return;
    this.setData(selection);
    this.checkSkuMatch();
  },

  checkSkuMatch() {
    const product = this.data.currentProduct;
    if (!product) return;
    const { selectedColor, selectedSize } = this.data;
    const skus = product.skuMatrix || [];
    const match = findSelectedSku(skus, selectedColor, selectedSize);
    const options = getSkuOptions(skus, selectedColor);
    if (match) {
      this.setData({
        ...options,
        currentSkuPrice: match.price,
        currentSkuStock: match.stock,
        currentSkuUnlimited: match.unlimitedStock || false,
        currentSkuSoldOut: false,
        currentSkuStockText: formatStock(match.stock, match.unlimitedStock),
        currentSkuId: match.skuId,
        currentSkuImage: match.imageUrl || product.coverUrl || product.image,
        quantity: this.normalizeSkuQuantity(this.data.quantity, match.stock, match.unlimitedStock)
      });
    } else {
      // 未选完整或没有可售组合时，清掉旧 SKU 的价格、库存和图片。
      const soldOut = skus.length === 0 || skus.every(isSkuSoldOut);
      this.setData({
        ...options,
        currentSkuPrice: null,
        currentSkuStock: soldOut ? 0 : null,
        currentSkuUnlimited: false,
        currentSkuSoldOut: soldOut,
        currentSkuStockText: soldOut ? '0' : null,
        currentSkuId: null,
        currentSkuImage: product.coverUrl || product.image,
        quantity: 1
      });
    }
  },

  normalizeSkuQuantity(value, stock, unlimitedStock) {
    var quantity = parseInt(value, 10);
    if (isNaN(quantity) || quantity < 1) quantity = 1;
    if (!unlimitedStock && stock != null && Number(stock) > 0) {
      quantity = Math.min(quantity, Number(stock));
    }
    return quantity;
  },

  skuQuantityMinus() {
    if (this.data.quantity <= 1) return;
    this.setData({ quantity: this.data.quantity - 1 });
  },

  skuQuantityPlus() {
    const { quantity, currentSkuStock, currentSkuUnlimited } = this.data;
    const hasStockLimit = !currentSkuUnlimited && currentSkuStock !== null;
    const maxQuantity = hasStockLimit ? Number(currentSkuStock) : 99;
    if (maxQuantity <= 0) {
      wx.showToast({ title: '该规格已售罄', icon: 'none' });
      return;
    }
    if (quantity >= maxQuantity) {
      wx.showToast({ title: '已达到库存上限', icon: 'none' });
      return;
    }
    this.setData({ quantity: quantity + 1 });
  },

  skuQuantityInput(e) {
    const { currentSkuStock, currentSkuUnlimited } = this.data;
    this.setData({
      quantity: this.normalizeSkuQuantity(e.detail.value, currentSkuStock, currentSkuUnlimited)
    });
  },

  skuQuantityInputBlur(e) {
    const { currentSkuStock, currentSkuUnlimited } = this.data;
    this.setData({
      quantity: this.normalizeSkuQuantity(e.detail.value, currentSkuStock, currentSkuUnlimited)
    });
  },

  // 套装子项选择处理
  selectBundleColor(e) {
    var result = this._computeBundleSelections(this.data.bundleSelections, e.currentTarget.dataset.index, 'selectedColor', e.currentTarget.dataset.color);
    this.setData(result);
  },

  selectBundleSize(e) {
    var result = this._computeBundleSelections(this.data.bundleSelections, e.currentTarget.dataset.index, 'selectedSize', e.currentTarget.dataset.size);
    this.setData(result);
  },

  _computeBundleSelections: function(sel, changeIdx, changeField, changeValue) {
    var allCheckedSelected = true;
    var hasChecked = false;
    var latestImage = null; // ✨ 专门捕获买家最新点击的那张图片

    var newSel = sel.map(function(s, i) {
      var ns = Object.assign({}, s);

      if (i === changeIdx && changeField) {
        var selection = getSkuOptionSelection(ns.skus || [], ns.selectedColor, ns.selectedSize, changeField, changeValue);
        if (selection) {
          // 保留套装子项再次点击可取消的交互。
          if (ns[changeField] === changeValue) ns[changeField] = '';
          else Object.assign(ns, selection);
        }
      }
      Object.assign(ns, getSkuOptions(ns.skus || [], ns.selectedColor));
      ns.selectedSku = null;
      ns.computedPrice = null;
      var needColor = ns.uniqueColors.length > 0;
      var needSize = ns.uniqueSizes.length > 0;
      var match = findSelectedSku(ns.skus || [], ns.selectedColor, ns.selectedSize);
      if (match) {
        ns.selectedSku = { skuId: match.skuId || match.id, color: match.color || match.spec, size: match.size, price: match.price != null ? match.price : match.retailPrice, stock: match.stock, unlimitedStock: match.unlimitedStock, imageUrl: match.imageUrl };
        if (!ns.quantity) ns.quantity = 1;
        if (!match.unlimitedStock) ns.quantity = Math.min(ns.quantity, Number(match.stock));
        ns.computedPrice = parseFloat((Number(ns.selectedSku.price || 0) * ns.quantity).toFixed(2));
      }

      // ✨ 核心逻辑：拦截买家刚刚点击的那件商品，提取它的专属图片上报
      if (i === changeIdx) {
          if (ns.selectedSku && ns.selectedSku.imageUrl) {
              latestImage = ns.selectedSku.imageUrl;
          } else if (ns.selectedColor && ns.skus) {
              var colorMatch = ns.skus.find(function(sku) { return (sku.color || sku.spec) === ns.selectedColor && sku.imageUrl; });
              if (colorMatch) latestImage = colorMatch.imageUrl;
          }
          if (!latestImage && ns.skus && ns.skus.length > 0 && ns.skus[0].imageUrl) {
              latestImage = ns.skus[0].imageUrl;
          }
      }

      var isPartiallySelected = (needColor && ns.selectedColor && needSize && !ns.selectedSize) || (needSize && ns.selectedSize && needColor && !ns.selectedColor);

      if (ns.selectedSku) {
        hasChecked = true;
    } else if (isPartiallySelected) {
        allCheckedSelected = false; // 如果有选了一半的规格，阻断结算
    }
    return ns;
  });

  // ✨ 核心修复：动态计算“已选”商品名称组合，没选就输出“待选择”
  var selectedNames = newSel.filter(function(s) { return s.selectedSku != null; }).map(function(s) { return s.bundleGroupName; });
  var dynamicNamesStr = selectedNames.length > 0 ? selectedNames.join('，') : '待选择';

  // ✨ 新增：遍历已选商品，计算总件数和总金额
  var tCount = 0;
  var tPrice = 0;
  newSel.forEach(function(s) {
    if (s.selectedSku) {
      tCount += s.quantity;
      tPrice += s.computedPrice || (Number(s.selectedSku.price || 0) * s.quantity);
    }
  });

  var result = {
    bundleSelections: newSel,
    bundleAllSelected: hasChecked && allCheckedSelected,
    bundleNamesStr: dynamicNamesStr,
    bundleTotalCount: tCount, // ✨ 传递合计件数给前端
    bundleTotalPrice: tPrice.toFixed(2) // ✨ 传递合计金额给前端
  };
  // ✨ 将捕获到的图片更新到页面顶部
  if (latestImage) {
      result.currentSkuImage = latestImage;
  }
  return result;
},

  // ====== 开放图片全屏预览 ======
  previewBundleImage(e) {
    var url = e.currentTarget.dataset.url;
    if (url) { wx.previewImage({ urls: [url], current: url }); }
  },

  // SKU 面板商品图预览（单张）
  previewSkuPanelImage() {
    var product = this.data.currentProduct || {};
    var current = this.data.currentSkuImage || product.coverUrl || product.image;
    if (current) {
      wx.previewImage({ urls: [current], current: current });
    }
  },

// ====== 精巧的数量增减器核心控制 ======
// ✨ 新增助手函数：点加减号时，同步重新算一次底部总价
_updateBundleTotals(sel) {
  var tCount = 0;
  var tPrice = 0;
  sel.forEach(function(s) {
    if (s.selectedSku) {
      tCount += s.quantity;
      tPrice += s.computedPrice || (Number(s.selectedSku.price || 0) * s.quantity);
    }
  });
  this.setData({
    bundleSelections: sel,
    bundleTotalCount: tCount,
    bundleTotalPrice: tPrice.toFixed(2)
  });
},
bundleMinus(e) {
  var index = e.currentTarget.dataset.index;
  var sel = this.data.bundleSelections;
  if (sel[index].quantity > 1) {
    sel[index].quantity--;
    sel[index].computedPrice = parseFloat((Number(sel[index].selectedSku.price || 0) * sel[index].quantity).toFixed(2));
    this._updateBundleTotals(sel); // ✨ 刷新视图和总价
  }
},
bundlePlus(e) {
  var index = e.currentTarget.dataset.index;
  var sel = this.data.bundleSelections;
  var sku = sel[index].selectedSku;
  if (sku && (sku.unlimitedStock || sel[index].quantity < sku.stock)) {
    sel[index].quantity++;
    sel[index].computedPrice = parseFloat((Number(sku.price || 0) * sel[index].quantity).toFixed(2));
    this._updateBundleTotals(sel); // ✨ 刷新视图和总价
  } else {
    wx.showToast({ title: '没库存了哦～', icon: 'none' });
  }
},
bundleInput(e) {
  var index = e.currentTarget.dataset.index;
  var val = parseInt(e.detail.value);
  var sel = this.data.bundleSelections;
  var sku = sel[index].selectedSku;
  if (!sku) return;
  if (isNaN(val) || val < 1) val = 1;
  if (!sku.unlimitedStock && val > sku.stock) {
    val = sku.stock;
    wx.showToast({ title: '没库存了哦～', icon: 'none' });
  }
  sel[index].quantity = val;
  sel[index].computedPrice = parseFloat((Number(sku.price || 0) * val).toFixed(2));
  this._updateBundleTotals(sel); // ✨ 刷新视图和总价
},
bundleInputBlur(e) {
  var index = e.currentTarget.dataset.index;
  var val = parseInt(e.detail.value);
  var sel = this.data.bundleSelections;
  if (isNaN(val) || val < 1) {
    sel[index].quantity = 1;
    sel[index].computedPrice = parseFloat((Number(sel[index].selectedSku.price || 0) * 1).toFixed(2));
    this._updateBundleTotals(sel); // ✨ 刷新视图和总价
  }
},


  // 套装商品加入购物车
  addToCartWithBundle(bundleConfig) {
    wx.showLoading({ title: '添加中...' });
    var cartData = {
      productId: this.data.currentProduct.id,
      skuId: bundleConfig[0].skuId,
      color: bundleConfig[0].color,
      size: bundleConfig[0].size,
      count: 1,
      bundleConfig: bundleConfig
    };
    api.post('/cart/items', cartData)
      .then(function() {
        wx.hideLoading();
        wx.showToast({ title: '已加入购物车', icon: 'success' });
        // 大厂逻辑：加入购物车不关闭弹窗，保障买家的连续购物流
      })
      .catch(function(err) {
        wx.hideLoading();
        if (isUnauthorized(err)) wx.showToast({ title: '请先登录', icon: 'none' });
        else wx.showToast({ title: getErrorMessage(err, '添加失败'), icon: 'none' });
      });
  },

  confirmAddToCart(e) {
    const actionType = e.currentTarget.dataset.action;
    const { currentProduct, bundleSelections, bundleAllSelected, selectedColor, selectedSize, currentSkuPrice, currentSkuStock, currentSkuUnlimited, currentSkuId, currentSkuImage, uniqueColors, uniqueSizes, quantity } = this.data;
    if (!currentProduct) return;

    if (bundleSelections && bundleSelections.length > 0) {
      if (!bundleAllSelected) return wx.showToast({ title: '请完善已选的规格', icon: 'none' });
      var selectedSubs = bundleSelections.filter(function(s) { return s.selectedSku != null; });
      if (selectedSubs.length === 0) return wx.showToast({ title: '请至少勾选一个商品', icon: 'none' });

      var bundleConfig = selectedSubs.map(function(s) {
        return { bundleGroupName: s.bundleGroupName, skuId: s.selectedSku.skuId, color: s.selectedSku.color, size: s.selectedSku.size, price: s.selectedSku.price, imageUrl: s.selectedSku.imageUrl || '', count: s.quantity };
      });

      if (actionType === 'buy') {
        this.setData({ showSku: false });
        var totalPrice = 0;
        bundleConfig.forEach(function(b) { totalPrice += (Number(b.price) || 0) * b.count; });
        var item = {
          productId: currentProduct.id, skuId: bundleConfig[0].skuId,
          name: currentProduct.name, image: currentProduct.coverUrl,
          selectedColor: bundleConfig[0].color, selectedSize: bundleConfig[0].size,
          price: totalPrice, finalPrice: totalPrice,
          count: 1, bundleConfig: bundleConfig
        };
        wx.setStorageSync('checkoutItems', [item]);
        wx.navigateTo({ url: '/pages/checkout/checkout' });
      } else {
        this.addToCartWithBundle(bundleConfig);
      }
      return;
    }


    if (uniqueColors.length > 0 && !selectedColor) {
      return wx.showToast({ title: '请选择颜色', icon: 'none' });
    }
    if (uniqueSizes.length > 0 && !selectedSize) {
      return wx.showToast({ title: '请选择尺码', icon: 'none' });
    }
    if (!hasStock(currentSkuStock, currentSkuUnlimited)) {
      return wx.showToast({ title: '该规格已售罄', icon: 'none' });
    }

    // 使用后端返回的 id 字段
    const productId = currentProduct.id || currentProduct._id;

    if (actionType === 'buy') {
      this.setData({ showSku: false });
      // 立即购买模式，使用本地存储传递数据
      const finalItem = {
        productId: productId,
        skuId: currentSkuId,
        name: currentProduct.name,
        image: currentProduct.coverUrl,
        coverUrl: currentSkuImage || currentProduct.coverUrl,  // 优先使用 SKU 图片
        selectedColor: selectedColor,
        selectedSize: selectedSize,
        finalPrice: currentSkuPrice,
        price: Number(currentSkuPrice || currentProduct.price || currentProduct.retailPrice || 0),
        count: quantity,
        selected: true
      };
      wx.setStorageSync('checkoutItems', [finalItem]);
      wx.navigateTo({ url: '/pages/checkout/checkout' });
    } else {
      // 加入购物车模式，调用后端 API
      wx.showLoading({ title: '添加中...' });

      const cartData = {
        productId: productId,
        skuId: currentSkuId || 0,
        color: selectedColor || '默认',
        size: selectedSize || '均码',
        count: quantity
      };

      api.post('/cart/items', cartData)
        .then(() => {
          wx.hideLoading();
          wx.showToast({ title: '已加入购物车', icon: 'success' });
          this.setData({ showSku: false });
        })
        .catch(err => {
          wx.hideLoading();
          console.error('添加购物车失败:', err);
          if (isUnauthorized(err)) {
            wx.showToast({ title: '请先登录', icon: 'none' });
          } else {
            wx.showToast({ title: getErrorMessage(err, '添加失败'), icon: 'none' });
          }
        });
    }
  },


  }
};
