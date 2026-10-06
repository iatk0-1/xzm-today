// 错误对象供程序判断，页面只展示可读文案；此工具不依赖 wx 或认证模块。
const DEFAULT_MESSAGE = '操作失败，请稍后重试';

function parse(value) {
  for (let i = 0; i < 3 && typeof value === 'string'; i++) {
    const text = value.trim();
    if (!/^[{[\"]/.test(text)) break;
    try { value = JSON.parse(text); } catch (_) { break; }
  }
  return value;
}

function readable(value, allowEnglish = false) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || (!allowEnglish && !/[\u3400-\u9fff]/.test(text))) return '';
  if (/^(?:null|undefined|nan|\[object Object\])$/i.test(text) || /^[A-Z][A-Z0-9_]*$/.test(text)) return '';
  if (/^[{[\"]|<\/?[a-z!]|\[object Object\]|\b(?:TypeError:|ReferenceError:|SyntaxError:|[a-z.]+Exception:|errcode=|errmsg=|rawBody=|java\.|SQL(?:State|Syntax)|SELECT .+ FROM |INSERT INTO |UPDATE .+ SET |DELETE FROM |Bearer |access_token=|secret=|http=|uri=)|\bat\s+\S+\s*\(/i.test(text)) return '';
  return text;
}

function extract(value, depth, seen, structured = false) {
  if (depth > 4 || value == null) return '';
  const parsed = parse(value);
  if (typeof parsed === 'string') return readable(parsed, structured);
  if (typeof parsed !== 'object' || Array.isArray(parsed) || seen.has(parsed)) return '';
  seen.add(parsed);
  if (typeof parsed.message === 'string') {
    const message = extract(parsed.message, depth + 1, seen, !(parsed instanceof Error));
    if (message) return message;
  }
  return extract(parsed.data, depth + 1, seen, true);
}

function getErrorMessage(error, fallbackMessage) {
  if (error instanceof Error && error.name !== 'Error') return readable(fallbackMessage) || DEFAULT_MESSAGE;
  const message = extract(error, 0, new Set());
  if (message) return message;
  const raw = error && typeof error.errMsg === 'string' ? error.errMsg : '';
  if (/timeout|timed out/i.test(raw)) return '请求超时，请稍后重试';
  if (/request:fail|network|connection/i.test(raw)) return '网络连接异常，请检查网络后重试';
  return readable(fallbackMessage) || DEFAULT_MESSAGE;
}

function getBusinessFailureMessage(value, fallbackMessage) {
  return extract(value, 0, new Set()) || readable(fallbackMessage) || DEFAULT_MESSAGE;
}

function normalizeApiError(input, options = {}) {
  const parsed = parse(input);
  const original = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const result = { ...original };
  if (options.statusCode != null) result.statusCode = options.statusCode;
  if (options.source) result.source = options.source;
  result.message = getErrorMessage(input, options.fallbackMessage);
  // 原始诊断仅用于内部日志，不参与序列化或页面文案。
  Object.defineProperty(result, 'cause', { value: input, enumerable: false });
  return result;
}

function isUnauthorized(error) {
  return !!error && (error.statusCode === 401 || error.code === 'UNAUTHORIZED' || error.error === 'UNAUTHORIZED');
}

module.exports = { normalizeApiError, getErrorMessage, getBusinessFailureMessage, isUnauthorized };
