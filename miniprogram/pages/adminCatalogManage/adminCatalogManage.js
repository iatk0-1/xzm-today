const api = require('../../utils/api');
const auth = require('../../utils/auth');

// 与 adminCatalogManage.wxss 中 .group-row 的高度保持一致，拖拽换位依赖该数值。
const ROW_HEIGHT = 96;
// 与 adminCatalogManage.wxss 中 .row-delete 的宽度保持一致，左滑最多露出这么宽。
const DELETE_WIDTH = 72;
// 横向滑动判定阈值，避免手抖被误判成左滑。
const SWIPE_THRESHOLD = 8;
// 拖动排序时，手指进入列表上下这个边缘范围内就自动滚动
const AUTO_SCROLL_EDGE = 72;
// 自动滚动的单帧步长（像素），按手指压进边缘的深度在两者之间取值
const AUTO_SCROLL_MIN_STEP = 4;
const AUTO_SCROLL_MAX_STEP = 18;
// 自动滚动定时器间隔（毫秒）
const AUTO_SCROLL_INTERVAL = 32;

// 多指操作时只认拖动那一根手指，免得被另一根手指的位置带偏
function pickDragTouch(e, identifier) {
  const touches = (e && e.touches && e.touches.length) ? e.touches : ((e && e.changedTouches) || []);
  if (identifier === undefined || identifier === null) return touches[0] || null;
  for (let i = 0; i < touches.length; i += 1) {
    if (touches[i].identifier === identifier) return touches[i];
  }
  return null;
}

Page({
  data: {
    currentType: 'stall',
    typeLabel: '档口',
    groups: [],
    newName: '',
    loading: false,
    saving: false,
    renaming: false,
    renameVisible: false,
    renameId: '',
    editName: '',
    deleting: false,
    dragIndex: -1,
    dragY: 0,
    listHeight: ROW_HEIGHT,
    snap: true,
    scrollTop: 0
  },

  async onLoad() {
    this.scrollTop = 0;
    this.dragBounds = null;
    this.dragContentBase = null;
    this.dragPaddingTop = 0;
    this.dragScrollStart = 0;
    this.autoScrollStep = 0;
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

  onUnload() {
    this.stopAutoScrollLoop();
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
    if (this.data.saving || this.data.renaming || this.data.renameVisible) {
      wx.showToast({ title: '正在保存，请稍候', icon: 'none' });
      return;
    }
    this.setData({
      currentType: type,
      typeLabel: type === 'stall' ? '档口' : '标签',
      groups: [],
      newName: '',
      scrollTop: 0
    }, () => this.loadGroups());
    this.scrollTop = 0;
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
  // 行的位置只由页面一处写入（setData 到 item.y）：手势在 drag-handle 上用 catchtouchmove 截住，
  // movable-view 只当定位容器，不再自己插一脚。之前是 movable-view 自己拖、页面再往回纠，
  // 两个写入方各按各的模型算位置，顶到列表头尾之后两个模型对不上，卡片就在两个位置之间来回闪。

  onDragStart(e) {
    const index = Number(e.currentTarget.dataset.index);
    const touch = pickDragTouch(e, null);
    const startY = this.data.groups[index] ? this.data.groups[index].y : index * ROW_HEIGHT;
    wx.vibrateShort({ type: 'light' });
    // 记下拖动前的滚动位置：行在内容里该待哪儿要拿它算，松手后也靠它判断这一趟滚没滚过
    this.dragScrollStart = this.scrollTop;
    // 行和手指的起步基准，后面靠它俩把行重新贴回手指
    this.dragOriginY = startY;
    this.dragTouchId = touch ? touch.identifier : null;
    this.dragFingerStartY = touch ? touch.clientY : null;
    this.dragFingerY = this.dragFingerStartY;
    this.data.dragY = startY;
    this.setData({ dragIndex: index, dragY: startY });
    this.measureDragBounds();
    this.startAutoScrollLoop();
  },

  // 拖动过程中记手指的位置。主来源是 drag-handle 上 catch 住的那一下，
  // movable-view 上也挂一份当备份（它已经被禁用，只跟着我们的 setData 摆位置，不会再插一脚）。
  onDragTouchMove(e) {
    if (this.data.dragIndex < 0) return;
    const touch = pickDragTouch(e, this.dragTouchId);
    if (touch) this.trackDragFinger(touch.clientY);
  },

  trackDragFinger(clientY) {
    if (this.data.dragIndex < 0) return;
    // 长按事件没带手指坐标的极端情况：拿第一下 touchmove 当起点，行先不动，后面再跟手
    if (this.dragFingerStartY == null) {
      this.dragFingerStartY = clientY;
      this.dragFingerY = clientY;
      return;
    }
    this.dragFingerY = clientY;
    this.syncDragRowToFinger();
    this.updateAutoScrollDirection();
  },

  // 行在内容里的位置 = 起步位置 + 手指这一趟挪了多少 + 列表这一趟滚了多少。
  // 两头都对上，行才一直贴在手指按住的那个点上，不用记住夹掉的位移，手指往回走就能立刻跟上。
  syncDragRowToFinger() {
    const index = this.data.dragIndex;
    if (index < 0) return;
    if (this.dragFingerY == null || this.dragFingerStartY == null) return;
    const maxDragY = Math.max(0, (this.data.groups.length - 1) * ROW_HEIGHT);
    const target = this.dragOriginY
      + (this.dragFingerY - this.dragFingerStartY)
      + (this.scrollTop - this.dragScrollStart);
    const y = Math.max(0, Math.min(maxDragY, target));
    if (Math.abs(y - this.data.dragY) < 0.5) return;
    this.data.dragY = y;
    this.setData({ ['groups[' + index + '].y']: y, dragY: y });
  },

  onDragEnd() {
    this.stopAutoScrollLoop();
    this.dragFingerY = null;
    this.dragFingerStartY = null;
    const dragIndex = this.data.dragIndex;
    if (dragIndex < 0) return;
    const groups = this.data.groups.slice();
    const targetIndex = Math.max(
      0,
      Math.min(groups.length - 1, Math.round(this.data.dragY / ROW_HEIGHT))
    );
    if (targetIndex === dragIndex) {
      this.setData({ dragIndex: -1 });
      this.restoreVisibleRow(targetIndex);
      return;
    }
    const moving = groups.splice(dragIndex, 1)[0];
    groups.splice(targetIndex, 0, moving);
    this.setData({ groups: this.positionGroups(groups), dragIndex: -1 });
    this.restoreVisibleRow(targetIndex);
    this.saveOrder();
  },

  // ===== 拖到列表边缘时自动滚动 =====

  // 松手后把落位的行完整露出来。贴着列表上下边缘拖时，滚动是跟着手指一点点推进的，
  // 行一顶到内容头尾滚动就停了，列表常常停在半路，落位的行会被列表边缘切掉一截。
  restoreVisibleRow(index) {
    if (!this.dragBounds || this.scrollTop === this.dragScrollStart) return;
    const padding = this.dragPaddingTop;
    // 可视区高度按边框高度去掉上下留白估算，差几个像素不影响「行完整露出来」这个目的
    const viewHeight = Math.max(
      this.dragBounds.bottom - this.dragBounds.top - padding * 2,
      ROW_HEIGHT
    );
    const rowTop = padding + index * ROW_HEIGHT;
    const rowBottom = Math.min(rowTop + ROW_HEIGHT, padding + this.data.listHeight);
    let next = Math.min(this.scrollTop, rowTop);
    if (next + viewHeight < rowBottom) next = rowBottom - viewHeight;
    next = Math.max(0, next);
    if (next === this.scrollTop) return;
    this.scrollTop = next;
    this.setData({ scrollTop: next });
  },

  measureDragBounds() {
    this.dragBounds = null;
    this.dragContentBase = null;
    wx.createSelectorQuery()
      .select('.list-scroll').boundingClientRect()
      .select('.list-scroll').scrollOffset()
      .select('.group-area').boundingClientRect()
      .exec((res) => {
        const listRect = res && res[0];
        const offset = res && res[1];
        const areaRect = res && res[2];
        if (!listRect || !areaRect || !listRect.height) return;
        // 以容器回传的真实滚动位置为准：数据层那份可能因为手动滚动过而偏旧，
        // 拿偏旧的值当基准，行和列表就会错位。
        if (offset && typeof offset.scrollTop === 'number') {
          this.scrollTop = offset.scrollTop;
          this.dragScrollStart = this.scrollTop;
        }
        // 内容 y=0 换算到视口坐标的基准：这里加回测量时的滚动量，让这个值跟滚动无关，
        // 后面用当前滚动位置就能算出任一内容坐标此刻落在视口哪儿。
        this.dragContentBase = areaRect.top + this.scrollTop;
        this.dragPaddingTop = Math.max(0, areaRect.top - listRect.top + this.scrollTop);
        this.dragBounds = {
          top: listRect.top,
          bottom: listRect.top + listRect.height
        };
        this.updateAutoScrollDirection();
      });
  },

  updateAutoScrollDirection() {
    const bounds = this.dragBounds;
    const index = this.data.dragIndex;
    if (!bounds || index < 0 || this.dragContentBase == null) return;
    // 手指顶在列表边缘就一直滚；拿不到手指坐标时才退回拿行中心估算
    const pointerY = this.dragFingerY != null
      ? this.dragFingerY
      : this.dragContentBase - this.scrollTop + this.data.dragY + ROW_HEIGHT / 2;
    const range = AUTO_SCROLL_MAX_STEP - AUTO_SCROLL_MIN_STEP;
    if (pointerY > bounds.bottom - AUTO_SCROLL_EDGE) {
      const depth = Math.min(1, (pointerY - (bounds.bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE);
      this.autoScrollStep = AUTO_SCROLL_MIN_STEP + range * depth;
    } else if (pointerY < bounds.top + AUTO_SCROLL_EDGE) {
      const depth = Math.min(1, (bounds.top + AUTO_SCROLL_EDGE - pointerY) / AUTO_SCROLL_EDGE);
      this.autoScrollStep = -(AUTO_SCROLL_MIN_STEP + range * depth);
    } else {
      this.autoScrollStep = 0;
    }
  },

  startAutoScrollLoop() {
    if (this.autoScrollTimer) return;
    this.autoScrollTimer = setInterval(() => this.autoScrollTick(), AUTO_SCROLL_INTERVAL);
  },

  stopAutoScrollLoop() {
    if (this.autoScrollTimer) {
      clearInterval(this.autoScrollTimer);
      this.autoScrollTimer = null;
    }
    this.autoScrollStep = 0;
  },

  autoScrollTick() {
    const step = this.autoScrollStep;
    const index = this.data.dragIndex;
    if (!step || index < 0 || !this.dragBounds) return;
    const delta = Math.max(0, this.scrollTop + step) - this.scrollTop;
    if (!delta) return;
    const maxDragY = (this.data.groups.length - 1) * ROW_HEIGHT;
    // 行只能在自己那一段内容里挪：挪不动说明已经顶到列表头/尾了，
    // 这时再滚内容，行就会从手指下面滑走。
    const nextDragY = Math.min(maxDragY, Math.max(0, this.data.dragY + delta));
    const moved = nextDragY - this.data.dragY;
    if (!moved) return;
    // 滚动多少，行在内容里的位置就同步挪多少，行才会一直跟着手指
    this.scrollTop += moved;
    this.data.dragY = nextDragY;
    this.setData({
      scrollTop: this.scrollTop,
      ['groups[' + index + '].y']: nextDragY
    });
  },

  onListScroll(e) {
    // 自动滚动期间滚动量由自己记账：bindscroll 回传可能晚于请求，
    // 拿它盖回来会把账对歪，行就会从手指下面滑走。
    if (this.data.dragIndex >= 0 && this.autoScrollStep) return;
    this.scrollTop = e.detail.scrollTop;
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

  renameGroup(e) {
    if (this.data.renaming || this.data.saving || this.data.deleting) return;
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.groups[index];
    if (!item) return;
    this.setData({ renameVisible: true, renameId: item.id, editName: item.name });
  },

  onEditNameInput(e) {
    this.setData({ editName: e.detail.value });
  },

  closeRename() {
    if (this.data.renaming) return;
    this.setData({ renameVisible: false, renameId: '', editName: '' });
  },

  async saveRename() {
    if (!this.data.renameVisible || this.data.renaming) return;
    const name = this.data.editName.trim();
    const item = this.data.groups.find(group => group.id === this.data.renameId);
    if (!item) return;
    if (!name) {
      wx.showToast({ title: this.data.typeLabel + '名称不能为空', icon: 'none' });
      return;
    }
    if (name.length > 64) {
      wx.showToast({ title: this.data.typeLabel + '名称最多 64 个字符', icon: 'none' });
      return;
    }
    if (name === item.name) {
      this.closeRename();
      return;
    }
    this.setData({ renaming: true });
    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const updated = await api.patch(this.resourcePath() + '/' + item.id + '/name', { name });
      const currentIndex = this.data.groups.findIndex(group => group.id === item.id);
      if (currentIndex >= 0) {
        this.setData({ [`groups[${currentIndex}].name`]: updated.name });
      }
      this.setData({ renameVisible: false, renameId: '', editName: '' });
      wx.hideLoading();
      wx.showToast({ title: '名称已修改', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '修改名称失败', icon: 'none' });
    } finally {
      this.setData({ renaming: false });
    }
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
