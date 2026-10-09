const { isSkuSoldOut } = require('./stock');

function getColors(skus) {
  return Array.from(new Set(skus.map(sku => sku.color || sku.spec || ''))).filter(Boolean);
}

function getSizes(skus) {
  return Array.from(new Set(skus.map(sku => sku.size || ''))).filter(Boolean);
}

function findSelectedSku(skus, selectedColor, selectedSize) {
  const needColor = getColors(skus).length > 0;
  const needSize = getSizes(skus).length > 0;
  if ((needColor && !selectedColor) || (needSize && !selectedSize)) return null;
  return skus.find(sku => !isSkuSoldOut(sku)
    && (!needColor || (sku.color || sku.spec) === selectedColor)
    && (!needSize || sku.size === selectedSize)) || null;
}

function getSkuOptions(skus, selectedColor) {
  const uniqueColors = getColors(skus);
  const uniqueSizes = getSizes(skus);
  return {
    uniqueColors,
    uniqueSizes,
    // 颜色按整体库存判断，避免被当前尺码锁住，导致无法切到其他有货颜色。
    colorOptions: uniqueColors.map(value => ({
      value,
      disabled: !skus.some(sku => (sku.color || sku.spec) === value && !isSkuSoldOut(sku))
    })),
    sizeOptions: uniqueSizes.map(value => ({
      value,
      disabled: !skus.some(sku => sku.size === value && !isSkuSoldOut(sku)
        && (!selectedColor || (sku.color || sku.spec) === selectedColor))
    }))
  };
}

function getDefaultSkuSelection(skus, color) {
  const colors = color ? [color] : getColors(skus);
  const sizes = getSizes(skus);
  // 按界面颜色、尺码的展示顺序查找，不能只取 SKU 数组中第一条有货的数据。
  for (const selectedColor of colors.length ? colors : ['']) {
    for (const selectedSize of sizes.length ? sizes : ['']) {
      if (findSelectedSku(skus, selectedColor, selectedSize)) {
        return { selectedColor, selectedSize };
      }
    }
  }
  return { selectedColor: '', selectedSize: '' };
}

function getSkuOptionSelection(skus, selectedColor, selectedSize, field, value) {
  const options = getSkuOptions(skus, selectedColor);
  const list = field === 'selectedColor' ? options.colorOptions : options.sizeOptions;
  if (!list.some(option => option.value === value && !option.disabled)) return null;
  if (field === 'selectedColor') {
    if (findSelectedSku(skus, value, selectedSize)) {
      return { selectedColor: value, selectedSize };
    }
    return getDefaultSkuSelection(skus, value);
  }
  return { selectedColor, selectedSize: value };
}

module.exports = { findSelectedSku, getSkuOptions, getDefaultSkuSelection, getSkuOptionSelection };
