function readyStockPrompt(shortages) {
  return {
    title: '现货不足',
    content: shortages.map(line => `当前「${line.productName}」（${line.color} / ${line.size}）只剩现货${line.readyStockQty}件`).join('；\n')
      + '。\n现货不足的部分需备货，请确认是否继续下单？',
    confirmText: '继续下单', cancelText: '暂不下单'
  };
}

module.exports = { readyStockPrompt };
