const api = require('./api');
const { money } = require('./managerFinance');
const { getErrorMessage } = require('./error');

const text = value => value == null ? '' : String(value);
const sameMoney = (a, b) => text(a).trim() === text(b).trim()
  || (text(a).trim() !== '' && text(b).trim() !== '' && Number(a) === Number(b));

function integrateProductQuickEdit(page) {
  Object.assign(page.data, {
    quickEditVisible: false, quickEditType: '', quickEditProductId: '', quickEditProductName: '',
    quickEditLoading: false, quickEditSaving: false, quickEditPricingBusy: false, quickEditArticleNo: '', quickEditSkus: [],
    quickEditCost: '', quickEditPrice: '', quickEditBatchVisible: false,
    quickEditColors: [], quickEditSizes: []
  });

  page.stopQuickEditTouch = function() {};
  page.closeQuickEdit = function() {
    if (this.data.quickEditSaving) return;
    this._quickEditRequest = null;
    this._quickEditPricingRequests = new Map();
    this.setData({ quickEditVisible: false, quickEditLoading: false, quickEditPricingBusy: false });
  };
  page.openArticleNoEditor = function(event) { return this.openProductQuickEdit(event, 'articleNo'); };
  page.openSkuPricing = function(event) { return this.openProductQuickEdit(event, 'sku'); };
  page.openProductQuickEdit = async function(event, type) {
    const id = event.currentTarget.dataset.id;
    if (this.data.selectMode) return this.toggleProductSelect(event);
    if (this.data.quickEditVisible) return;
    const product = this.data.products.find(item => String(item.id) === String(id));
    if (!product) return;
    const request = {};
    this._quickEditRequest = request;
    this._quickEditPricingRequests = new Map();
    this._quickEditPricingSegments = [];
    this.setData({ quickEditVisible: true, quickEditType: type, quickEditProductId: id,
      quickEditProductName: product.name, quickEditArticleNo: product.articleNo || '',
      quickEditLoading: type === 'sku', quickEditSaving: false, quickEditPricingBusy: false, quickEditSkus: [],
      quickEditCost: '', quickEditPrice: '', quickEditBatchVisible: false,
      quickEditColors: [], quickEditSizes: [] });
    if (type !== 'sku') return;
    try {
      const detail = await api.get('/products/' + encodeURIComponent(id) + '?manage=true');
      if (this._quickEditRequest !== request) return;
      this._quickEditPricingSegments = detail.pricingRuleSegments || [];
      const rows = (detail.skus || []).map(sku => ({ ...sku,
        costPrice: text(sku.costPrice == null ? detail.costPrice : sku.costPrice),
        retailPrice: text(sku.retailPrice) }));
      this._quickEditOriginalSkus = rows.map(sku => ({ ...sku }));
      this.setData({ quickEditSkus: rows,
        quickEditColors: [...new Set(rows.map(sku => sku.spec || '默认'))].map(name => ({ name, selected: false })),
        quickEditSizes: [...new Set(rows.map(sku => sku.size || '均码'))].map(name => ({ name, selected: false })) });
    } catch (error) {
      if (this._quickEditRequest !== request) return;
      this.closeQuickEdit();
      wx.showToast({ title: getErrorMessage(error, '加载商品规格失败'), icon: 'none' });
    } finally {
      if (this._quickEditRequest === request) this.setData({ quickEditLoading: false });
    }
  };
  page.onQuickEditInput = function(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.quickEditSaving || !['quickEditCost', 'quickEditPrice', 'quickEditArticleNo'].includes(field)) return;
    this.setData({ [field]: event.detail.value });
  };
  page.onQuickSkuInput = function(event) {
    const { index, field } = event.currentTarget.dataset;
    if (this.data.quickEditSaving || !this.data.quickEditSkus[index]
      || !['costPrice', 'retailPrice'].includes(field) || (field === 'retailPrice' && this.data.isStallManager)) return;
    this._quickEditPricingRequests.delete(String(this.data.quickEditSkus[index].id));
    this.setData({ quickEditSkus: this.data.quickEditSkus.map((sku, i) => i === Number(index)
      ? { ...sku, [field]: event.detail.value } : sku), quickEditPricingBusy: this._quickEditPricingRequests.size > 0 });
  };
  page.onQuickSkuCostBlur = function(event) {
    const sku = this.data.quickEditSkus[event.currentTarget.dataset.index];
    if (sku) return this.recalculateQuickSkuPrices([sku.id]);
  };
  page.recalculateQuickSkuPrices = async function(ids) {
    const segments = this._quickEditPricingSegments || [];
    if (!segments.length) return;
    const request = this._quickEditRequest;
    const pending = this._quickEditPricingRequests;
    const rows = this.data.quickEditSkus.filter(sku => ids.some(id => String(id) === String(sku.id)));
    const previews = new Map();
    await Promise.all(rows.map(async sku => {
      const token = {};
      pending.set(String(sku.id), token);
      this.setData({ quickEditPricingBusy: true });
      try {
        if (!sku.costPrice.trim()) return;
        const cost = Number(money(sku.costPrice));
        if (!previews.has(cost)) previews.set(cost, api.post('/pricing-rules/preview', {
          segments: segments.map(({ label, ...segment }) => segment), cost
        }));
        const result = await previews.get(cost);
        if (this._quickEditRequest !== request || pending.get(String(sku.id)) !== token) return;
        this.setData({ quickEditSkus: this.data.quickEditSkus.map(current => String(current.id) === String(sku.id)
          ? { ...current, retailPrice: text(result.price) } : current) });
      } catch (error) {
        if (this._quickEditRequest === request && pending.get(String(sku.id)) === token)
          wx.showToast({ title: getErrorMessage(error, '按成本计算售价失败，请核对售价'), icon: 'none' });
      } finally {
        if (pending.get(String(sku.id)) === token) pending.delete(String(sku.id));
        if (this._quickEditRequest === request) this.setData({ quickEditPricingBusy: pending.size > 0 });
      }
    }));
  };
  page.toggleSkuPricingBatch = function() {
    if (!this.data.quickEditSaving) this.setData({ quickEditBatchVisible: !this.data.quickEditBatchVisible });
  };
  page.togglePricingOption = function(event) {
    const { field, index } = event.currentTarget.dataset;
    if (this.data.quickEditSaving || !['quickEditColors', 'quickEditSizes'].includes(field)) return;
    this.setData({ [field]: this.data[field].map((item, i) => i === Number(index) ? { ...item, selected: !item.selected } : item) });
  };
  page.toggleAllPricingOptions = function(event) {
    const { field } = event.currentTarget.dataset;
    if (this.data.quickEditSaving || !['quickEditColors', 'quickEditSizes'].includes(field)) return;
    const selected = !this.data[field].every(item => item.selected);
    this.setData({ [field]: this.data[field].map(item => ({ ...item, selected })) });
  };
  page.fillAllSkuPricing = function() { return this.fillSkuPricing(false); };
  page.applySkuPricingBatch = function() { return this.fillSkuPricing(true); };
  page.fillSkuPricing = function(filtered) {
    if (this.data.quickEditSaving) return;
    try {
      const cost = this.data.quickEditCost.trim(), price = this.data.isStallManager ? '' : this.data.quickEditPrice.trim();
      if (!cost && !price) throw new Error('请先填写批量成本或价格');
      if (cost) money(cost);
      if (price) money(price);
      const colors = this.data.quickEditColors.filter(item => item.selected).map(item => item.name);
      const sizes = this.data.quickEditSizes.filter(item => item.selected).map(item => item.name);
      const appliedIds = [];
      const rows = this.data.quickEditSkus.map(sku => {
        if (filtered && ((colors.length && !colors.includes(sku.spec || '默认'))
          || (sizes.length && !sizes.includes(sku.size || '均码')))) return sku;
        appliedIds.push(sku.id);
        this._quickEditPricingRequests.delete(String(sku.id));
        return { ...sku, costPrice: cost || sku.costPrice, retailPrice: price || sku.retailPrice };
      });
      if (!appliedIds.length) throw new Error('没有符合所选颜色和尺码的规格');
      this.setData({ quickEditSkus: rows, quickEditCost: '', quickEditPrice: '', quickEditBatchVisible: false,
        quickEditPricingBusy: this._quickEditPricingRequests.size > 0 });
      wx.showToast({ title: '已填充，保存后生效', icon: 'none' });
      if (cost && !price) return this.recalculateQuickSkuPrices(appliedIds);
    } catch (error) {
      wx.showToast({ title: getErrorMessage(error, '批量设置失败'), icon: 'none' });
    }
  };
  page.saveQuickEdit = async function() {
    if (!this.data.quickEditVisible || this.data.quickEditLoading || this.data.quickEditSaving) return;
    if (this.data.quickEditPricingBusy) {
      wx.showToast({ title: '正在计算售价，请稍后保存', icon: 'none' });
      return;
    }
    try {
      const id = this.data.quickEditProductId;
      let endpoint, body;
      if (this.data.quickEditType === 'articleNo') {
        const articleNo = this.data.quickEditArticleNo.trim();
        if (articleNo.length > 100) throw new Error('货号不能超过100个字符');
        endpoint = '/products/' + encodeURIComponent(id) + '/article-no';
        body = { articleNo };
      } else {
        const originals = new Map((this._quickEditOriginalSkus || []).map(sku => [String(sku.id), sku]));
        const changed = this.data.quickEditSkus.filter(sku => {
          const previous = originals.get(String(sku.id));
          return !previous || !sameMoney(sku.costPrice, previous.costPrice)
            || (!this.data.isStallManager && !sameMoney(sku.retailPrice, previous.retailPrice));
        });
        if (!changed.length) { this.closeQuickEdit(); return; }
        body = { skus: changed.map(sku => ({ id: sku.id,
          costPrice: sku.costPrice.trim() ? Number(money(sku.costPrice)) : null,
          retailPrice: Number(money(sku.retailPrice)) })) };
        if (this.data.isStallManager && body.skus.some(sku => sku.costPrice == null)) throw new Error('请填写每条规格的成本');
        endpoint = '/products/' + encodeURIComponent(id) + '/sku-pricing';
      }
      this.setData({ quickEditSaving: true });
      const result = await api.patch(endpoint, body);
      this.updateVisibleProduct(result.product || result);
      this.setData({ quickEditSaving: false });
      this.closeQuickEdit();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (error) {
      this.setData({ quickEditSaving: false });
      wx.showToast({ title: getErrorMessage(error, '保存商品失败'), icon: 'none' });
    }
  };
  return page;
}

module.exports = { integrateProductQuickEdit };
