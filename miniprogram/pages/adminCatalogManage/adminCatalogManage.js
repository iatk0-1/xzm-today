const api = require('../../utils/api');
const auth = require('../../utils/auth');

// 与 adminCatalogManage.wxss 中 .group-row 的高度保持一致，拖拽换位依赖该数值。
const ROW_HEIGHT = 72;

Page({
  data: {
    currentType: 'stall',
    typeLabel: '档口',
    groups: [],
    newName: '',
    loading: false,
    saving: false,
    orderDirty: false,
    dragIndex: -1,
    dragY: 0,
    listHeight: ROW_HEIGHT
  },

  async onLoad() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) {
        wx.showToast({ title: '无权限', icon: 'none' });
        wx.navigateBack();
      }
    } catch (err) {
      wx.showToast({ title: '登录状态恢复失败', icon: 'none' });
    }
  },

  onShow() {
    this.loadGroups();
  },

  resourcePath(type = this.data.currentType) {
    return type === 'stall' ? '/stalls' : '/tags';
  },

  positionGroups(groups) {
    return groups.map((item, index) => ({
      ...item,
      y: index * ROW_HEIGHT
    }));
  },

  async loadGroups() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const groups = await api.get(this.resourcePath() + '/manage');
      const positioned = this.positionGroups(groups || []);
      this.setData({
        groups: positioned,
        listHeight: Math.max(positioned.length * ROW_HEIGHT, ROW_HEIGHT),
        orderDirty: false,
        dragIndex: -1,
        loading: false
      });
    } catch (err) {
      console.error('加载档口标签管理列表失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  switchType(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.currentType) return;
    if (this.data.orderDirty) {
      wx.showToast({ title: '请先保存当前排序', icon: 'none' });
      return;
    }
    this.setData({
      currentType: type,
      typeLabel: type === 'stall' ? '档口' : '标签',
      groups: [],
      newName: ''
    }, () => this.loadGroups());
  },

  onNameInput(e) {
    this.setData({ newName: e.detail.value });
  },

  async createGroup() {
    const name = this.data.newName.trim();
    if (!name) {
      wx.showToast({ title: '请输入' + this.data.typeLabel + '名称', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '新增中...', mask: true });
    try {
      const result = await api.post(this.resourcePath(), { name });
      wx.hideLoading();
      this.setData({ newName: '' });
      wx.showToast({
        title: result.created ? '新增成功' : (result.restored ? '已恢复' : '名称已存在'),
        icon: result.created || result.restored ? 'success' : 'none'
      });
      await this.loadGroups();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '新增失败', icon: 'none' });
    }
  },

  onDragStart(e) {
    const index = Number(e.currentTarget.dataset.index);
    wx.vibrateShort({ type: 'light' });
    this.setData({ dragIndex: index, dragY: index * ROW_HEIGHT });
  },

  onDragMove(e) {
    if (this.data.dragIndex < 0 || e.detail.source !== 'touch') return;
    this.data.dragY = e.detail.y;
  },

  onDragEnd() {
    const dragIndex = this.data.dragIndex;
    if (dragIndex < 0) return;
    const groups = this.data.groups.slice();
    const targetIndex = Math.max(
      0,
      Math.min(groups.length - 1, Math.round(this.data.dragY / ROW_HEIGHT))
    );
    if (targetIndex !== dragIndex) {
      const moving = groups.splice(dragIndex, 1)[0];
      groups.splice(targetIndex, 0, moving);
    }
    this.setData({
      groups: this.positionGroups(groups),
      dragIndex: -1,
      orderDirty: targetIndex !== dragIndex || this.data.orderDirty
    });
  },

  async saveOrder(showToast = true) {
    if (!this.data.orderDirty || this.data.saving) return true;
    this.setData({ saving: true });
    try {
      await api.put(this.resourcePath() + '/order', {
        orderedIds: this.data.groups.map(item => item.id)
      });
      this.setData({ saving: false, orderDirty: false });
      if (showToast) wx.showToast({ title: '排序已保存', icon: 'success' });
      return true;
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      return false;
    }
  },

  async toggleVisibility(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.groups[index];
    const visible = e.detail.value;
    if (visible && item.onSaleProductCount === 0) {
      wx.showToast({ title: '没有上架商品，无法显示', icon: 'none' });
      this.setData({ [`groups[${index}].visible`]: false });
      return;
    }
    try {
      const updated = await api.patch(
        this.resourcePath() + '/' + item.id + '/visibility',
        { visible }
      );
      this.setData({
        [`groups[${index}].visible`]: updated.visible,
        [`groups[${index}].hiddenReason`]: updated.hiddenReason
      });
    } catch (err) {
      this.setData({ [`groups[${index}].visible`]: item.visible });
      wx.showToast({ title: err.message || '设置失败', icon: 'none' });
    }
  },

  async openProducts(e) {
    const item = e.currentTarget.dataset.item;
    if (!(await this.saveOrder(false))) return;
    wx.navigateTo({
      url: '/pages/adminCatalogProducts/adminCatalogProducts?type=' + this.data.currentType
        + '&id=' + item.id + '&name=' + encodeURIComponent(item.name)
    });
  }
});
