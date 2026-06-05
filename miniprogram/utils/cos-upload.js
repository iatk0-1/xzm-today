/**
 * 腾讯云 COS 直传工具（STS PUT Object 方案）
 *
 * 流程：
 * 1. 后端 GET /files/cos-credentials → STS 临时凭证 + bucket/region/cdnDomain
 * 2. wx.getFileSystemManager().readFile() → ArrayBuffer
 * 3. cos-wx-sdk-v5 putObject({Body: ArrayBuffer}) → 直传 COS（PUT 请求）
 * 4. 返回 CDN URL
 *
 * 经验证：STS 凭证走 PUT Object 是 200，走 POST Object 表单是 403
 */
var COS;
try {
  COS = require('cos-wx-sdk-v5');
} catch (e) {
  console.error('[COS] cos-wx-sdk-v5 加载失败！请在微信开发者工具 → 工具 → 构建 npm');
  console.error('[COS] 错误详情:', e.message);
}

function getApi() {
  return require('./api');
}

function extractExtension(filePath) {
  if (!filePath) return '';
  // 去除 URL query 参数（macOS temp 路径可能带 ?）
  var qIdx = filePath.indexOf('?');
  var cleanPath = qIdx >= 0 ? filePath.substring(0, qIdx) : filePath;
  var lastSlash = Math.max(cleanPath.lastIndexOf('/'), cleanPath.lastIndexOf('\\'));
  var filename = lastSlash >= 0 ? cleanPath.substring(lastSlash + 1) : cleanPath;
  var dotIndex = filename.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === filename.length - 1) return '';
  var ext = filename.substring(dotIndex + 1).toLowerCase();
  if (/^[a-z0-9]{1,10}$/.test(ext)) return ext;
  // macOS 上扩展名可能混入下划线（如 .jpg_large），取纯字母部分
  var cleanExt = ext.match(/^[a-z]+/);
  return cleanExt ? cleanExt[0] : '';
}

function readFile(filePath) {
  return new Promise(function (resolve, reject) {
    console.log('[COS] 读取文件:', filePath);
    // 先验证文件是否存在（macOS 上 wx.chooseMedia 返回的 temp HTTP 路径可能已被 GC 回收）
    try {
      var fs = wx.getFileSystemManager();
      fs.accessSync(filePath);
    } catch (e) {
      console.error('[COS] 文件不存在（可能已被系统回收）:', filePath);
      reject(new Error('文件已失效，请重新选择图片'));
      return;
    }
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      success: function (res) {
        console.log('[COS] 文件读取成功, size:', res.data.byteLength || res.data.length);
        resolve(res.data);
      },
      fail: function (err) {
        console.error('[COS] 读取文件失败:', err);
        reject(err);
      }
    });
  });
}

function uploadFile(filePath, dir, onProgress, format) {
  return new Promise(async function (resolve, reject) {
    try {
      var ext = format || extractExtension(filePath);
      if (!ext) ext = 'jpg';

      // 1. 获取 STS 临时凭证
      console.log('[COS] 获取 STS 凭证, dir=' + dir);
      var credentials = await getApi().getCosCredentials(dir);
      console.log('[COS] STS 凭证获取成功, bucket=' + credentials.bucket + ' region=' + credentials.region);

      // 2. 生成对象 Key
      var now = new Date();
      var datePath = now.getFullYear() + '/' +
        String(now.getMonth() + 1).padStart(2, '0') + '/' +
        String(now.getDate()).padStart(2, '0');
      var uuid = 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      var objectKey = (dir ? 'xzm/' + dir : 'xzm') + '/' + datePath + '/' + uuid + '.' + ext;

      // 3. 读取文件为 ArrayBuffer
      var fileData = await readFile(filePath);

      // 4. 用 COS SDK 直传（PUT Object）
      var cos = new COS({
        getAuthorization: function (_options, callback) {
          callback({
            TmpSecretId: credentials.tmpSecretId,
            TmpSecretKey: credentials.tmpSecretKey,
            SecurityToken: credentials.sessionToken,
            StartTime: Math.floor(Date.now() / 1000),
            ExpiredTime: credentials.expiredTime
          });
        }
      });

      console.log('[COS] 开始 PUT Object, key=' + objectKey);
      cos.putObject({
        Bucket: credentials.bucket,
        Region: credentials.region,
        Key: objectKey,
        Body: fileData,
        Headers: {
          'x-cos-acl': 'public-read'
        },
        onProgress: function (info) {
          if (onProgress) onProgress(info.percent * 100);
        }
      }, function (err, data) {
        if (err) {
          console.error('[COS] PUT Object 失败:', err);
          reject(err);
          return;
        }

        var url;
        if (credentials.cdnDomain) {
          url = 'https://' + credentials.cdnDomain + '/' + objectKey;
        } else {
          url = 'https://' + data.Location;
          if (url && url.startsWith('http://')) {
            url = 'https://' + url.substring(7);
          }
        }

        console.log('[COS] 上传成功:', objectKey, '→', url);
        resolve(url);
      });
    } catch (err) {
      console.error('[COS] 上传流程失败:', err);
      reject(err);
    }
  });
}

function uploadFiles(filePaths, dir, onProgress) {
  var promises = filePaths.map(function (filePath, index) {
    return uploadFile(filePath, dir, function (percent) {
      if (onProgress) onProgress(index, percent);
    });
  });
  return Promise.all(promises);
}

module.exports = {
  uploadFile: uploadFile,
  uploadFiles: uploadFiles
};
