const api = require('./api');
const auth = require('./auth');
const finance = require('./managerFinance');

function integrateProductPricing(page, { allowAdminManualPricing = false } = {}) {
  Object.assign(page.data, {
    costPrice: '', defaultPrice: '', quickCost: '', batchCost: '',
    isAdmin: false,
    pricingRules: [], pricingRuleId: '', pricingRuleName: '',
    pricingRuleVersion: '', pricingRuleSegments: [], ruleSource: '',
    pricingError: '', pricingBusy: false, managerInactive: false
  });

  page.canManuallyPrice = function() {
    return allowAdminManualPricing && auth.isAdmin() && !this.data.isStallManager;
  };

  page.cancelPricing = function() {
    if (this._pricingTimer) clearTimeout(this._pricingTimer);
    this._pricingSequence = (this._pricingSequence || 0) + 1;
    this.setData({ pricingBusy: false });
  };

  page.productCost = function(value) {
    if (this.canManuallyPrice() && String(value == null ? '' : value).trim() === '') return null;
    return finance.money(value);
  };

  page.loadPricingChoices = async function() {
    const rules = await api.get('/pricing-rules');
    const choices = (rules || []).filter(rule => rule.enabled && !rule.deleted);
    if (this.canManuallyPrice()) choices.unshift({ id: '', name: '未选择', segments: [] });
    this.setData({ pricingRules: choices });
  };

  page.useExistingPricing = async function(rule, token) {
    const productId = this.data.editId || (this.data.editMode && this.data.productId);
    if (!productId || !rule) return false;
    const existing = await api.get('/products/' + encodeURIComponent(String(productId)) + '?manage=true');
    if (token !== undefined && token !== this._ruleToken) return false;
    const previousStalls = ((existing.product || {}).stallIds || []).map(String);
    const currentStalls = this.data.selectedStalls.map(stall => String(stall.id));
    if (String(existing.pricingRuleId) !== String(rule.id)
      || previousStalls.join(',') !== currentStalls.join(',')) return false;
    this.showRule({ ...rule, currentVersion: existing.pricingRuleVersion,
      segments: existing.pricingRuleSegments }, '已有商品使用的规则');
    return true;
  };

  page.showRule = function(rule, source) {
    if (this.canManuallyPrice()) this.cancelPricing();
    this.setData({
      pricingRuleId: rule ? String(rule.id) : '',
      pricingRuleName: rule ? rule.name : '',
      pricingRuleVersion: rule ? rule.currentVersion : '',
      pricingRuleSegments: finance.segmentsWithLabels(rule ? rule.segments : []),
      ruleSource: source || '', pricingError: ''
    });
  };

  page.useStallPricing = async function() {
    const stall = this.data.selectedStalls[0];
    const token = (this._ruleToken || 0) + 1;
    this._ruleToken = token;
    if (!stall) {
      if (this.data.isStallManager) this.showRule(null, '');
      return;
    }
    try {
      const rule = await api.get('/stalls/' + encodeURIComponent(String(stall.id)) + '/pricing-rule');
      if (token !== this._ruleToken) return;
      if (rule && rule.enabled && !rule.deleted) this.showRule(rule, '档口：' + stall.name);
      else {
        const preserved = await this.useExistingPricing(rule, token);
        if (token !== this._ruleToken) return;
        if (!preserved) {
          this.showRule(null, '');
          if (this.canManuallyPrice()) return;
          this.setData({ pricingError: '该档口的计价规则未启用或已删除，不能用于新增商品，请联系管理员' });
          return;
        }
      }
      if (!this.canManuallyPrice()) await this.recalculatePricing(false);
    } catch (error) {
      if (token === this._ruleToken) {
        this.showRule(null, '');
        this.setData({ pricingError: error.message || '加载档口规则失败' });
      }
    }
  };

  page.choosePricingRule = async function(event) {
    if (this.data.isStallManager) return;
    const rule = this.data.pricingRules[Number(event.detail.value)];
    if (!rule) return;
    this._ruleToken = (this._ruleToken || 0) + 1;
    this.showRule(rule.id === '' ? null : rule, '管理员选择');
    this._markDirty();
    if (!this.canManuallyPrice()) await this.recalculatePricing(false);
  };

  page.onCostInput = function(event) {
    this.setData({ costPrice: event.detail.value, defaultPrice: '' });
    this._markDirty();
    this.schedulePricing();
  };

  page.schedulePricing = function() {
    if (this.canManuallyPrice()) {
      this.cancelPricing();
      return;
    }
    if (this._pricingTimer) clearTimeout(this._pricingTimer);
    this._pricingSequence = (this._pricingSequence || 0) + 1;
    this._pricingTimer = setTimeout(() => this.recalculatePricing(false), 350);
  };

  page.applyPricingRule = async function() {
    if (this.data.pricingBusy) return;
    if (this._pricingTimer) clearTimeout(this._pricingTimer);
    const result = await this.recalculatePricing(false, true);
    if (!result) {
      if (this.data.pricingError) wx.showToast({ title: this.data.pricingError, icon: 'none' });
      return;
    }
    if (result.updatedCount > 0) this._markDirty();
    wx.showToast({
      title: result.updatedCount > 0 ? '已更新' + result.updatedCount + '条SKU售价' : '请先填写SKU成本',
      icon: 'none'
    });
  };

  page.recalculatePricing = async function(strict, skuOnly = false) {
    const sequence = (this._pricingSequence || 0) + 1;
    this._pricingSequence = sequence;
    if (this.data.isBundleMode) this.saveActiveGroupState();
    try {
      if (!this.data.pricingRuleId || !this.data.pricingRuleSegments.length) throw new Error('请选择有效计价规则');
      // 编辑预览允许默认成本为空；保存时仍按原有要求完整校验。
      const defaultCost = strict ? finance.money(this.data.costPrice) : null;
      const segments = this.data.pricingRuleSegments.map(({ label, ...segment }) => segment);
      this.setData({ pricingBusy: true });
      const cache = new Map();
      const price = async cost => {
        const amount = finance.money(cost);
        if (!cache.has(amount)) {
          cache.set(amount, api.post('/pricing-rules/preview', { segments, cost: amount }).then(result => String(result.price)));
        }
        return cache.get(amount);
      };
      let updatedCount = 0;
      const updateSku = async sku => {
        if (sku._toBeRemoved) return { ...sku };
        if (!strict && String(sku.costPrice == null ? '' : sku.costPrice).trim() === '') return { ...sku };
        const cost = finance.money(sku.costPrice || defaultCost);
        const retailPrice = await price(cost);
        updatedCount += 1;
        return { ...sku, costPrice: cost, price: retailPrice };
      };
      let defaultPrice = skuOnly ? this.data.defaultPrice : '';
      if (strict) defaultPrice = await price(defaultCost);
      else if (!skuOnly) {
        // 默认成本的输入状态不应阻挡已经填写成本的SKU计价。
        let previewCost;
        try { previewCost = finance.money(this.data.costPrice); } catch (_) { /* 等待默认成本输入完整 */ }
        if (previewCost) defaultPrice = await price(previewCost);
      }
      let skuList;
      let bundleGroups = this.data.bundleGroups;
      if (this.data.isBundleMode) {
        bundleGroups = await Promise.all(bundleGroups.map(async group => ({
          ...group, skuList: await Promise.all((group.skuList || []).map(updateSku))
        })));
        skuList = this.data.activeGroupIndex >= 0
          ? bundleGroups[this.data.activeGroupIndex].skuList : this.data.skuList;
      } else {
        skuList = await Promise.all(this.data.skuList.map(updateSku));
      }
      if (sequence === this._pricingSequence) {
        // 预览请求返回时只合并计价字段，保留等待期间编辑的库存、图片等资料。
        const mergePrices = (current, calculated) => current.map((sku, index) => {
          if (sku._toBeRemoved || (!strict && String(sku.costPrice == null ? '' : sku.costPrice).trim() === '')) return sku;
          const priced = calculated[index];
          return priced ? { ...sku, costPrice: priced.costPrice, price: priced.price } : sku;
        });
        if (this.data.isBundleMode) {
          bundleGroups = this.data.bundleGroups.map((group, index) => ({
            ...group,
            skuList: mergePrices(index === this.data.activeGroupIndex ? this.data.skuList : (group.skuList || []), bundleGroups[index].skuList)
          }));
          skuList = this.data.activeGroupIndex >= 0
            ? bundleGroups[this.data.activeGroupIndex].skuList : this.data.skuList;
        } else skuList = mergePrices(this.data.skuList, skuList);
        this.setData({ skuList, bundleGroups, defaultPrice, pricingError: '' });
        return { updatedCount };
      }
    } catch (error) {
      if (sequence === this._pricingSequence) this.setData({ pricingError: error.message || '成本计价失败' });
      if (strict) throw error;
    } finally {
      if (sequence === this._pricingSequence) this.setData({ pricingBusy: false });
    }
  };

  const originalOnLoad = page.onLoad;
  page.onLoad = async function(options) {
    await originalOnLoad.call(this, options);
    this.setData({ isAdmin: auth.isAdmin() });
    try {
      if (this.data.isStallManager) {
        const profile = await api.get('/stall-managers/mine');
        if (!profile.active) {
          this.setData({ managerInactive: true, pricingError: '负责人已经下线，请联系管理员重新激活后管理商品' });
          return;
        }
      }
      await this.loadPricingChoices();
      if (!options || (!options.editId && !options.copyId && !options.productId && !options.convertFromLiveProductId)) {
        if (!this.data.isStallManager) {
          const preference = await api.get('/pricing-rules/preference/mine');
          const rule = this.data.pricingRules.find(item => String(item.id) === String(preference.ruleId));
          if (rule) this.showRule(rule, '上次成功保存使用');
        }
        await this.useStallPricing();
      }
    } catch (error) {
      this.setData({ pricingError: error.message || '加载计价规则失败' });
    }
  };

  const originalLoad = page.loadProductForEdit;
  page.loadProductForEdit = async function(id) {
    await originalLoad.call(this, id);
    if (this.data.isStallManager) await this.useStallPricing();
    else if (!this.canManuallyPrice()) await this.recalculatePricing(false);
  };

  if (page.loadLiveProductForConvert) {
    const originalConvert = page.loadLiveProductForConvert;
    page.loadLiveProductForConvert = async function(id) {
      await originalConvert.call(this, id);
      if (this.data.isStallManager) await this.useStallPricing();
      else if (!this.canManuallyPrice()) await this.recalculatePricing(false);
    };
  }

  page.copyCurrentProduct = function() {
    if (!this.data.editId) return;
    if (this.data.isBundleMode) this.saveActiveGroupState();
    const cloneSku = sku => ({ ...sku, skuId: null, bundleGroupId: null, soldMain: 0, lockedMain: 0 });
    const groups = this.data.bundleGroups.map(group => ({
      ...group, id: null, skuList: (group.skuList || []).map(cloneSku)
    }));
    this.setData({
      editId: null, skuList: this.data.skuList.filter(sku => !sku._toBeRemoved).map(cloneSku),
      bundleGroups: groups
    });
    this._draftType = 'create';
    this._relatedId = null;
    this._markDirty();
    wx.showToast({ title: '已复制为新商品，请检查成本与规则', icon: 'none' });
  };

  ['toggleBundleMode', 'addBundleGroup', 'removeBundleGroup', 'onBundleGroupNameInput'].forEach(name => {
    const original = page[name];
    page[name] = function(...args) {
      if (this.data.editId) {
        wx.showToast({ title: '已有商品保留分组结构，可复制为新商品调整', icon: 'none' });
        return;
      }
      original.apply(this, args);
    };
  });

  ['selectRecentStall', 'selectStall', 'createStall'].forEach(name => {
    const original = page[name];
    page[name] = async function(event) {
      await original.call(this, event);
      await this.useStallPricing();
    };
  });

  const originalRemove = page.removeStall;
  page.removeStall = function(event) {
    originalRemove.call(this, event);
    if (this.data.isStallManager) this.showRule(null, '');
  };

  const originalInput = page.onSkuInput;
  page.onSkuInput = function(event) {
    const field = event.currentTarget.dataset.field;
    if (field === 'price' && !this.canManuallyPrice()) return;
    originalInput.call(this, event);
    if (this.canManuallyPrice()) {
      if (field === 'price' || field === 'costPrice') this.cancelPricing();
      this._afterBundleSkuChange();
      return;
    }
    if (field === 'costPrice') {
      this.setData({ ['skuList[' + event.currentTarget.dataset.index + '].price']: '' });
      this._afterBundleSkuChange();
      this.schedulePricing();
    }
  };

  ['generateSkuMatrix', 'applyQuickFillAll', 'confirmBatch'].forEach(name => {
    if (!page[name]) return;
    const original = page[name];
    page[name] = function(...args) {
      original.apply(this, args);
      this._afterBundleSkuChange();
      this.schedulePricing();
    };
  });

  const originalRestore = page.restoreDraft;
  page.restoreDraft = function(data) {
    originalRestore.call(this, data);
    this.setData({
      costPrice: data.costPrice || '', pricingRuleId: data.pricingRuleId || '',
      pricingRuleVersion: data.pricingRuleVersion || '',
      pricingRuleName: data.pricingRuleName || '',
      pricingRuleSegments: finance.segmentsWithLabels(data.pricingRuleSegments || [])
    });
    if (this.data.isStallManager) this.useStallPricing();
    else this.schedulePricing();
  };

  const originalSubmit = page.submitProduct;
  page.submitProduct = async function() {
    if (this._pricingSubmitting) return;
    this._pricingSubmitting = true;
    try {
      if (this.data.managerInactive) throw new Error('负责人已下线，不能保存商品');
      if (this.data.selectedStalls.length !== 1) throw new Error('商品必须且只能选择一个档口');
      if (this.canManuallyPrice()) {
        this.cancelPricing();
        if (this.data.isBundleMode) this.saveActiveGroupState();
        const skus = this.data.isBundleMode
          ? this.data.bundleGroups.reduce((all, group) => all.concat(group.skuList || []), []) : this.data.skuList;
        this.productCost(this.data.costPrice);
        skus.filter(sku => !sku._toBeRemoved).forEach(sku => {
          try { finance.money(sku.price); } catch (_) { throw new Error('请填写正确的SKU售价，须大于零且最多两位小数'); }
          this.productCost(sku.costPrice || this.data.costPrice);
        });
        this.setData({ pricingError: '' });
        await originalSubmit.call(this);
        return;
      }
      if (this.data.isStallManager) await this.useStallPricing();
      else {
        const current = await api.get('/pricing-rules/' + encodeURIComponent(this.data.pricingRuleId));
        if (!current.enabled || current.deleted) {
          if (!await this.useExistingPricing(current)) throw new Error('所选计价规则已禁用或删除，不能用于新增商品或变更规则');
        } else this.showRule(current, this.data.ruleSource);
      }
      await this.recalculatePricing(true);
      await originalSubmit.call(this);
    } catch (error) {
      this.setData({ pricingError: error.message || '保存商品失败' });
      wx.showToast({ title: error.message || '保存商品失败', icon: 'none' });
    } finally {
      this._pricingSubmitting = false;
    }
  };

  const originalUnload = page.onUnload;
  page.onUnload = function() {
    if (this._pricingTimer) clearTimeout(this._pricingTimer);
    this._pricingSequence = (this._pricingSequence || 0) + 1;
    originalUnload.call(this);
  };
}

module.exports = { integrateProductPricing };
