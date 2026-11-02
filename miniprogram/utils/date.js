// 无时区的日期时间按设备本地时间解析，避免 iOS 解析带空格的日期字符串。
// 数字仍按毫秒处理；需要支持秒级时间戳的调用方先转换成毫秒。
function parseDate(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  if (Array.isArray(value)) {
    return new Date(value[0], (value[1] || 1) - 1, value[2] || 1,
      value[3] || 0, value[4] || 0, value[5] || 0);
  }
  if (typeof value !== 'string') return new Date(NaN);

  const text = value.trim();
  // 标准日期不带时间时沿用 ISO 的 UTC 语义。
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(text);

  const local = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/);
  if (local) {
    const milliseconds = Number(((local[7] || '') + '000').slice(0, 3));
    return new Date(Number(local[1]), Number(local[2]) - 1, Number(local[3]),
      Number(local[4] || 0), Number(local[5] || 0), Number(local[6] || 0), milliseconds);
  }

  // 只将明确带时区的字符串交给原生解析，保留 Z 和时区偏移，避免时间偏移。
  const zoned = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/);
  if (zoned) {
    const fraction = zoned[4] ? '.' + (zoned[4] + '000').slice(0, 3) : '';
    return new Date(zoned[1] + 'T' + zoned[2] + ':' + (zoned[3] || '00') + fraction + zoned[5]);
  }
  return new Date(NaN);
}

function dateTimestamp(value) {
  return parseDate(value).getTime();
}

module.exports = { parseDate, dateTimestamp };
