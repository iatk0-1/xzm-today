const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); }
};

const auth = require('../../utils/auth');
const merchantContext = require('../../utils/merchant-context');

test.beforeEach(() => {
  storage.clear();
  wx.setStorageSync('userInfo', {
    userId: 10,
    platformRoles: ['USER'],
    memberships: [
      { merchantId: 100, merchantName: '甲商户', merchantStatus: 'active', memberStatus: 'active', permissions: ['PRODUCT_UPDATE'] },
      { merchantId: 200, merchantName: '乙商户', merchantStatus: 'active', memberStatus: 'disabled', permissions: ['PRODUCT_UPDATE'] }
    ],
    sellerProfile: { sellerId: 20, status: 'active' },
    sellerPartnerships: [{ merchantId: 100, status: 'active' }]
  });
});

test('auth exposes merchant permissions and seller partnership independently', () => {
  assert.deepEqual(auth.getPlatformRoles(), ['USER']);
  assert.equal(auth.hasPlatformRole('user'), true);
  assert.equal(auth.hasMerchantPermission(100, 'product_update'), true);
  assert.equal(auth.hasMerchantPermission(200, 'PRODUCT_UPDATE'), false);
  assert.equal(auth.canUseSellerWorkbench(100), true);
  assert.equal(auth.canUseSellerWorkbench(200), false);
});

test('merchant context only accepts active memberships', () => {
  const context = merchantContext.setCurrentMerchant(100);
  assert.equal(context.merchantId, 100);
  assert.equal(context.merchantName, '甲商户');
  assert.equal(typeof context.selectedAt, 'number');
  assert.equal(merchantContext.getCurrentMerchant().merchantId, 100);
  assert.throws(() => merchantContext.setCurrentMerchant(200), /成员关系已失效/);
  merchantContext.clearCurrentMerchant();
  assert.equal(merchantContext.getCurrentMerchant(), null);
});

test('merchant context is cleared when membership becomes disabled', () => {
  merchantContext.setCurrentMerchant(100);
  const userInfo = wx.getStorageSync('userInfo');
  userInfo.memberships[0].memberStatus = 'disabled';
  wx.setStorageSync('userInfo', userInfo);

  assert.throws(() => merchantContext.requireCurrentMerchant(), /有效的商户经营身份/);
  assert.equal(merchantContext.getCurrentMerchant(), null);
});

test('disabled merchant cannot expose permissions or retain context', () => {
  merchantContext.setCurrentMerchant(100);
  const userInfo = wx.getStorageSync('userInfo');
  userInfo.memberships[0].merchantStatus = 'disabled';
  wx.setStorageSync('userInfo', userInfo);

  assert.equal(auth.hasMerchantPermission(100, 'PRODUCT_UPDATE'), false);
  assert.throws(() => merchantContext.requireCurrentMerchant(), /有效的商户经营身份/);
});
