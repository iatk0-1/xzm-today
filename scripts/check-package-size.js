const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_LIMIT = 2 * 1024 * 1024;
const MAIN_BUDGET = 1.5 * 1024 * 1024;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isInside(file, directory) {
  return file === directory || file.startsWith(`${directory}/`);
}

function matchesRule(file, rule) {
  const value = rule.value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  switch (rule.type) {
    case 'file': return file === value;
    case 'folder': return isInside(file, value);
    case 'suffix': return file.endsWith(value);
    case 'prefix': return file.startsWith(value);
    default: throw new Error(`体积检查暂不支持打包规则类型：${rule.type}`);
  }
}

function inspectPackages(projectRoot = PROJECT_ROOT) {
  const project = readJson(path.join(projectRoot, 'project.config.json'));
  const sourceRoot = path.resolve(projectRoot, project.miniprogramRoot);
  const app = readJson(path.join(sourceRoot, 'app.json'));
  const packages = [{ name: '主包', root: '', pages: app.pages, bytes: 0, files: [] }]
    .concat((app.subPackages || app.subpackages || []).map(pkg => ({ ...pkg, bytes: 0, files: [] })));
  const options = project.packOptions || {};
  const errors = [];
  const routes = new Set();
  const names = new Set();

  for (const pkg of packages) {
    if (pkg.root) {
      if (names.has(pkg.name)) errors.push(`分包名称重复：${pkg.name}`);
      names.add(pkg.name);
      for (const other of packages.filter(item => item.root && item !== pkg)) {
        if (isInside(pkg.root, other.root)) errors.push(`分包根目录重叠：${pkg.root} / ${other.root}`);
      }
    }
    for (const page of pkg.pages) {
      const route = pkg.root ? `${pkg.root}/${page}` : page;
      if (routes.has(route)) errors.push(`页面重复注册：${route}`);
      routes.add(route);
      if (!pkg.root && packages.some(item => item.root && isInside(route, item.root))) {
        errors.push(`主包页面位于分包目录内：${route}`);
      }
      for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
        if (!fs.existsSync(path.join(sourceRoot, route + extension))) errors.push(`页面文件缺失：${route}${extension}`);
      }
    }
  }
  for (const tab of (app.tabBar && app.tabBar.list) || []) {
    if (!app.pages.includes(tab.pagePath)) errors.push(`tabBar 页面必须放在主包：${tab.pagePath}`);
  }

  function visit(directory) {
    for (const entry of fs.readdirSync(path.join(sourceRoot, directory), { withFileTypes: true })) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      const included = (options.include || []).some(rule => matchesRule(relative, rule));
      const ignored = (options.ignore || []).some(rule => matchesRule(relative, rule));
      // 即使文件夹被排除，也允许 include 显式恢复其中的文件。
      if (entry.isDirectory()) {
        const containsInclude = (options.include || []).some(rule => isInside(rule.value, relative));
        if (!ignored || included || containsInclude) visit(relative);
      } else if (entry.isFile() && (!ignored || included)) {
        const pkg = packages.find(item => item.root && isInside(relative, item.root)) || packages[0];
        const bytes = fs.statSync(path.join(sourceRoot, relative)).size;
        pkg.bytes += bytes;
        pkg.files.push({ path: relative, bytes });
      }
    }
  }
  visit('');

  const packedFiles = new Set(packages.flatMap(pkg => pkg.files.map(file => file.path)));
  for (const route of routes) {
    for (const extension of ['.js', '.json', '.wxml', '.wxss']) {
      if (!packedFiles.has(route + extension)) errors.push(`页面文件被打包规则排除：${route}${extension}`);
    }
  }
  for (const pkg of packages) {
    if (pkg.bytes > PACKAGE_LIMIT) errors.push(`${pkg.name} 源码体积超过 2 MiB：${pkg.bytes} 字节`);
  }
  return { sourceRoot, packages, routes, errors };
}

function main() {
  const result = inspectPackages();
  console.log('按分包目录与 packOptions 统计源码体积；微信编译产物大小以开发者工具为准。');
  for (const pkg of result.packages) {
    console.log(`${pkg.name.padEnd(26)} ${(pkg.bytes / 1024).toFixed(1).padStart(8)} KiB  ${pkg.pages.length} 个页面`);
  }
  const mainPackage = result.packages[0];
  console.log(`主包距 2 MiB 源码上限还余 ${((PACKAGE_LIMIT - mainPackage.bytes) / 1024).toFixed(1)} KiB。`);
  if (mainPackage.bytes > MAIN_BUDGET) console.warn('主包源码超过 1.5 MiB 建议预算，请继续拆分或缩减公共资源。');
  console.log('主包最大的 8 个文件：');
  for (const file of [...mainPackage.files].sort((a, b) => b.bytes - a.bytes).slice(0, 8)) {
    console.log(`  ${(file.bytes / 1024).toFixed(1).padStart(7)} KiB  ${file.path}`);
  }
  for (const error of result.errors) console.error(error);
  if (result.errors.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { inspectPackages, isInside, PACKAGE_LIMIT, MAIN_BUDGET };
