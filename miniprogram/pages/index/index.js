const ADMIN_OPENID = 'owehQ3RIu5bhzKM0HtEX7gxqU2Jw'; 

Page({

  // 1. 跳转到搜索页
  goToSearch: function() {
    wx.navigateTo({ 
      url: '/pages/search/search' 
    });
  },

  // 2. 跳转到购物车页
  goToCart: function() {
    // ⚠️ 这里有一个极其重要的分支：
    // 如果你的购物车 (cart) 是在底部那一排固定的 TabBar 里面，必须用 switchTab：
    wx.switchTab({
      url: '/pages/cart/cart',
      fail: (err) => {
        // 如果购物车不是底部 TabBar，switchTab 会失败，我们自动降级用 navigateTo
        wx.navigateTo({
          url: '/pages/cart/cart'
        });
      }
    });
  },

  data: {
    showSku: false,
    currentProduct: null,
    isAdmin: false,
    productList: [] ,// 新增：这个空盒子用来装我们从云端拉下来的真实衣服数据
    uniqueColors: [],   // 解析出来的所有颜色
    uniqueSizes: [],    // 解析出来的所有尺码
    selectedColor: '',  // 顾客当前选中的颜色
    selectedSize: '',   // 顾客当前选中的尺码
    currentSkuPrice: null, // 选中规格后的具体价格
    currentSkuStock: null, // 选中规格后的具体库存
  },

  onLoad: function() {
    this.checkAdmin();
  },

  // 重点！每次回到首页（比如上架完成后退回来），都会自动执行这个函数重新拉取数据
  onShow: function() {
    this.getProductsList();
  },

  // 去云端把所有衣服拿下来
  getProductsList: function() {
    wx.cloud.database().collection('products')
      .orderBy('createTime', 'desc') // 让最新上架的衣服排在最前面！
      .get({
        success: (res) => {
          this.setData({
            productList: res.data // 把拿到的真实数据塞进 productList 盒子里
          });
        },
        fail: (err) => {
          console.error('拉取衣服失败啦', err);
        }
      })
  },

  checkAdmin: function() {
    wx.cloud.callFunction({
      name: 'getOpenId',
      success: (res) => {
        if (res.result.openid === ADMIN_OPENID) {
          this.setData({ isAdmin: true });
        }
      }
    });
  },

  // 稍微改造一下：点击衣服时，顺便把这件衣服的专属ID带过去，方便后面详情页用
  goToDetail: function(e) {
    const productId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + productId
    })
  },

  goToAdmin: function() {
    wx.navigateTo({
      url: '/pages/admin/admin'
    })
  },

  // ====== 前面是 goToAdmin 等代码 ======

  // 核心新增：点击市集按钮的跳转逻辑
  goToMarket: function() {
    // 方案A：如果你在 app.json 里配置了 tabBar，必须用 switchTab
    wx.switchTab({
      url: '/pages/market/market',
      fail: () => {
        // 方案B（防坑保底）：如果你纯粹是自定义的底部栏，switchTab 会失败。系统会自动无缝切换用 reLaunch 跳转！
        wx.reLaunch({
          url: '/pages/market/market'
        })
      }
    })
  },

  // --- 购物车弹窗逻辑升级版 ---
  
  // 1. 打开弹窗，并瞬间拆解后台传来的 SKU 矩阵
  openSkuPanel(e) {
    const product = e.currentTarget.dataset.product;
    let colors = [];
    let sizes = [];

    // 如果这个商品有我们在后台设置的高级矩阵
    if (product.skuMatrix && product.skuMatrix.length > 0) {
      // 提取出所有不重复的颜色和尺码
      colors = [...new Set(product.skuMatrix.map(s => s.color))];
      sizes = [...new Set(product.skuMatrix.map(s => s.size))];
    }

    this.setData({
      currentProduct: product,
      uniqueColors: colors,
      uniqueSizes: sizes,
      // 如果某种规格只有一个选项，为了用户体验，系统自动帮他选中
      selectedColor: colors.length === 1 ? colors[0] : '',
      selectedSize: sizes.length === 1 ? sizes[0] : '',
      currentSkuPrice: null,
      currentSkuStock: null,
      showSku: true
    });
    
    this.checkSkuMatch(); // 检查一下自动选中后是否能匹配出价格
  },

  closeSkuPanel() {
    this.setData({ showSku: false });
  },

  // 2. 顾客点击颜色
  selectColor(e) {
    this.setData({ selectedColor: e.currentTarget.dataset.color });
    this.checkSkuMatch();
  },

  // 3. 顾客点击尺码
  selectSize(e) {
    this.setData({ selectedSize: e.currentTarget.dataset.size });
    this.checkSkuMatch();
  },

  // 4. 核心算价引擎：颜色和尺码都选了，就去矩阵里找价格和库存！
  checkSkuMatch() {
    const { currentProduct, selectedColor, selectedSize } = this.data;
    if (selectedColor && selectedSize && currentProduct.skuMatrix) {
      // 在矩阵里精确匹配这一条
      const match = currentProduct.skuMatrix.find(s => s.color === selectedColor && s.size === selectedSize);
      if (match) {
        this.setData({ currentSkuPrice: match.price, currentSkuStock: match.stock });
      } else {
        // 如果没找到（比如某个颜色没有某个尺码）
        this.setData({ currentSkuPrice: null, currentSkuStock: 0 }); 
      }
    }
  },

  // 5. 确认加购（带严格拦截机制）
  confirmAddToCart() {
    const { currentProduct, selectedColor, selectedSize, currentSkuPrice, currentSkuStock, uniqueColors, uniqueSizes } = this.data;
    if (!currentProduct) return;

    // 严密拦截：必须要选全颜色和尺码才能加购
    if (uniqueColors.length > 0 && !selectedColor) {
      return wx.showToast({ title: '请选择颜色', icon: 'none' });
    }
    if (uniqueSizes.length > 0 && !selectedSize) {
      return wx.showToast({ title: '请选择尺码', icon: 'none' });
    }
    if (currentSkuStock <= 0) {
      return wx.showToast({ title: '该规格已售罄', icon: 'none' });
    }

    // 组装带详细规格的购物车数据
    let cart = wx.getStorageSync('cart') || [];
    
    // 购物车的查重不仅要看商品ID，还要看颜色和尺码是不是一样
    let existIndex = cart.findIndex(item => 
      item._id === currentProduct._id && 
      item.selectedColor === selectedColor && 
      item.selectedSize === selectedSize
    );

    if (existIndex > -1) {
      cart[existIndex].count += 1;
    } else {
      cart.push({ 
        ...currentProduct, 
        selectedColor: selectedColor, // 把选中的颜色印在订单上
        selectedSize: selectedSize,   // 把选中的尺码印在订单上
        finalPrice: currentSkuPrice,  // 使用选中规格的具体价格
        count: 1, 
        selected: true 
      });
    }

    wx.setStorageSync('cart', cart);
    this.setData({ showSku: false });
    wx.showToast({ title: '已加入购物车', icon: 'success' });
  },

}) 

