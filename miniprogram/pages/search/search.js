// miniprogram/pages/search/search.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const { isProductSoldOut } = require('../../utils/stock');

Page({
  data: {
    keyword: '',
    appliedKeyword: '',
    results: [],
    leftColumn: [],   // 左列商品
    rightColumn: [],  // 右列商品
    searched: false,
    recentSearches: [],
    showHistory: false,  // 控制搜索历史下拉框显示/隐藏
    focus: true,  // 搜索框获得焦点
    // 分页参数
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    searchType: 'all'  // 'all' 或 'keyword'
  },

  // 页面刚打开时，自动去拉取所有商品
  onLoad: function() {
    this.fetchAllProducts();
    this.loadRecentSearches();
  },

  // 加载最近搜索记录
  loadRecentSearches: async function() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      const res = await api.get('/users/me/usage/searches?limit=10');
      this.setData({ recentSearches: res || [] });
    } catch (err) {
      console.error('加载搜索历史失败:', err);
    }
  },

  // 改造：从后端 API 获取全部商品（支持分页）
  fetchAllProducts: async function(reset = true) {
    if (this.data.loading) {
      if (reset) this._pendingSearch = true;
      return;
    }
    if (reset) {
      this.setData({ page: 1, results: [], hasMore: true, searchType: 'all', appliedKeyword: '', leftColumn: [], rightColumn: [] });
    }

    if (!this.data.hasMore || this.data.loading) return;

    this.setData({ loading: true });
    wx.showLoading({ title: '加载中...' });

    try {
      await auth.ensureAuthenticated({ silent: true });
      const { page, pageSize } = this.data;
      const res = await api.get('/products/query', {
        page: page,
        size: pageSize
      });

      const newResults = (res.content || []).map(function(product) {
        return Object.assign({}, product, { soldOut: isProductSoldOut(product) });
      });
      const hasMore = res.hasNext !== undefined ? res.hasNext : newResults.length === pageSize;

      wx.hideLoading();
      
      const allResults = reset ? newResults : [...this.data.results, ...newResults];
      
      // 将商品分配到左右两列（奇数位置放左列，偶数位置放右列）
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
        page: this.data.page + 1,
        hasMore: hasMore,
        searched: false,
        loading: false
      });
    } catch (err) {
      wx.hideLoading();
      console.error('获取商品失败:', err);
      this.setData({ loading: false });
    } finally {
      this.finishPendingSearch();
    }
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
    this.setData({ showHistory: true });
  },

  // 搜索框失去焦点
  onSearchBlur: function() {
    // 等点击搜索、历史词或删除历史的事件处理完，避免重复提交。
    clearTimeout(this._blurTimer);
    this._blurTimer = setTimeout(() => {
      this.setData({ showHistory: false });
      if (this.data.keyword.trim() !== this.data.appliedKeyword) this.doSearch();
    }, 200);
  },

  // 改造：搜索商品（支持分页）
  doSearch: async function(reset = true) {
    clearTimeout(this._blurTimer);
    reset = reset !== false;
    if (this.data.loading) {
      if (reset) this._pendingSearch = true;
      return;
    }
    const word = reset ? this.data.keyword.trim() : this.data.appliedKeyword;
    if (!word && reset) {
      return this.fetchAllProducts();
    }

    if (reset) {
      this.setData({ page: 1, results: [], hasMore: true, searchType: 'keyword', searched: true, appliedKeyword: word, leftColumn: [], rightColumn: [] });
    }

    if (!this.data.hasMore || this.data.loading) return;

    if (reset) {
      wx.showLoading({ title: '全网搜索中...' });
    }

    this.setData({ loading: true, showHistory: false });

    try {
      const { page, pageSize } = this.data;
      const res = await api.get('/products/query', {
        keyword: word,
        page: page,
        size: pageSize
      });

      const newResults = (res.content || []).map(function(product) {
        return Object.assign({}, product, { soldOut: isProductSoldOut(product) });
      });
      const hasMore = res.hasNext !== undefined ? res.hasNext : newResults.length === pageSize;

      if (reset) {
        wx.hideLoading();
      }

      const allResults = reset ? newResults : [...this.data.results, ...newResults];
      
      // 将商品分配到左右两列
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
        page: this.data.page + 1,
        hasMore: hasMore,
        loading: false
      });

      // 搜索成功后重新加载历史记录（只在首次搜索时）
      if (reset) {
        this.loadRecentSearches();
      }
    } catch (err) {
      if (reset) {
        wx.hideLoading();
      }
      console.error('搜索失败:', err);
      this.setData({ loading: false });
      if (reset) {
        wx.showToast({ title: '搜索失败', icon: 'none' });
      }
    } finally {
      this.finishPendingSearch();
    }
  },

  finishPendingSearch: function() {
    if (this._pendingSearch && !this._pageClosed) {
      this._pendingSearch = false;
      this.doSearch();
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
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 跳转到商品详情页
  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    });
  }
});
