const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  // 调用微信原生的云支付接口
  const res = await cloud.cloudPay.unifiedOrder({
    "body" : "fanapp 订单支付", // 顾客付款时看到的商品名
    "outTradeNo" : event.outTradeNo, // 订单号（我们从前端传过来）
    "spbillCreateIp" : "127.0.0.1",
    "subMchId" : "1739557473", // 你的专属商户号！
    "totalFee" : event.totalFee, // 支付金额（单位是“分”）
    "envId": "cloud1-1g5xiwto16479b78", // 你的专属云环境ID！
    "functionName": "payCallback" // 支付成功后的系统回调（暂不用管）
  })
  return res
}