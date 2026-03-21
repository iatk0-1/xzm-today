const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    // 动态刘海屏高度
    statusBarHeight: 20,
    navHeight: 64,

    product: {}, 
    currentTab: 0, 
    bannerImgs: [], lookbookImgs: [], detailImgs: [], currentDetailIndex: 1, 
    relatedProducts: [],

    showSku: false,
    skuAction: 'cart', // 核心状态：加购('cart') 还是 购买('buy')
    
    uniqueColors: [], uniqueSizes: [], selectedColor: '', selectedSize: '',
    currentSkuPrice: null, currentSkuStock: null,

    showVideo: false, // 控制全屏视频的开关
  },

  onLoad: function(options) {
    // 🚀 顺手修复你的黄色警告：使用最新接口获取刘海屏高度
    const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const sbHeight = sysInfo.statusBarHeight || 20;
    this.setData({ 
      statusBarHeight: sbHeight,
      navHeight: sbHeight + 44
    });

    const productId = options.id; 
    
    // 核心拦截：如果没有传 ID 进来，直接退回主页
    if (productId) {
      this.getRealDetail(productId); 
    } else {
      wx.showToast({ title: '商品数据丢失，请重试', icon: 'none', duration: 2000 });
      setTimeout(() => { wx.switchTab({ url: '/pages/index/index' }); }, 1500);
    }
  },

  getRealDetail: function(id) {
    wx.showLoading({ title: '加载中...' });
    db.collection('products').doc(id).get({
      success: (res) => {
        wx.hideLoading();
        let p = res.data;
        
        // ================= 🚀 核心排查与修复 =================
        // 彻底解决“封面被吞”和“关联错乱”的问题！
        let banners = [];
        if (p.image) { 
          banners.push(p.image); // 第一步：强制把封面图抓过来，死死按在轮播图的第 1 个位置！
        }
        if (p.bannerImgs && p.bannerImgs.length > 0) {
          banners = banners.concat(p.bannerImgs); // 第二步：把剩下的第 2、3、4 张图按顺序接在后面
        }
        // ===================================================

        let lookbooks = p.lookbookImgs || [];
        let details = p.detailImgs || [];

        let colors = [];
        let sizes = [];
        if (p.skuMatrix && p.skuMatrix.length > 0) {
          colors = [...new Set(p.skuMatrix.map(s => s.color))];
          sizes = [...new Set(p.skuMatrix.map(s => s.size))];
        }

        this.setData({ 
          product: p,
          bannerImgs: banners,      // 完美的轮播图序列：[封面, 图2, 图3...]
          lookbookImgs: lookbooks,
          detailImgs: details,
          uniqueColors: colors,
          uniqueSizes: sizes,
          selectedColor: colors.length === 1 ? colors[0] : '',
          selectedSize: sizes.length === 1 ? sizes[0] : ''
        });

        this.checkSkuMatch();
        this.fetchRelatedProducts(p); // 触发关联商品查询
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('获取详情失败:', err);
        wx.showModal({ title: '提示', content: '找不到该商品', showCancel: false });
      }
    });
  },

  // 🚀 核心修复：彻底抛弃 async/await，使用最稳妥的回调函数写法
  fetchRelatedProducts: function(product) {
    let that = this;
    
    // 定义一个内部函数：用来智能获取标签相似的商品
    let fetchSmart = function(currentRelated) {
      if (currentRelated.length < 4 && product.tags && product.tags.length > 0) {
        let excludeIds = currentRelated.map(item => item._id);
        excludeIds.push(product._id); 
        db.collection('products').where({
          tags: _.in(product.tags),
          _id: _.nin(excludeIds) 
        }).limit(4 - currentRelated.length).get({
          success: res2 => {
            that.setData({ relatedProducts: currentRelated.concat(res2.data) });
          }
        });
      } else {
        that.setData({ relatedProducts: currentRelated });
      }
    };

    // 先查询手动关联的商品
    if (product.manualRelatedIds && product.manualRelatedIds.length > 0) {
      db.collection('products').where({ _id: _.in(product.manualRelatedIds) }).get({
        success: res1 => {
          fetchSmart(res1.data); // 查完手动，再去查智能补齐
        },
        fail: err => { fetchSmart([]); }
      });
    } else {
      fetchSmart([]); // 如果没有手动关联，直接去查智能补齐
    }
  },

  // ================= 界面交互事件 =================
  goBack: function() {
    if (getCurrentPages().length === 1) { 
      wx.switchTab({ url: '/pages/index/index' }); 
    } else { 
      wx.navigateBack(); 
    }
  },
  goToCart: function() { wx.switchTab({ url: '/pages/cart/cart' }); },
  switchTab: function(e) { this.setData({ currentTab: Number(e.currentTarget.dataset.index) }); },
  onDetailSwiperChange: function(e) { this.setData({ currentDetailIndex: e.detail.current + 1 }); },
  goToRelatedDetail: function(e) {
    let id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  // ================= 弹窗与分流引擎 =================
  openSkuPanel(e) { 
    const action = e.currentTarget.dataset.action || 'cart';
    this.setData({ showSku: true, skuAction: action }); 
  },
  closeSkuPanel() { this.setData({ showSku: false }); },
  
  selectColor(e) { this.setData({ selectedColor: e.currentTarget.dataset.color }); this.checkSkuMatch(); },
  selectSize(e) { this.setData({ selectedSize: e.currentTarget.dataset.size }); this.checkSkuMatch(); },
  
  checkSkuMatch() {
    const { product, selectedColor, selectedSize } = this.data;
    if (selectedColor && selectedSize && product.skuMatrix) {
      const match = product.skuMatrix.find(s => s.color === selectedColor && s.size === selectedSize);
      if (match) { 
        this.setData({ currentSkuPrice: match.price, currentSkuStock: match.stock }); 
      } else { 
        this.setData({ currentSkuPrice: null, currentSkuStock: 0 }); 
      }
    }
  },

  confirmSkuAction() {
    const { product, selectedColor, selectedSize, currentSkuPrice, currentSkuStock, uniqueColors, uniqueSizes, skuAction } = this.data;
    
    if (uniqueColors.length > 0 && !selectedColor) return wx.showToast({ title: '请选择颜色', icon: 'none' });
    if (uniqueSizes.length > 0 && !selectedSize) return wx.showToast({ title: '请选择尺码', icon: 'none' });
    if (currentSkuStock <= 0) return wx.showToast({ title: '该规格已售罄', icon: 'none' });

    let finalItem = { 
      ...product, 
      selectedColor: selectedColor, 
      selectedSize: selectedSize,   
      finalPrice: currentSkuPrice, 
      price: Number(currentSkuPrice), // 🚀 核心修复：强行塞入一个纯数字的 price 属性，给结算页计算用！
      count: 1, 
      selected: true 
    };

    if (skuAction === 'buy') {
      this.setData({ showSku: false });
      wx.setStorageSync('checkoutItems', [finalItem]);
      wx.navigateTo({ url: '/pages/checkout/checkout' });
    } else {
      let cart = wx.getStorageSync('cart') || [];
      let existIndex = cart.findIndex(item => item._id === product._id && item.selectedColor === selectedColor && item.selectedSize === selectedSize);
      if (existIndex > -1) { 
        cart[existIndex].count += 1; 
      } else { 
        cart.push(finalItem); 
      }
      wx.setStorageSync('cart', cart);
      this.setData({ showSku: false });
      wx.showToast({ title: '已加入购物车', icon: 'success' });
    }
  },

  // ================= 视频悬浮窗控制系统 =================
  openVideoOverlay: function() {
    this.setData({ showVideo: true });
    // 弹窗打开后，通过 ID 找到大视频组件，强制播放（避免某些机型 autoplay 失效）
    setTimeout(() => {
      const videoContext = wx.createVideoContext('mainFullscreenVideo');
      videoContext.play();
    }, 100);
  },

  closeVideoOverlay: function() {
    this.setData({ showVideo: false });
    // 弹窗关闭时，暂停大视频播放，节省系统资源
    const videoContext = wx.createVideoContext('mainFullscreenVideo');
    if(videoContext) videoContext.pause();
  },

  doNothing: function() {
    // 阻止视频本体的点击事件冒泡，防止点视频时不小心触发了背景的关闭事件
  }
})