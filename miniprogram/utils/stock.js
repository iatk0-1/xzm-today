// miniprogram/utils/stock.js
var UNLIMITED_THRESHOLD = 1000000000;

function formatStock(stock, unlimitedFlag) {
  if (unlimitedFlag === true) return '无限';
  if (stock == null) return '请选择规格';
  if (stock >= UNLIMITED_THRESHOLD) return '无限';
  return String(stock);
}

function hasStock(stock, unlimitedFlag) {
  if (unlimitedFlag === true) return true;
  return (stock || 0) > 0;
}

function isUnlimited(stock, unlimitedFlag) {
  if (unlimitedFlag === true) return true;
  return (stock || 0) >= UNLIMITED_THRESHOLD;
}

module.exports = {
  UNLIMITED_THRESHOLD: UNLIMITED_THRESHOLD,
  formatStock: formatStock,
  hasStock: hasStock,
  isUnlimited: isUnlimited
};
