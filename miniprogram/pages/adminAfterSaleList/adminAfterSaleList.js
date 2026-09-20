// miniprogram/pages/adminAfterSaleList/adminAfterSaleList.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

// 状态映射
const STATUS_MAP = {
  'all': null,
  'pending': 'pending',
  'approved': 'approved',
  'rejected': 'rejected',
  'received': 'received',
  'refunded': 'refunded',
  'cancelled': 'cancelled'
};

// Tab 文案到后端状态参数的映射
const TAB_STATUS_KEY_MAP = {
  '全部': 'all',
  '待审核': 'pending',
  '已同意': 'approved',
  '已拒绝': 'rejected',
  '已收货': 'received',
  '已退款': 'refunded',
  '已取消': 'cancelled'
};

// 类型映射
const TYPE_MAP = {
  'all': null,
  'refund': 'refund',
  'return_refund': 'return_refund'
};

// 状态中文显示
const STATUS_DISPLAY = {
  'pending': '待审核',
  'approved': '已同意',
  'rejected': '已拒绝',
  'received': '已收货',
  'refunded': '已退款',
  'cancelled': '已取消'
};

// 类型中文显示
const TYPE_DISPLAY = {
  'refund': '仅退款',
  'return_refund': '退货退款'
};

Page({
  data: {
    tabs: ['全部', '待审核', '已同意', '已拒绝', '已收货', '已退款', '已取消'],
    currentTab: '全部',
    currentStatus: null,
    currentType: null,
    afterSales: [],
    isLoading: false,
    page: 1,
    size: 20,
    total: 0,
    hasMore: true,
    // 统计数量
    stats: {
      pending: 0,
      approved: 0,
      rejected: 0,
      received: 0,
      refunded: 0,
      cancelled: 0
    },
    // 搜索
    searchKeyword: '',
    showSearch: false
  },

  onLoad: function(options) {
    // 从参数中选择初始 tab
    if (options.status && STATUS_MAP[options.status]) {
      const tabMap = {
        'pending': '待审核',
        'approved': '已同意',
        'rejected': '已拒绝',
        'received': '已收货',
        'refunded': '已退款',
        'cancelled': '已取消'
      };
      if (tabMap[options.status]) {
        this.setData({ currentTab: tabMap[options.status], currentStatus: STATUS_MAP[options.status] });
      }
    }
    this.loadAfterSales(true);
  },

  onPullDownRefresh: function() {
    this.loadAfterSales(true, () => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom: function() {
    if (!this.data.isLoading && this.data.hasMore) {
      this.loadAfterSales(false);
    }
  },

  // 切换 Tab
  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    const statusKey = TAB_STATUS_KEY_MAP[tab] || 'all';
    const status = STATUS_MAP[statusKey];
    
    this.setData({
      currentTab: tab,
      currentStatus: status,
      page: 1,
      hasMore: true
    }, () => {
      this.loadAfterSales(true);
    });
  },

  // 切换类型筛选
  switchType: function(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      currentType: TYPE_MAP[type],
      page: 1,
      hasMore: true
    }, () => {
      this.loadAfterSales(true);
    });
  },

  // 显示/隐藏搜索
  toggleSearch: function() {
    this.setData({
      showSearch: !this.data.showSearch,
      searchKeyword: ''
    });
  },

  // 搜索输入
  onSearchInput: function(e) {
    this.setData({ searchKeyword: e.detail.value });
  },

  // 执行搜索
  doSearch: function() {
    const searchKeyword = this.data.searchKeyword.trim();
    this.setData({
      searchKeyword,
      page: 1,
      hasMore: true
    }, () => {
      this.loadAfterSales(true);
    });
  },

  // 加载售后列表
  loadAfterSales: function(isRefresh, callback) {
    if (this.data.isLoading && !isRefresh) return;

    // 刷新从第一页开始，触底加载请求下一页，不能重复使用当前页码。
    const requestPage = isRefresh ? 1 : this.data.page + 1;

    this.setData({ isLoading: true });

    const params = {
      page: requestPage,
      size: this.data.size
    };

    if (this.data.currentStatus) {
      params.status = this.data.currentStatus;
    }

    if (this.data.currentType) {
      params.type = this.data.currentType;
    }

    if (this.data.searchKeyword) {
      params.keyword = this.data.searchKeyword;
    }

    return auth.ensureAuthenticated({ silent: true })
      .then(() => api.get('/after-sales/query', params))
      .then(res => {
        const items = res.content || res.items || [];
        const newList = isRefresh ? items : [...this.data.afterSales, ...items];
        const responsePage = Number(res.page);
        const currentPage = Number.isFinite(responsePage) && responsePage >= 1
          ? responsePage
          : requestPage;

        this.setData({
          afterSales: newList.map(item => ({
            ...item,
            statusDisplay: STATUS_DISPLAY[item.status] || item.status,
            typeDisplay: TYPE_DISPLAY[item.type] || item.type,
            itemDisplay: item.items && item.items.length > 0 
              ? `${item.items.length} 件商品` 
              : `${item.totalQty || 0} 件商品`
          })),
          total: res.totalElements !== undefined ? res.totalElements : res.total,
          page: currentPage,
          hasMore: newList.length < (res.totalElements !== undefined ? res.totalElements : res.total),
          isLoading: false
        });

        if (callback) callback();
      })
      .catch(err => {
        console.error('加载售后列表失败:', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
        this.setData({ isLoading: false });
        if (callback) callback();
      });
  },

  // 刷新列表
  refreshList: function() {
    this.loadAfterSales(true);
  },

  // 跳转到售后详情页
  goToDetail: function(e) {
    const afterSaleId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/adminAfterSaleDetail/adminAfterSaleDetail?afterSaleId=${afterSaleId}`
    });
  },

  // 复制订单号
  copyOrderNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.orderno, '订单号');
  }
});
