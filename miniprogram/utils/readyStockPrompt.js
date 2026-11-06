function readyStockPrompt() {
  return { title: '现货不足', content: '现货数量不足，请重新下单哦~', showCancel: false };
}

module.exports = { readyStockPrompt };
