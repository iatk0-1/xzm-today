// miniprogram/pages/search/search.js
const api = require('../../utils/api');

Page({
  data: {
    keyword: '',
    results: [],
    leftColumn: [],   // 左列商品
    rightColumn: [],  // 右列商品
    searched: false,
    recentSearches: [],
    showHistory: false,  // 控制搜索历史下拉框显示/隐藏
    focus: true,  // 搜索框获得焦点
    // 分页参数
    page: 0,
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
      const res = await api.get('/users/me/usage/searches?limit=10');
      this.setData({ recentSearches: res || [] });
    } catch (err) {
      console.error('加载搜索历史失败:', err);
    }
  },

  // 改造：从后端 API 获取全部商品（支持分页）
  fetchAllProducts: async function(reset = true) {
    if (reset) {
      this.setData({ page: 0, results: [], hasMore: true, searchType: 'all' });
    }

    if (!this.data.hasMore || this.data.loading) return;

    this.setData({ loading: true });
    wx.showLoading({ title: '加载中...' });

    try {
      const { page, pageSize } = this.data;
      const res = await api.get('/products/search', {
        page: page,
        size: pageSize
      });

      const newResults = res.content || [];
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

    // 如果用户把搜索框里的字全删了，自动恢复显示所有商品
    if (!val.trim()) {
      this.fetchAllProducts();
    }
  },

  // 搜索框获得焦点
  onSearchFocus: function() {
    this.setData({ showHistory: true });
  },

  // 搜索框失去焦点
  onSearchBlur: function() {
    // 延迟隐藏，给点击事件留出时间
    setTimeout(() => {
      this.setData({ showHistory: false });
    }, 200);
  },

  // 改造：搜索商品（支持分页）
  doSearch: async function(reset = true) {
    const word = this.data.keyword.trim();
    if (!word && reset) {
      wx.showToast({ title: '请输入关键词', icon: 'none' });
      return;
    }

    if (reset) {
      this.setData({ page: 0, results: [], hasMore: true, searchType: 'keyword', searched: true });
    }

    if (!this.data.hasMore || this.data.loading) return;

    if (reset) {
      wx.showLoading({ title: '全网搜索中...' });
    }

    try {
      const { page, pageSize } = this.data;
      const res = await api.get('/products/search', {
        keyword: word,
        page: page,
        size: pageSize
      });

      const newResults = res.content || [];
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
    }
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
