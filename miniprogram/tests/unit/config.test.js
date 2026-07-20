const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../../utils/config');

test('E2E checkout uses the dev backend API', () => {
  assert.equal(config.API_BASE_URL, 'https://api-dev.xianzaimai.com/api/v1');
  assert.match(config.CDN_BASE_URL, /-dev\./);
});
