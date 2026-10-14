const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ postHandler, authError } = {}) {
  let definition;
  const requests = [], toasts = [];
  const pageFile = path.resolve(__dirname, '../../pages/afterSaleDetail/afterSaleDetail.js');
  vm.runInNewContext(fs.readFileSync(pageFile, 'utf8'), {
    Page: value => { definition = value; }, console,
    require(name) {
      if (name.endsWith('/api')) return {
        post: async (url, data) => {
          requests.push({ url, data });
          if (postHandler) return postHandler(url, data);
          return { id: '367997919246159872', status: 'approved', type: 'return_refund',
            totalRefundAmount: 109, totalQty: 1, returnExpressCode: data.expressCode,
            returnExpressNo: data.expressNo, returnShippedAt: '2026-10-14T15:28:27+08:00' };
        }
      };
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => { if (authError) throw authError; } };
      if (name.endsWith('/clipboard')) return {};
      return require(path.resolve(path.dirname(pageFile), name));
    },
    wx: {
      showModal() { throw new Error('退货表单不应调用原生输入弹窗'); },
      showActionSheet() { throw new Error('退货表单不应调用原生菜单'); },
      showToast: options => toasts.push(options.title)
    }
  });
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch); } };
  page.data.afterSaleId = '367997919246159872';
  page.data.afterSale = { status: 'approved', type: 'return_refund', warehouseCheck: 'pending', items: [] };
  return { page, requests, toasts };
}

function fill(page, code = 'YTO', number = '  YT2554201578592  ') {
  page.shipReturnGoods();
  page.toggleReturnExpressOptions();
  page.selectReturnExpress({ currentTarget: { dataset: { code } } });
  page.onReturnExpressNoInput({ detail: { value: number } });
}

test('退货物流新增或修改入口固定在标题行右侧', () => {
  const wxmlFile = path.resolve(__dirname, '../../pages/afterSaleDetail/afterSaleDetail.wxml');
  const wxml = fs.readFileSync(wxmlFile, 'utf8');
  assert.match(wxml, /class="return-logistics-header"[\s\S]*退货物流[\s\S]*class="return-logistics-action"/);
  assert.match(wxml, /afterSale\.returnExpressNo \? '修改' : '新增'/);
  assert.doesNotMatch(wxml, /class="action-btn"[^>]*bindtap="shipReturnGoods"/);
});

test('自定义弹窗打开后先选快递再填单号，保存成功关闭弹窗并更新物流和进度', async () => {
  const env = harness();
  fill(env.page);
  assert.equal(env.page.data.showReturnShippingModal, true);
  assert.equal(env.page.data.returnExpressName, '圆通');
  assert.equal(env.page.data.showReturnExpressOptions, false);
  await env.page.submitReturnShipping();
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].url, '/after-sales/367997919246159872/return-ship');
  assert.equal(env.requests[0].data.expressCode, 'YTO');
  assert.equal(env.requests[0].data.expressNo, 'YT2554201578592');
  assert.equal(env.page.data.afterSale.returnExpressNo, 'YT2554201578592');
  assert.ok(env.page.data.timeline.some(item => item.status === '用户已寄回'));
  assert.equal(env.page.data.showReturnShippingModal, false);
  assert.equal(env.page.data.isSubmittingReturnShipping, false);
  assert.deepEqual(env.toasts, ['提交成功']);
});

test('七种快递均在同一自定义选择列表中，并提交对应代码', async () => {
  for (const [code, name] of [['ZTO', '中通'], ['YTO', '圆通'], ['STO', '申通'],
    ['YD', '韵达'], ['SF', '顺丰'], ['EMS', '邮政 EMS'], ['OTHER', '其他']]) {
    const env = harness();
    fill(env.page, code, 'RETURN123');
    assert.equal(env.page.data.returnExpressName, name);
    await env.page.submitReturnShipping();
    assert.equal(env.requests.length, 1);
    assert.equal(env.requests[0].data.expressCode, code);
  }
});

test('未选公司及空白单号在弹窗内提示，不发请求且保留表单', async () => {
  const env = harness();
  env.page.shipReturnGoods();
  env.page.onReturnExpressNoInput({ detail: { value: '123456' } });
  await env.page.submitReturnShipping();
  assert.equal(env.page.data.returnShippingError, '请选择快递公司');
  fill(env.page, 'YTO', '  ');
  await env.page.submitReturnShipping();
  assert.equal(env.page.data.returnShippingError, '请输入快递单号');
  assert.equal(env.page.data.showReturnShippingModal, true);
  assert.equal(env.requests.length, 0);
});

test('取消不保存，重新打开清空表单；输入单号时收起选择列表', async () => {
  const env = harness();
  fill(env.page);
  env.page.toggleReturnExpressOptions();
  env.page.onReturnExpressNoFocus();
  assert.equal(env.page.data.showReturnExpressOptions, false);
  env.page.closeReturnShippingModal();
  await env.page.submitReturnShipping();
  assert.equal(env.requests.length, 0);
  assert.equal(env.page.data.showReturnShippingModal, false);
  env.page.shipReturnGoods();
  assert.equal(env.page.data.returnExpressCode, '');
  assert.equal(env.page.data.returnExpressNo, '');
  assert.equal(env.page.data.returnShippingError, '');
});

test('提交期间禁止重复请求和关闭弹窗，保存失败保留输入并能重试', async () => {
  let rejectSave;
  let attempt = 0;
  const env = harness({ postHandler: async (url, data) => {
    if (attempt++ === 0) return new Promise((resolve, reject) => { rejectSave = reject; });
    return { status: 'approved', type: 'return_refund', totalRefundAmount: 109, ...data,
      returnExpressCode: data.expressCode, returnExpressNo: data.expressNo };
  } });
  fill(env.page);
  const pending = env.page.submitReturnShipping();
  await new Promise(resolve => setImmediate(resolve));
  await env.page.submitReturnShipping();
  env.page.closeReturnShippingModal();
  env.page.selectReturnExpress({ currentTarget: { dataset: { code: 'SF' } } });
  env.page.onReturnExpressNoInput({ detail: { value: 'CHANGED' } });
  assert.equal(env.requests.length, 1);
  assert.equal(env.page.data.showReturnShippingModal, true);
  assert.equal(env.page.data.returnExpressCode, 'YTO');
  assert.equal(env.page.data.returnExpressNo, '  YT2554201578592  ');
  rejectSave({ message: '售后单状态已变更，请刷新后重试' });
  await pending;
  assert.equal(env.page.data.returnShippingError, '售后单状态已变更，请刷新后重试');
  assert.equal(env.page.data.isSubmittingReturnShipping, false);
  assert.equal(env.toasts.length, 0);
  await env.page.submitReturnShipping();
  assert.equal(env.requests.length, 2);
  assert.equal(env.page.data.showReturnShippingModal, false);
});

test('登录失败保留填写内容并解除提交状态，不误报成功', async () => {
  const env = harness({ authError: { message: '登录已过期，请重新登录' } });
  fill(env.page);
  await env.page.submitReturnShipping();
  assert.equal(env.requests.length, 0);
  assert.equal(env.page.data.returnShippingError, '登录已过期，请重新登录');
  assert.equal(env.page.data.showReturnShippingModal, true);
  assert.equal(env.page.data.isSubmittingReturnShipping, false);
  assert.equal(env.page.data.returnExpressCode, 'YTO');
  assert.equal(env.toasts.length, 0);
});

test('物流和进度将码值转成中文，修改时回填公司和原单号', async () => {
  const env = harness();
  env.page.data.afterSale = env.page.formatAfterSaleDetail({ status: 'approved', type: 'return_refund',
    warehouseCheck: 'pending', returnExpressCode: 'OTHER', returnExpressNo: '1234' });
  assert.equal(env.page.data.afterSale.returnExpressName, '其他');
  assert.equal(env.page.data.afterSale.canModifyReturnShipping, true);
  assert.ok(env.page.buildTimeline(env.page.data.afterSale).some(item => item.description === '其他：1234'));
  env.page.shipReturnGoods();
  assert.equal(env.page.data.returnExpressCode, 'OTHER');
  assert.equal(env.page.data.returnExpressName, '其他');
  assert.equal(env.page.data.returnExpressNo, '1234');
  env.page.selectReturnExpress({ currentTarget: { dataset: { code: 'YTO' } } });
  env.page.onReturnExpressNoInput({ detail: { value: 'YT2554201578592' } });
  await env.page.submitReturnShipping();
  assert.equal(env.requests[0].data.expressCode, 'YTO');
  assert.equal(env.page.data.afterSale.returnExpressName, '圆通');
  assert.equal(env.page.getReturnExpressName('YUNDA'), '韵达');
  assert.equal(env.page.getReturnExpressName('BEST'), '百世快递');
  assert.equal(env.page.getReturnExpressName('UNRECOGNIZED'), '其他');
});

test('仓库收货后无论验收通过或失败都禁止修改，兼容主单状态未同步的数据', async () => {
  for (const patch of [
    { status: 'received' }, { status: 'refunded' },
    { warehouseCheck: 'pass' }, { warehouseCheck: 'fail' },
    { items: [{ afterSaleType: 'return_refund', status: 'received' }] },
    { items: [{ afterSaleType: 'return_refund', status: 'refunded' }] }
  ]) {
    const env = harness();
    env.page.data.afterSale = env.page.formatAfterSaleDetail({ ...env.page.data.afterSale, ...patch,
      returnExpressCode: 'YTO', returnExpressNo: 'ORIGINAL' });
    assert.equal(env.page.data.afterSale.canModifyReturnShipping, false);
    env.page.shipReturnGoods();
    assert.equal(env.page.data.showReturnShippingModal, false);
    assert.equal(env.toasts.length, 1);
    // 即便弹窗已打开时状态改变，也不能发起修改请求。
    env.page.data.showReturnShippingModal = true;
    env.page.data.returnExpressCode = 'SF';
    env.page.data.returnExpressNo = 'CHANGED';
    await env.page.submitReturnShipping();
    assert.equal(env.requests.length, 0);
    assert.match(env.page.data.returnShippingError, /不允许修改/);
  }
});
