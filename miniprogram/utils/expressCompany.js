// 按微信物流快递公司列表维护展示名称。
const expressNameMap = {
  BEST: '百世快递',
  EMS: '中国邮政速递物流',
  PJ: '品骏物流',
  SF: '顺丰速运',
  YTO: '圆通速递',
  YUNDA: '韵达快递',
  ZTO: '中通快递'
};

function getExpressName(expressCode) {
  const code = expressCode == null ? '' : String(expressCode).trim();
  return Object.prototype.hasOwnProperty.call(expressNameMap, code)
    ? expressNameMap[code]
    : code || '-';
}

module.exports = { getExpressName };
