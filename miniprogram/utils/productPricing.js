const api = require('./api');
const auth = require('./auth');
const finance = require('./managerFinance');

function integrateProductPricing(page) {
  Object.assign(page.data, {
    costPrice: '', defaultPrice: '', quickCost: '', batchCost: '',
    pricingRules: [], pricingRuleId: '', pricingRuleName: '',
    pricingRuleVersion: '', pricingRuleSegments: [], ruleSource: '',
    pricingError: '', pricingBusy: false, managerInactive: false
  });

  page.loadPricingChoices = async function() {
    const rules = await api.get('/pricing-rules');
    this.setData({ pricingRules: (rules || []).filter(rule => rule.enabled) });
  };

  page.showRule = function(rule, source) {
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
      if (rule && rule.enabled) this.showRule(rule, '档口：' + stall.name);
      else if (this.data.isStallManager) {
        this.showRule(null, '');
        this.setData({ pricingError: '该档口未分配启用的计价规则，请联系管理员' });
      }
      await this.recalculatePricing(false);
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
    this.showRule(rule, '管理员选择');
    this._markDirty();
    await this.recalculatePricing(false);
  };

  page.onCostInput = function(event) {
    this.setData({ costPrice: event.detail.value, defaultPrice: '' });
    this._markDirty();
    this.schedulePricing();
  };

  page.schedulePricing = function() {
    if (this._pricingTimer) clearTimeout(this._pricingTimer);
    this._pricingSequence = (this._pricingSequence || 0) + 1;
    this._pricingTimer = setTimeout(() => this.recalculatePricing(false), 350);
  };

  page.recalculatePricing = async function(strict) {
    const sequence = (this._pricingSequence || 0) + 1;
    this._pricingSequence = sequence;
    if (this.data.isBundleMode) this.saveActiveGroupState();
    try {
      if (!this.data.pricingRuleId || !this.data.pricingRuleSegments.length) throw new Error('请选择有效计价规则');
      const defaultCost = finance.money(this.data.costPrice);
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
      const updateSku = async sku => {
        if (sku._toBeRemoved) return { ...sku };
        const cost = finance.money(sku.costPrice || defaultCost);
        return { ...sku, costPrice: cost, price: await price(cost) };
      };
      const defaultPrice = await price(defaultCost);
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
        this.setData({ skuList, bundleGroups, defaultPrice, pricingError: '' });
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
    else await this.recalculatePricing(false);
  };

  if (page.loadLiveProductForConvert) {
    const originalConvert = page.loadLiveProductForConvert;
    page.loadLiveProductForConvert = async function(id) {
      await originalConvert.call(this, id);
      if (this.data.isStallManager) await this.useStallPricing();
      else await this.recalculatePricing(false);
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
    if (event.currentTarget.dataset.field === 'price') return;
    originalInput.call(this, event);
    if (event.currentTarget.dataset.field === 'costPrice') {
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
      if (this.data.isStallManager) await this.useStallPricing();
      else {
        const current = await api.get('/pricing-rules/' + encodeURIComponent(this.data.pricingRuleId));
        if (!current.enabled) throw new Error('所选计价规则已经停用，请更换');
        this.showRule(current, this.data.ruleSource);
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
