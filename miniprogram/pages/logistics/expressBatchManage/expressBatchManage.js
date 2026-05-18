// miniprogram/pages/logistics/expressBatchManage/expressBatchManage.js
const api = require('../../../utils/api');
const config = require('../../../utils/config');

Page({
  data: {
    // 快递公司列表（第一位是"全部"）
    deliveryList: [],
    deliveryNames: ['全部'],
    deliveryIndex: 0,
    deliveryId: '',   // 空=全部, 非空=按此code筛选

    // expressCode → deliveryName 映射
    deliveryNameMap: {},

    // 运单数据
    allItems: [],       // [{orderId, waybillId, expressCode, deliveryName, checked, source}]
    displayItems: [],   // 过滤后显示的列表

    // 手动添加弹窗
    showModal: false,
    formOrderId: '',
    formWaybillId: '',

    // 全选状态
    allChecked: false,
    checkedCount: 0,

    canceling: false
  },

  onLoad: function() {
    this.loadDeliveryCompanies();
    this.loadWaybills();
  },

  // 加载快递公司列表
  loadDeliveryCompanies: async function() {
    try {
      const res = await api.get('/logistics/delivery-companies');
      const deliveryList = res || [];
      const nameMap = {};
      deliveryList.forEach(d => { nameMap[d.deliveryId] = d.deliveryName; });
      this.setData({
        deliveryList,
        deliveryNames: ['全部', ...deliveryList.map(d => d.deliveryName)],
        deliveryNameMap: nameMap
      });
    } catch (err) {
      console.error('加载快递公司列表失败:', err);
    }
  },

  // 从数据库加载运单
  loadWaybills: async function() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await api.get('/logistics/waybills');
      wx.hideLoading();
      const waybills = res || [];
      const nameMap = this.data.deliveryNameMap;
      const dbItems = waybills.map(w => ({
        orderId: w.orderId || '',
        waybillId: w.expressNo || '',
        expressCode: w.expressCode || '',
        deliveryName: nameMap[w.expressCode] || w.expressCode || '-',
        checked: false,
        source: 'db'
      }));
      this.setData({ allItems: dbItems }, () => {
        this.applyFilter();
      });
    } catch (err) {
      wx.hideLoading();
      console.error('加载运单失败:', err);
      wx.showToast({ title: '加载运单失败', icon: 'none' });
    }
  },

  // 选择快递公司筛选，index=0 为全部
  onDeliveryChange: function(e) {
    const index = parseInt(e.detail.value);
    let deliveryId = '';
    if (index > 0) {
      const delivery = this.data.deliveryList[index - 1];
      deliveryId = delivery ? delivery.deliveryId : '';
    }
    this.setData({ deliveryIndex: index, deliveryId }, () => {
      this.applyFilter();
    });
  },

  // 根据快递公司过滤显示列表
  applyFilter: function() {
    const { allItems, deliveryId } = this.data;
    let displayItems;
    if (deliveryId) {
      displayItems = allItems.filter(item =>
        item.expressCode === deliveryId
      );
    } else {
      displayItems = allItems;
    }
    this.setData({ displayItems }, () => {
      this.updateCheckState();
    });
  },

  // 导入Excel
  importExcel: function() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls'],
      success: (res) => {
        this.parseExcelFile(res.tempFiles[0].path);
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '请选择 .xlsx 或 .xls 文件', icon: 'none' });
      }
    });
  },

  // 上传并解析Excel
  parseExcelFile: async function(filePath) {
    wx.showLoading({ title: '解析中...', mask: true });
    const token = wx.getStorageSync('accessToken') || '';

    wx.uploadFile({
      url: config.API_BASE_URL + '/logistics/parse-waybill-excel',
      filePath: filePath,
      name: 'file',
      header: { 'Authorization': token ? 'Bearer ' + token : '' },
      success: (res) => {
        wx.hideLoading();
        try {
          const data = JSON.parse(res.data);
          if (data && data.items && data.items.length > 0) {
            this.mergeImportItems(data.items);
            wx.showToast({ title: '成功导入 ' + data.items.length + ' 条', icon: 'success' });
          } else {
            wx.showToast({ title: '文件中没有有效数据', icon: 'none' });
          }
        } catch (e) {
          wx.showToast({ title: '解析失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '上传失败，请重试', icon: 'none' });
      }
    });
  },

  // 合并导入数据（Excel中的expressCode为空，需要用户手动选择）
  mergeImportItems: function(newItems) {
    const existingWaybillIds = new Set(this.data.allItems.map(item => item.waybillId));
    const nameMap = this.data.deliveryNameMap;
    const addedItems = newItems
      .filter(item => !existingWaybillIds.has(item.waybillId))
      .map(item => ({
        orderId: item.orderId || '',
        waybillId: item.waybillId,
        expressCode: '',
        deliveryName: '-',
        checked: true,
        source: 'import'
      }));
    if (addedItems.length > 0) {
      this.setData({ allItems: [...this.data.allItems, ...addedItems] }, () => {
        this.applyFilter();
      });
    }
  },

  // 显示手动添加弹窗
  showAddModal: function() {
    this.setData({ showModal: true, formOrderId: '', formWaybillId: '' });
  },

  closeModal: function() {
    this.setData({ showModal: false, formOrderId: '', formWaybillId: '' });
  },

  onFormInput: function(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  // 确认手动添加
  confirmAdd: function() {
    const waybillId = this.data.formWaybillId.trim();
    if (!waybillId) {
      wx.showToast({ title: '请输入运单号', icon: 'none' });
      return;
    }
    if (this.data.allItems.some(item => item.waybillId === waybillId)) {
      wx.showToast({ title: '该运单号已存在', icon: 'none' });
      return;
    }

    const newItem = {
      orderId: this.data.formOrderId.trim(),
      waybillId: waybillId,
      expressCode: '',
      deliveryName: '-',
      checked: true,
      source: 'manual'
    };

    this.setData({
      allItems: [...this.data.allItems, newItem],
      showModal: false,
      formOrderId: '',
      formWaybillId: ''
    }, () => {
      this.applyFilter();
      wx.showToast({ title: '添加成功', icon: 'success' });
    });
  },

  // 切换单个勾选
  toggleItem: function(e) {
    const index = e.currentTarget.dataset.index;
    const waybillId = this.data.displayItems[index].waybillId;
    const allItems = this.data.allItems.map(item => {
      if (item.waybillId === waybillId) {
        return { ...item, checked: !item.checked };
      }
      return item;
    });
    this.setData({ allItems }, () => {
      this.applyFilter();
    });
  },

  // 全选/取消全选
  toggleAll: function() {
    const newChecked = !this.data.allChecked;
    const allItems = this.data.allItems.map(item => {
      const inDisplay = this.data.displayItems.some(d => d.waybillId === item.waybillId);
      if (inDisplay) {
        return { ...item, checked: newChecked };
      }
      return item;
    });
    this.setData({ allItems }, () => {
      this.applyFilter();
    });
  },

  // 更新全选状态
  updateCheckState: function() {
    const items = this.data.displayItems;
    if (items.length === 0) {
      this.setData({ allChecked: false, checkedCount: 0 });
      return;
    }
    const allChecked = items.every(item => item.checked);
    const checkedCount = items.filter(item => item.checked).length;
    this.setData({ allChecked, checkedCount });
  },

  // 删除单条
  deleteItem: function(e) {
    const index = e.currentTarget.dataset.index;
    const waybillId = this.data.displayItems[index].waybillId;
    const allItems = this.data.allItems.filter(item => item.waybillId !== waybillId);
    this.setData({ allItems }, () => {
      this.applyFilter();
    });
  },

  // 批量取消运单
  batchCancel: function() {
    const checkedItems = this.data.allItems.filter(item => item.checked);
    if (checkedItems.length === 0) {
      wx.showToast({ title: '请先选择要取消的运单', icon: 'none' });
      return;
    }

    // 检查是否有条目缺少必要字段
    const itemsWithoutOrderId = checkedItems.filter(item => !item.orderId);
    const itemsWithoutDelivery = checkedItems.filter(item => !item.expressCode);
    if (itemsWithoutOrderId.length > 0 || itemsWithoutDelivery.length > 0) {
      let msg = '';
      if (itemsWithoutOrderId.length > 0) {
        msg += itemsWithoutOrderId.length + ' 条缺少订单号；';
      }
      if (itemsWithoutDelivery.length > 0) {
        msg += itemsWithoutDelivery.length + ' 条缺少快递公司；';
      }
      msg += '\n请取消勾选这些条目或删除后重新添加。';
      wx.showModal({
        title: '无法取消',
        content: msg,
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    if (this.data.canceling) return;

    wx.showModal({
      title: '确认批量取消',
      content: '确定要取消 ' + checkedItems.length + ' 个运单吗？此操作不可撤销。',
      confirmText: '确认取消',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;

        this.setData({ canceling: true });
        wx.showLoading({ title: '取消中...', mask: true });

        try {
          const requestBody = {
            deliveryId: null,
            items: checkedItems.map(item => ({
              orderId: item.orderId || null,
              waybillId: item.waybillId,
              deliveryId: item.expressCode
            }))
          };

          const result = await api.post('/logistics/batch-cancel', requestBody);
          wx.hideLoading();
          this.setData({ canceling: false });

          const successWaybillIds = new Set(
            result.results.filter(r => r.success).map(r => r.waybillId)
          );
          const failItems = result.results.filter(r => !r.success);

          if (successWaybillIds.size > 0) {
            const allItems = this.data.allItems.filter(
              item => !successWaybillIds.has(item.waybillId)
            );
            this.setData({ allItems }, () => {
              this.applyFilter();
            });
          }

          let content = '成功：' + successWaybillIds.size + ' 条';
          if (failItems.length > 0) {
            content += '\n失败：' + failItems.length + ' 条';
            content += '\n原因：' + (failItems[0].error || '未知错误');
          }

          wx.showModal({
            title: '操作完成',
            content: content,
            showCancel: false,
            confirmText: '知道了',
            confirmColor: '#1890ff'
          });
        } catch (err) {
          wx.hideLoading();
          this.setData({ canceling: false });
          console.error('批量取消失败:', err);
          wx.showModal({
            title: '操作失败',
            content: err.message || '批量取消请求失败',
            showCancel: false,
            confirmText: '知道了'
          });
        }
      }
    });
  }
});
