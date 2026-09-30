// 输入停顿后搜索；列表正在加载时保留最新搜索，避免刷新被加载锁丢弃。
function wrap(config, options) {
  const { input, submit, field, automatic = submit, loading = ['loading', 'isLoading', 'isLoadingMore'] } = options;
  const originalSubmit = config[submit];
  const originalInput = config[input];
  const originalUnload = config.onUnload;
  const originalClear = config.clearSearch;

  function cancel(page) {
    clearTimeout(page._autoSearchTimer);
    page._autoSearchTimer = null;
  }

  function run(page, action, args = []) {
    cancel(page);
    if (page._autoSearchDisposed) return;
    if (loading.some(key => page.data[key])) {
      page._autoSearchTimer = setTimeout(() => run(page, action, args), 50);
      return;
    }
    return action.apply(page, args);
  }

  config[input] = function(e) {
    cancel(this);
    const value = e.detail.value || '';
    originalInput.call(this, e);
    this._autoSearchTimer = setTimeout(() => {
      run(this, config[automatic]);
    }, value.trim() ? 350 : 0);
    // bindinput 的返回值会替换输入框内容，不能返回请求的 Promise。
  };

  config[submit] = function(...args) {
    // false 表示分页追加，不取消待执行的输入搜索。
    if (args[0] === false) return originalSubmit.apply(this, args);
    return run(this, originalSubmit, args);
  };

  if (originalClear) {
    config.clearSearch = function(...args) {
      this.setData({ [field]: '' });
      return run(this, originalClear, args);
    };
  }

  config.onUnload = function(...args) {
    this._autoSearchDisposed = true;
    cancel(this);
    if (originalUnload) return originalUnload.apply(this, args);
  };
  return config;
}

module.exports = { wrap };
