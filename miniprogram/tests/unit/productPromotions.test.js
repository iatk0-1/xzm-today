const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const utils = require('../../utils/productPromotions');

test('优惠绑定只提交两个方案和凑单开关，大整数ID不转成数字，旧客户端不覆盖已有优惠', () => {
  assert.equal(utils.binding(null), undefined);
  assert.deepEqual(utils.binding({ firstSchemeId: '9007199254740993123', otherSchemeId: '9007199254740993222', combine: true, firstName: '首单' }),
    { firstSchemeId: '9007199254740993123', otherSchemeId: '9007199254740993222', combine: true });
  assert.deepEqual(utils.binding({ combine: true }), { firstSchemeId: null, otherSchemeId: null, combine: false });
});
test('四种方案参数正确转换，首单人数天数和金额均校验，折扣使用百分比', () => {
  assert.deepEqual(utils.schemeRequest({ type: 'FIRST', name: '首单减5', amount: '5', maxUsers: '100', validDays: '7' }),
    { name: '首单减5', type: 'FIRST', mode: 'FIXED', enabled: true, amount: 5, maxUsers: 100, validDays: 7 });
  assert.equal(utils.schemeRequest({ type: 'RATE', name: '三件九五折', minimumQty: '3', fold: '9.5' }).discountPercent, 95);
  assert.deepEqual(utils.schemeRequest({ type: 'QUANTITY', mode: 'PROGRESSIVE', name: '递增减', amount: '1', maxUnitDiscount: '5' }),
    { name: '递增减', type: 'QUANTITY', mode: 'PROGRESSIVE', enabled: true, minimumQty: 1, amount: 1, maxUnitDiscount: 5 });
  for (const patch of [{ amount: '0' }, { amount: '1.001' }, { maxUsers: '1.5' }, { validDays: '0' }])
    assert.throws(() => utils.schemeRequest({ type: 'FIRST', name: '首单', amount: '5', maxUsers: '100', validDays: '7', ...patch }));
  assert.throws(() => utils.schemeRequest({ type: 'AMOUNT', name: '满减', thresholdAmount: '10', amount: '10' }));
  assert.throws(() => utils.schemeRequest({ type: 'RATE', name: '折扣', minimumQty: '3', fold: '10' }));
});
function component({ fail = false } = {}) {
  let definition;const calls = [], changes = [];
  const schemes = [
    { id: '1', type: 'FIRST', name: '首单减5', enabled: true },
    { id: '2', type: 'AMOUNT', name: '满200减10', enabled: true },
    { id: '3', type: 'RATE', name: '三件九折', enabled: true }
  ];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../components/productPromotions/index.js'), 'utf8'), {
    Component: value => { definition = value; },
    require(name) {
      if (name.endsWith('/api')) return {
        get: async () => schemes,
        post: async (url, data) => { calls.push({ url, data });if (fail) throw new Error('保存失败');return { ...data, id: '4' }; }
      };
      if (name.endsWith('/error')) return require('../../utils/error');
      return utils;
    }, wx: { showToast() {} }
  });
  const instance = { ...definition.methods, data: { ...structuredClone(definition.data), value: null },
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith('form.')) this.data.form[key.slice(5)] = value;else this.data[key] = value;
      }
    },
    triggerEvent(name, event) { changes.push(event.value);this.data.value = event.value;this.syncChoices(); }
  };
  return { instance, calls, changes };
}
test('切换其他优惠类型时清掉旧方案和凑单开关，首单选择保留', async () => {
  const { instance } = component();await instance.open();
  instance.chooseFirst({ detail: { value: 1 } });
  instance.chooseType({ detail: { value: 1 } });instance.chooseOther({ detail: { value: 1 } });
  instance.combine({ detail: { value: true } });
  assert.equal(instance.data.value.firstSchemeId, '1');assert.equal(instance.data.value.otherSchemeId, '2');
  instance.chooseType({ detail: { value: 2 } });
  assert.equal(instance.data.value.firstSchemeId, '1');assert.equal(instance.data.value.otherSchemeId, null);assert.equal(instance.data.value.combine, false);
  instance.chooseOther({ detail: { value: 1 } });assert.equal(instance.data.value.otherSchemeId, '3');
});
test('新增方案成功后自动选中，失败保留表单且不改变商品选择', async () => {
  for (const fail of [false, true]) {
    const { instance, calls, changes } = component({ fail });await instance.open();instance.create();
    instance.data.form = { type: 'FIRST', name: '首单减5', amount: '5', maxUsers: '100', validDays: '7' };
    await instance.saveScheme();
    assert.equal(calls.length, 1);assert.equal(calls[0].data.validDays, 7);
    assert.equal(changes.length, fail ? 0 : 1);assert.equal(instance.data.editing, fail);assert.equal(instance.data.saving, false);
    if (fail) assert.match(instance.data.error, /保存失败/);else assert.equal(instance.data.value.firstSchemeId, '4');
  }
});
