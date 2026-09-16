const api = require('../../utils/api');
const auth = require('../../utils/auth');

// 与 adminCatalogManage.wxss 中 .group-row 的高度保持一致，拖拽换位依赖该数值。
const ROW_HEIGHT = 96;
// 与 adminCatalogManage.wxss 中 .row-delete 的宽度保持一致，左滑最多露出这么宽。
const DELETE_WIDTH = 72;
// 横向滑动判定阈值，避免手抖被误判成左滑。
const SWIPE_THRESHOLD = 8;

Page({
  data: {
    currentType: 'stall',
    typeLabel: '档口',
    groups: [],
    newName: '',
    loading: false,
    saving: false,
    deleting: false,
    dragIndex: -1,
    dragY: 0,
    listHeight: ROW_HEIGHT,
    snap: true
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

  noop() {},

  resourcePath(type = this.data.currentType) {
    return type === 'stall' ? '/stalls' : '/tags';
  },

  positionGroups(groups) {
    return groups.map((item, index) => ({
      ...item,
      y: index * ROW_HEIGHT,
      offsetX: 0
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
    if (this.data.saving) {
      wx.showToast({ title: '排序保存中，请稍候', icon: 'none' });
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

  // ===== 拖动排序：只有按住左侧图标才能拖动，松手自动保存 =====

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
    if (targetIndex === dragIndex) {
      this.setData({ dragIndex: -1 });
      return;
    }
    const moving = groups.splice(dragIndex, 1)[0];
    groups.splice(targetIndex, 0, moving);
    this.setData({ groups: this.positionGroups(groups), dragIndex: -1 });
    this.saveOrder();
  },

  async saveOrder() {
    if (this.data.saving) return;
    const orderedIds = this.data.groups.map(item => item.id);
    this.setData({ saving: true });
    try {
      await api.put(this.resourcePath() + '/order', { orderedIds });
      this.setData({ saving: false });
      wx.showToast({ title: '排序已保存', icon: 'none' });
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: err.message || '排序保存失败', icon: 'none' });
      // 保存失败就把服务端的顺序拉回来，避免界面和实际顺序不一致
      this.loadGroups();
    }
  },

  // ===== 左滑露出删除 =====

  onRowTouchStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.groups[index];
    this.rowSwipe = {
      index,
      startX: touch.clientX,
      startY: touch.clientY,
      startOffset: item ? (item.offsetX || 0) : 0,
      swiping: false
    };
    this.rowMoved = false;
  },

  onRowTouchMove(e) {
    const state = this.rowSwipe;
    if (!state || this.data.dragIndex >= 0) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - state.startX;
    const deltaY = touch.clientY - state.startY;
    if (!state.swiping) {
      if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      state.swiping = true;
    }
    this.rowMoved = true;
    const offsetX = Math.min(0, Math.max(-DELETE_WIDTH, state.startOffset + deltaX));
    this.setData({
      snap: false,
      ['groups[' + state.index + '].offsetX']: offsetX
    });
  },

  onRowTouchEnd() {
    const state = this.rowSwipe;
    this.rowSwipe = null;
    if (!state || !state.swiping || this.data.dragIndex >= 0) return;
    const item = this.data.groups[state.index];
    const offsetX = item ? (item.offsetX || 0) : 0;
    this.applySwipeState(state.index, offsetX <= -DELETE_WIDTH / 2);
  },

  applySwipeState(openIndex, open) {
    const patch = { snap: true };
    this.data.groups.forEach((item, index) => {
      const target = index === openIndex && open ? -DELETE_WIDTH : 0;
      if ((item.offsetX || 0) !== target) {
        patch['groups[' + index + '].offsetX'] = target;
      }
    });
    this.setData(patch);
  },

  closeAllSwipe() {
    this.applySwipeState(-1, false);
  },

  hasOpenSwipe() {
    return this.data.groups.some(item => (item.offsetX || 0) !== 0);
  },

  // ===== 显隐、删除、进入商品列表 =====

  async toggleVisibility(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.groups[index];
    const visible = e.detail.value;
    try {
      const updated = await api.patch(
        this.resourcePath() + '/' + item.id + '/visibility',
        { visible }
      );
      this.setData({
        [`groups[${index}].visible`]: updated.visible,
        [`groups[${index}].hiddenReason`]: updated.hiddenReason
      });
      if (updated.visible && updated.onSaleProductCount === 0) {
        wx.showToast({ title: '已开启，无上架商品暂不展示', icon: 'none' });
      }
    } catch (err) {
      this.setData({ [`groups[${index}].visible`]: item.visible });
      wx.showToast({ title: err.message || '设置失败', icon: 'none' });
    }
  },

  deleteGroup(e) {
    if (this.data.deleting) return;
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.groups[index];
    if (!item) return;
    const label = this.data.typeLabel;
    const total = item.totalProductCount || 0;
    const productTip = total > 0
      ? '该' + label + '下有 ' + total + ' 个商品，删除后这些商品不再归属此' + label + '。'
      : '';
    wx.showModal({
      title: '删除' + label,
      content: productTip + '删除后可再次新增同名' + label + '恢复。',
      confirmText: '删除',
      confirmColor: '#c83e35',
      success: (res) => {
        if (res.confirm) this.performDelete(item.id);
      }
    });
  },

  async performDelete(id) {
    this.setData({ deleting: true });
    wx.showLoading({ title: '删除中...', mask: true });
    try {
      await api.delete(this.resourcePath() + '/' + id);
      wx.hideLoading();
      this.setData({ deleting: false });
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.loadGroups();
    } catch (err) {
      wx.hideLoading();
      this.setData({ deleting: false });
      wx.showToast({ title: err.message || '删除失败', icon: 'none' });
    }
  },

  openProducts(e) {
    // 刚滑动过就不算点击，避免划一下就直接跳走。
    if (this.rowMoved) {
      this.rowMoved = false;
      return;
    }
    if (this.hasOpenSwipe()) {
      this.closeAllSwipe();
      return;
    }
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.groups[index];
    if (!item) return;
    wx.navigateTo({
      url: '/pages/adminCatalogProducts/adminCatalogProducts?type=' + this.data.currentType
        + '&id=' + item.id + '&name=' + encodeURIComponent(item.name)
    });
  }
});
