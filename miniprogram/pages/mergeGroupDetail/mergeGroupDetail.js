// miniprogram/pages/mergeGroupDetail/mergeGroupDetail.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const clipboard = require('../../utils/clipboard');

Page({
  data: {
    mergeGroupId: null,
    mergeGroup: null,
    orders: [],
    shipments: [],
    canComplete: false,
    isLoading: true,
    // 批量打印相关
    selectedShipments: [],
    selectAll: false
  },

  onLoad: function(options) {
    const mergeGroupId = options.mergeGroupId || null;
    this.setData({ mergeGroupId }, () => {
      this.loadMergeGroupDetail();
    });
    wx.setNavigationBarTitle({ title: `合并订单 #${mergeGroupId}` });
  },

  copyOrderNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.orderNo, '订单号');
  },

  copyExpressNo: function(e) {
    clipboard.copyText(e.currentTarget.dataset.expressNo, '快递单号');
  },

  copyRecipientInfo: function() {
    clipboard.copyRecipient(this.data.mergeGroup || {});
  },

  // 加载合并组详情
  loadMergeGroupDetail: async function() {
    this.setData({ isLoading: true });
    wx.showLoading({ title: '加载中...' });

    try {
      await auth.ensureAuthenticated({ silent: true });
      const res = await api.get(`/merge-groups/${this.data.mergeGroupId}`);

      // 检查是否可以完成
      const canComplete = res.orders.every(order => order.status === 'completed' || order.status === 'shipped');

      // 处理 shipments，添加 _selected 标记
      const shipments = (res.shipments || []).map(s => ({ ...s, _selected: false }));

      this.setData({
        mergeGroup: res,
        orders: res.orders || [],
        shipments: shipments,
        selectedShipments: [],
        selectAll: false,
        canComplete: canComplete,
        isLoading: false
      });
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ isLoading: false });
      console.error('loadMergeGroupDetail error:', err);
    } finally {
      wx.hideLoading();
    }
  },

  // 添加订单到合并组
  addOrder: function() {
    wx.showModal({
      title: '添加订单',
      editable: true,
      placeholderText: '请输入订单 ID',
      success: (res) => {
        if (res.confirm && res.content) {
          const orderId = parseInt(res.content.trim());
          if (isNaN(orderId)) {
            wx.showToast({ title: '请输入有效的订单 ID', icon: 'none' });
            return;
          }
          this.doAddOrder(orderId);
        }
      }
    });
  },

  // 执行添加订单
  doAddOrder: async function(orderId) {
    wx.showLoading({ title: '添加中...' });

    try {
      await api.post(`/merge-groups/${this.data.mergeGroupId}/orders`, [orderId]);
      wx.showToast({ title: '添加成功', icon: 'success' });
      this.loadMergeGroupDetail();
    } catch (err) {
      wx.showModal({
        title: '添加失败',
        content: err.message || '未知错误',
        showCancel: false
      });
    } finally {
      wx.hideLoading();
    }
  },

  // 解绑订单
  unbindOrder: function(e) {
    const orderId = e.currentTarget.dataset.orderId;

    wx.showModal({
      title: '确认解绑',
      content: `确定要解绑订单 ${orderId} 吗？解绑后该订单将恢复为独立订单。`,
      confirmText: '确认解绑',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (res.confirm) {
          await this.doUnbindOrder(orderId);
        }
      }
    });
  },

  // 执行解绑
  doUnbindOrder: async function(orderId) {
    wx.showLoading({ title: '解绑中...', mask: true });

    try {
      await api.delete(`/merge-groups/${this.data.mergeGroupId}/orders/${orderId}`);
      wx.showToast({ title: '解绑成功', icon: 'success' });
      this.loadMergeGroupDetail();
    } catch (err) {
      wx.showModal({
        title: '解绑失败',
        content: err.message || '未知错误',
        showCancel: false
      });
    } finally {
      wx.hideLoading();
    }
  },

  // 完成合并组
  completeMergeGroup: async function() {
    wx.showModal({
      title: '确认完成',
      content: '确认要完成该合并组吗？完成后将无法继续添加订单或发货。',
      confirmText: '确认完成',
      success: async (res) => {
        if (res.confirm) {
          await this.doCompleteMergeGroup();
        }
      }
    });
  },

  // 执行完成
  doCompleteMergeGroup: async function() {
    wx.showLoading({ title: '处理中...' });

    try {
      await api.post(`/merge-groups/${this.data.mergeGroupId}/complete`);
      wx.showToast({ title: '已完成', icon: 'success' });
      this.loadMergeGroupDetail();
    } catch (err) {
      wx.showModal({
        title: '操作失败',
        content: err.message || '未知错误',
        showCancel: false
      });
    } finally {
      wx.hideLoading();
    }
  },

  // 去发货
  shipNow: function() {
    // 跳转到发货页面，传递 mergeGroupId
    wx.navigateTo({
      url: `/pages/shipPartial/shipPartial?mergeGroupId=${this.data.mergeGroupId}&orderIds=${this.data.orders.map(o => o.id).join(',')}`
    });
  },

  // 跳转到蓝牙打印页面（单个打印）
  bluetoothPrint: function(e) {
    const shipmentId = e.currentTarget.dataset.shipmentId;
    if (shipmentId) {
      wx.navigateTo({
        url: `/pages/bluetoothPrint/bluetoothPrint?shipmentId=${shipmentId}`
      });
    }
  },

  // 批量打印
  batchBluetoothPrint: function() {
    if (this.data.selectedShipments.length === 0) {
      wx.showToast({ title: '请选择要打印的运单号', icon: 'none' });
      return;
    }

    // 构建参数：传递多个 shipmentId
    const shipmentIds = this.data.selectedShipments.join(',');
    wx.navigateTo({
      url: `/pages/bluetoothPrint/bluetoothPrint?shipmentIds=${shipmentIds}&mergeGroupId=${this.data.mergeGroupId}`
    });
  },

  // 全选/取消全选
  toggleSelectAll: function() {
    const selectAll = !this.data.selectAll;

    // 更新每个 shipment 的 _selected 标记
    const shipments = this.data.shipments.map(s => ({
      ...s,
      _selected: selectAll
    }));

    // 更新 selectedShipments 数组
    const selectedShipments = selectAll ? this.data.shipments.map(s => String(s.id)) : [];

    this.setData({
      selectAll,
      selectedShipments,
      shipments
    });
  },

  // 切换单个发货单的选择状态
  toggleShipmentSelection: function(e) {
    const shipmentId = String(e.currentTarget.dataset.shipmentId);
    const index = this.data.selectedShipments.indexOf(shipmentId);
    let selectedShipments = [...this.data.selectedShipments];

    // 更新 selectedShipments 数组
    if (index > -1) {
      selectedShipments.splice(index, 1); // 取消选中
    } else {
      selectedShipments.push(shipmentId); // 选中
    }

    // 更新每个 shipment 的 _selected 标记
    const shipments = this.data.shipments.map(s => ({
      ...s,
      _selected: selectedShipments.indexOf(String(s.id)) > -1
    }));

    // 更新全选状态
    const selectAll = selectedShipments.length === this.data.shipments.length;

    this.setData({
      selectedShipments,
      selectAll,
      shipments
    });
  }
});
