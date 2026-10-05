// miniprogram/pages/user/user.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');
const managementNavigation = require('../../utils/managementNavigation');
const config = require('../../utils/config');
const customerServiceNavigation = require('../../utils/customerServiceNavigation');
const customerServiceUnread = require('../../utils/customerServiceUnread');
const workbench = require('../../utils/workbench');

Page({
  data: {
    currentRoleLabel: '普通用户',
    availableRoles: [],
    hasMultipleRoles: false,
    isAdmin: false,
    isStallManager: false,
    workbenchItems: [],
    workbenchHeight: 0,
    workbenchItemWidth: 0,
    workbenchItemHeight: 0,
    workbenchDraggingId: '',
    workbenchDropX: 0,
    workbenchDropY: 0,
    workbenchSaving: false,
    messageUnreadCount: 0,
    messageUnreadLabel: '0',
    navTop: 0,
    navHeight: 0,
    userInfo: null,
    avatarUrl: null,
    phone: null,
    isPhoneBound: false,
    phoneBinding: false // 手机号绑定中状态，防止重复点击
  },

  onLoad: function() {
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    this.setData({
      navTop: menuButtonInfo.top,
      navHeight: menuButtonInfo.height
    });
    this.checkAdmin();
    this.loadUserInfo();
  },

  onShow: function() {
    this._workbenchHidden = false;
    customerServiceUnread.start(this);
    // 每次显示页面时检查管理员状态
    this.checkAdmin();
    this.refreshWorkbenchOrder();
    this.loadUserInfo();
    this.refreshUserInfoFromServer();
  },

  onReady: function() {
    this.measureWorkbench();
  },

  onResize: function() {
    this.cancelWorkbenchDrag();
    this.measureWorkbench();
  },

  // 加载用户信息
  loadUserInfo: function() {
    // 从 storage 重新读取最新用户信息
    const userInfo = auth.getUserInfo();
    if (userInfo) {
      this.setData({
        userInfo: userInfo,
        avatarUrl: userInfo.avatarUrl || null,
        phone: userInfo.phone || null,
        isPhoneBound: !!userInfo.phone
      });
    } else {
      // 如果没有本地缓存，从后端获取
      this.refreshUserInfoFromServer();
    }
  },

  // 从后端刷新用户信息
  refreshUserInfoFromServer: async function() {
    try {
      await auth.ensureAuthenticated({ silent: true });
      const roles = await auth.loadAvailableRoles();
      this.setData({ availableRoles: roles, hasMultipleRoles: roles.some(role => role !== 'user') });
      const res = await api.get('/users/me');
      const userInfo = auth.getUserInfo() || {};
      userInfo.phone = res.phone;
      // 用户资料接口通过 phone 表示绑定状态，不依赖额外的状态字段。
      userInfo.isPhoneBound = !!res.phone;
      userInfo.nickname = res.nickname;
      userInfo.avatarUrl = res.avatarUrl;
      userInfo.role = userInfo.selectedRole || res.role || userInfo.role;
      wx.setStorageSync(config.USER_INFO_KEY, userInfo);
      this.setData({
        userInfo: userInfo,
        avatarUrl: res.avatarUrl || null,
        phone: res.phone || null,
        isPhoneBound: userInfo.isPhoneBound
      });
      this.checkAdmin();
    } catch (err) {
      console.error('刷新用户信息失败:', err);
    }
  },

  // 检查是否为主理人
  checkAdmin: function() {
    const info = auth.getUserInfo() || {};
    this.setData({
      currentRoleLabel: auth.ROLE_LABELS[info.role] || '普通用户',
      isStallManager: auth.isStallManager()
    });
    if (auth.isAdmin()) {
      this.setData({ isAdmin: true });
    } else {
      this.setData({ isAdmin: false });
    }
    this.loadWorkbench(info);
  },

  loadWorkbench: function(info) {
    const scope = workbench.getStorageKey(info);
    if (this._workbenchRole === info.role && this._workbenchScope === scope) return;
    this.cancelWorkbenchDrag();
    this._workbenchOrderVersion = (this._workbenchOrderVersion || 0) + 1;
    this.setData({ workbenchSaving: false });
    this._workbenchRole = info.role;
    this._workbenchScope = scope;
    let savedOrder;
    try {
      if (scope && wx.getStorageSync) savedOrder = wx.getStorageSync(scope);
    } catch (err) {
      console.error('读取工作台排序失败:', err);
    }
    this.setWorkbenchLayout(workbench.getOrderedEntries(info.role, savedOrder));
    this.measureWorkbench();
    this.refreshWorkbenchOrder();
  },

  refreshWorkbenchOrder: async function() {
    const info = auth.getUserInfo() || {};
    const scope = workbench.getStorageKey(info);
    if (!scope || this.data.workbenchSaving || this._workbenchDrag || this._workbenchHidden || typeof api.get !== 'function') return;
    if (this._workbenchRead && this._workbenchRead.scope === scope) return;
    const read = { scope, version: this._workbenchOrderVersion };
    this._workbenchRead = read;
    try {
      const response = await api.get('/users/me/workbench-order', { role: info.role });
      if (this._workbenchScope !== scope || workbench.getStorageKey(auth.getUserInfo()) !== scope
          || this._workbenchOrderVersion !== read.version || this._workbenchDrag || this._workbenchHidden) return;
      if (!response || response.role !== info.role || response.userId !== String(info.userId || info.id) || !Array.isArray(response.entries)) return;
      const items = workbench.getOrderedEntries(info.role, response.entries);
      this.setWorkbenchLayout(items);
      this.cacheWorkbenchOrder(scope, items);
    } catch (err) {
      console.error('同步工作台排序失败，暂用本机缓存:', err);
    } finally {
      if (this._workbenchRead === read) this._workbenchRead = null;
    }
  },

  cacheWorkbenchOrder: function(scope, items) {
    try {
      if (scope && wx.setStorageSync) wx.setStorageSync(scope, items.map(item => item.id));
    } catch (err) {
      console.error('缓存工作台排序失败:', err);
    }
  },

  saveWorkbenchOrder: async function(items, drag) {
    this.setData({ workbenchSaving: true });
    const version = this._workbenchOrderVersion;
    const stillCurrent = () => this._workbenchScope === drag.scope
      && this._workbenchOrderVersion === version
      && workbench.getStorageKey(auth.getUserInfo()) === drag.scope;
    try {
      const info = auth.getUserInfo() || {};
      const response = await api.put('/users/me/workbench-order', {
        userId: String(info.userId || info.id || ''), role: drag.role, entries: items.map(item => item.id)
      });
      if (!stillCurrent()) return;
      if (!response || response.role !== drag.role || response.userId !== String(info.userId || info.id) || !Array.isArray(response.entries)) {
        throw new Error('工作台排序保存响应无效');
      }
      const saved = workbench.getOrderedEntries(drag.role, response.entries);
      this.setWorkbenchLayout(saved);
      this.cacheWorkbenchOrder(drag.scope, saved);
    } catch (err) {
      console.error('保存工作台排序失败:', err);
      if (stillCurrent()) {
        this.setWorkbenchLayout(drag.original);
        wx.showToast({ title: '排序保存失败，请重试', icon: 'none' });
      }
    } finally {
      if (stillCurrent()) this.setData({ workbenchSaving: false });
    }
  },

  setWorkbenchLayout: function(items) {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : { windowWidth: 375 };
    const scale = (windowInfo.windowWidth || 375) / 750;
    const width = this._workbenchWidth || 648 * scale;
    const layout = workbench.createLayout(items, width, scale);
    this._workbenchLayout = layout;
    const drag = this._workbenchDrag;
    if (drag) {
      const moving = layout.items.find(item => item.id === drag.id);
      moving.x = drag.x;
      moving.y = drag.y;
    }
    this.setData({
      workbenchItems: layout.items.map(item => ({ ...item, renderKey: `${item.id}:${this._workbenchRevision || 0}` })),
      workbenchHeight: layout.height,
      workbenchItemWidth: layout.itemWidth,
      workbenchItemHeight: layout.itemHeight,
      workbenchDropX: drag ? (drag.target % 3) * layout.stepX : 0,
      workbenchDropY: drag ? Math.floor(drag.target / 3) * layout.stepY : 0
    });
  },

  measureWorkbench: function() {
    if (!wx.createSelectorQuery || !this.data.workbenchItems.length) return;
    const scope = this._workbenchScope;
    wx.createSelectorQuery().in(this).select('.workbench-grid').boundingClientRect(rect => {
      if (!rect || rect.width <= 0 || scope !== this._workbenchScope || this._workbenchDrag) return;
      this._workbenchWidth = rect.width;
      this.setWorkbenchLayout(this.data.workbenchItems);
    }).exec();
  },

  onWorkbenchTouchStart: function() {
    // 拖动后产生的 tap 要拦住，下一次主动点按仍可正常打开页面。
    if (!this._workbenchDrag) this._workbenchSuppressTapUntil = 0;
  },

  onWorkbenchDragStart: function(e) {
    if (this._workbenchDrag || this.data.workbenchSaving) return;
    const info = auth.getUserInfo() || {};
    const id = e.currentTarget.dataset.entry;
    const entry = workbench.findEntry(id);
    const index = this.data.workbenchItems.findIndex(item => item.id === id);
    if (!entry || !entry.roles.includes(info.role) || index < 0) return;
    const item = this.data.workbenchItems[index];
    this._workbenchOrderVersion = (this._workbenchOrderVersion || 0) + 1;
    this._workbenchDrag = {
      id, role: info.role, scope: workbench.getStorageKey(info),
      original: this.data.workbenchItems.slice(), from: index, target: index, x: item.x, y: item.y
    };
    this.setData({ workbenchDraggingId: id, workbenchDropX: item.x, workbenchDropY: item.y });
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light', fail: () => {} });
  },

  onWorkbenchDragMove: function(e) {
    const drag = this._workbenchDrag;
    if (!drag || e.currentTarget.dataset.entry !== drag.id) return;
    const { x, y, source } = e.detail;
    // 忽略布局更新触发的 change，避免其他按钮的动画影响正在拖动的按钮。
    if (!['touch', 'touch-out-of-bounds'].includes(source) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    drag.x = x;
    drag.y = y;
    const target = workbench.getDropIndex(x, y, this._workbenchLayout, drag.original.length);
    if (target !== drag.target) {
      drag.target = target;
      this.setWorkbenchLayout(workbench.moveEntry(drag.original, drag.from, target));
    }
  },

  onWorkbenchDragEnd: function(e) {
    const drag = this._workbenchDrag;
    if (!drag || e.currentTarget.dataset.entry !== drag.id) return;
    const info = auth.getUserInfo() || {};
    if (drag.role !== info.role || drag.scope !== workbench.getStorageKey(info)) {
      this.cancelWorkbenchDrag();
      this.loadWorkbench(info);
      return;
    }
    this._workbenchDrag = null;
    this._workbenchRevision = (this._workbenchRevision || 0) + 1;
    this._workbenchSuppressTapUntil = Date.now() + 350;
    this.setData({ workbenchDraggingId: '' });
    const items = workbench.moveEntry(drag.original, drag.from, drag.target);
    // 重建拖动节点，保证未跨格移动时也能清掉原生组件的实际偏移。
    this.setWorkbenchLayout(items);
    if (drag.from === drag.target) return;
    return this.saveWorkbenchOrder(items, drag);
  },

  cancelWorkbenchDrag: function() {
    const drag = this._workbenchDrag;
    if (!drag) return;
    this._workbenchDrag = null;
    this._workbenchRevision = (this._workbenchRevision || 0) + 1;
    this._workbenchSuppressTapUntil = Date.now() + 350;
    this.setData({ workbenchDraggingId: '' });
    this.setWorkbenchLayout(drag.original);
  },

  onWorkbenchDragCancel: function(e) {
    if (this._workbenchDrag && e.currentTarget.dataset.entry === this._workbenchDrag.id) this.cancelWorkbenchDrag();
  },

  switchRole: async function() {
    try {
      const roles = await auth.loadAvailableRoles();
      this.setData({ availableRoles: roles, hasMultipleRoles: roles.some(role => role !== 'user') });
      this.checkAdmin();
      wx.showActionSheet({
        itemList: roles.map(role => auth.ROLE_LABELS[role]),
        success: result => {
          auth.selectRole(roles[result.tapIndex]);
          this.checkAdmin();
          this.loadUserInfo();
          // 重新创建页面，清掉旧角色的列表、分页和管理页面栈。
          wx.reLaunch({ url: '/pages/user/user' });
        }
      });
    } catch (err) {
      wx.showToast({ title: err.message || '获取可切换角色失败', icon: 'none' });
    }
  },

  // 跳转到编辑资料页面
  goToEditProfile: function() {
    wx.navigateTo({
      url: '/pages/editProfile/editProfile'
    });
  },

  // 请求手机号授权（已绑定用户点击）
  requestPhoneAuth: function() {
    wx.showModal({
      title: '手机号已绑定',
      content: `当前绑定的手机号为：${this.data.phone}，如需修改请联系客服`,
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#000'
    });
  },

  // 阻止事件冒泡
  stopPropagation: function() {
    // 空函数，仅用于阻止事件冒泡
  },

  // 获取手机号（微信官方回调）
  onGetPhoneNumber: async function(e) {
    const errMsg = e.detail.errMsg || '';

    // ── 用户取消或拒绝授权 ──
    if (errMsg !== 'getPhoneNumber:ok') {
      this.setData({ phoneBinding: false });

      // 区分不同的失败原因，给予针对性引导
      if (errMsg.includes('fail user deny') || errMsg.includes('fail cancel')) {
        // 用户主动点击了"拒绝"
        wx.showModal({
          title: '需授权手机号',
          content: '您拒绝了手机号授权。微信有短暂的冷却时间，请稍候几秒后重试；或前往「设置」手动开启授权。',
          confirmText: '前往设置',
          cancelText: '稍后重试',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          }
        });
      } else if (errMsg.includes('too frequently')) {
        // 微信频率限制 —— 上一个请求的 resolve() 未被正确调用时会触发
        wx.showModal({
          title: '操作过于频繁',
          content: '由于微信平台限制，请稍候 10 秒后再点击授权按钮。',
          showCancel: false,
          confirmText: '知道了'
        });
      } else if (errMsg.includes('privacy permission is not authorized')) {
        // 隐私协议未授权
        wx.showModal({
          title: '需同意隐私协议',
          content: '请先同意隐私协议后才能获取手机号。请前往设置开启。',
          confirmText: '前往设置',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          }
        });
      } else {
        // 其他未知错误
        wx.showToast({ title: '授权失败，请稍后重试', icon: 'none', duration: 3000 });
      }
      return;
    }

    // ── 授权成功，开始绑定 ──
    this.setData({ phoneBinding: true });

    const { code } = e.detail;
    wx.showLoading({ title: '绑定中...', mask: true });

    try {
      const res = await api.post('/users/me/phone/bind', {
        code: code
      });

      wx.hideLoading();

      // 更新本地用户信息
      const userInfo = auth.getUserInfo();
      if (userInfo) {
        userInfo.phone = res.phone;
        userInfo.isPhoneBound = true;
        wx.setStorageSync(config.USER_INFO_KEY, userInfo);
      }

      this.setData({
        phone: res.phone,
        isPhoneBound: true,
        phoneBinding: false
      });

      wx.showToast({ title: '绑定成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.setData({ phoneBinding: false });
      console.error('绑定手机号失败:', err);

      // 后端返回的错误（如手机号已被绑定等）
      wx.showModal({
        title: '绑定失败',
        content: auth.getPhoneBindErrorMessage(err),
        showCancel: false,
        confirmText: '知道了'
      });
    }
  },

  // 跳转订单列表
  goToOrderList: function(e) {
    const status = e.currentTarget.dataset.status || 'all';
    wx.navigateTo({
      url: `/pages/orderList/orderList?status=${status}`
    });
  },

  // 基础工具跳转
  goToAddress: function() {
    wx.chooseAddress({
      success: () => {
        wx.showToast({ title: '地址已同步', icon: 'success' });
      }
    });
  },

  // 底部 Tab 导航
  goToIndex: function() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
  goToMarket: function() {
    wx.reLaunch({ url: '/pages/market/market' });
  },

  onHide: function() {
    this._workbenchHidden = true;
    this.cancelWorkbenchDrag();
    customerServiceUnread.stop(this);
  },

  onUnload: function() {
    this._workbenchHidden = true;
    this.cancelWorkbenchDrag();
    customerServiceUnread.stop(this);
  },
  goToMessages: function() {
    wx.reLaunch({ url: '/pages/messages/messages' });
  },
  handleCustomerServiceContact: function(e) {
    customerServiceNavigation.openFromContact(e);
  },
  // 加号直接进入商品新增页面。
  goToCreateProduct: function() {
    managementNavigation.openProductCreate();
  },

  goToWorkbench: function(e) {
    if (this._workbenchDrag || Date.now() < (this._workbenchSuppressTapUntil || 0)) return;
    managementNavigation.openWorkbenchEntry(e.currentTarget.dataset.entry);
  },

  // 跳转到打印员管理页面
  goToPrinters: function() {
    wx.navigateTo({
      url: '/pages/logistics/printers/printers'
    });
  },

  // 跳转到快递批量管理页面
  goToExpressBatch: function() {
    wx.navigateTo({
      url: '/pages/logistics/expressBatchManage/expressBatchManage'
    });
  },

  // 跳转到售后管理页面（管理员专属）
  goToAdminAfterSale: function() {
    wx.navigateTo({
      url: '/pages/adminAfterSaleList/adminAfterSaleList'
    });
  },

  goToSales: function() {
    wx.navigateTo({
      url: '/pages/adminSales/adminSales'
    });
  },

  goToShippingSales: function() {
    wx.navigateTo({ url: '/pages/adminShippingSales/adminShippingSales' });
  },

  goToCatalogManage: function() {
    wx.navigateTo({
      url: '/pages/adminCatalogManage/adminCatalogManage'
    });
  },

  goToChangeRequestManage: function() {
    wx.navigateTo({
      url: '/pages/adminChangeRequestManage/adminChangeRequestManage'
    });
  },

  goToStallManagers: function() {
    if (!auth.isAdmin()) return;
    wx.navigateTo({ url: '/pages/stallManagers/stallManagers' });
  },

  goToPricingRules: function() {
    if (!auth.isAdmin()) return;
    wx.navigateTo({ url: '/pages/pricingRules/pricingRules' });
  },

  goToCommissionConfigs: function() {
    if (!auth.isAdmin()) return;
    wx.navigateTo({ url: '/pages/commissionConfigs/commissionConfigs' });
  },

  goToManagerIncome: function() {
    if (!auth.isStallManager()) return;
    wx.navigateTo({ url: '/pages/managerIncome/managerIncome' });
  }
});
