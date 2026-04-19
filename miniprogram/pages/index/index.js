// miniprogram/pages/index/index.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const app = getApp();

Page({
  data: {
    // 1. 顶部大厂导航栏适配参数
    navTop: 0,
    navHeight: 0,
    totalNavHeight: 0,

    // 2. 小红书同款交互参数
    currentMainTab: '上新',
    showStall: false,
    showTag: false,
    selectedStall: '',
    selectedTag: '',
    stallList: [], // 从后端加载，初始为空
    tagList: [], // 从后端加载，初始为空

    // 3. 商品与权限参数
    isAdmin: false,
    productList: [],

    // 4. 底部 SKU (颜色/尺码) 弹窗参数
    showSku: false,
    currentProduct: null,
    uniqueColors: [],
    uniqueSizes: [],
    selectedColor: '',
    selectedSize: '',
    currentSkuPrice: null,
    currentSkuStock: null,
    currentSkuImage: null
  },

  onLoad: function() {
    this.checkAdmin();

    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    this.setData({
      navTop: menuButtonInfo.top,
      navHeight: menuButtonInfo.height,
      totalNavHeight: menuButtonInfo.bottom + 40
    });

    // 等待认证完成后加载所有数据
    this.waitForAuthAndLoad();
  },

  onShow: function() {
    // 每次显示页面时检查管理员状态
    this.checkAdmin();

    // 等待认证完成后加载商品
    if (app.globalData.isAuthReady) {
      this.checkAdmin(); // 认证完成后再次检查
      this.getProductsList();
    } else {
      this.waitForAuthAndLoad();
    }
  },

  // 等待认证完成并加载数据
  waitForAuthAndLoad: function() {
    // 检查是否已经认证完成
    if (app.globalData.isAuthReady) {
      console.log('认证已完成，直接加载数据');
      this.checkAdmin();
      this.loadAllData();
      return;
    }

    // 显示加载提示
    wx.showLoading({ title: '加载中...' });

    // 等待认证完成
    const checkAuth = () => {
      if (app.globalData.isAuthReady) {
        wx.hideLoading();
        console.log('认证完成，开始加载数据');
        this.checkAdmin();
        this.loadAllData();
      } else {
        // 最多等待 5 秒
        setTimeout(checkAuth, 500);
      }
    };

    checkAuth();

    // 超时处理
    setTimeout(() => {
      wx.hideLoading();
      if (!app.globalData.isAuthReady) {
        console.log('认证超时，使用访客模式加载数据');
        this.checkAdmin();
        this.loadAllData();
      }
    }, 5000);
  },

  // 加载所有数据（商品、档口、标签）
  loadAllData: function() {
    this.getProductsList();
    this.loadStallList();
    this.loadTagList();
  },

  // 从后端 API 获取商品列表
  getProductsList: async function() {
    wx.showLoading({ title: '加载中...' });

    try {
      // 构建查询参数
      const params = {
        status: 'on',  // 只获取上架商品
        limit: 100,
        offset: 0
      };

      // 如果选择了档口，按档口筛选（使用 stall 参数）
      if (this.data.selectedStall) {
        params.stall = this.data.selectedStall;
      }

      // 如果选择了标签，按标签筛选（使用 tag 参数）
      if (this.data.selectedTag) {
        params.tag = this.data.selectedTag;
      }

      const res = await api.get('/products/search', params);

      wx.hideLoading();
      this.setData({ productList: res || [] });
    } catch (err) {
      wx.hideLoading();
      console.error('拉取商品失败:', err);
      // 不弹窗，允许空列表显示
      this.setData({ productList: [] });
    }
  },

  // 从后端 API 获取档口列表
  loadStallList: async function() {
    try {
      const stalls = await api.get('/stalls');
      // 在档口列表前添加"全部分区"选项
      const stallListWithAll = [{ id: 'all', name: '全部' }, ...stalls];
      this.setData({ stallList: stallListWithAll });
    } catch (err) {
      console.error('加载档口列表失败:', err);
      // 失败时显示默认列表
      this.setData({
        stallList: [
          { id: 'all', name: '全部' }
        ]
      });
    }
  },

  // 从后端 API 获取标签列表
  loadTagList: async function() {
    try {
      const tags = await api.get('/tags');
      // 在标签列表前添加"全部分类"选项
      const tagListWithAll = [{ id: 'all', name: '全部' }, ...tags];
      this.setData({ tagList: tagListWithAll });
    } catch (err) {
      console.error('加载标签列表失败:', err);
      // 失败时显示默认列表
      this.setData({
        tagList: [
          { id: 'all', name: '全部' }
        ]
      });
    }
  },

  // 检查管理员（使用本地 auth 模块）
  checkAdmin: function() {
    if (auth.isAdmin()) {
      this.setData({ isAdmin: true });
    }
  },

  // 小红书灵魂交互逻辑
  handleMainTabChange(e) {
    const tabName = e.currentTarget.dataset.tab;

    if (tabName === '档口') {
      // 点击档口时，隐藏分类面板
      this.setData({
        currentMainTab: '档口',
        showStall: true,
        showTag: false
      });
    } else if (tabName === '分类') {
      // 点击分类时，隐藏档口面板
      this.setData({
        currentMainTab: '分类',
        showTag: true,
        showStall: false
      });
    } else if (tabName === '上新') {
      this.setData({
        currentMainTab: '上新',
        showStall: false,
        showTag: false,
        selectedStall: '',
        selectedTag: ''
      });
      this.getProductsList();
    }
  },

  closeStallPanel() {
    if (this.data.selectedStall) {
      this.setData({ currentMainTab: '档口', showStall: false });
    } else {
      this.setData({ currentMainTab: '上新', showStall: false });
    }
  },

  closeTagPanel() {
    if (this.data.selectedTag) {
      this.setData({ currentMainTab: '分类', showTag: false });
    } else {
      this.setData({ currentMainTab: '上新', showTag: false });
    }
  },

  selectStall(e) {
    const stallId = e.currentTarget.dataset.stall;
    const stallName = e.currentTarget.dataset.name;

    this.setData({
      selectedStall: stallId === 'all' ? '' : stallId,
      selectedStallName: stallId === 'all' ? '' : stallName,
      showStall: false,
      currentMainTab: '档口'
    });

    // 切换档口后重新加载商品（后端会自动记录用户使用历史）
    this.getProductsList();

    if (stallId === 'all') {
      wx.showToast({ title: '已显示全部', icon: 'none' });
    } else {
      wx.showToast({ title: '已切换至：' + stallName, icon: 'none' });
    }
  },

  selectTag(e) {
    const tagId = e.currentTarget.dataset.tag;
    const tagName = e.currentTarget.dataset.name;

    this.setData({
      selectedTag: tagId === 'all' ? '' : tagId,
      selectedTagName: tagId === 'all' ? '' : tagName,
      showTag: false,
      currentMainTab: '分类'
    });

    // 切换标签后重新加载商品（后端会自动记录用户使用历史）
    this.getProductsList();

    if (tagId === 'all') {
      wx.showToast({ title: '已显示全部', icon: 'none' });
    } else {
      wx.showToast({ title: '已切换至：' + tagName, icon: 'none' });
    }
  },

  // 基础跳转功能
  goToSearch: function() { wx.navigateTo({ url: '/pages/search/search' }); },
  goToCart: function() { wx.navigateTo({ url: '/pages/cart/cart' }); },
  goToDetail: function(e) { wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id }); },
  goToMarket: function() { wx.reLaunch({ url: '/pages/market/market' }); },
  goToUser: function() { wx.reLaunch({ url: '/pages/user/user' }); },
  goToIndex: function() { wx.reLaunch({ url: '/pages/index/index' }); },
  goToMessage: function() { wx.showToast({ title: '功能开发中...', icon: 'none' }); },
  goToLiveRoom: function() { wx.navigateTo({ url: '/pages/liveRoomList/index' }); },

  // 老板专属入口（与 user.js 保持一致）
  // 老板专属入口
  goToAdmin: function() {
    wx.showActionSheet({
      itemList: ['发布新商品', '商品上下架管理', '库存管理', '拣货推荐', '订单管理', '订单发货管理'],
      itemColor: '#111111',
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/admin/admin' });
        } else if (res.tapIndex === 1) {
          wx.navigateTo({ url: '/pages/adminProduct/adminProduct' });
        } else if (res.tapIndex === 2) {
          wx.navigateTo({ url: '/pages/skuInventory/skuInventory' });
        } else if (res.tapIndex === 3) {
          wx.navigateTo({ url: '/pages/pickingList/pickingList' });
        } else if (res.tapIndex === 4) {
          wx.navigateTo({ url: '/pages/adminOrderManage/adminOrderManage' });
        } else if (res.tapIndex === 5) {
          wx.navigateTo({ url: '/pages/adminOrder/adminOrder' });
        }
      }
    });
  },

  // SKU 选规格与购物车逻辑
  openSkuPanel(e) {
    const product = e.currentTarget.dataset.product;
    let colors = [];
    let sizes = [];

    if (product.skuMatrix && product.skuMatrix.length > 0) {
      // 后端返回：color (颜色), size (尺码)
      colors = [...new Set(product.skuMatrix.map(s => s.color || ''))];
      sizes = [...new Set(product.skuMatrix.map(s => s.size || ''))];
      // 过滤空值
      colors = colors.filter(c => c);
      sizes = sizes.filter(s => s);
    }

    this.setData({
      currentProduct: product,
      uniqueColors: colors,
      uniqueSizes: sizes,
      selectedColor: colors.length === 1 ? colors[0] : '',
      selectedSize: sizes.length === 1 ? sizes[0] : '',
      currentSkuPrice: null,
      currentSkuStock: null,
      currentSkuImage: product.coverUrl || product.image,
      showSku: true
    });
    this.checkSkuMatch();
  },

  closeSkuPanel() {
    this.setData({ showSku: false });
  },

  selectColor(e) {
    this.setData({ selectedColor: e.currentTarget.dataset.color });
    this.checkSkuMatch();
  },

  selectSize(e) {
    this.setData({ selectedSize: e.currentTarget.dataset.size });
    this.checkSkuMatch();
  },

  checkSkuMatch() {
    const { currentProduct, selectedColor, selectedSize } = this.data;
    if (selectedColor && selectedSize && currentProduct.skuMatrix) {
      const match = currentProduct.skuMatrix.find(s =>
        s.color === selectedColor && s.size === selectedSize
      );
      if (match) {
        // 有 SKU 信息，使用 SKU 的价格、库存和图片
        this.setData({
          currentSkuPrice: match.price,
          currentSkuStock: match.stock,
          currentSkuId: match.skuId,
          currentSkuImage: match.imageUrl || (currentProduct.coverUrl || currentProduct.image)
        });
      } else {
        // 没有匹配的 SKU 信息，库存为 0，使用商品封面图
        this.setData({
          currentSkuPrice: null,
          currentSkuStock: 0,
          currentSkuId: null,
          currentSkuImage: currentProduct.coverUrl || currentProduct.image
        });
      }
    }
  },

  confirmAddToCart(e) {
    const actionType = e.currentTarget.dataset.action;

    const { currentProduct, selectedColor, selectedSize, currentSkuPrice, currentSkuStock, currentSkuId, currentSkuImage, uniqueColors, uniqueSizes } = this.data;
    if (!currentProduct) return;

    if (uniqueColors.length > 0 && !selectedColor) {
      return wx.showToast({ title: '请选择颜色', icon: 'none' });
    }
    if (uniqueSizes.length > 0 && !selectedSize) {
      return wx.showToast({ title: '请选择尺码', icon: 'none' });
    }
    if (currentSkuStock <= 0) {
      return wx.showToast({ title: '该规格已售罄', icon: 'none' });
    }

    // 使用后端返回的 id 字段
    const productId = currentProduct.id || currentProduct._id;

    if (actionType === 'buy') {
      this.setData({ showSku: false });
      // 立即购买模式，使用本地存储传递数据
      const finalItem = {
        productId: productId,
        skuId: currentSkuId,
        name: currentProduct.name,
        image: currentProduct.coverUrl,
        coverUrl: currentSkuImage || currentProduct.coverUrl,  // 优先使用 SKU 图片
        selectedColor: selectedColor,
        selectedSize: selectedSize,
        finalPrice: currentSkuPrice,
        price: Number(currentSkuPrice || currentProduct.price || currentProduct.retailPrice || 0),
        count: 1,
        selected: true
      };
      wx.setStorageSync('checkoutItems', [finalItem]);
      wx.navigateTo({ url: '/pages/checkout/checkout' });
    } else {
      // 加入购物车模式，调用后端 API
      wx.showLoading({ title: '添加中...' });

      const cartData = {
        productId: productId,
        skuId: currentSkuId || 0,
        color: selectedColor || '默认',
        size: selectedSize || '均码',
        count: 1
      };

      api.post('/cart/items', cartData)
        .then(() => {
          wx.hideLoading();
          wx.showToast({ title: '已加入购物车', icon: 'success' });
          this.setData({ showSku: false });
        })
        .catch(err => {
          wx.hideLoading();
          console.error('添加购物车失败:', err);
          if (err.error === 'UNAUTHORIZED') {
            wx.showToast({ title: '请先登录', icon: 'none' });
          } else {
            wx.showToast({ title: '添加失败', icon: 'none' });
          }
        });
    }
  }
});
