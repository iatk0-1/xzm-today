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
  assert.equal(utils.schemeRequest({ type: 'RATE', name: '三件九五折', rules: [{ minimumQty: '3', fold: '9.5' }] }).rules[0].discountPercent, 95);
  assert.deepEqual(utils.schemeRequest({ type: 'QUANTITY', name: '多件优惠', rules: [{ minimumQty: '2', amount: '1' }, { minimumQty: '3', amount: '3' }] }),
    { name: '多件优惠', type: 'QUANTITY', mode: 'FIXED', enabled: true, rules: [{ minimumQty: 2, amount: 1 }, { minimumQty: 3, amount: 3 }] });
  for (const patch of [{ amount: '0' }, { amount: '1.001' }, { maxUsers: '1.5' }, { validDays: '0' }])
    assert.throws(() => utils.schemeRequest({ type: 'FIRST', name: '首单', amount: '5', maxUsers: '100', validDays: '7', ...patch }));
  assert.throws(() => utils.schemeRequest({ type: 'AMOUNT', name: '满减', rules: [{ thresholdAmount: '10', amount: '10' }] }));
  assert.throws(() => utils.schemeRequest({ type: 'RATE', name: '折扣', rules: [{ minimumQty: '3', fold: '10' }] }));
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


test('三类多行规则校验空行、空列表、重复门槛和非法折扣，发送时不包含界面行标识', () => {
  const result = utils.schemeRequest({ type: 'AMOUNT', name: '阶梯满减', rules: [
    { _key: 'a', thresholdAmount: '100', amount: '10' }, { _key: 'b', thresholdAmount: '200', amount: '30' }
  ] });
  assert.deepEqual(result.rules, [{ thresholdAmount: 100, amount: 10 }, { thresholdAmount: 200, amount: 30 }]);
  for (const type of ['AMOUNT', 'RATE', 'QUANTITY']) {
    assert.throws(() => utils.schemeRequest({ type, name: '空方案', rules: [] }), /1到100/);
    assert.throws(() => utils.schemeRequest({ type, name: '空行', rules: [{}] }), /第1条规则/);
  }
  assert.throws(() => utils.schemeRequest({ type: 'AMOUNT', name: '重复', rules: [
    { thresholdAmount: '100', amount: '10' }, { thresholdAmount: '100.00', amount: '20' }
  ] }), /门槛不能重复/);
  for (const type of ['RATE', 'QUANTITY']) assert.throws(() => utils.schemeRequest({ type, name: '重复', rules: [
    { minimumQty: '2', amount: '1', fold: '9.5' }, { minimumQty: '2', amount: '3', fold: '9' }
  ] }), /门槛不能重复/);
});

test('新增按钮增加空行，叉叉移除指定行，剩余输入值和稳定行标识保留', () => {
  const { instance } = component();instance.create();instance.createType({ detail: { value: 1 } });
  assert.equal(instance.data.form.rules.length, 1);
  const firstKey = instance.data.form.rules[0]._key;
  instance.ruleInput({ currentTarget: { dataset: { index: 0, field: 'thresholdAmount' } }, detail: { value: '100' } });
  instance.addRule();
  const secondKey = instance.data.form.rules[1]._key;
  assert.notEqual(firstKey, secondKey);assert.equal(instance.data.form.rules[1].thresholdAmount, undefined);
  instance.ruleInput({ currentTarget: { dataset: { index: 1, field: 'thresholdAmount' } }, detail: { value: '200' } });
  instance.removeRule({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(instance.data.form.rules.length, 1);assert.equal(instance.data.form.rules[0]._key, secondKey);
  assert.equal(instance.data.form.rules[0].thresholdAmount, '200');
  instance.removeRule({ currentTarget: { dataset: { index: 0 } } });assert.equal(instance.data.form.rules.length, 0);
  instance.addRule();assert.equal(instance.data.form.rules.length, 1);assert.equal(instance.data.form.rules[0].thresholdAmount, undefined);
  instance.data.saving = true;instance.addRule();instance.removeRule({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(instance.data.form.rules.length, 1);
});

test('多行方案摘要展示每一档，保存后自动选中完整规则', async () => {
  assert.equal(utils.summary({ type: 'AMOUNT', enabled: true, rules: [{ thresholdAmount: 100, amount: 10 }, { thresholdAmount: 200, amount: 30 }] }), '满100元减10元；满200元减30元');
  const { instance, calls } = component();await instance.open();instance.create();instance.createType({ detail: { value: 2 } });
  instance.data.form = { type: 'RATE', name: '阶梯折扣', rules: [{ minimumQty: '2', fold: '9.5' }, { minimumQty: '3', fold: '9' }] };
  await instance.saveScheme();assert.equal(calls[0].data.rules.length, 2);
  assert.equal(instance.data.value.otherSchemeId, '4');assert.equal(instance.data.value.otherType, 'RATE');
  assert.equal(instance.data.value.otherSummary, '满2件打9.5折；满3件打9折');
});
