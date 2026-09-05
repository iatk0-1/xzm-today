// miniprogram/pages/adminProductRecycleBin/adminProductRecycleBin.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    products: [],
    isLoading: true,
    offset: 0,
    limit: 20,
    hasMore: true,
    searchKeyword: '',

    // 筛选相关
    filterBarHeight: 100, // 筛选栏高度（用于面板定位）
    showStallPanel: false,
    showTagPanel: false,
    selectedStall: '',
    selectedStallName: '',
    selectedTag: '',
    selectedTagName: '',
    hasFilter: false,
    stallList: [],
    tagList: []
  },

  onShow: function() {
    this.resetAndLoad();
  },

  onLoad: function() {
    // 获取系统信息，计算筛选栏高度
    const systemInfo = wx.getSystemInfoSync();
    const windowWidth = systemInfo.windowWidth;
    // 筛选栏高度约为 80rpx，转换为 px
    this.setData({
      filterBarHeight: Math.floor(80 * windowWidth / 750)
    });
  },

  // 重置并加载
  resetAndLoad: function() {
    this.setData({
      products: [],
      offset: 0,
      hasMore: true
    }, () => {
      this.loadProducts();
      this.loadStallList();
      this.loadTagList();
    });
  },

  // 加载档口列表
  loadStallList: async function() {
    try {
      const stalls = await api.get('/stalls');
      // 在档口列表前添加"全部"选项
      const stallListWithAll = [{ id: 'all', name: '全部' }, ...stalls];
      this.setData({ stallList: stallListWithAll });
    } catch (err) {
      console.error('加载档口列表失败:', err);
      this.setData({
        stallList: [{ id: 'all', name: '全部' }]
      });
    }
  },

  // 加载标签列表
  loadTagList: async function() {
    try {
      const tags = await api.get('/tags');
      // 在标签列表前添加"全部"选项
      const tagListWithAll = [{ id: 'all', name: '全部' }, ...tags];
      this.setData({ tagList: tagListWithAll });
    } catch (err) {
      console.error('加载标签列表失败:', err);
      this.setData({
        tagList: [{ id: 'all', name: '全部' }]
      });
    }
  },

  // 加载商品列表
  loadProducts: async function(isLoadMore = false) {
    if (!this.data.hasMore && isLoadMore) {
      return;
    }

    if (!isLoadMore) {
      this.setData({ isLoading: true });
    }

    const { offset, limit, searchKeyword, selectedStall, selectedTag } = this.data;

    try {
      await auth.ensureAuthenticated({ silent: true });
      const params = {
        limit: limit,
        offset: offset
      };

      if (searchKeyword) {
        params.keyword = searchKeyword;
      }
      if (selectedStall && selectedStall !== 'all') {
        params.stall = selectedStall;
      }
      if (selectedTag && selectedTag !== 'all') {
        params.tag = selectedTag;
      }

      const res = await api.get('/products/deleted', params);

      let list = res.map(item => {
        if (item.createdAt) {
          const date = new Date(item.createdAt);
          item.deleteTimeStr = `${date.getMonth()+1}-${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        }
        return item;
      });

      this.setData({
        products: isLoadMore ? [...this.data.products, ...list] : list,
        isLoading: false,
        offset: offset + list.length,
        hasMore: list.length === limit
      });
    } catch (err) {
      console.error('加载回收站失败:', err);
      this.setData({ isLoading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 加载更多
  loadMore: function() {
    if (this.data.hasMore && !this.data.isLoading) {
      this.loadProducts(true);
    }
  },

  // 搜索输入
  onSearchInput: function(e) {
    this.setData({
      searchKeyword: e.detail.value
    });
  },

  // 搜索确认
  onSearchConfirm: function() {
    this.resetAndLoad();
  },

  // 清除搜索
  clearSearch: function() {
    this.setData({
      searchKeyword: ''
    }, () => {
      this.resetAndLoad();
    });
  },

  // 切换筛选面板（档口/标签）
  handleFilterTabChange: function(e) {
    const tab = e.currentTarget.dataset.tab;

    if (tab === 'stall') {
      this.setData({
        showStallPanel: true,
        showTagPanel: false
      });
    } else if (tab === 'tag') {
      this.setData({
        showTagPanel: true,
        showStallPanel: false
      });
    }
  },

  // 关闭档口面板
  closeStallPanel: function() {
    if (this.data.selectedStall) {
      this.setData({ showStallPanel: false });
    } else {
      this.setData({
        showStallPanel: false,
        currentMainTab: '上新'
      });
    }
  },

  // 关闭标签面板
  closeTagPanel: function() {
    if (this.data.selectedTag) {
      this.setData({ showTagPanel: false });
    } else {
      this.setData({
        showTagPanel: false,
        currentMainTab: '上新'
      });
    }
  },

  // 选择档口
  selectStall: function(e) {
    const stallId = e.currentTarget.dataset.stall;
    const stallName = e.currentTarget.dataset.name;

    this.setData({
      selectedStall: stallId === 'all' ? '' : stallId,
      selectedStallName: stallId === 'all' ? '' : stallName,
      showStallPanel: false,
      hasFilter: (stallId !== 'all' && stallId !== '') || this.data.selectedTag
    });

    // 切换档口后重新加载商品
    this.resetAndLoad();

    if (stallId === 'all') {
      wx.showToast({ title: '已显示全部', icon: 'none' });
    } else {
      wx.showToast({ title: '已切换至：' + stallName, icon: 'none' });
    }
  },

  // 选择标签
  selectTag: function(e) {
    const tagId = e.currentTarget.dataset.tag;
    const tagName = e.currentTarget.dataset.name;

    this.setData({
      selectedTag: tagId === 'all' ? '' : tagId,
      selectedTagName: tagId === 'all' ? '' : tagName,
      showTagPanel: false,
      hasFilter: (tagId !== 'all' && tagId !== '') || this.data.selectedStall
    });

    // 切换标签后重新加载商品
    this.resetAndLoad();

    if (tagId === 'all') {
      wx.showToast({ title: '已显示全部', icon: 'none' });
    } else {
      wx.showToast({ title: '已切换至：' + tagName, icon: 'none' });
    }
  },

  // 重置筛选
  resetFilter: function() {
    this.setData({
      selectedStall: '',
      selectedStallName: '',
      selectedTag: '',
      selectedTagName: '',
      hasFilter: false,
      showStallPanel: false,
      showTagPanel: false
    }, () => {
      this.resetAndLoad();
    });
  },

  // 查看商品详情
  viewProductDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin/admin?editId=${id}`
    });
  },

  // 恢复商品
  restoreProduct: async function(e) {
    const id = e.currentTarget.dataset.id;

    wx.showModal({
      title: '确认恢复',
      content: '确定要恢复这件商品吗？商品和关联的 SKU 都将被恢复到删除前的状态。',
      confirmColor: '#1890ff',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '恢复中...' });
          try {
            await api.post(`/products/deleted/${id}/restore`, {});
            wx.hideLoading();
            wx.showToast({ title: '恢复成功', icon: 'success' });

            // 从列表中移除该商品
            const products = this.data.products.filter(p => p.id !== id);
            this.setData({ products });

            if (products.length === 0) {
              this.resetAndLoad();
            }
          } catch (err) {
            console.error('恢复失败:', err);
            wx.hideLoading();
            wx.showToast({ title: '恢复失败', icon: 'none' });
          }
        }
      }
    });
  }
});
