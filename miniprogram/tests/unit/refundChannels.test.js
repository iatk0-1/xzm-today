const test = require('node:test');
const assert = require('node:assert/strict');
const channels = require('../../utils/refundChannels');
function page() { return { data: {}, setData(patch) { Object.assign(this.data, patch); } }; }
const line = (amount = '50.00') => [{ orderItemId: '371292052173885440', qty: 1, refundAmount: amount, afterSaleType: 'refund' }];
const response = (online, offline, token = 'quote') => ({ onlineAmount: online, offlineAmount: offline, totalAmount: Number(online) + Number(offline), items: [], token });
test('申请与审核展示允许线上0元，不能把0元误当成未计算', () => {
  const value = channels.format(response(0, 50));
  assert.equal(value.onlineAmount, '0.00'); assert.equal(value.offlineAmount, '50.00'); assert.equal(value.totalAmount, '50.00');
});
test('管理员改数量金额触发的新报价先返回时，迟到的旧报价不能覆盖', async () => {
  const p = page(); const resolves = [];
  const api = { post: () => new Promise(resolve => resolves.push(resolve)) };
  const old = channels.preview(p, api, '/preview', line('50.00'), 'reviewQuote');
  const latest = channels.preview(p, api, '/preview', line('20.00'), 'reviewQuote');
  resolves[1](response(2, 18, 'new')); await latest;
  resolves[0](response(5, 45, 'old')); await old;
  assert.equal(p.data.reviewQuote.token, 'new'); assert.equal(p.data.reviewQuoteLoading, false);
});
test('输入变化立即作废旧拆分，计算失败时不允许沿用旧报价', async () => {
  const p = page(); p.data.refundQuote = response(5, 45);
  const promise = channels.preview(p, { post: async () => { throw new Error('渠道余额已变化'); } }, '/preview', line(), 'refundQuote');
  assert.equal(p.data.refundQuote, null); await promise;
  assert.equal(p.data.refundQuote, null); assert.match(p.data.refundQuoteError, /余额已变化/);
});
test('清空选择后迟到报价不能恢复已取消申请的金额', async () => {
  const p = page(); let resolve;
  const old = channels.preview(p, { post: () => new Promise(r => { resolve = r; }) }, '/preview', line(), 'refundQuote');
  await channels.preview(p, {}, '/preview', [], 'refundQuote');
  resolve(response(0, 50)); await old;
  assert.equal(p.data.refundQuote, null); assert.equal(p.data.refundQuoteLoading, false);
});
test('不完整或超过两位小数的金额不能请求报价', async () => {
  let calls = 0; const api = { post: async () => { calls++; } }; const p = page();
  for (const value of ['', '0', '-1', '0.001', 'NaN']) await channels.preview(p, api, '/preview', line(value), 'refundQuote');
  assert.equal(calls, 0); assert.ok(p.data.refundQuoteError);
});
