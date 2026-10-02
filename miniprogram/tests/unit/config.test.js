const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../../utils/config');

test('deployment API and CDN use matching supported environments', () => {
  // 部署配置由使用者选择；单元测试不发网络请求，不强改已有线上配置。
  const api = new URL(config.API_BASE_URL);
  const cdn = new URL(config.CDN_BASE_URL);
  assert.equal(api.protocol, 'https:');
  assert.equal(cdn.protocol, 'https:');
  assert.equal(api.pathname, '/api/v1');
  const environments = {
    'api-dev.xianzaimai.com': 'upload-dev.xianzaimai.com',
    'api.xianzaimai.com': 'upload.xianzaimai.com'
  };
  assert.ok(Object.hasOwn(environments, api.hostname), 'API必须使用明确的部署环境');
  assert.equal(cdn.hostname, environments[api.hostname], 'API与上传CDN不可混用环境');
  assert.equal(api.username + api.password + api.search + api.hash, '');
});
