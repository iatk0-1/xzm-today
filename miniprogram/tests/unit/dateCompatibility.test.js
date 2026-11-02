const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NativeDate = Date;
const unsupported = [];
// 模拟 iOS：拒绝带横杠和空格的日期时间，同时记录不兼容的原生解析调用。
class IOSDate extends NativeDate {
  constructor(...args) {
    if (args.length === 1 && typeof args[0] === 'string' && !IOSDate.supports(args[0])) {
      unsupported.push(args[0]);
      super(NaN);
    } else {
      super(...args);
    }
  }
  static supports(value) {
    return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value);
  }
  static parse(value) {
    return new IOSDate(value).getTime();
  }
}

const dateModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../utils/date.js'), 'utf8'), {
  module: dateModule, Date: IOSDate
});
const { parseDate, dateTimestamp } = dateModule.exports;

function loadPage(relative, timers = []) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages', relative), 'utf8'), {
    Date: IOSDate, Array, console,
    Page(value) { definition = value; },
    require(name) {
      if (name.endsWith('/date')) return dateModule.exports;
      if (name.endsWith('/pageSync') || name.endsWith('/autoSearch')) return { wrap: page => page };
      if (name.endsWith('/auth')) return { isAdmin: () => false, isStallManager: () => false };
      if (name.endsWith('/inventoryOperations')) return require('../../utils/inventoryOperations');
      return {};
    },
    setInterval(fn) { timers.push(fn); return timers.length; }, clearInterval() {},
    wx: {}
  });
  return definition;
}

test('iOS 下解析空格、T、斜杠和小数秒，不向原生解析器传不兼容格式', () => {
  unsupported.length = 0;
  for (const value of ['2026-09-07 16:14:32', '2026-09-07T16:14:32', '2026/09/07 16:14:32']) {
    assert.equal(dateTimestamp(value), new NativeDate(2026, 8, 7, 16, 14, 32).getTime());
  }
  assert.equal(dateTimestamp('2026-09-07 16:14'), new NativeDate(2026, 8, 7, 16, 14).getTime());
  assert.equal(parseDate('2026-09-07 16:14:32.123456789').getMilliseconds(), 123);
  assert.equal(parseDate('2026-09-07T16:14:32.1').getMilliseconds(), 100);
  assert.equal(dateTimestamp('2026/09/07'), new NativeDate(2026, 8, 7).getTime());
  assert.deepEqual(unsupported, []);
});

test('带时区的日期保留真实时间，标准日期、毫秒时间戳和跨上下文 Date 对象仍可解析', () => {
  unsupported.length = 0;
  const expected = NativeDate.parse('2026-09-07T08:14:32Z');
  for (const value of ['2026-09-07T16:14:32+08:00', '2026-09-07 16:14:32+08:00', '2026-09-07T08:14:32Z']) {
    assert.equal(dateTimestamp(value), expected);
  }
  assert.equal(dateTimestamp('2026-09-07T16:14+08:00'), expected - 32000);
  assert.equal(dateTimestamp('2026-09-07T08:14:32.123456Z'), expected + 123);
  assert.equal(dateTimestamp('2026-09-07'), NativeDate.parse('2026-09-07'));
  assert.equal(dateTimestamp(expected), expected);
  assert.equal(dateTimestamp(new NativeDate(expected)), expected);
  assert.equal(dateTimestamp([2026, 9, 7, 16, 14, 32]), new NativeDate(2026, 8, 7, 16, 14, 32).getTime());
  for (const value of [null, undefined, '', '无效时间', {}, NaN]) assert.ok(Number.isNaN(dateTimestamp(value)));
  assert.deepEqual(unsupported, []);
});

test('订单、售后、客服、库存等页面格式化时不再触发 iOS 原生解析警告', () => {
  unsupported.length = 0;
  const pages = [
    ['orderList/orderList.js', 'formatTime'], ['orderDetail/orderDetail.js', 'formatTime'],
    ['adminOrder/adminOrder.js', 'formatDate'], ['adminOrderManage/adminOrderManage.js', 'formatTime'],
    ['adminOrderDetail/adminOrderDetail.js', 'formatTime'], ['afterSaleDetail/afterSaleDetail.js', 'formatDateTime'],
    ['adminAfterSaleList/adminAfterSaleList.js', 'formatDateTime'], ['adminAfterSaleDetail/adminAfterSaleDetail.js', 'formatDateTime'],
    ['customerServiceChat/customerServiceChat.js', 'formatTime'], ['messages/messages.js', 'formatTime'],
    ['inventoryDetail/inventoryDetail.js', 'formatTime'], ['purchaseOrders/purchaseOrders.js', 'formatTime'],
    ['shipPartial/shipPartial.js', 'formatTime'], ['shipmentTraceDetail/shipmentTraceDetail.js', 'formatTime'],
    ['adminSalesDetail/adminSalesDetail.js', 'formatTime'], ['adminShippingSalesDetail/adminShippingSalesDetail.js', 'formatTime'],
    ['adminProductRecycleBin/adminProductRecycleBin.js', 'formatDeletedTime'], ['wishDetail/wishDetail.js', 'formatTime', '2026-09-07']
  ];
  for (const [file, method, expectedPart = '16:14'] of pages) {
    const page = loadPage(file);
    const formatted = page[method]('2026-09-07 16:14:32');
    assert.ok(formatted.includes(expectedPart), file + ' 应正确显示时间，实际：' + formatted);
    assert.deepEqual(unsupported, [], file + ' 不应调用不兼容的原生日期解析');
  }
  const page = loadPage('orderList/orderList.js');
  const timestamp = new NativeDate(2026, 8, 7, 16, 14, 32).getTime();
  for (const value of [timestamp, timestamp / 1000, [2026, 9, 7, 16, 14, 32]]) {
    assert.equal(page.formatTime(value), '2026-09-07 16:14:32');
  }
  assert.equal(page.formatTime('无效时间'), '无效时间');
});

test('支付倒计时和直播时间转换在 iOS 下使用正确的时间戳', () => {
  unsupported.length = 0;
  const timers = [];
  const order = loadPage('orderDetail/orderDetail.js', timers);
  const deadlines = [];
  order.updateCountdown = deadline => deadlines.push(deadline);
  order.startCountdown('2026-09-07 16:14:32');
  timers[0]();
  const expected = new NativeDate(2026, 8, 7, 16, 44, 32).getTime();
  assert.deepEqual(deadlines, [expected, expected]);
  for (const file of ['liveRoomList/index.js', 'liveRoomDetail/detail.js']) {
    const live = loadPage(file);
    assert.equal(live.normalizeTimestamp('2026-09-07 16:14:32'), expected - 30 * 60 * 1000);
    assert.equal(live.normalizeTimestamp('1788797672'), 1788797672000);
  }
  assert.deepEqual(unsupported, []);
});
