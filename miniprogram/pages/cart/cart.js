Page({
  data: {
    cartList: [],       
    isAllSelected: true,
    totalPrice: 0,      
    totalCount: 0       
  },

  onShow: function() {
    this.loadCartData();
  },

  loadCartData: function() {
    let cart = wx.getStorageSync('cart') || [];
    cart.forEach(item => {
      if (typeof item.selected === 'undefined') {
        item.selected = true;
      }
    });
    this.setData({ cartList: cart });
    this.calculateTotal();
  },

  // 1. 🚀 核心修复：计算总价和总件数 (采用精确 SKU 单价)
  calculateTotal: function() {
    let cart = this.data.cartList;
    let totalP = 0;
    let totalC = 0;
    let allSelected = true;

    if (cart.length === 0) allSelected = false;

    cart.forEach(item => {
      if (item.selected) {
        // 优先使用加入购物车时确定的 SKU 专属单价 finalPrice
        let currentPrice = Number(item.finalPrice || item.price || 0);
        totalP += (currentPrice * item.count);
        totalC += item.count;
      } else {
        allSelected = false;
      }
    });

    this.setData({
      totalPrice: totalP.toFixed(2), 
      totalCount: totalC,
      isAllSelected: allSelected
    });

    wx.setStorageSync('cart', cart);
  },

  // 2. 勾选/取消勾选 单件衣服
  toggleSelect: function(e) {
    const index = e.currentTarget.dataset.index;
    let cart = this.data.cartList;
    cart[index].selected = !cart[index].selected;
    this.setData({ cartList: cart });
    this.calculateTotal();
  },

  // 3. 点击底部全选按钮
  toggleAll: function() {
    let allSelected = !this.data.isAllSelected;
    let cart = this.data.cartList;
    cart.forEach(item => {
      item.selected = allSelected;
    });
    this.setData({ cartList: cart, isAllSelected: allSelected });
    this.calculateTotal();
  },

  // 4. 增加或减少衣服数量
  changeCount: function(e) {
    const index = e.currentTarget.dataset.index;
    const type = e.currentTarget.dataset.type; 
    let cart = this.data.cartList;

    if (type === 'add') {
      cart[index].count += 1;
    } else if (type === 'minus') {
      if (cart[index].count > 1) {
        cart[index].count -= 1;
      } else {
        wx.showModal({
          title: '提示',
          content: '确定要将这件商品移出购物车吗？',
          confirmColor: '#111111',
          success: (res) => {
            if (res.confirm) {
              cart.splice(index, 1); 
              this.setData({ cartList: cart });
              this.calculateTotal();
            }
          }
        });
        return; 
      }
    }
    this.setData({ cartList: cart });
    this.calculateTotal();
  },

  // 5. 点击结算按钮
  goToCheckout: function() {
    if (this.data.totalCount === 0) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }
    let selectedItems = this.data.cartList.filter(item => item.selected);
    wx.setStorageSync('checkoutItems', selectedItems);
    
    wx.navigateTo({
      url: '/pages/checkout/checkout'
    });
  }
})