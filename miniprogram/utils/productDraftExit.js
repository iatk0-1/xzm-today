const { getErrorMessage } = require('./error');
const draft = require('./draft');
const auth = require('./auth');

function contextOptions(options, live) {
  if (live) return { draftType: options.productId ? 'live_edit' : 'live_create',
    relatedId: options.productId || null, sessionId: options.sessionId || null };
  return { draftType: options.editId ? 'edit' : options.convertFromLiveProductId ? 'convert' : 'create',
    relatedId: options.editId || options.convertFromLiveProductId || null,
    sessionId: options.convertFromLiveProductId ? options.sessionId || null : null };
}

// 只替换保存期间没有被用户再次修改的媒体路径，不能整份旧表单覆盖新输入。
function replaceUploaded(value, cache) {
  if (typeof value === 'string' && cache.has(value)) return cache.get(value);
  if (Array.isArray(value)) return value.map(item => replaceUploaded(item, cache));
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).forEach(key => { result[key] = replaceUploaded(value[key], cache); });
    return result;
  }
  return value;
}

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
  Object.assign(page.data, { showExitConfirm: false, draftSaving: false, draftCount: 0,
    draftSavedText: '', draftProblem: '', draftWarnings: [], draftConflict: false });

  // 由初始化统一按类型、来源或指定ID恢复，停用旧的“最近一份草稿”探测。
  page.checkDraft = function() {};
  page.clearDraft = function() {};

  page.bindDraftRecord = function(record) {
    this._draftId = record.id;
    this._draftVersion = record.version;
    this._clientDraftKey = record.clientDraftKey || this._clientDraftKey;
    this.setData({ draftSavedText: '已保存 ' + draft.formatTime(record.savedAt),
      draftWarnings: record.warnings || [] });
  };

  page.refreshDraftCount = async function() {
    try {
      const value = await draft.summary();
      if (!this._draftUnloaded) this.setData({ draftCount: Number(value.total) });
    } catch (error) {
      console.warn('加载草稿数量失败:', error);
    }
  };

  page.openDraftBox = function() {
    if (this.data.draftSaving || this._pricingSubmitting) return;
    this._draftExitTarget = '/pages/productDrafts/index';
    this.requestEditorExit();
  };

  page.handleDraftError = function(error) {
    const code = error && error.code;
    if (['DRAFT_VERSION_CONFLICT', 'PRODUCT_CHANGED', 'STOCK_CHANGED', 'DRAFT_ALREADY_EXISTS', 'DRAFT_COMPLETED'].includes(code)) {
      this.setData({ draftConflict: true, draftProblem: getErrorMessage(error, '草稿内容有变化，请核对后继续') });
    }
    if (code === 'CLIENT_UPGRADE_REQUIRED' && wx.getUpdateManager) {
      const manager = wx.getUpdateManager();
      manager.onUpdateReady(() => wx.showModal({ title: '更新小程序', content: '新版已准备好，更新后即可继续编辑。',
        success: res => { if (res.confirm) manager.applyUpdate(); } }));
    }
  };

  page.reloadDraftSource = function() {
    if (this.data.draftSaving || this._pricingSubmitting) return;
    wx.showModal({ title: '核对最新内容',
      content: '重新打开后载入最新商品或草稿。本次未保存输入会暂存在当前页面，返回本页仍可查看；已保存草稿会保留。',
      confirmText: '打开最新', success: res => {
        if (!res.confirm) return;
        const query = this._completedProductId ? (this.getDraftType
          ? 'productId=' + encodeURIComponent(this._completedProductId) + '&sessionId=' + encodeURIComponent(this._draftContextOptions.sessionId)
          : 'editId=' + encodeURIComponent(this._completedProductId))
          : this._draftId ? 'draftId=' + encodeURIComponent(this._draftId) : Object.keys(this._draftEditorOptions || {})
          .filter(key => key !== 'draftId').map(key => key + '=' + encodeURIComponent(this._draftEditorOptions[key])).join('&');
        const route = this.getDraftType ? '/pages/liveRoomPublish/publish' : '/pages/admin/admin';
        wx.navigateTo({ url: route + '?' + query });
      } });
  };

  page.useLatestProduct = async function() {
    if (this.data.draftSaving || this._pricingSubmitting || !this._draftContextOptions.relatedId
      || !['edit', 'live_edit'].includes(this._draftContextOptions.draftType)) return;
    wx.showModal({ title: '使用当前商品内容', content: '本次未保存输入会放弃，原草稿保留。请先核对商品内容，再重新应用需要的修改。',
      confirmText: '重新载入', success: async res => {
        if (!res.confirm) return;
        this._draftRestoring = true;
        try {
          const context = await draft.context(this._draftContextOptions);
          this._draftContextToken = context.token;
          this.setData({ isBundleMode: false, bundleGroups: [], activeGroupIndex: -1 });
          await this.loadProductForEdit(this._draftContextOptions.relatedId);
          if (this._productLoadFailed) throw new Error('商品内容加载失败，请重试；原草稿仍保留');
          this._pendingDraftSave = null; this._pendingProductSubmission = null;
          this.setData({ draftProblem: '', draftConflict: false, draftWarnings: [] });
          this.captureDraftBaseline();
        } catch (error) {
          this.setData({ draftProblem: getErrorMessage(error, '重新载入商品失败') });
        } finally { this._draftRestoring = false; this._updateExitGuard(); }
      } });
  };

  page.submitDraftProduct = async function(productData) {
    if (this._lastProductResult) return this._lastProductResult;
    if (this._draftInitializing || this._draftRestoring) throw new Error('正在加载商品内容，请稍后保存商品');
    if (this._pendingDraftSave) throw new Error('上次草稿保存结果尚未确认，请先再次保存草稿后发布');
    if (!this._draftContextToken || this.data.draftProblem) throw new Error(this.data.draftProblem || '商品资料未加载完成，请重新打开页面');
    const body = { ...this._draftContextOptions, contextToken: this._draftContextToken,
      sourceDraftId: this._draftId || null, sourceDraftVersion: this._draftId ? this._draftVersion : null, productData };
    const signature = JSON.stringify(body);
    if (this._pendingProductSubmission && this._pendingProductSubmission.signature !== signature) {
      // 超时后的前一请求可能已经提交，必须先找回结果，不能换键再创建一件。
      try {
        const previous = await draft.submit(this._pendingProductSubmission.body);
        this._pendingProductSubmission = null;
        this._completedProductId = (previous.product || previous).id;
        const error = { code: 'PREVIOUS_SUBMISSION_COMPLETED', statusCode: 409,
          message: '上次提交已成功，本页后续修改尚未保存。请打开最新商品继续核对修改。' };
        this.setData({ draftConflict: true, draftProblem: error.message });
        throw error;
      } catch (error) {
        if (error.statusCode >= 400 && error.statusCode < 500) this._pendingProductSubmission = null;
        this.handleDraftError(error); throw error;
      }
    }
    if (!this._pendingProductSubmission) this._pendingProductSubmission = {
      signature, body: { ...body, requestKey: draft.createKey() }
    };
    try {
      const result = await draft.submit(this._pendingProductSubmission.body);
      this._pendingProductSubmission = null;
      this._lastProductResult = result;
      return result;
    } catch (error) {
      if (error.statusCode >= 400 && error.statusCode < 500) this._pendingProductSubmission = null;
      this.handleDraftError(error); throw error;
    }
  };

  page.hasUnsavedDraftChanges = function() {
    return this._draftReady && !this._draftInitializing && !this._draftRestoring
      && !this._submitted && draftSnapshot(this) !== this._draftBaseline;
  };

  page._updateExitGuard = function() {
    const dirty = !this._draftExiting && this.hasUnsavedDraftChanges();
    if (this.data.draftDirty !== !!dirty && !this._draftUnloaded) this.setData({ draftDirty: !!dirty });
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
    this._draftExitTarget = '';
    this._clientDraftKey = draft.createKey();
    this._draftMediaCache = new Map();
    const originalSetData = this.setData;
    this.setData = function(patch, callback) {
      originalSetData.call(this, patch, callback);
      if (!this._draftUnloaded) this._updateExitGuard();
    };
    try {
      options = options || {};
      await auth.ensureAuthenticated({ silent: true });
      let record = null;
      if (options.draftId) {
        record = await draft.loadDraft(options.draftId);
        options = draft.editorOptions(record);
      }
      this._draftEditorOptions = options;
      this._draftContextOptions = contextOptions(options, !!this.getDraftType);
      if (record) {
        this.bindDraftRecord(record);
        this._draftContextToken = record.contextToken;
        if (record.capabilities && !record.capabilities.edit) this.setData({ draftProblem: (record.warnings || []).join('；') || '该草稿暂不能编辑' });
        if (!record.contextToken && ['edit', 'live_edit'].includes(record.draftType)) {
          this.setData({ draftProblem: '历史草稿需先载入当前商品核对，再重新应用修改', draftConflict: true });
        } else if (!record.contextToken && !(record.capabilities && !record.capabilities.edit)) {
          const context = await draft.context(this._draftContextOptions);
          this._draftContextToken = context.token;
        }
      } else {
        const context = await draft.context(this._draftContextOptions);
        this._draftContextToken = context.token;
        this._draftContextOptions.sessionId = context.sessionId || this._draftContextOptions.sessionId;
      }
      await originalLoad.call(this, options);
      if (this._productLoadFailed && !record) throw new Error('商品内容加载失败，请重新打开页面；原草稿仍保留');
      this._initialDraftSnapshot = draftSnapshot(this);
      if (record) await this.restoreDraft(record.draftData);
      else if (this._draftContextOptions.relatedId) {
        const result = await draft.list({ ...this._draftContextOptions, size: 1 });
        const existing = (result.content || []).find(item => !item.capabilities || item.capabilities.edit);
        if (existing) {
          const saved = await draft.loadDraft(existing.id);
          this.bindDraftRecord(saved);
          wx.showModal({ title: '该商品有未完成草稿', content: '保存时间：' + draft.formatTime(saved.savedAt) + '。可以继续草稿，或使用当前商品内容。',
            confirmText: '继续草稿', cancelText: '当前商品', success: async res => {
              if (!res.confirm || this._draftUnloaded) return;
              this._draftContextToken = saved.contextToken;
              if (!saved.contextToken) this.setData({ draftProblem: '历史草稿需先载入当前商品核对，再重新应用修改', draftConflict: true });
              await this.restoreDraft(saved.draftData);
            } });
        }
      }
      if (this._draftRestorePromise) await this._draftRestorePromise;
      this.refreshDraftCount();
    } catch (error) {
      console.error('初始化商品草稿失败:', error);
      this.setData({ draftProblem: getErrorMessage(error, '加载商品草稿失败，请重新打开页面') });
      this.handleDraftError(error);
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
    if (this._pendingProductSubmission) {
      wx.showToast({ title: '上次商品提交结果尚未确认，请先重试保存商品', icon: 'none' });
      return false;
    }
    if (!this._draftContextToken || this.data.draftProblem) {
      wx.showToast({ title: this.data.draftProblem || '商品资料未加载完成，请重新打开页面', icon: 'none' });
      return false;
    }
    if (this.data.isBundleMode && this.data.activeGroupIndex >= 0) this.saveActiveGroupState();
    const snapshot = draftSnapshot(this);
    // 固定点击时的内容，上传期间的变化不能被误标记为已经保存。
    const data = JSON.parse(JSON.stringify(this.collectDraftData()));
    if (!this._draftId && snapshot === this._initialDraftSnapshot && !this._draftContextOptions.relatedId) {
      wx.showToast({ title: '请先填写商品内容', icon: 'none' }); return false;
    }
    this.setData({ draftSaving: true });
    wx.showLoading({ title: '保存草稿...', mask: true });
    try {
      let record;
      const persist = async pending => {
        const result = await draft.saveDraft(pending.data, this.uploadFile.bind(this), pending.options);
        this.bindDraftRecord(result); this._pendingDraftSave = null; return result;
      };
      const pendingInput = this._pendingDraftSave && JSON.stringify(this._pendingDraftSave.data);
      if (this._pendingDraftSave) record = await persist(this._pendingDraftSave);
      if (!record || pendingInput !== JSON.stringify(data)) {
        this._pendingDraftSave = { data, options: { ...this._draftContextOptions,
          id: this._draftId, version: this._draftVersion, clientDraftKey: this._clientDraftKey,
          contextToken: this._draftContextToken, requestKey: draft.createKey(), mediaCache: this._draftMediaCache } };
        record = await persist(this._pendingDraftSave);
      }
      this._lastPersistedInput = JSON.stringify(data);
      const urls = new Map();
      for (const [local, promise] of this._draftMediaCache) urls.set(local, await promise);
      const patch = {};
      Object.keys(data).forEach(key => { if (key in this.data) patch[key] = replaceUploaded(this.data[key], urls); });
      this.setData(patch);
      this._draftBaseline = draftSnapshot({ collectDraftData: () => replaceUploaded(data, urls) });
      this._draftReady = true;
      this._lastSavedSnapshot = JSON.stringify(data);
      this._lastDraftSavedAt = Date.now();
      this.refreshDraftCount();
      if (!this._draftUnloaded) wx.showToast({ title: '草稿已保存', icon: 'success' });
      return true;
    } catch (error) {
      console.error('草稿保存失败:', error);
      if (error.statusCode >= 400 && error.statusCode < 500) this._pendingDraftSave = null;
      this.handleDraftError(error);
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
    if (!this.data.draftSaving) { this._draftExitTarget = ''; this.setData({ showExitConfirm: false }); }
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
    if (this._draftExitTarget) wx.redirectTo({ url: this._draftExitTarget, fail });
    else if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1, fail });
    else wx.reLaunch({ url: '/pages/index/index', fail });
  };

  const originalUnload = page.onUnload;
  page.onUnload = function() {
    this._draftUnloaded = true;
    originalUnload.call(this);
  };
}

module.exports = { integrateProductDraftExit, draftSnapshot };
