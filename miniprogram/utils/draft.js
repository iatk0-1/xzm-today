// miniprogram/utils/draft.js
// 草稿存储工具 — 后端数据库存储（图片先上传 CDN，JSON 存入 PostgreSQL）
//
// 向下兼容设计：
//   - 恢复草稿时，草稿中没有的字段使用默认空值，不会报错
//   - 草稿中多余的字段（旧版本遗留）会被静默忽略
//
// 图片上传逻辑：
//   - isRemoteUrl() 判断是否已是 CDN URL（https:// 开头且非 temp）
//   - 所有非远程 URL 的图片路径都会在上传草稿前递归上传到 CDN

var api = require('./api');

// 已知的图片字段名（值为路径/URL 的字符串，需要上传判断）
var IMAGE_FIELDS = ['url', 'image', 'imageUrl', 'coverUrl', 'videoUrl'];

// 判断是否为有效的远程 URL（CDN 地址，无需上传）
function isRemoteUrl(url) {
  if (!url) return false;
  if (url.startsWith('http://tmp/')) return false;
  if (url.startsWith('http://127.0.0.1')) return false;
  if (url.startsWith('http://localhost')) return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  return true;
}

// 递归遍历草稿数据，上传所有临时图片到 CDN，返回替换后的副本
// uploadFn: (filePath, contentType) => Promise<url>
async function _uploadAllImages(obj, uploadFn) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    var result = [];
    for (var i = 0; i < obj.length; i++) {
      result.push(await _uploadAllImages(obj[i], uploadFn));
    }
    return result;
  }

  var copy = {};
  for (var key in obj) {
    if (!obj.hasOwnProperty || !obj.hasOwnProperty(key)) continue;
    var val = obj[key];

    // 字符串：如果字段名是图片字段且值是需要上传的临时路径
    if (typeof val === 'string' && IMAGE_FIELDS.indexOf(key) >= 0) {
      if (val && !isRemoteUrl(val)) {
        try {
          copy[key] = await uploadFn(val, 'image/jpeg');
        } catch (e) {
          console.warn('[draft] 图片上传失败，置空:', val, e);
          copy[key] = '';
        }
      } else {
        copy[key] = val;
      }
    }
    // 对象或数组：递归处理
    else if (val && typeof val === 'object') {
      copy[key] = await _uploadAllImages(val, uploadFn);
    }
    // 其他类型：直接复制
    else {
      copy[key] = val;
    }
  }
  return copy;
}

// 保存草稿：先上传所有临时图片到 CDN，再将完整的 JSON 存入后端
// uploadFn: (filePath, contentType) => Promise<url>  — admin.js 的 uploadFile 方法
// opts: { draftType: 'create'|'edit'|'convert', relatedId: number|null }
async function saveDraftRemote(draftData, uploadFn, opts) {
  // 1. 递归遍历，上传所有临时图片
  var processed = await _uploadAllImages(draftData, uploadFn);
  // 2. POST 到后端
  return api.post('/drafts', {
    draftType: (opts && opts.draftType) || 'create',
    relatedId: (opts && opts.relatedId) || null,
    draftData: processed
  });
}

// 加载草稿：GET /drafts，返回 { id, draftType, relatedId, draftData, savedAt }
// 无草稿时返回 null
async function loadDraftRemote() {
  try {
    return await api.get('/drafts');
  } catch (e) {
    return null;
  }
}

// 删除草稿
async function removeDraftRemote() {
  try {
    await api.delete('/drafts');
  } catch (e) {
    // 服务端返回 404 也无所谓
  }
}

// 检查是否有草稿
async function hasDraftRemote() {
  try {
    await api.get('/drafts');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  saveDraft: saveDraftRemote,
  loadDraft: loadDraftRemote,
  removeDraft: removeDraftRemote,
  hasDraft: hasDraftRemote,
  isRemoteUrl: isRemoteUrl
};
