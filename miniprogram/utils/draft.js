// miniprogram/utils/draft.js
// 草稿存储工具 — 提供通用的草稿保存/恢复/清除/检查能力，支持媒体文件本地持久化

var STORAGE_PREFIX = 'draft_';
var fs = wx.getFileSystemManager();

function saveDraft(key, data) {
  try {
    var payload = Object.assign({}, data, { _savedAt: Date.now() });
    wx.setStorageSync(STORAGE_PREFIX + key, payload);
    return true;
  } catch (e) {
    console.error('草稿保存失败:', e);
    return false;
  }
}

function loadDraft(key) {
  try {
    return wx.getStorageSync(STORAGE_PREFIX + key) || null;
  } catch (e) {
    return null;
  }
}

function removeDraft(key) {
  try {
    wx.removeStorageSync(STORAGE_PREFIX + key);
  } catch (e) {
    // ignore
  }
}

function hasDraft(key) {
  return !!loadDraft(key);
}

// 判断是否为有效的远程 URL（非临时文件）
function isRemoteUrl(url) {
  if (!url) return false;
  if (!/^https?:\/\//.test(url)) return false;
  if (/^http:\/\/tmp/.test(url)) return false;
  return true;
}

// 判断是否为临时文件路径（需要持久化处理）
function isTempPath(url) {
  if (!url) return false;
  // 微信临时 HTTP 服务
  if (/^http:\/\/tmp\//.test(url)) return true;
  // 微信文件系统临时路径
  if (/^wxfile:\/\/tmp_/.test(url)) return true;
  // 不含协议的本地路径（wx.chooseMedia 可能返回这种格式）
  // 远程 URL 已在 isRemoteUrl 中处理，此处只命中本地路径
  if (!/^https?:\/\//.test(url) && !/^wxfile:\/\//.test(url) && url.indexOf('/') >= 0) return true;
  return false;
}

// 获取草稿持久文件目录
function getDraftDir(key) {
  return wx.env.USER_DATA_PATH + '/draft_' + key.replace(/[^a-zA-Z0-9_]/g, '_');
}

// 清理草稿对应的持久文件目录
function cleanupDraftFiles(key) {
  try {
    var dir = getDraftDir(key);
    fs.rmdirSync(dir, true);
  } catch (e) {
    // 目录不存在或无法删除，忽略
  }
}

// 将临时文件复制到持久目录，返回替换路径后的数组副本
function _persistUrl(key, url) {
  if (!url) return '';
  if (isRemoteUrl(url)) return url;

  // 已经是本地持久化路径（wxfile://usr/...），无需再次复制
  if (/^wxfile:\/\/usr\//.test(url)) {
    try {
      fs.accessSync(url);
      return url; // 文件仍存在，直接使用
    } catch (e) {
      return ''; // 文件不存在，丢弃
    }
  }

  // 临时文件，复制到持久目录
  try {
    var dir = getDraftDir(key);
    // 确保目录存在
    try { fs.mkdirSync(dir, true); } catch (e) { /* 目录已存在 */ }

    var ext = '.tmp';
    var m = url.match(/\.(\w{3,4})\b/);
    if (m) ext = '.' + m[1].toLowerCase();

    var dest = dir + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    fs.copyFileSync(url, dest);
    return dest;
  } catch (e) {
    console.error('草稿文件持久化失败:', url, e);
    return '';
  }
}

// 持久化媒体列表中的临时文件，返回替换后的新数组
function persistMediaList(key, list) {
  if (!list || !Array.isArray(list)) return list;
  return list.map(function(item) {
    // 字符串类型的媒体列表（如 lookbookImgs、detailImgs）
    if (typeof item === 'string') {
      return _persistUrl(key, item);
    }
    // 对象类型的媒体列表（如 mediaList 的 {id, url}、skuList 的 {image}）
    if (item && typeof item === 'object') {
      var copy = Object.assign({}, item);
      if (copy.url !== undefined) copy.url = _persistUrl(key, copy.url);
      if (copy.image !== undefined) copy.image = _persistUrl(key, copy.image);
      if (copy.imageUrl !== undefined) copy.imageUrl = _persistUrl(key, copy.imageUrl);
      return copy;
    }
    return item;
  }).filter(function(item) {
    // 过滤掉空字符串（持久化失败的项）
    if (typeof item === 'string') return !!item;
    return true;
  });
}

// 批量持久化多个媒体列表
// listsObj: { fieldName: array, ... }
// 返回替换后的 listsObj
function persistMediaFiles(key, listsObj) {
  var result = {};
  for (var field in listsObj) {
    result[field] = persistMediaList(key, listsObj[field]);
  }
  return result;
}

// 验证恢复时媒体列表中的路径是否有效
function validatePersistedList(list) {
  if (!list || !Array.isArray(list)) return list;
  return list.map(function(item) {
    if (typeof item === 'string') {
      if (isRemoteUrl(item)) return item;
      if (item && /^wxfile:\/\/usr\//.test(item)) {
        try { fs.accessSync(item); return item; } catch (e) { return ''; }
      }
      return ''; // 临时路径或无效路径
    }
    if (item && typeof item === 'object') {
      var copy = Object.assign({}, item);
      if (copy.url !== undefined) {
        if (isRemoteUrl(copy.url)) { /* keep */ }
        else if (copy.url && /^wxfile:\/\/usr\//.test(copy.url)) {
          try { fs.accessSync(copy.url); } catch (e) { copy.url = ''; }
        } else {
          copy.url = '';
        }
      }
      if (copy.image !== undefined) {
        if (isRemoteUrl(copy.image)) { /* keep */ }
        else if (copy.image && /^wxfile:\/\/usr\//.test(copy.image)) {
          try { fs.accessSync(copy.image); } catch (e) { copy.image = ''; }
        } else {
          copy.image = '';
        }
      }
      if (copy.imageUrl !== undefined) {
        if (isRemoteUrl(copy.imageUrl)) { /* keep */ }
        else if (copy.imageUrl && /^wxfile:\/\/usr\//.test(copy.imageUrl)) {
          try { fs.accessSync(copy.imageUrl); } catch (e) { copy.imageUrl = ''; }
        } else {
          copy.imageUrl = '';
        }
      }
      return copy;
    }
    return item;
  }).filter(function(item) {
    if (typeof item === 'string') return !!item;
    return true;
  });
}

// 验证多个列表
function validatePersistedUrls(listsObj) {
  var result = {};
  for (var field in listsObj) {
    result[field] = validatePersistedList(listsObj[field]);
  }
  return result;
}

// 过滤数组中的临时文件路径，保留远程 URL（用于向后兼容）
function filterTempFiles(list) {
  if (!list || !Array.isArray(list)) return list;
  return list.map(function(item) {
    if (typeof item === 'string') {
      return isRemoteUrl(item) ? item : '';
    }
    if (item && typeof item === 'object') {
      var filtered = {};
      for (var k in item) {
        if (k === 'url' || k === 'image' || k === 'imageUrl') {
          filtered[k] = isRemoteUrl(item[k]) ? item[k] : '';
        } else {
          filtered[k] = item[k];
        }
      }
      return filtered;
    }
    return item;
  });
}

// 检查数组中是否还有远程 URL
function hasRemoteUrls(list) {
  if (!list || !Array.isArray(list)) return false;
  return list.some(function(item) {
    if (typeof item === 'string') return isRemoteUrl(item);
    if (item && typeof item === 'object') {
      var url = item.url || item.image || item.imageUrl || '';
      return isRemoteUrl(url);
    }
    return false;
  });
}

module.exports = {
  saveDraft: saveDraft,
  loadDraft: loadDraft,
  removeDraft: removeDraft,
  hasDraft: hasDraft,
  isRemoteUrl: isRemoteUrl,
  isTempPath: isTempPath,
  persistMediaFiles: persistMediaFiles,
  cleanupDraftFiles: cleanupDraftFiles,
  validatePersistedUrls: validatePersistedUrls,
  filterTempFiles: filterTempFiles,
  hasRemoteUrls: hasRemoteUrls
};
