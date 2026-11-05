// 按完整字符计数，保留插入点后的原文；光标位置仍使用原生事件的 UTF-16 偏移。
function limitTextInput(value, previous = '', cursor, maxLength = 500) {
  const raw = String(value == null ? '' : value);
  const characters = Array.from(raw);
  const position = Number.isInteger(cursor) && cursor >= 0 ? Math.min(cursor, raw.length) : raw.length;
  if (characters.length <= maxLength) {
    return { value: raw, length: characters.length, cursor: position, truncated: false };
  }

  const before = Array.from(String(previous || '')).slice(0, maxLength);
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < characters.length && before[prefix] === characters[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < characters.length - prefix
      && before[before.length - 1 - suffix] === characters[characters.length - 1 - suffix]) suffix++;
  const head = characters.slice(0, prefix).join('');
  const inserted = characters.slice(prefix, characters.length - suffix).join('');
  const accepted = characters.slice(prefix, prefix + Math.max(0, maxLength - prefix - suffix)).join('');
  const tail = characters.slice(characters.length - suffix).join('');
  const text = head + accepted + tail;
  const nextCursor = position <= head.length ? position
    : position <= head.length + inserted.length ? head.length + Math.min(position - head.length, accepted.length)
      : position - (inserted.length - accepted.length);
  return { value: text, length: Array.from(text).length,
    cursor: Math.min(nextCursor, text.length), truncated: true };
}

module.exports = { limitTextInput };
