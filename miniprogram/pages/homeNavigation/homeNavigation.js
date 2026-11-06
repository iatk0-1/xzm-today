const api = require('../../utils/api');
const auth = require('../../utils/auth');
const navigation = require('../../utils/homeNavigation');
const { getErrorMessage } = require('../../utils/error');

// 与样式中的行高一致；沿用档口管理的手势计算位置，movable-view 只负责定位。
const ROW_HEIGHT = 96;
const positionTabs = tabs => tabs.map((tab, index) => ({ ...tab, y: index * ROW_HEIGHT }));
function dragTouch(event, identifier) {
  const touches = event.touches && event.touches.length ? event.touches : (event.changedTouches || []);
  return identifier == null ? touches[0] : touches.find(touch => touch.identifier === identifier);
}

Page({
  data: { tabs: [], listHeight: 0, dragKey: '', loading: true, saving: false, error: '', saved: false },
  async onLoad() {
    this._pageClosed = false;
    try {
      await auth.ensureAuthenticated({ silent: true });
      if (!auth.isAdmin()) throw new Error('仅管理员可调整首页导航');
      this._authorized = true;
      await this.load();
    } catch (error) {
      this.setData({ loading: false, error: getErrorMessage(error, '加载导航配置失败') });
    }
  },
  async load() {
    if (!this._authorized || this.data.saving || this._drag) return;
    this.setData({ loading: true, error: '' });
    try {
      const tabs = navigation.normalize(await api.get('/home-navigation'));
      if (this._pageClosed) return;
      this._savedTabs = tabs;
      this.setData({ tabs: positionTabs(tabs), listHeight: tabs.length * ROW_HEIGHT });
    } catch (error) {
      this.setData({ error: getErrorMessage(error, '加载导航配置失败，请重试') });
    } finally { if (!this._pageClosed) this.setData({ loading: false }); }
  },
  onDragStart(event) {
    if (!this._authorized || this.data.loading || this.data.saving || this._drag) return;
    const key = event.currentTarget.dataset.key;
    const from = this.data.tabs.findIndex(tab => tab.key === key);
    const touch = dragTouch(event);
    if (from < 0 || !touch || !Number.isFinite(touch.clientY)) return;
    this._drag = { key, from, identifier: touch.identifier, startY: touch.clientY, y: from * ROW_HEIGHT };
    this.setData({ dragKey: key });
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light', fail() {} });
  },
  onDragTouchMove(event) {
    const drag = this._drag;
    if (!drag) return;
    const touch = dragTouch(event, drag.identifier);
    if (!touch || !Number.isFinite(touch.clientY)) return;
    drag.y = Math.max(0, Math.min((this.data.tabs.length - 1) * ROW_HEIGHT,
      drag.from * ROW_HEIGHT + touch.clientY - drag.startY));
    this.setData({ tabs: this.data.tabs.map(tab => tab.key === drag.key ? { ...tab, y: drag.y } : tab) });
  },
  onDragEnd(event) {
    const drag = this._drag;
    if (!drag || !dragTouch({ changedTouches: event.changedTouches }, drag.identifier)) return;
    // 松手前的最后一段位移也参与计算，避免 touchmove 被合并后落位偏差。
    this.onDragTouchMove({ changedTouches: event.changedTouches });
    this._drag = null;
    const to = Math.round(drag.y / ROW_HEIGHT);
    const tabs = this.data.tabs.slice();
    const [moving] = tabs.splice(drag.from, 1);
    tabs.splice(to, 0, moving);
    this.setData({ tabs: positionTabs(tabs), dragKey: '' });
    if (to !== drag.from) return this.save();
  },
  cancelDrag() {
    if (!this._drag) return;
    this._drag = null;
    this.setData({ tabs: positionTabs(this.data.tabs), dragKey: '' });
  },
  onHide() { this.cancelDrag(); },
  onUnload() { this.cancelDrag(); this._pageClosed = true; },
  toggle(event) {
    if (!this._authorized || this.data.loading || this.data.saving || this._drag) return;
    const key = event.currentTarget.dataset.key;
    if (!this.data.tabs.some(tab => tab.key === key && tab.visible !== event.detail.value)) return;
    this.setData({ tabs: this.data.tabs.map(tab => tab.key === key ? { ...tab, visible: event.detail.value } : tab) });
    return this.save();
  },
  async save() {
    if (!this._authorized || this.data.loading || this.data.saving || this._drag || this.data.tabs.length !== 3) return;
    this.setData({ saving: true, error: '', saved: false });
    try {
      const tabs = this.data.tabs.map(({ key, visible }) => ({ key, visible }));
      const saved = navigation.normalize(await api.put('/home-navigation', { tabs }));
      this._savedTabs = saved;
      if (!this._pageClosed) this.setData({ tabs: positionTabs(saved), saved: true });
    } catch (error) {
      if (!this._pageClosed) {
        this.setData({ tabs: positionTabs(this._savedTabs), error: getErrorMessage(error, '保存失败，请重试') });
        wx.showToast({ title: '保存失败，已恢复', icon: 'none' });
      }
    } finally { if (!this._pageClosed) this.setData({ saving: false }); }
  }
});
