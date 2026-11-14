const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('小程序启动恢复首页，不再执行购买须知状态查询和强制同意检查', async () => {
  const app = require('../../app.json');
  assert.equal(app.pages[0], 'pages/index/index');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/purchaseConsent.js'), 'utf8'), {
    module, require() { throw new Error('已停用功能不能再请求接口'); }
  });
  assert.equal(await module.exports.ensure({ route: 'pages/detail/detail' }, {}), true);
});

test('历史须知地址直接跳回原页面，无弹窗、计时或同意动作', () => {
  let page;
  const targets = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/purchaseConsent/purchaseConsent.js'), 'utf8'), {
    Page: value => { page = value; }, wx: { reLaunch: value => targets.push(value.url) }
  });
  page.onLoad({ returnTo: encodeURIComponent('/pages/detail/detail?id=123') });
  page.onLoad({});
  page.onLoad({ returnTo: encodeURIComponent('/pages/purchaseConsent/purchaseConsent') });
  assert.deepEqual(targets, ['/pages/detail/detail?id=123', '/pages/index/index', '/pages/index/index']);
  assert.equal(page.agree, undefined);
});
