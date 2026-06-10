// miniprogram/pages/cart/cart.js
const api = require('../../utils/api');

Page({
  data: {
    cartList: [],
    isAllSelected: true,
    totalPrice: 0,
    totalCount: 0,
    currentSlideIndex: -1,  // 当前滑出的项索引
    slideOut: 0,  // 当前滑出的距离
    touchStartX: 0,  // 触摸开始 X 坐标
    MAX_SLIDE_OUT: 80  // 最大滑出距离（删除按钮宽度）
  },

  onShow: function() {
    this.loadCartData();
  },

  // 从后端加载购物车数据
  loadCartData: async function() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await api.get('/cart');
      wx.hideLoading();

      // 后端返回：{ items: [...], totalCount, totalPrice, selectedCount }
      const cartItems = res.items || [];

      // 转换后端数据格式到前端格式，并处理库存和有效性状态
      const cartList = cartItems.map(item => {
        // 根据状态字段设置禁用标志
        const isOutOfStock = item.stockStatus === 'out_of_stock';
        const isInvalid = item.validityStatus === 'invalid' || item.validityStatus === 'changed';
        const isProductOff = item.productStatus === 'off';  // 商品已下架
        const isRemoved = item.validityStatus === 'removed';  // SKU 已被移除
        const isDisabled = isOutOfStock || isInvalid || isProductOff || isRemoved;

        // 套装商品总价 = 各子项价格 × 数量 之和
        var bundleConfig = item.bundleConfig || null;
        var itemPrice = Number(item.price);
        if (bundleConfig && bundleConfig.length > 0) {
          itemPrice = bundleConfig.reduce(function(sum, b) {
            return sum + (Number(b.price) || 0) * (b.count || 1);
          }, 0);
        }

        return {
          id: item.id,
          productId: item.productId,
          skuId: item.skuId,
          name: item.productName,
          image: item.productImage,
          coverUrl: item.skuImageUrl || item.productImage,  // 优先使用 SKU 图片
          selectedColor: item.color || '默认',
          selectedSize: item.size || '均码',
          price: itemPrice,
          finalPrice: itemPrice,
          count: isDisabled ? 0 : item.count,
          selected: isDisabled ? false : item.selected,
          disabled: isDisabled,
          stockStatus: item.stockStatus,
          validityStatus: item.validityStatus,
          stockMain: item.stockMain,
          productStatus: item.productStatus,
          bundleConfig: bundleConfig
        };
      });

      this.setData({ cartList });
      this.calculateTotal();
    } catch (err) {
      wx.hideLoading();
      console.error('加载购物车失败:', err);
      // 如果是因为未登录，清空本地购物车并提示
      if (err.error === 'UNAUTHORIZED') {
        wx.showToast({ title: '请先登录', icon: 'none' });
        this.setData({ cartList: [] });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    }
  },

  // 计算总价和总件数
  calculateTotal: function() {
    let cart = this.data.cartList;
    let totalP = 0;
    let totalC = 0;
    let allSelected = true;

    // 过滤出可用且选中的商品
    const availableItems = cart.filter(item => !item.disabled);

    if (availableItems.length === 0) {
      allSelected = false;
    } else {
      availableItems.forEach(item => {
        if (item.selected) {
          let currentPrice = Number(item.finalPrice || item.price || 0);
          totalP += (currentPrice * item.count);
          totalC += item.count;
        } else {
          allSelected = false;
        }
      });
    }

    this.setData({
      totalPrice: totalP.toFixed(2),
      totalCount: totalC,
      isAllSelected: allSelected
    });
  },

  // 勾选/取消勾选单件商品
  toggleSelect: async function(e) {
    const index = e.currentTarget.dataset.index;
    let cart = this.data.cartList;
    const item = cart[index];

    // 售罄或无效商品不能选中
    if (item.disabled) {
      wx.showToast({ title: '该商品无法选中', icon: 'none' });
      return;
    }

    const newSelected = !item.selected;

    try {
      await api.patch(`/cart/items/${item.id}/selected?selected=${newSelected}`);
      item.selected = newSelected;
      this.setData({ cartList: cart });
      this.calculateTotal();
    } catch (err) {
      console.error('更新商品选中状态失败:', err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 点击底部全选按钮
  toggleAll: async function() {
    let allSelected = !this.data.isAllSelected;

    try {
      await api.patch(`/cart/toggle-all`);
      let cart = this.data.cartList;
      cart.forEach(item => {
        item.selected = allSelected;
      });
      this.setData({ cartList: cart, isAllSelected: allSelected });
      this.calculateTotal();
    } catch (err) {
      console.error('全选操作失败:', err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 增加或减少商品数量
  changeCount: async function(e) {
    const index = e.currentTarget.dataset.index;
    const type = e.currentTarget.dataset.type;
    let cart = this.data.cartList;
    const item = cart[index];

    // 售罄或无效商品不能修改数量
    if (item.disabled) {
      wx.showToast({ title: '该商品无法购买', icon: 'none' });
      return;
    }

    if (type === 'add') {
      // 检查库存
      if (item.stockMain !== null && item.count >= item.stockMain) {
        wx.showToast({ title: '已达库存上限', icon: 'none' });
        return;
      }

      const newCount = item.count + 1;
      try {
        await api.put(`/cart/items/${item.id}`, { count: newCount });
        item.count = newCount;
        this.setData({ cartList: cart });
        this.calculateTotal();
      } catch (err) {
        console.error('更新数量失败:', err);
        wx.showToast({ title: '操作失败', icon: 'none' });
      }
    } else if (type === 'minus') {
      if (item.count > 1) {
        const newCount = item.count - 1;
        try {
          await api.put(`/cart/items/${item.id}`, { count: newCount });
          item.count = newCount;
          this.setData({ cartList: cart });
          this.calculateTotal();
        } catch (err) {
          console.error('更新数量失败:', err);
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      } else {
        // 数量为 1 时，点击"-"直接删除，不再确认
        this.deleteItem({ currentTarget: { dataset: { index } } });
      }
    }
  },

  // 点击结算按钮
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
  },

  // ================= 滑动删除相关方法 =================

  // 触摸开始
  onTouchStart: function(e) {
    const index = e.currentTarget.dataset.index;
    const touchX = e.touches[0].clientX;

    // 关闭其他滑动项
    if (this.data.currentSlideIndex !== -1 && this.data.currentSlideIndex !== index) {
      this.closeOtherSlide();
      return;
    }

    this.setData({
      touchStartX: touchX,
      currentSlideIndex: index
    });
  },

  // 触摸移动
  onTouchMove: function(e) {
    const index = e.currentTarget.dataset.index;
    const touchX = e.touches[0].clientX;
    const deltaX = touchX - this.data.touchStartX;

    // 只允许向左滑动（deltaX < 0）
    if (deltaX > 0) {
      return;
    }

    // 限制滑动距离
    const slideOut = Math.max(deltaX, -this.data.MAX_SLIDE_OUT);

    this.setData({
      slideOut: slideOut
    });
  },

  // 触摸结束
  onTouchEnd: function(e) {
    const index = e.currentTarget.dataset.index;
    const currentSlideOut = this.data.slideOut;

    // 如果滑动距离超过一半，完全展开/收起
    if (Math.abs(currentSlideOut) > this.data.MAX_SLIDE_OUT / 2) {
      if (currentSlideOut < 0) {
        // 向左滑动，显示删除按钮
        this.showDeleteButton();
      } else {
        this.closeOtherSlide();
      }
    } else {
      // 滑动距离不足，恢复原状
      this.closeOtherSlide();
    }
  },

  // 显示删除按钮
  showDeleteButton: function() {
    this.setData({
      slideOut: -this.data.MAX_SLIDE_OUT
    });
  },

  // 关闭其他滑动项
  closeOtherSlide: function() {
    this.setData({
      currentSlideIndex: -1,
      slideOut: 0
    });
  },

  // 点击商品项
  onItemTap: function(e) {
    const index = e.currentTarget.dataset.index;
    const currentItem = this.data.cartList[index];

    // 如果当前有滑动项打开，点击任何地方都关闭
    if (this.data.currentSlideIndex !== -1) {
      this.closeOtherSlide();
      return;
    }

    // 禁用商品不能操作
    if (currentItem.disabled) {
      wx.showToast({ title: '该商品无法操作', icon: 'none' });
      return;
    }
  },

  // 删除商品（通过滑动删除按钮调用）
  deleteItem: async function(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.cartList[index];

    if (!item) return;

    try {
      await api.delete(`/cart/items/${item.id}`);
      let cartList = this.data.cartList;
      cartList.splice(index, 1);
      this.setData({
        cartList: cartList,
        currentSlideIndex: -1,
        slideOut: 0
      });
      this.calculateTotal();
      wx.showToast({ title: '已移除', icon: 'success' });
    } catch (err) {
      console.error('删除商品失败:', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  }
});
