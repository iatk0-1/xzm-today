const { getErrorMessage } = require('./error');
const draft = require('./draft');

function draftSnapshot(page) {
  const value = JSON.parse(JSON.stringify(page.collectDraftData()));
  // 当前套装子项在主表单里编辑，比较前合并，切换查看子项本身不算修改。
  if (value.isBundleMode) {
    const index = value.activeGroupIndex;
    if (value.bundleGroups[index]) {
      Object.assign(value.bundleGroups[index], {
        colors: value.colors, sizeOptions: value.sizeOptions, skuList: value.skuList
      });
      if ('sizeCategoryId' in value.bundleGroups[index]) value.bundleGroups[index].sizeCategoryId = value.currentSizeCategoryId;
    }
    ['colors', 'sizeOptions', 'skuList', 'currentSizeCategoryId'].forEach(key => delete value[key]);
  }
  ['activeGroupIndex', 'currentSizeCategoryName', 'videoThumbPath', 'displayPrice',
    'pricingRuleName', 'pricingRuleVersion', 'pricingRuleSegments'].forEach(key => delete value[key]);
  const normalize = (item, key) => {
    if (key === 'mediaList') return (item || []).map(media => typeof media === 'string' ? media : media.url);
    if (key === 'selectedStalls' || key === 'selectedTags') return (item || []).map(row => String(row.id)).sort();
    if (key === 'sizeOptions') return (item || []).filter(row => row.selected).map(row => String(row.id || row.name)).sort();
    if ((key === 'price' || key === 'costPrice') && item !== '' && item != null && Number.isFinite(Number(item))) return Number(item).toFixed(2);
    if (Array.isArray(item)) return item.map(row => normalize(row));
    if (item && typeof item === 'object') {
      const result = {};
      Object.keys(item).sort().forEach(field => {
        if (['soldMain', 'lockedMain', 'availableMain', 'sizeCategoryName', 'label'].includes(field)) return;
        result[field] = normalize(item[field], field);
      });
      return result;
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function integrateProductDraftExit(page) {
  Object.assign(page.data, { showExitConfirm: false, draftSaving: false });

  page.hasUnsavedDraftChanges = function() {
    return this._draftReady && !this._draftInitializing && !this._draftRestoring
      && !this._submitted && draftSnapshot(this) !== this._draftBaseline;
  };

  page._updateExitGuard = function() {
    const dirty = !this._draftExiting && this.hasUnsavedDraftChanges();
    if (dirty && !this._alertEnabled && wx.enableAlertBeforeUnload) {
      this._alertEnabled = true;
      wx.enableAlertBeforeUnload({
        message: '当前修改未保存。若要保留，请取消返回并点击“保存草稿”；继续离开将放弃本次修改。',
        fail: () => { this._alertEnabled = false; }
      });
    } else if (!dirty && this._alertEnabled) {
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      this._alertEnabled = false;
    }
  };
  page.enableExitConfirm = page._updateExitGuard;

  page.captureDraftBaseline = function() {
    this._draftBaseline = draftSnapshot(this);
    this._draftReady = true;
    this._updateExitGuard();
  };

  const originalLoad = page.onLoad;
  page.onLoad = async function(options) {
    this._draftInitializing = true;
    this._draftReady = false;
    this._draftUnloaded = false;
    this._draftExiting = false;
    const originalSetData = this.setData;
    this.setData = function(patch, callback) {
      originalSetData.call(this, patch, callback);
      if (!this._draftUnloaded) this._updateExitGuard();
    };
    try {
      await originalLoad.call(this, options);
      if (this._draftRestorePromise) await this._draftRestorePromise;
    } finally {
      this._draftInitializing = false;
      if (!this._draftUnloaded) this.captureDraftBaseline();
    }
  };

  const originalRestore = page.restoreDraft;
  page.restoreDraft = function(data) {
    this._draftRestoring = true;
    let result;
    try {
      result = originalRestore.call(this, data);
    } catch (error) {
      this._draftRestoring = false;
      throw error;
    }
    this._draftRestorePromise = Promise.resolve(result).then(() => {
      this._draftRestoring = false;
      if (!this._draftUnloaded) this.captureDraftBaseline();
    }, error => {
      this._draftRestoring = false;
      this._updateExitGuard();
      throw error;
    });
    return this._draftRestorePromise;
  };

  page.saveProductDraft = async function() {
    if (this.data.draftSaving || this._draftExiting || this._draftUnloaded) return false;
    if (this._draftInitializing || this._draftRestoring) {
      wx.showToast({ title: '正在加载商品内容，请稍后保存草稿', icon: 'none' });
      return false;
    }
    if (this._pricingSubmitting) {
      wx.showToast({ title: '正在保存商品，请稍后保存草稿', icon: 'none' });
      return false;
    }
    if (this.data.isBundleMode && this.data.activeGroupIndex >= 0) this.saveActiveGroupState();
    const snapshot = draftSnapshot(this);
    // 固定点击时的内容，上传期间的变化不能被误标记为已经保存。
    const data = JSON.parse(JSON.stringify(this.collectDraftData()));
    const options = this.getDraftType
      ? { draftType: this.getDraftType(), relatedId: this.getDraftRelatedId() }
      : { draftType: this._draftType, relatedId: this._relatedId };
    this.setData({ draftSaving: true });
    wx.showLoading({ title: '保存草稿...', mask: true });
    try {
      await draft.saveDraft(data, this.uploadFile.bind(this), options);
      this._draftBaseline = snapshot;
      this._draftReady = true;
      this._lastSavedSnapshot = JSON.stringify(data);
      this._lastDraftSavedAt = Date.now();
      if (!this._draftUnloaded) wx.showToast({ title: '草稿已保存', icon: 'success' });
      return true;
    } catch (error) {
      console.error('草稿保存失败:', error);
      if (!this._draftUnloaded) wx.showToast({ title: getErrorMessage(error, '草稿保存失败，请重试'), icon: 'none' });
      return false;
    } finally {
      wx.hideLoading();
      if (!this._draftUnloaded) this.setData({ draftSaving: false });
    }
  };

  page.requestEditorExit = function() {
    if (this.data.draftSaving || this._pricingSubmitting || this._draftExiting) return;
    if (this.hasUnsavedDraftChanges()) this.setData({ showExitConfirm: true });
    else this.leaveProductEditor();
  };
  page.goBack = page.requestEditorExit;

  page.cancelEditorExit = function() {
    if (!this.data.draftSaving) this.setData({ showExitConfirm: false });
  };
  page.discardDraftAndExit = function() {
    if (!this.data.draftSaving) this.leaveProductEditor();
  };
  page.saveDraftAndExit = async function() {
    if (!await this.saveProductDraft() || this._draftUnloaded) return;
    if (this.hasUnsavedDraftChanges()) {
      wx.showToast({ title: '保存期间内容发生变化，请再次保存后退出', icon: 'none' });
      return;
    }
    this.leaveProductEditor();
  };
  page.leaveProductEditor = function() {
    if (this._draftExiting || this._draftUnloaded) return;
    this._draftExiting = true;
    this._updateExitGuard();
    this.setData({ showExitConfirm: false });
    const fail = error => {
      this._draftExiting = false;
      this._updateExitGuard();
      console.error('退出商品编辑页面失败:', error);
      wx.showToast({ title: '退出失败，请重试', icon: 'none' });
    };
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1, fail });
    else wx.reLaunch({ url: '/pages/index/index', fail });
  };

  const originalUnload = page.onUnload;
  page.onUnload = function() {
    this._draftUnloaded = true;
    originalUnload.call(this);
  };
}

module.exports = { integrateProductDraftExit, draftSnapshot };
