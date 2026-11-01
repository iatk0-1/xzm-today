const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inspectPackages, isInside, MAIN_BUDGET } = require('../../../scripts/check-package-size');

const layout = inspectPackages();
const owner = file => layout.packages.find(pkg => pkg.root && isInside(file, pkg.root)) || layout.packages[0];
const packedFiles = new Set(layout.packages.flatMap(pkg => pkg.files.map(file => file.path)));

test('分包页面完整、无重复或嵌套，主包源码保持在 1.5 MiB 预算内', () => {
  assert.deepEqual(layout.errors, []);
  assert.ok(layout.packages[0].bytes <= MAIN_BUDGET, '主包公共资源或页面增长过多，请调整分包');
  for (const route of ['pages/index/index', 'pages/detail/detail', 'pages/cart/cart', 'pages/checkout/checkout', 'pages/orderList/orderList', 'pages/orderDetail/orderDetail', 'pages/user/user']) {
    assert.ok(layout.routes.has(route), `核心页面必须保留：${route}`);
    assert.equal(owner(route).root, '', `核心交易页面应留在主包：${route}`);
  }
  for (const route of ['pages/adminProduct/adminProduct', 'pages/adminOrderDetail/adminOrderDetail', 'pages/purchaseOrders/purchaseOrders', 'pages/skuInventory/skuInventory', 'pages/logistics/printers/printers', 'pages/logistics/expressBatchManage/expressBatchManage']) {
    assert.ok(layout.routes.has(route), `管理页面原有地址必须保留：${route}`);
    assert.notEqual(owner(route).root, '', `管理页面应移出主包：${route}`);
  }
});

test('测试、npm 源码、源码映射和依赖清单不进入代码包，构建后的 npm 仍保留', () => {
  for (const file of packedFiles) {
    assert.ok(!file.startsWith('tests/') && !file.startsWith('node_modules/') && !file.endsWith('.map'), `开发文件不应打包：${file}`);
  }
  assert.ok(!packedFiles.has('package.json'));
  assert.ok(!packedFiles.has('package-lock.json'));
  assert.ok(packedFiles.has('miniprogram_npm/cos-wx-sdk-v5/index.js'), 'COS 上传依赖必须保留');
});

test('页面、组件、模板和样式只引用主包或本分包内的文件', () => {
  const errors = [];
  function checkReference(source, reference, extensions) {
    if (/^(?:plugin:|https?:|data:|wx:)/.test(reference) || reference.includes('{{')) return;
    const base = reference.startsWith('/') ? reference.slice(1) : path.posix.join(path.posix.dirname(source), reference);
    const target = [base, ...extensions.map(ext => base + ext)].find(candidate => packedFiles.has(candidate));
    if (!target) { errors.push(`${source} 引用未打包的文件：${reference}`); return; }
    const sourcePackage = owner(source);
    const targetPackage = owner(target);
    if (targetPackage.root && sourcePackage !== targetPackage) errors.push(`${source} 跨包引用：${target}`);
  }
  for (const file of packedFiles) {
    // 构建后的第三方库内部使用自己的模块加载器，无需检查其 require 编号。
    if (file.startsWith('miniprogram_npm/')) continue;
    if (!/\.(?:js|json|wxml|wxss)$/.test(file)) continue;
    const content = fs.readFileSync(path.join(layout.sourceRoot, file), 'utf8');
    if (file.endsWith('.js')) {
      for (const match of content.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const reference = match[1];
        if (reference.startsWith('.') || reference.startsWith('/')) checkReference(file, reference, ['.js', '.json', '/index.js']);
        else checkReference(file, `/miniprogram_npm/${reference}/index.js`, []);
      }
    } else if (file.endsWith('.json')) {
      for (const reference of Object.values(JSON.parse(content).usingComponents || {})) checkReference(file, reference, ['.json']);
    } else if (file.endsWith('.wxml')) {
      for (const match of content.matchAll(/<(?:import|include|wxs)\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/g)) checkReference(file, match[1], []);
    } else if (file.endsWith('.wxss')) {
      for (const match of content.matchAll(/@import\s+['"]([^'"]+)['"]/g)) checkReference(file, match[1], []);
    }
  }
  assert.deepEqual(errors, []);
});
