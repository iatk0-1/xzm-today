const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const tick = () => new Promise(resolve => setImmediate(resolve));

test('读取旧账号的同意状态晚返回，不能放行已经切换的新账号', async () => {
  let user = 'a', complete;
  const redirects = [], module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/purchaseConsent.js'), 'utf8'), {
    module, console, wx: { reLaunch: options => redirects.push(options.url) },
    require: name => name === './auth' ? { getUserInfo: () => ({ userId: user }) } : {
      get: () => user === 'a' ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ agreed: false })
    }
  });
  const consent = module.exports;
  const waiting = consent.ensure({ route: 'pages/detail/detail' }, { id: '1' });
  user = 'b'; complete({ agreed: true });
  assert.equal(await waiting, false);
  assert.equal(consent.isConfirmed(), false);
  assert.equal(redirects.length, 1);
});
function gate({ agreed = false, accept, read, get, fits = false } = {}) {
  let definition, now = 0, interval;
  const calls = [], redirects = [], remembered = [];
  let reads = 0;
  const wx = {
    reLaunch: options => redirects.push(options.url),
    createSelectorQuery: () => {
      const query = { in: () => query, select: () => query, boundingClientRect: () => query,
        exec: callback => callback([{ height: 400 }, { height: fits ? 300 : 1200 }]) };
      return query;
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../pages/purchaseConsent/purchaseConsent.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, console,
    Date: { now: () => now }, setInterval: callback => { interval = callback; return 1; }, clearInterval: () => { interval = null; },
    require(name) {
      if (name.endsWith('/auth')) return { ensureAuthenticated: async () => {}, loadPermissionSnapshot: async () => {} };
      if (name.endsWith('/error')) return require('../../utils/error');
      if (name.endsWith('/purchaseConsent')) return { GATE_ROUTE: 'pages/purchaseConsent/purchaseConsent',
        entered() {}, remember: result => remembered.push(result) };
      if (name.endsWith('/api')) return {
        get: async () => get ? get() : { agreed },
        post: async (url, body) => {
          calls.push({ url, body });
          if (url.endsWith('/reading')) return read ? read(++reads) : { readingId: 'reading-1', version: 'v1', purchaseNotice: '完整购买须知' };
          return accept ? accept(body) : { agreed: true, version: 'v1', agreedAt: '2026-11-11T08:00:05Z' };
        }
      };
      throw new Error('未模拟模块：' + name);
    }
  });
  const page = { ...definition, data: structuredClone(definition.data),
    setData(data, callback) { Object.assign(this.data, data); if (callback) callback(); } };
  return { page, calls, redirects, remembered,
    async load(options) { page.onLoad(options); page.onShow(); await tick(); },
    advance(ms) { now += ms; if (interval) interval(); },
    agreements: () => calls.filter(call => call.url.endsWith('/agree')) };
}

test('须知同时满足5秒和到底才提交，同意落库成功才恢复带参数分享页面', async () => {
  const env = gate();
  const target = '/pages/detail/detail?id=9007199254740993123&source=分享';
  await env.load({ returnTo: encodeURIComponent(target) });
  assert.equal(env.page.data.ready, true);
  await env.page.agree();
  env.advance(4999);
  assert.equal(env.page.data.remaining, 1);
  await env.page.agree();
  env.advance(1);
  await env.page.agree();
  assert.equal(env.agreements().length, 0);
  env.page.onReadBottom();
  await env.page.agree();
  assert.equal(env.agreements().length, 1);
  assert.equal(env.agreements()[0].body.reachedBottom, true);
  assert.equal(env.agreements()[0].body.readingId, 'reading-1');
  assert.deepEqual(env.redirects, [target]);
  assert.equal(env.remembered.length, 1);
});

test('先到底仍需读满5秒，退后台停计时，短须知完整一屏可以视为到底', async () => {
  const env = gate({ fits: true });
  await env.load();
  assert.equal(env.page.data.reachedBottom, true);
  env.advance(2000); env.page.onHide(); env.advance(60000);
  assert.equal(env.page.data.remaining, 3);
  await env.page.agree();
  assert.equal(env.agreements().length, 0);
  env.page.onShow(); env.advance(2999);
  assert.equal(env.page.data.remaining, 1);
  env.advance(1); await env.page.agree();
  assert.equal(env.redirects.length, 1);
});

test('同意请求失败继续拦截，可以重试，提交期间连点只发一次', async () => {
  let resolve, attempts = 0;
  const env = gate({ accept: () => ++attempts === 1 ? Promise.reject(new Error('网络异常，请重试'))
    : new Promise(done => { resolve = done; }) });
  await env.load(); env.advance(5000); env.page.onReadBottom();
  await env.page.agree();
  assert.equal(env.redirects.length, 0);
  assert.match(env.page.data.error, /网络异常/);
  const saving = env.page.agree(); await env.page.agree();
  assert.equal(env.agreements().length, 2);
  resolve({ agreed: true, version: 'v1' }); await saving;
  assert.equal(env.redirects.length, 1);
});

test('阅读期间换版重新取文案，重置倒计时、滚动和到底状态', async () => {
  const env = gate({ accept: async () => { throw { code: 'NOTICE_UPDATED', message: '购买须知已更新' }; },
    read: index => ({ readingId: 'r' + index, version: 'v' + index, purchaseNotice: '第' + index + '版规则' }) });
  await env.load(); env.advance(5000); env.page.onReadBottom(); await env.page.agree();
  assert.equal(env.page.data.content, '第2版规则');
  assert.equal(env.page.data.remaining, 5);
  assert.equal(env.page.data.reachedBottom, false);
  assert.equal(env.page.data.scrollTop, 0);
  assert.equal(env.redirects.length, 0);
  env.page.onUnload();
});

test('须知读取失败留在弹窗，唯一按钮重试读取，已有同意记录直接进入', async () => {
  let failing = true;
  const env = gate({ get: async () => { if (failing) throw new Error('须知读取失败'); return { agreed: false }; } });
  await env.load();
  assert.equal(env.page.data.ready, false); assert.equal(env.redirects.length, 0);
  failing = false; await env.page.agree(); assert.equal(env.page.data.ready, true);
  const accepted = gate({ agreed: true }); await accepted.load();
  assert.deepEqual(accepted.redirects, ['/pages/index/index']);
  assert.equal(accepted.calls.length, 0);
  env.page.onUnload();
});

test('启动状态按用户缓存，前后台切换重查版本；网络失败及未同意都拦截深链', async () => {
  let user = 'a', agreed = true, failed = false, requests = 0;
  const redirects = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/purchaseConsent.js'), 'utf8'), {
    module, console: { warn() {} }, wx: { reLaunch: options => redirects.push(options.url) },
    require: name => name === './auth' ? { getUserInfo: () => ({ userId: user }) } : {
      get: async () => { requests++; if (failed) throw new Error('网络异常'); return { agreed }; }
    }
  });
  const consent = module.exports;
  const page = { route: 'pages/detail/detail' };
  assert.equal(await consent.ensure(page, { id: '1' }), true);
  assert.equal(await consent.ensure(page, { id: '1' }), true);
  assert.equal(requests, 1);
  user = 'b'; agreed = false;
  assert.equal(await consent.ensure(page, { id: '90071992547409931' }), false);
  assert.match(decodeURIComponent(redirects[0]), /returnTo=\/pages\/detail\/detail\?id=90071992547409931$/);
  consent.entered(); failed = true; consent.invalidate();
  assert.equal(await consent.ensure(page, {}), false);
  assert.equal(redirects.length, 2);
});
