// 仅用于展示：先四舍五入到分，再省略小数末尾的零，最多两位小数。
module.exports = function skuMoneyText(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0';
  const parts = String(amount).split('e');
  const cents = Math.round(Number(parts[0] + 'e' + (Number(parts[1] || 0) + 2)));
  return (cents / 100).toFixed(2).replace(/\.?0+$/, '');
};
