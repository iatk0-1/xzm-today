const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CLI_PATHS = [
  'D:\\Program Files (x86)\\Tencent\\微信web开发者工具\\wechatide.cmd',
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\wechatide.cmd',
  path.join(process.env.LOCALAPPDATA || '', '微信开发者工具', 'wechatide.cmd')
];

const projectPath = path.resolve(__dirname, '../../..');
const clientName = process.env.WECHAT_DEVTOOLS_CLIENT || 'CodexE2E';
const cliToken = process.env.WECHAT_DEVTOOLS_CLI_TOKEN || '';
const commandTimeout = Number(process.env.WECHAT_DEVTOOLS_COMMAND_TIMEOUT || 30000);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function resolveCliPath() {
  const configuredPath = process.env.WECHAT_DEVTOOLS_CLI;
  if (configuredPath) return configuredPath;
  return DEFAULT_CLI_PATHS.find((candidate) => fs.existsSync(candidate)) || DEFAULT_CLI_PATHS[0];
}

function spawnCli(cliPath, args) {
  if (process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(cliPath)) {
    // cmd.exe is required because Node cannot execute a .bat/.cmd file directly.
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'call', cliPath, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }

  return spawn(cliPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function toFlagName(name) {
  return String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function buildToolArgs(toolName, input) {
  const args = ['-c', clientName, toolName];
  const tempFiles = [];
  for (const [name, value] of Object.entries(input || {})) {
    if (value === undefined || value === null || value === '') continue;
    const flagName = toFlagName(name);
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      // New wechatide reserves --args for its own parser. Array/object tool
      // inputs must be sent through the generated --<field>-file form.
      const filePath = path.join(
        os.tmpdir(),
        `xzm-wechatide-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
      );
      fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
      tempFiles.push(filePath);
      args.push(`--${flagName}-file`, filePath);
      continue;
    }
    args.push(`--${flagName}`);
    if (typeof value !== 'boolean') args.push(String(value));
  }
  if (cliToken) args.push('--token', cliToken);
  return { args, tempFiles };
}

function parseJsonOutput(stdout) {
  const firstJsonObject = stdout.indexOf('{');
  const lastJsonObject = stdout.lastIndexOf('}');
  if (firstJsonObject >= 0 && lastJsonObject > firstJsonObject) {
    try {
      return JSON.parse(stdout.slice(firstJsonObject, lastJsonObject + 1));
    } catch (error) {
      // Keep trying line-based output below for compact JSON responses.
    }
  }

  const candidates = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(candidates[index]);
    } catch (error) {
      // The CLI may print progress lines before its JSON result.
    }
  }

  if (firstJsonObject >= 0) {
    try {
      return JSON.parse(stdout.slice(firstJsonObject));
    } catch (error) {
      // Fall through to a useful command-output error.
    }
  }
  throw new Error(`微信开发者工具自动化命令没有返回 JSON：${stdout.trim()}`);
}

function extractResult(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.ok === false) {
    throw new Error(payload.error || payload.message || JSON.stringify(payload));
  }
  if (payload.result !== undefined) return payload.result;
  if (payload.data !== undefined) return payload.data;
  return payload;
}

function runCliCommand(args, tempFiles = []) {
  const cliPath = resolveCliPath();
  const cleanup = () => {
    for (const filePath of tempFiles) {
      try { fs.unlinkSync(filePath); } catch (error) {}
    }
  };
  return new Promise((resolve, reject) => {
    const child = spawnCli(cliPath, args);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      cleanup();
      reject(new Error(`微信开发者工具自动化命令超时（${commandTimeout}ms）：${args.join(' ')}`));
    }, commandTimeout);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (code !== 0) {
        reject(new Error(
          `微信开发者工具自动化命令失败（退出码 ${code}）：${stdout || ''}${stderr || ''}`
        ));
        return;
      }
      try {
        resolve(parseJsonOutput(stdout));
      } catch (error) {
        reject(new Error(`${error.message}\n${stderr}`));
      }
    });
  });
}

async function runTool(toolName, input) {
  const command = buildToolArgs(toolName, input);
  const payload = await runCliCommand(command.args, command.tempFiles);
  if (payload && payload.result && payload.result.status === 'pending') {
    throw new Error(
      `微信开发者工具正在等待客户端授权（client=${clientName}）。`
        + '请先在开发者工具的授权弹窗中允许自动化，或设置 WECHAT_DEVTOOLS_CLI_TOKEN。'
    );
  }
  return extractResult(payload);
}

function unwrap(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.result !== undefined) return unwrap(value.result);
  if (value.data !== undefined) return unwrap(value.data);
  return value;
}

function getCurrentPagePath(value) {
  const result = unwrap(value) || {};
  const page = result.currentPage || result.page || result;
  return page.path || page.route || page.pagePath || page.url || '';
}

function normalizeElements(value) {
  const result = unwrap(value);
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  for (const key of ['elements', 'nodes', 'items', 'list']) {
    if (Array.isArray(result[key])) return result[key];
  }
  if (typeof result.count === 'number') return Array.from({ length: result.count });
  return result.found === false ? [] : [result];
}

function indexedSelectors(selector, index) {
  if (index === 0) return [selector];
  const selectors = [];
  const tokens = selector.trim().split(/\s+/);
  const firstToken = tokens.shift();
  const remainder = tokens.join(' ');
  const add = (token) => selectors.push(remainder ? `${token} ${remainder}` : token);

  // nth-child is wrong when a WXML loop shares a parent with helper views;
  // nth-of-type matches the selector's rendered element type instead.
  add(`${firstToken}:nth-of-type(${index + 1})`);
  add(`${firstToken}:nth-child(${index + 1})`);

  // The index page has two waterfall columns. A flat querySelectorAll spans
  // both columns, so provide the only stable selectors for that layout.
  if (selector.includes('.product-item') && !remainder) {
    const columnIndex = index < 2 ? 1 : 2;
    const itemIndex = index < 2 ? index + 1 : index - 1;
    selectors.unshift(
      `.waterfall-column:nth-of-type(${columnIndex}) .product-item:nth-of-type(${itemIndex})`,
      `.waterfall-column:nth-child(${columnIndex}) .product-item:nth-of-type(${itemIndex})`
    );
  }
  return [...new Set(selectors)];
}

class ElementAdapter {
  constructor(page, selector, fallbackSelector = null, selectorCandidates = []) {
    this.page = page;
    this.selector = selector;
    this.fallbackSelector = fallbackSelector;
    this.selectorCandidates = [...new Set([selector, ...selectorCandidates].filter(Boolean))];
  }

  async run(action, input = {}) {
    let lastError;
    for (const selector of this.selectorCandidates) {
      try {
        return await runTool('automation_element_action', {
          project: projectPath,
          selector,
          action,
          ...input
        });
      } catch (error) {
        lastError = error;
        if (!/no such element|not found/i.test(error.message)) throw error;
      }
    }
    throw lastError;
  }

  tap() { return this.run('tap'); }

  input(value) { return this.run('input', { value }); }

  text() { return this.run('text'); }

  value() { return this.run('value'); }

  attribute(name) { return this.run('attribute', { name }); }

  property(name) { return this.run('property', { name }); }

  $(selector) {
    return new ElementAdapter(this.page, `${this.selector} ${selector}`);
  }

  $$(selector) {
    return this.page.queryAll(`${this.selector} ${selector}`);
  }
}

class PageAdapter {
  constructor(pathname = '') {
    this.path = pathname.replace(/^\//, '').split('?')[0];
  }

  async refreshPath() {
    const current = await runTool('automation_runtime_info', {
      project: projectPath,
      action: 'currentPage'
    });
    this.path = getCurrentPagePath(current).replace(/^\//, '').split('?')[0];
    return this;
  }

  waitFor(milliseconds) { return delay(milliseconds); }

  data() {
    return runTool('automation_page_action', {
      project: projectPath,
      action: 'getData'
    }).then(unwrap);
  }

  async queryAll(selector) {
    const raw = await runTool('automation_page_action', {
      project: projectPath,
      action: 'querySelectorAll',
      selector
    });
    return normalizeElements(raw).map((match, index) => {
      const selectors = indexedSelectors(selector, index);
      return new ElementAdapter(
        this,
        selectors[0],
        match && match.selector ? match.selector : null,
        selectors.slice(1)
      );
    });
  }

  $$(selector) {
    return this.queryAll(selector);
  }

  async $(selector) {
    let raw;
    try {
      raw = await runTool('automation_page_action', {
        project: projectPath,
        action: 'querySelector',
        selector
      });
    } catch (error) {
      if (/no such element|not found/i.test(error.message)) return null;
      throw error;
    }
    const matches = normalizeElements(raw);
    if (matches.length === 0) return null;
    const match = matches[0];
    return new ElementAdapter(this, selector, match && match.selector ? match.selector : null);
  }
}

class MiniProgramAdapter {
  async reLaunch(url) {
    await runTool('automation_navigate', {
      project: projectPath,
      action: 'reLaunch',
      url
    });
    return new PageAdapter(url).refreshPath();
  }

  async navigateTo(url) {
    await runTool('automation_navigate', {
      project: projectPath,
      action: 'navigateTo',
      url
    });
    return new PageAdapter(url).refreshPath();
  }

  async redirectTo(url) {
    await runTool('automation_navigate', {
      project: projectPath,
      action: 'redirectTo',
      url
    });
    return new PageAdapter(url).refreshPath();
  }

  async navigateBack(delta = 1) {
    await runTool('automation_navigate', {
      project: projectPath,
      action: 'navigateBack',
      delta
    });
    return new PageAdapter().refreshPath();
  }

  async switchTab(url) {
    await runTool('automation_navigate', {
      project: projectPath,
      action: 'switchTab',
      url
    });
    return new PageAdapter(url).refreshPath();
  }

  async currentPage() {
    const current = await runTool('automation_runtime_info', {
      project: projectPath,
      action: 'currentPage'
    });
    return new PageAdapter(getCurrentPagePath(current));
  }

  callWxMethod(method, ...args) {
    return runTool('automation_wx_api', {
      project: projectPath,
      action: 'call',
      method,
      args
    }).then(unwrap);
  }

  mockWxMethod(method, functionDeclaration) {
    return runTool('automation_wx_api', {
      project: projectPath,
      action: 'mock',
      method,
      functionDeclaration: typeof functionDeclaration === 'function'
        ? functionDeclaration.toString()
        : functionDeclaration
    });
  }

  restoreWxMethod(method) {
    return runTool('automation_wx_api', {
      project: projectPath,
      action: 'restore',
      method
    });
  }

  disconnect() {}
}

async function connectDeveloperTools() {
  // The new CLI starts or reuses the IDE HTTP service; it does not expose the
  // old miniprogram-automator WebSocket endpoint.
  process.stdout.write(`[e2e] using WeChat Developer Tools CLI client ${clientName}\n`);
  await runTool('automation_runtime_info', {
    project: projectPath,
    action: 'systemInfo'
  });
  return { miniProgram: new MiniProgramAdapter(), cli: null };
}

function disconnectDeveloperTools(miniProgram) {
  if (miniProgram) miniProgram.disconnect();
}

module.exports = {
  connectDeveloperTools,
  disconnectDeveloperTools,
  projectPath,
  runTool,
  MiniProgramAdapter,
  PageAdapter,
  ElementAdapter
};

