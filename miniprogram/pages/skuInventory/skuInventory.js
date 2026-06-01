// miniprogram/pages/skuInventory/skuInventory.js
const api = require('../../utils/api');
const { formatStock } = require('../../utils/stock');

Page({
  data: {
    productList: [],
    loading: false,
    keyword: '',
    // SKU 操作弹窗
    showSkuModal: false,
    selectedProduct: null,
    selectedSku: null,
    currentQty: 0,
    ledgerList: [],
    activeTab: 'operate', // 'ledger' or 'operate'
    operateType: 'add', // 'add' or 'set'
    inputQty: '',
    note: '',
    // 分页参数
    page: 0,
    pageSize: 20,
    hasMore: true
  },

  onLoad: function() {
    this.loadProducts();
  },

  // 触底加载更多
  onReachBottom: function() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadProducts(false);
    }
  },

  // 加载商品列表（支持分页）
  loadProducts: async function(reset = true) {
    if (reset) {
      this.setData({ page: 0, productList: [], hasMore: true });
    }

    if (!this.data.hasMore || this.data.loading) return;

    this.setData({ loading: true });
    try {
      const { page, pageSize } = this.data;
      // 获取所有商品（分页获取）
      const productsRes = await api.get('/products', {
        page: page,
        size: pageSize
      });
      const products = productsRes.content || [];
      const hasMore = productsRes.hasNext !== undefined ? productsRes.hasNext : products.length === pageSize;

      // 获取所有 SKU 库存
      const inventoryRes = await api.get('/sku-inventory');
      const inventoryMap = {};
      (inventoryRes || []).forEach(inv => {
        // inv.skuId 是后端返回的 SKU ID
        inventoryMap[inv.skuId] = inv.qty || 0;
      });

      // 合并商品和 SKU 库存信息
      const productList = products.map(product => {
        // skuMatrix 是后端返回的 SKU 列表
        const skuMatrix = product.skuMatrix || [];
        const skusWithQty = skuMatrix.map(sku => {
          const skuId = sku.skuId || sku.id;
          const unlimited = sku.unlimitedStock || false;

          return {
            id: skuId,
            spec: sku.color,
            size: sku.size,
            price: sku.price,
            stock: sku.stock,
            imageUrl: sku.imageUrl,
            availableQty: unlimited ? '无限' : (inventoryMap[skuId] !== undefined ? inventoryMap[skuId] : 0),
            unlimitedStock: unlimited
          };
        });

        return {
          ...product,
          skus: skusWithQty
        };
      });

      this.setData({
        productList: reset ? productList : [...this.data.productList, ...productList],
        page: this.data.page + 1,
        hasMore: hasMore,
        loading: false
      });
    } catch (err) {
      console.error('加载商品失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 搜索
  onKeywordInput: function(e) {
    this.setData({ keyword: e.detail.value });
  },

  search: function() {
    const keyword = this.data.keyword.trim().toLowerCase();
    
    if (!keyword) {
      this.loadProducts();
      return;
    }

    const filtered = this.data.productList.filter(product => {
      const nameMatch = product.name && product.name.toLowerCase().includes(keyword);
      const skuMatch = product.skus && product.skus.some(sku => 
        (sku.spec && sku.spec.toLowerCase().includes(keyword)) ||
        (sku.size && sku.size.toLowerCase().includes(keyword))
      );
      return nameMatch || skuMatch;
    });

    this.setData({ productList: filtered });
  },

  // 选择商品
  selectProduct: function(e) {
    const product = e.currentTarget.dataset.item;
    // 如果有多个 SKU，打开弹窗让用户选择
    if (product.skus && product.skus.length > 0) {
      this.openSkuModal(product, product.skus[0]);
    } else {
      wx.showToast({ title: '该商品没有 SKU', icon: 'none' });
    }
  },

  // 操作 SKU
  operateSku: function(e) {
    const product = e.currentTarget.dataset.product;
    const sku = e.currentTarget.dataset.sku;
    if (sku) {
      this.openSkuModal(product, sku);
    } else {
      wx.showToast({ title: 'SKU 信息不存在', icon: 'none' });
    }
  },

  // 打开 SKU 弹窗
  openSkuModal: function(product, sku) {
    if (!sku || !sku.id) {
      wx.showToast({ title: 'SKU 信息不完整', icon: 'none' });
      return;
    }
    
    this.setData({
      selectedProduct: product,
      selectedSku: sku,
      currentQty: sku.availableQty || 0,
      showSkuModal: true,
      activeTab: 'operate',
      operateType: 'add',
      inputQty: '',
      note: ''
    });
    this.loadLedger(sku.id);
  },

  // 选择 SKU
  selectSku: function(e) {
    const index = e.currentTarget.dataset.index;
    const sku = this.data.selectedProduct.skus[index];
    
    this.setData({
      selectedSku: sku,
      currentQty: sku.availableQty || 0,
      inputQty: '',
      note: ''
    });
    this.loadLedger(sku.id);
  },

  // 隐藏 SKU 弹窗
  hideSkuModal: function() {
    this.setData({ showSkuModal: false });
  },

  // 加载录入记录
  loadLedger: async function(skuId) {
    try {
      const res = await api.get(`/sku-inventory/${skuId}/ledger?limit=50`);
      
      // 检查每条记录是否已被撤销
      const ledgerList = (res || []).map(item => {
        // 检查是否有对应的撤销记录
        const isRevoked = res.some(l => l.changeType === 'revoke' && l.refId === item.id);
        
        return {
          ...item,
          changeTypeText: this.getChangeTypeText(item.changeType),
          createdAt: this.formatTime(item.createdAt),
          isRevoked: isRevoked
        };
      });
      
      this.setData({ ledgerList });
    } catch (err) {
      console.error('加载流水失败:', err);
    }
  },

  // 切换选项卡
  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
  },

  // 设置操作类型
  setOperateType: function(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ operateType: type, inputQty: '' });
  },

  // 输入数量
  onQtyInput: function(e) {
    this.setData({ inputQty: e.detail.value });
  },

  // 输入备注
  onNoteInput: function(e) {
    this.setData({ note: e.detail.value });
  },

  // 确认操作
  confirmOperate: async function() {
    const qty = parseInt(this.data.inputQty);
    if (isNaN(qty)) {
      wx.showToast({ title: '请输入数量', icon: 'none' });
      return;
    }

    const { selectedSku, operateType, note } = this.data;
    
    wx.showLoading({ title: '保存中...' });

    try {
      if (operateType === 'add') {
        // 录入库存（增加）
        await api.post('/sku-inventory', {
          skuId: selectedSku.id,
          qty: qty,
          note: note || undefined
        });
      } else {
        // 修改库存（设置为指定值）
        await api.put(`/sku-inventory/${selectedSku.id}`, {
          qty: qty,
          note: note || undefined
        });
      }

      wx.hideLoading();
      wx.showToast({ title: '操作成功', icon: 'success' });
      
      // 刷新商品列表（更新所有 SKU 的库存）
      await this.loadProducts();
      
      // 刷新录入记录
      this.loadLedger(selectedSku.id);
      
      // 更新当前库存和 SKU 选择器中的库存
      const inventoryRes = await api.get(`/sku-inventory/${selectedSku.id}`);
      const newQty = inventoryRes.qty || 0;
      
      // 更新 selectedProduct 中对应 SKU 的 availableQty
      const updatedSkus = this.data.selectedProduct.skus.map(sku => {
        if (sku.id === selectedSku.id) {
          return { ...sku, availableQty: newQty };
        }
        return sku;
      });
      
      this.setData({
        selectedProduct: {
          ...this.data.selectedProduct,
          skus: updatedSkus
        },
        selectedSku: {
          ...selectedSku,
          availableQty: newQty
        },
        currentQty: newQty,
        inputQty: '',
        note: ''
      });
    } catch (err) {
      wx.hideLoading();
      console.error('操作失败:', err);
      wx.showToast({ title: err?.message || '操作失败', icon: 'none' });
    }
  },

  // 撤销录入记录
  revokeLedger: async function(e) {
    const item = e.currentTarget.dataset.item;
    
    wx.showModal({
      title: '确认撤销',
      content: `确定要撤销这条录入记录吗？（撤销数量：${item.changeQty}）`,
      confirmText: '确认',
      confirmColor: '#f44336',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '撤销中...' });
          
          try {
            // 调用后端撤销接口
            await api.post(`/sku-inventory/${item.skuId}/ledger/${item.id}/revoke?note=撤销录入记录`, {});
            
            wx.hideLoading();
            wx.showToast({ title: '撤销成功', icon: 'success' });
            
            // 刷新数据
            this.loadProducts();
            this.loadLedger(item.skuId);
            
            // 更新当前库存
            const inventoryRes = await api.get(`/sku-inventory/${item.skuId}`);
            this.setData({ currentQty: inventoryRes.qty || 0 });
          } catch (err) {
            wx.hideLoading();
            console.error('撤销失败:', err);
            wx.showToast({ title: err?.message || '撤销失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 获取变动类型文本
  getChangeTypeText: function(type) {
    const typeMap = {
      'manual_add': '手动录入',
      'shipment': '发货扣减',
      'adjustment': '库存调整',
      'revoke': '撤销录入'
    };
    return typeMap[type] || type;
  },

  // 格式化时间
  formatTime: function(timeStr) {
    if (!timeStr) return '';
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
});
