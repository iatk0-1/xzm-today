const { getErrorMessage } = require('../../utils/error');
// miniprogram/pages/search/search.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { isProductSoldOut } = require('../../utils/stock');
const { groupStalls } = require('../../utils/productFilters');

Page({
  data: {
    currentMainTab: '上新',
    selectedStall: '',
    stallList: [],
    groupedStalls: [],
    showAllPanel: false,
    keyword: '',
    appliedKeyword: '',
    results: [],
    leftColumn: [],   // 左列商品
    rightColumn: [],  // 右列商品
    searched: false,
    recentSearches: [],
    showHistory: false,  // 控制搜索历史下拉框显示/隐藏
    focus: true,  // 搜索框获得焦点
    searchEditing: true,
    // 分页参数
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    searchType: 'all'  // 'all' 或 'keyword'
  },

  // 先恢复首页带来的档口，首次查询就应用筛选条件。
  onLoad: function(options = {}) {
    this._pageClosed = false;
    const stallId = options.stallId || '';
    this.setData({ selectedStall: stallId, currentMainTab: stallId ? '档口' : '上新', showAllPanel: false });
    return Promise.all([this.fetchAllProducts(), this.loadRecentSearches(), this.loadStallList()]);
  },

  loadStallList: async function() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      const stalls = await api.get('/stalls');
      if (!this._pageClosed) this.setData({ stallList: stalls, groupedStalls: groupStalls(stalls) });
    } catch (err) {
      console.error('加载档口列表失败:', err);
      if (!this._pageClosed) this.setData({ stallList: [], groupedStalls: [] });
    }
  },

  handleMainTabChange: function(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab !== '上新' && tab !== '档口') return;
    this.finishSearchInput();
    this.setData({ currentMainTab: tab, showAllPanel: false });
    if (tab === '上新') {
      this.setData({ selectedStall: '' });
      return this.doSearch();
    }
    return this.submitChangedKeyword();
  },

  toggleAllPanel: function() {
    this.finishSearchInput();
    this.setData({ showAllPanel: !this.data.showAllPanel });
    return this.submitChangedKeyword();
  },

  closeAllPanel: function() {
    this.setData({ showAllPanel: false });
  },

  selectStall: function(e) {
    const stallId = e.currentTarget.dataset.stall;
    this.finishSearchInput();
    this.setData({ selectedStall: stallId === 'all' ? '' : stallId,
      currentMainTab: '档口', showAllPanel: false });
    return this.doSearch();
  },

  goToCart: function() {
    this.finishSearchInput();
    this.closeAllPanel();
    wx.navigateTo({ url: '/pages/cart/cart' });
  },

  // 加载最近搜索记录
  loadRecentSearches: async function() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      const res = await api.get('/users/me/usage/searches?limit=10');
      if (!this._pageClosed) this.setData({ recentSearches: res || [] });
    } catch (err) {
      console.error('加载搜索历史失败:', err);
    }
  },

  fetchAllProducts: function(reset = true) {
    return this.queryProducts(reset !== false, '');
  },

  // 触底加载更多
  onReachBottom: function() {
    if (!this.data.loading && this.data.hasMore) {
      if (this.data.searchType === 'all') {
        this.fetchAllProducts(false);
      } else if (this.data.searchType === 'keyword') {
        this.doSearch(false);
      }
    }
  },

  // 监听键盘输入
  onInput: function(e) {
    const val = e.detail.value;
    this.setData({ keyword: val });
  },

  // 搜索框获得焦点
  onSearchFocus: function() {
    clearTimeout(this._blurTimer);
    this._searchBlurPending = false;
    this.setData({ focus: true, searchEditing: true, showHistory: true, showAllPanel: false });
  },

  // 搜索框失去焦点
  onSearchBlur: function() {
    // 等点击搜索、历史词或删除历史的事件处理完，避免重复提交。
    clearTimeout(this._blurTimer);
    this._searchBlurPending = true;
    this.setData({ focus: false });
    this._blurTimer = setTimeout(() => {
      this._searchBlurPending = false;
      this.setData({ searchEditing: false, showHistory: false });
      this.submitChangedKeyword();
    }, 200);
  },

  finishSearchInput: function() {
    clearTimeout(this._blurTimer);
    this._searchBlurPending = false;
    const wasFocused = this.data.focus;
    this.setData({ focus: false, searchEditing: false, showHistory: false });
    if (wasFocused && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
  },

  submitChangedKeyword: function() {
    const word = this.data.keyword.trim();
    const applied = this._pendingSearch ? this._pendingSearch.word : this.data.appliedKeyword;
    if (word !== applied) return this.queryProducts(true, word);
  },

  doSearch: function(reset = true) {
    clearTimeout(this._blurTimer);
    reset = reset !== false;
    if (reset) this.finishSearchInput();
    const word = reset ? this.data.keyword.trim() : this.data.appliedKeyword;
    this.setData({ showHistory: false, showAllPanel: false });
    return this.queryProducts(reset, word);
  },

  // 无关键词和关键词查询共用筛选、排序及分页，快速切换时只应用最后一次选择。
  queryProducts: async function(reset, word) {
    if (this._pageClosed) return;
    if (reset) this._queryVersion = (this._queryVersion || 0) + 1;
    if (this.data.loading) {
      if (reset) this._pendingSearch = { word };
      return;
    }
    if (reset) {
      this.setData({ page: 1, results: [], hasMore: true, searchType: word ? 'keyword' : 'all',
        searched: !!word, appliedKeyword: word, leftColumn: [], rightColumn: [] });
    }
    if (!this.data.hasMore) return;
    const version = this._queryVersion || 0;
    const { page, pageSize, selectedStall } = this.data;
    const params = { page, size: pageSize, sort: 'newest' };
    if (word) params.keyword = word;
    if (selectedStall) params.stallId = selectedStall;
    this.setData({ loading: true, loadError: '' });
    if (reset) wx.showLoading({ title: word ? '搜索中...' : '加载中...' });
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (this._pageClosed || version !== (this._queryVersion || 0)) return;
      const res = await api.get('/products/query', params);
      if (this._pageClosed || version !== (this._queryVersion || 0)) return;
      const newResults = (res.content || []).map(function(product) {
        return Object.assign({}, product, { soldOut: isProductSoldOut(product) });
      });
      const hasMore = res.hasNext !== undefined ? res.hasNext : newResults.length === pageSize;
      const allResults = reset ? newResults : [...this.data.results, ...newResults];
      const leftColumn = [];
      const rightColumn = [];
      allResults.forEach((item, index) => {
        if (index % 2 === 0) {
          leftColumn.push(item);
        } else {
          rightColumn.push(item);
        }
      });

      this.setData({
        results: allResults,
        leftColumn: leftColumn,
        rightColumn: rightColumn,
        page: page + 1,
        hasMore: hasMore
      });

      // 搜索成功后重新加载历史记录（只在首次搜索时）
      if (reset && word) {
        this.loadRecentSearches();
      }
    } catch (err) {
      if (this._pageClosed || version !== (this._queryVersion || 0)) return;
      console.error('搜索失败:', err);
      this.setData({ loadError: getErrorMessage(err, '商品列表加载失败，请稍后重试') });
      if (reset) {
        wx.showToast({ title: getErrorMessage(err, '搜索失败'), icon: 'none' });
      }
    } finally {
      if (reset) wx.hideLoading();
      if (!this._pageClosed) this.setData({ loading: false });
      await this.finishPendingSearch();
    }
  },

  retrySearch: function() {
    return this.queryProducts(!this.data.results.length, this.data.appliedKeyword);
  },

  finishPendingSearch: function() {
    if (this._pendingSearch && !this._pageClosed) {
      const pending = this._pendingSearch;
      this._pendingSearch = false;
      return this.queryProducts(true, pending.word);
    }
  },

  onUnload: function() {
    this._pageClosed = true;
    clearTimeout(this._blurTimer);
    this._pendingSearch = false;
  },

  // 点击历史搜索词
  onSearchHistoryTap: function(e) {
    const keyword = e.currentTarget.dataset.keyword;
    this.setData({
      keyword: keyword,
      showHistory: false,
      searched: true
    }, () => {
      this.doSearch();
    });
  },

  // 删除单条搜索历史
  deleteSearchHistory: async function(e) {
    clearTimeout(this._blurTimer);
    const keyword = e.currentTarget.dataset.keyword;
    try {
      await api.delete('/users/me/usage/searches', { keyword: keyword });
      this.loadRecentSearches();
    } catch (err) {
      console.error('删除搜索历史失败:', err);
    }
  },

  // 清空所有搜索历史
  clearAllSearches: async function() {
    clearTimeout(this._blurTimer);
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有搜索记录吗？',
      confirmColor: '#111111',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.delete('/users/me/usage/searches/all');
            this.setData({ recentSearches: [] });
            wx.showToast({ title: '已清空', icon: 'success' });
          } catch (err) {
            wx.showToast({ title: getErrorMessage(err, '操作失败'), icon: 'none' });
          }
        }
      }
    });
  },

  // 记住触摸开始时是否还在输入，避免失焦回调先完成导致本次点击误跳转。
  onProductTouchStart: function() {
    this._productTouchStartedWhileEditing = this.data.searchEditing || this.data.focus || this._searchBlurPending;
  },

  // 输入中点商品只结束输入；之后正常点击才进入详情。
  goToDetail: function(e) {
    const dismissSearch = this.data.searchEditing || this.data.focus || this._searchBlurPending || this._productTouchStartedWhileEditing;
    this._productTouchStartedWhileEditing = false;
    if (dismissSearch) {
      this.finishSearchInput();
      return this.submitChangedKeyword();
    }
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    });
  }
});
