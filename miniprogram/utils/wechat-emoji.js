// 微信客服回调中的经典表情和方括号表情是文本代码；仅在本地展示时替换。
// 发送仍使用微信代码，让用户的原生客服会话自行渲染表情。
const emojis = [
  { code: '/::)', glyph: '🙂', name: '微笑' },
  { code: '/::~', glyph: '😔', name: '难过' },
  { code: '/:8-)', glyph: '😎', name: '得意' },
  { code: '/::D', glyph: '😁', name: '呲牙' },
  { code: '/::P', glyph: '😛', name: '调皮' },
  { code: '/::$', glyph: '😊', name: '害羞' },
  { code: '/::<', glyph: '😢', name: '流泪' },
  { code: '/::@', glyph: '😠', name: '发怒' },
  { code: '/:,@P', glyph: '😄', name: '偷笑' },
  { code: '/:,@-D', glyph: '😆', name: '愉快' },
  { code: '/:wipe', glyph: '😅', name: '擦汗' },
  { code: '/:handclap', glyph: '👏', name: '鼓掌' },
  { code: '/:rose', glyph: '🌹', name: '玫瑰' },
  { code: '/:heart', glyph: '❤️', name: '爱心' },
  { code: '/:strong', glyph: '👍', name: '点赞' },
  { code: '[Doge]', glyph: '🐶', name: '旺柴' },
  { code: '[Sweats]', glyph: '😓', name: '汗' },
  { code: '[Facepalm]', glyph: '🤦', name: '捂脸' },
  { code: '[Hey]', glyph: '😄', name: '嘿哈' },
  { code: '[Onlooker]', glyph: '🍉', name: '吃瓜' },
  { code: '[GoForIt]', glyph: '💪', name: '加油' },
  { code: '[OMG]', glyph: '😱', name: '天啊' },
  { code: '[Emm]', glyph: '😐', name: 'Emm' },
  { code: '[Wow]', glyph: '😮', name: '哇' },
  { code: '[Broken]', glyph: '💔', name: '裂开' },
  { code: '[Hurt]', glyph: '🥺', name: '苦涩' },
  { code: '[Awesome]', glyph: '👍', name: '666' }
];

const glyphByCode = Object.fromEntries(emojis.map(item => [item.code, item.glyph]));
glyphByCode['/::8-)'] = glyphByCode['/:8-)'];
const pattern = new RegExp(Object.keys(glyphByCode)
  .sort((a, b) => b.length - a.length)
  .map(code => code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

function displayWechatEmoji(content) {
  return typeof content === 'string' ? content.replace(pattern, code => glyphByCode[code]) : content;
}

module.exports = { emojis, displayWechatEmoji };
