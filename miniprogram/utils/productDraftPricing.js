const api = require('./api');
const auth = require('./auth');
const draft = require('./draft');
const finance = require('./managerFinance');

function activeRows(data) {
  const rows = data.isBundleMode ? (data.bundleGroups || []).reduce((all, group) => all.concat(group.skuList || []), []) : data.skuList || [];
  return rows.filter(sku => !sku._toBeRemoved);
}

function costInput(data) {
  const values = activeRows(data).map(sku => String(sku.costPrice == null ? '' : sku.costPrice).trim());
  const distinct = [...new Set(values.map(value => {
    try { return finance.money(value); } catch (_) { return value; }
  }))];
  if (distinct.length > 1) return { costInput: '', mixedCosts: true };
  return { costInput: distinct[0] || String(data.costPrice || ''), mixedCosts: false };
}

function createDraftPricingEditor() {
  let globalRules;
  const choices = async record => {
    let rules;
    if (auth.isStallManager()) {
      const stall = ((record.draftData || {}).selectedStalls || [])[0];
      if (!stall) return [];
      const response = await api.get('/stalls/' + encodeURIComponent(String(stall.id)) + '/pricing-rules');
      rules = Array.isArray(response) ? response : response ? [response] : [];
    } else {
      if (!globalRules) globalRules = api.get('/pricing-rules').catch(error => { globalRules = null; throw error; });
      rules = await globalRules;
    }
    const active = (rules || []).filter(rule => rule.enabled && !rule.deleted).map(rule => ({ ...rule, id: String(rule.id) }));
    if (auth.isAdmin() && !auth.isStallManager() && !record.draftType.startsWith('live_')) {
      active.unshift({ id: '', name: '未选择', segments: [] });
    }
    return active;
  };
  return {
    resetRules() { globalRules = null; },
    async load(item) {
      const record = await draft.loadDraft(item.id);
      draft.editorOptions(record);
      if (String(record.version) !== String(item.version)) throw new Error('草稿已更新，请刷新后设置成本和规则');
      if (record.capabilities && !record.capabilities.edit) throw new Error((record.warnings || []).join('；') || '该草稿暂不能修改');
      const rules = await choices(record);
      const data = record.draftData || {};
      return { record, rules, ...costInput(data), ruleId: String(data.pricingRuleId || ''),
        ruleName: data.pricingRuleName || (rules.find(rule => rule.id === String(data.pricingRuleId || '')) || {}).name || '未选择',
        costChanged: false, ruleChanged: false, revision: 0, error: '', saved: false };
    },
    async save(model, changes) {
      if (!auth.isAdmin() && !auth.isStallManager()) throw new Error('请切换到商品管理身份后修改草稿');
      const signature = JSON.stringify(changes);
      const persist = async pending => {
        const result = await draft.saveDraft(pending.data, async () => { throw new Error('草稿中有未上传的媒体，请继续编辑后重新保存'); }, pending.options);
        model.record = { ...model.record, ...result, draftData: result.draftData || pending.data };
        model.pendingSave = null;
        return model.record;
      };
      try {
        if (model.pendingSave) {
          const previous = model.pendingSave;
          await persist(previous);
          if (previous.signature === signature) return model.record;
        }
        const record = model.record;
        const context = { draftType: record.draftType, relatedId: record.relatedId || null, sessionId: record.sessionId || null };
        if (!record.contextToken && ['edit', 'live_edit'].includes(record.draftType)) throw new Error('历史草稿请先继续编辑，核对当前商品后再设置');
        const token = record.contextToken || (await draft.context(context)).token;
        const data = JSON.parse(JSON.stringify(record.draftData || {}));
        const cost = changes.costChanged ? finance.money(changes.costInput) : null;
        const ruleId = String(changes.ruleId || '');
        let rule = null;
        if (ruleId) {
          if (auth.isStallManager()) {
            const assigned = await choices(record);
            rule = assigned.find(item => item.id === ruleId);
          } else rule = await api.get('/pricing-rules/' + encodeURIComponent(ruleId));
          if (!rule || !rule.enabled || rule.deleted || !(rule.segments || []).length) throw new Error('计价规则已失效，请选择有效规则');
        } else if (changes.ruleChanged && (!auth.isAdmin() || auth.isStallManager() || record.draftType.startsWith('live_'))) {
          throw new Error('请选择有效计价规则');
        }
        data.pricingRuleId = ruleId;
        data.pricingRuleName = rule ? rule.name : '';
        data.pricingRuleVersion = rule ? rule.currentVersion : '';
        data.pricingRuleSegments = rule ? rule.segments : [];
        if (changes.costChanged) data.costPrice = cost;
        const cache = new Map();
        const updateRows = rows => Promise.all((rows || []).map(async sku => {
          if (sku._toBeRemoved) return sku;
          const updated = { ...sku, ...(changes.costChanged ? { costPrice: cost } : {}) };
          if (!rule || String(updated.costPrice == null ? '' : updated.costPrice).trim() === '') return updated;
          const amount = finance.money(updated.costPrice);
          if (!cache.has(amount)) cache.set(amount, api.post('/pricing-rules/preview', { cost: amount,
            segments: rule.segments.map(({ label, ...segment }) => segment) }).then(value => finance.money(value.price)));
          return { ...updated, costPrice: amount, price: await cache.get(amount) };
        }));
        if (data.isBundleMode) {
          data.bundleGroups = await Promise.all((data.bundleGroups || []).map(async group => ({ ...group, skuList: await updateRows(group.skuList) })));
          const active = data.bundleGroups[data.activeGroupIndex];
          if (active) data.skuList = active.skuList;
        } else data.skuList = await updateRows(data.skuList);
        const prices = activeRows(data).map(sku => Number(sku.price)).filter(value => Number.isFinite(value) && value > 0);
        if (prices.length) {
          const min = Math.min(...prices), max = Math.max(...prices);
          data.displayPrice = min === max ? String(min) : min + ' - ' + max;
        }
        model.pendingSave = { signature, data, options: { ...context, id: record.id, version: record.version,
          clientDraftKey: record.clientDraftKey, contextToken: token, requestKey: draft.createKey(), mediaCache: new Map() } };
        const result = await persist(model.pendingSave);
        model.record.contextToken = result.contextToken || token;
        return model.record;
      } catch (error) {
        if (error.statusCode >= 400 && error.statusCode < 500) model.pendingSave = null;
        throw error;
      }
    }
  };
}

module.exports = { createDraftPricingEditor };
