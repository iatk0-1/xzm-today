const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../../utils/config');

function loadAuth({ storage = {}, loginResult = { code: 'mock-code' }, requestHandler }) {
  const store = { ...storage };
  const requests = [];
  let loginCalls = 0;

  global.wx = {
    getStorageSync(key) {
      return store[key];
    },
    setStorageSync(key, value) {
      store[key] = value;
    },
    removeStorageSync(key) {
      delete store[key];
    },
    login(options) {
      loginCalls += 1;
      setImmediate(() => options.success(loginResult));
    },
    request(options) {
      requests.push(options);
      try {
        const response = requestHandler(options, { store, requests });
        setImmediate(() => options.success(response));
      } catch (error) {
        setImmediate(() => options.fail(error));
      }
    }
  };

  const authPath = require.resolve('../../utils/auth');
  const apiPath = require.resolve('../../utils/api');
  delete require.cache[authPath];
  delete require.cache[apiPath];

  return {
    auth: require('../../utils/auth'),
    store,
    requests,
    get loginCalls() {
      return loginCalls;
    }
  };
}

function loginSession(overrides = {}) {
  return {
    accessToken: 'access-new',
    refreshToken: 'refresh-new',
    userId: 7,
    openid: 'openid-7',
    role: 'user',
    nickname: '测试用户',
    isPhoneBound: false,
    expiresIn: 3600,
    refreshExpiresIn: 86400,
    ...overrides
  };
}

test('没有本地会话时自动执行微信登录并保存新会话', async () => {
  const env = loadAuth({
    requestHandler(options) {
      assert.equal(options.url, config.API_BASE_URL + '/auth/miniapp/login');
      return { statusCode: 200, data: loginSession() };
    }
  });

  const result = await env.auth.ensureAuthenticated();

  assert.equal(result.source, 'wx_login');
  assert.equal(env.loginCalls, 1);
  assert.equal(env.store[config.TOKEN_KEY], 'access-new');
  assert.equal(env.store[config.REFRESH_TOKEN_KEY], 'refresh-new');
  assert.equal(env.store[config.USER_INFO_KEY].userId, 7);
});

test('并发恢复请求共享同一个 Promise，只执行一次微信登录', async () => {
  const env = loadAuth({
    requestHandler() {
      return { statusCode: 200, data: loginSession() };
    }
  });

  const first = env.auth.ensureAuthenticated();
  const second = env.auth.ensureAuthenticated();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.strictEqual(first, second);
  assert.deepEqual(firstResult, secondResult);
  assert.equal(env.loginCalls, 1);
  assert.equal(env.requests.length, 1);
});

test('Refresh Token 明确失效时清理旧会话并自动重新登录', async () => {
  const env = loadAuth({
    storage: {
      [config.TOKEN_KEY]: 'access-old',
      [config.REFRESH_TOKEN_KEY]: 'refresh-old',
      [config.TOKEN_EXPIRES_AT_KEY]: Date.now() - 1000,
      [config.USER_INFO_KEY]: { userId: 7, openid: 'openid-7', role: 'user' }
    },
    requestHandler(options) {
      if (options.url.endsWith('/auth/refresh')) {
        return { statusCode: 401, data: { error: 'UNAUTHORIZED' } };
      }
      return { statusCode: 200, data: loginSession() };
    }
  });

  const result = await env.auth.ensureAuthenticated();

  assert.equal(result.source, 'wx_login');
  assert.equal(env.loginCalls, 1);
  assert.equal(env.store[config.TOKEN_KEY], 'access-new');
  assert.equal(env.store[config.REFRESH_TOKEN_KEY], 'refresh-new');
});

test('Refresh 遇到网络异常时保留本地会话，不自动清理或重新登录', async () => {
  const env = loadAuth({
    storage: {
      [config.TOKEN_KEY]: 'access-old',
      [config.REFRESH_TOKEN_KEY]: 'refresh-old',
      [config.TOKEN_EXPIRES_AT_KEY]: Date.now() - 1000,
      [config.USER_INFO_KEY]: { userId: 7, openid: 'openid-7', role: 'user' }
    },
    requestHandler(options) {
      if (options.url.endsWith('/auth/refresh')) {
        throw { errMsg: 'request:fail timeout' };
      }
      throw new Error('不应继续访问登录接口');
    }
  });

  await assert.rejects(
    env.auth.ensureAuthenticated(),
    (error) => error && error.errMsg === 'request:fail timeout'
  );
  assert.equal(env.loginCalls, 0);
  assert.equal(env.store[config.TOKEN_KEY], 'access-old');
  assert.equal(env.store[config.REFRESH_TOKEN_KEY], 'refresh-old');
});

test('Access Token 可用但用户资料不完整时补齐 /users/me', async () => {
  const env = loadAuth({
    storage: {
      [config.TOKEN_KEY]: 'access-valid',
      [config.TOKEN_EXPIRES_AT_KEY]: Date.now() + 30 * 60 * 1000,
      [config.USER_INFO_KEY]: { userId: 7, role: 'user' }
    },
    requestHandler(options) {
      assert.equal(options.url, config.API_BASE_URL + '/users/me');
      return {
        statusCode: 200,
        data: {
          id: 7,
          openid: 'openid-7',
          phone: '13800000000',
          nickname: '已补齐用户',
          avatarUrl: 'https://example.com/avatar.png'
        }
      };
    }
  });

  const result = await env.auth.ensureAuthenticated();

  assert.equal(result.source, 'access_token');
  assert.equal(env.loginCalls, 0);
  assert.equal(env.store[config.USER_INFO_KEY].openid, 'openid-7');
  assert.equal(env.store[config.USER_INFO_KEY].isPhoneBound, true);
});
