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
var IMAGE_FIELDS = ['url', 'image', 'imageUrl', 'coverUrl', 'videoUrl', 'videoThumbPath'];
var IMAGE_LIST_FIELDS = ['lookbookImgs', 'detailImgs', 'bannerImages', 'mediaList'];

// 判断是否为有效的远程 URL（CDN 地址，无需上传）
function isRemoteUrl(url) {
  if (!url) return false;
  if (url.startsWith('http://tmp/')) return false;
  if (url.startsWith('https://tmp/')) return false;
  if (url.startsWith('http://127.0.0.1')) return false;
  if (url.startsWith('http://localhost')) return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  return true;
}

// 递归遍历草稿数据，上传所有临时图片到 CDN，返回替换后的副本
// uploadFn: (filePath, contentType) => Promise<url>
async function _uploadAllImages(obj, uploadFn, field, cache) {
  cache = cache || new Map();
  async function upload(path, type) {
    if (!cache.has(path)) cache.set(path, Promise.resolve(uploadFn(path, type)).then(url => {
      if (!isRemoteUrl(url)) throw new Error('草稿媒体上传失败，请重试');
      return url;
    }).catch(error => { cache.delete(path); throw error; }));
    return cache.get(path);
  }
  if (typeof obj === 'string' && IMAGE_LIST_FIELDS.indexOf(field) >= 0) {
    return obj && !isRemoteUrl(obj) ? upload(obj, 'image/jpeg') : obj;
  }
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    var result = [];
    for (var i = 0; i < obj.length; i++) {
      result.push(await _uploadAllImages(obj[i], uploadFn, field, cache));
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
        copy[key] = await upload(val, key === 'videoUrl' ? 'video/mp4' : 'image/jpeg');
      } else {
        copy[key] = val;
      }
    }
    // 对象或数组：递归处理
    else if (val && typeof val === 'object') {
      copy[key] = await _uploadAllImages(val, uploadFn, key, cache);
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
  var processed = await _uploadAllImages(draftData, uploadFn, '', opts.mediaCache);
  var body = {
    clientDraftKey: opts.clientDraftKey, requestKey: opts.requestKey,
    draftType: opts.draftType, relatedId: opts.relatedId || null, sessionId: opts.sessionId || null,
    version: opts.version, schemaVersion: 1, contextToken: opts.contextToken, draftData: processed
  };
  return opts.id ? api.put('/drafts/v2/' + encodeURIComponent(opts.id), body) : api.post('/drafts/v2', body);
}

// 加载草稿：GET /drafts，返回 { id, draftType, relatedId, draftData, savedAt }
// 无草稿时返回 null
async function loadDraftRemote(id) {
  if (!id) throw new Error('请指定要打开的草稿');
  return api.get('/drafts/v2/' + encodeURIComponent(id));
}

// 删除草稿
async function removeDraftRemote(id, version) {
  if (!id || version == null) throw new Error('草稿编号或版本缺失，请刷新后重试');
  return api.delete('/drafts/v2/' + encodeURIComponent(id) + '?version=' + encodeURIComponent(version));
}

// 检查是否有草稿
async function hasDraftRemote() {
  var value = await api.get('/drafts/v2/summary');
  return value.total > 0;
}

function query(data) {
  return Object.keys(data || {}).filter(key => data[key] !== '' && data[key] != null)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key])).join('&');
}

function createKey() { return 'draft_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14); }

function editorOptions(record) {
  if (!record || !['create', 'edit', 'convert', 'live_create', 'live_edit'].includes(record.draftType)) throw new Error('草稿类型无效');
  const options = { draftId: String(record.id) };
  if (record.draftType === 'edit') options.editId = String(record.relatedId);
  if (record.draftType === 'convert') options.convertFromLiveProductId = String(record.relatedId);
  if (record.sessionId) options.sessionId = String(record.sessionId);
  if (record.draftType === 'live_edit') options.productId = String(record.relatedId);
  return options;
}

function editorUrl(record) {
  const page = record.draftType.indexOf('live_') === 0 ? '/pages/liveRoomPublish/publish' : '/pages/admin/admin';
  return page + '?draftId=' + encodeURIComponent(String(record.id));
}

function formatTime(value) {
  if (!value) return '';
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return '';
  const china = new Date(time.getTime() + 8 * 60 * 60 * 1000);
  return china.getUTCFullYear() + '-' + String(china.getUTCMonth() + 1).padStart(2, '0') + '-'
    + String(china.getUTCDate()).padStart(2, '0') + ' ' + String(china.getUTCHours()).padStart(2, '0')
    + ':' + String(china.getUTCMinutes()).padStart(2, '0');
}

module.exports = {
  saveDraft: saveDraftRemote,
  loadDraft: loadDraftRemote,
  removeDraft: removeDraftRemote,
  hasDraft: hasDraftRemote,
  isRemoteUrl: isRemoteUrl,
  list: data => api.get('/drafts/v2?' + query(data)),
  summary: data => api.get('/drafts/v2/summary?' + query(data)),
  context: data => api.get('/drafts/v2/context?' + query(data)),
  batchDelete: items => api.post('/drafts/v2/batch-delete', { items }),
  submit: data => api.post('/product-submissions/v2', data),
  createKey, editorOptions, editorUrl, formatTime,
  uploadMedia: _uploadAllImages
};
