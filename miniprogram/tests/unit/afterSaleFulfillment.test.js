const test = require('node:test');
const assert = require('node:assert/strict');
const { format } = require('../../utils/afterSaleFulfillment');

test('申请两件只展示匹配到的未报单一件和已备货一件，不混入整单已发货', () => {
  const result = format({ qty: 2, fulfillment: { unreportedQty: 1, transitQty: 1, stockQty: 0, shippedQty: 0 } });
  assert.equal(result.fulfillmentKnown, true);
  assert.match(result.fulfillmentText, /未报单 1 件.*已备货未发 1 件.*已发货 0 件/);
  assert.match(result.fulfillmentStockText, /在途 1 件.*现货 0 件/);
});

test('申请快照按原申请数量展示，审核缩减数量后不冒充原申请变化', () => {
  const result = format({ qty: 1, requestedQty: 2, fulfillment: { unreportedQty: 1, transitQty: 1, stockQty: 0, shippedQty: 0 } });
  assert.equal(result.fulfillmentKnown, true);
  assert.match(result.fulfillmentText, /^申请时匹配/);
});

test('历史缺失、无效或数量对不上的快照明确提示核对，不伪装成未报单', () => {
  for (const fulfillment of [undefined, {}, { unreportedQty: null, transitQty: 1, stockQty: 0, shippedQty: 0 },
    { unreportedQty: 0, transitQty: 0, stockQty: 0, shippedQty: 0 }]) {
    const result = format({ qty: 1, fulfillment });
    assert.equal(result.fulfillmentKnown, false);
    assert.match(result.fulfillmentText, /未保存.*核对/);
  }
});

test('处理中售后展示当前匹配，同时保留申请时在途快照', () => {
  const result = format({ qty: 2, requestedQty: 2,
    currentFulfillment: { unreportedQty: 1, transitQty: 0, stockQty: 1, shippedQty: 0 },
    fulfillment: { unreportedQty: 1, transitQty: 1, stockQty: 0, shippedQty: 0 } });
  assert.match(result.fulfillmentText, /^当前售后匹配/);
  assert.match(result.fulfillmentStockText, /在途 0 件.*现货 1 件/);
  assert.match(result.applicationFulfillmentText, /^申请时/);
});

test('旧的处理中售后没有申请快照也能显示服务端核对的当前匹配', () => {
  const result = format({ qty: 1, currentFulfillment: { unreportedQty: 0, transitQty: 1, stockQty: 0, shippedQty: 0 } });
  assert.equal(result.fulfillmentKnown, true);
  assert.match(result.fulfillmentText, /^当前售后匹配.*已备货未发 1 件/);
  assert.equal(result.applicationFulfillmentText, '');
});
