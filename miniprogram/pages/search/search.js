const db = wx.cloud.database();

Page({
  data: {
    keyword: '',    // 用户输入的词
    results: [],    // 搜出来的商品
    searched: false // 是否已经点过搜索了
  },

  // 🚀 核心升级 1：页面刚打开时，自动去拉取所有商品，告别白屏！
  onLoad: function() {
    this.fetchAllProducts();
  },

  // 专门用来拉取全部商品的方法
  fetchAllProducts: function() {
    wx.showLoading({ title: '加载中...' });
    // 按创建时间倒序排列（新上架的排在最前面）
    db.collection('products').orderBy('createTime', 'desc').get({
      success: res => {
        wx.hideLoading();
        this.setData({ 
          results: res.data,
          searched: false // 此时不算做“搜索失败”，所以不显示空提示
        });
      },
      fail: err => {
        wx.hideLoading();
        console.error('获取全部商品失败：', err);
      }
    });
  },

  // 1. 监听键盘输入
  onInput: function(e) {
    const val = e.detail.value;
    this.setData({ keyword: val });
    
    // 🚀 核心升级 2：如果用户把搜索框里的字全删了，自动恢复显示所有商品
    if (!val.trim()) {
      this.fetchAllProducts();
    }
  },

  // 2. 点击搜索按钮或键盘回车
  doSearch: function() {
    const word = this.data.keyword.trim();
    if (!word) {
      wx.showToast({ title: '请输入关键词', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '全网搜索中...' });
    this.setData({ searched: true });

    // 去 products 集合里模糊匹配商品标题
    db.collection('products').where({
      title: db.RegExp({
        regexp: word,
        options: 'i', // 忽略大小写
      })
    }).get({
      success: res => {
        wx.hideLoading();
        this.setData({ results: res.data });
      },
      fail: err => {
        wx.hideLoading();
        wx.showToast({ title: '搜索失败，请重试', icon: 'none' });
        console.error('搜索报错：', err);
      }
    });
  },

  // 3. 点击商品跳转到详情页
  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    });
  }
})