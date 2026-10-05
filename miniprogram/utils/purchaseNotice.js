const DEFAULT_PURCHASE_NOTICE = `【下单即默认同意以下全部规则哦，介意勿拍！】
小程序内所有商品为档口报单代购，属于代购服务，排单货品，非质量问题不退不换，下单即代表阅读并同意全部规则！

✅ 售后总则
衣服收到请第一时间开箱检查；下水、穿着、拆除吊牌，均无法售后。
有质量问题只换不退，仅更换订单原规格、原色、原尺码；批发代购遵循批发市场规则，不支持无理由退款。
不喜欢、尺码不合适、款式不满意、材质体感不合预期，不在售后范围。

✅ 次品换新规则
收到货48小时内拍照反馈，签收起3天内寄回，超时不予处理。
👉 买家承担寄回运费，我方承担再次寄出运费。

✅ 排单&缺货说明
排单周期：3～30天，爆款可能延期。排单期间，任何个人理由不支持退单。
仅小概率档口缺货/拼团失败，会主动办理退款。
我们仅做代购搬运，不生产衣服，档口出货延迟，不作为退货理由。

✅ 特价品提示
特价商品存在微瑕概率，严重问题可按售后规则换新；完美主义姐妹介意勿拍。

✅ 不属于质量问题（不支持售后）
线头、衣物气味、肤感、无吊牌/混标/无标、动物毛扎感、拍摄轻微色差，均属于正常出货情况，不属于次品。
含羊毛面料洗护不当造成缩水变形，不属于质量问题，建议手洗，下单前自查洗护方式。

✅ 修改地址、拍错规格

1. 未发货：快团后台备注+微信同步告知客服，仅双重通知才生效，后台备注客服看不到。

2. 已发货：无法修改地址。

3. 拍错颜色/尺码，务必第一时间微信联系客服。

✅ 套装购买特殊说明
成套下单，若其中单品档口缺货，缺货单品不支持单独退货，属于档口不可控因素，请知悉。

✅ 售后渠道&客服时间
快团/小程序后台无客服，售后请直接微信私聊；群内消息容易遗漏，售后不要在群内留言。
客服上班：12:30–20:30，市场选款期间回复会慢，敬请理解。

⚠️ 自愿下单，理性消费，不强买强卖。下单即代表已阅读并接受全部代购规则，感谢理解🙏`;

function getPurchaseNotice(value) {
  return typeof value === 'string' && value.trim() ? value : DEFAULT_PURCHASE_NOTICE;
}

// 相同须知只展示一次，不同商品的规则全部保留。
function buildPurchaseNoticeSections(products) {
  const sections = [];
  (products || []).forEach(product => {
    const content = getPurchaseNotice(product.purchaseNotice);
    const existing = sections.find(section => section.content === content);
    const name = product.name || product.title || '商品';
    if (existing) {
      if (!existing.names.includes(name)) existing.names.push(name);
    } else {
      sections.push({ content, names: [name] });
    }
  });
  return sections.map((section, index) => ({
    id: index,
    title: sections.length > 1 ? section.names.join('、') : '',
    content: section.content
  }));
}

module.exports = { DEFAULT_PURCHASE_NOTICE, getPurchaseNotice, buildPurchaseNoticeSections };
