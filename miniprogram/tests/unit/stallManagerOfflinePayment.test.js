const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const finance = require('../../utils/managerFinance');

const fixedNow = Date.parse('2026-10-04T15:55:00+08:00');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixedNow])); }
  static now() { return fixedNow; }
}

function harness({ get, post, confirm = true } = {}) {
  let config;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../pages/stallManagerDetail/stallManagerDetail.js'), 'utf8'), {
    Page: value => { config = value; }, Date: FixedDate,
    require: name => name.endsWith('/error') ? require('../../utils/error') : name.endsWith('/api') ? {
      async get(url, params) {
        calls.push({ method: 'get', url, params });
        return get ? get(url, params) : { content: [], totalElements: 0, totalPages: 0 };
      },
      async post(url, body) { calls.push({ method: 'post', url, body }); return post && post(url, body); }
    } : name.endsWith('/managerFinance') ? { ...finance, confirmAction: async () => confirm }
      : name.endsWith('/auth') ? { isAdmin: () => true, getUserInfo: () => ({ userId: '42' }) } : {},
    wx: { showToast() {}, stopPullDownRefresh() {}, getStorageSync() { return null; } }, console
  });
  const page = { ...config, data: structuredClone(config.data), _authorized: true };
  page.setData = patch => Object.assign(page.data, patch);
  page.setData({ userId: '42', tab: 'records', allocations: { '9007199254740993': '10.25' }, settlementTotal: '10.25', income: { settleableIncome: '20' } });
  return { page, calls };
}
const change = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } });
const choose = value => ({ detail: { value } });
function fillPayment(page) {
  page.paymentTimeChange(change('paidDate', '2026-10-03'));
  page.paymentTimeChange(change('paidTime', '09:30'));
  page.paymentMethodChange(choose(0));
  page.setData({ voucher: '银行流水123' });
}

test('日期和时间选择器合成北京时间，未完整选择不生成付款时间', () => {
  const { page } = harness();
  page.updatePaidDateEnd();
  assert.equal(page.data.paidDateEnd, '2026-10-04');
  assert.equal(page.data.paidAt, '');
  page.paymentTimeChange(change('paidTime', '09:30'));
  assert.equal(page.data.paidAt, '');
  page.paymentTimeChange(change('paidDate', '2026-10-03'));
  assert.equal(page.data.paidAt, '2026-10-03T09:30:00+08:00');
  page.paymentTimeChange(change('paidDate', '2026-10-02'));
  assert.equal(page.data.paidAt, '2026-10-02T09:30:00+08:00');
});

test('付款方式使用选择器，其他方式清空原值，切回常用方式不带入自定义值', () => {
  const { page } = harness();
  page.paymentMethodChange(choose(0));
  assert.equal(page.data.paymentMethod, '银行转账');
  page.paymentMethodChange(choose(4));
  assert.equal(page.data.paymentMethod, '');
  page.setData({ paymentMethod: '支票' });
  page.paymentMethodChange(choose(3));
  assert.equal(page.data.paymentMethod, '现金');
});

test('明细状态选择器查询对应佣金，不影响商品状态、填写金额和合计', async () => {
  const { page, calls } = harness();
  page.setData({ productStatus: 'sold_out' });
  await page.recordStatusChange(choose(1));
  assert.equal(calls[0].url, '/stall-managers/42/commission-records');
  assert.equal(calls[0].params.status, 'COMPLETED');
  assert.equal(calls[0].params.page, 1);
  await page.recordStatusChange(choose(2));
  assert.equal(calls[1].params.status, 'PENDING');
  await page.recordStatusChange(choose(0));
  assert.equal(Object.hasOwn(calls[2].params, 'status'), false);
  assert.equal(page.data.productStatus, 'sold_out');
  assert.equal(page.data.settlementTotal, '10.25');
  assert.equal(page.data.allocations['9007199254740993'], '10.25');
});

test('更新收入与明细同步账户和首屏佣金，保留当前状态筛选及付款信息', async () => {
  const { page, calls } = harness({ get: url => {
    if (url === '/stall-managers/42') return { stallIds: [] };
    if (url.endsWith('/income')) return { settleableIncome: '18' };
    if (url === '/stalls/all') return [];
    if (url.endsWith('/receiver')) return { registered: false };
    return { content: [{ id: '1', productName: '商品' }], totalElements: 1, totalPages: 1 };
  } });
  fillPayment(page);
  page.setData({ filterStatus: 'COMPLETED', recordStatusIndex: 1 });
  await page.refreshRecords();
  assert.equal(page.data.income.settleableIncome, '18');
  const list = calls.find(call => call.url.endsWith('/commission-records'));
  assert.equal(list.params.status, 'COMPLETED');
  assert.equal(list.params.page, 1);
  assert.equal(page.data.paidAt, '2026-10-03T09:30:00+08:00');
  assert.equal(page.data.voucher, '银行流水123');
});

test('只填必要付款信息即可登记，备注留空自动生成说明，成功清空付款表单', async () => {
  const { page, calls } = harness();
  fillPayment(page);
  page.refresh = async () => {};
  await page.settleOffline();
  assert.equal(calls[0].url, '/stall-managers/42/offline-settlements');
  assert.equal(calls[0].body.paidAt, '2026-10-03T09:30:00+08:00');
  assert.equal(calls[0].body.paymentMethod, '银行转账');
  assert.equal(calls[0].body.voucher, '银行流水123');
  assert.equal(calls[0].body.amount, '10.25');
  assert.equal(calls[0].body.allocations[0].recordId, '9007199254740993');
  assert.match(calls[0].body.reason, /线下佣金付款/);
  assert.equal(page.data.paidAt, '');
  assert.equal(page.data.paidDate, '');
  assert.equal(page.data.paidTime, '');
  assert.equal(page.data.voucher, '');
  assert.equal(page.data.paymentMethodIndex, -1);
  assert.equal(page.data.settlementTotal, '0.00');
});

test('缺少日期时间、付款方式或凭证，以及未来时间都不会提交', async () => {
  for (const [patch, expected] of [
    [{ paidAt: '' }, /选择实际付款日期和时间/],
    [{ paymentMethod: '' }, /付款方式/],
    [{ voucher: ' ' }, /凭证/],
    [{ paidAt: '2026-10-04T16:00:00+08:00' }, /晚于当前时间/]
  ]) {
    const { page, calls } = harness();
    fillPayment(page);
    page.setData(patch);
    await page.settleOffline();
    assert.equal(calls.length, 0);
    assert.match(page.data.error, expected);
  }
});

test('保存失败保留付款信息和备注，取消确认不登记付款', async () => {
  const { page, calls } = harness({ post: () => { throw new Error('登记失败'); } });
  fillPayment(page);
  page.toggleSettlementNote();
  page.setData({ settlementReason: '核对付款合同' });
  await page.settleOffline();
  assert.equal(calls[0].body.reason, '核对付款合同');
  assert.equal(page.data.voucher, '银行流水123');
  assert.equal(page.data.settlementTotal, '10.25');
  assert.equal(page.data.settlementReason, '核对付款合同');
  assert.equal(page.data.error, '登记失败');
  const cancelled = harness({ confirm: false });
  fillPayment(cancelled.page);
  await cancelled.page.settleOffline();
  assert.equal(cancelled.calls.length, 0);
  assert.equal(cancelled.page.data.voucher, '银行流水123');
});

test('登记期间日期、付款方式、明细金额和备注不能变动', () => {
  const { page } = harness();
  fillPayment(page);
  page.setData({ busy: true });
  page.paymentTimeChange(change('paidDate', '2026-10-02'));
  page.paymentMethodChange(choose(3));
  page.allocationInput({ currentTarget: { dataset: { id: '9007199254740993' } }, detail: { value: '99' } });
  page.toggleSettlementNote();
  assert.equal(page.data.paidDate, '2026-10-03');
  assert.equal(page.data.paymentMethod, '银行转账');
  assert.equal(page.data.settlementTotal, '10.25');
  assert.equal(page.data.settlementNoteVisible, false);
});
