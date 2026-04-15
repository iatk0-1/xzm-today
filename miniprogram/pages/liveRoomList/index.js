// miniprogram/pages/liveRoomList/index.js
const api = require('../../utils/api');
const auth = require('../../utils/auth');

Page({
  data: {
    isLoading: true,
    hasData: false,
    activeSession: null,
    groupedSessions: [],
    isAdmin: false,
    showCreateModal: false,
    titleInput: ''
  },

  onLoad: function() {
    this.checkAdmin();
    this.loadLiveSessions();
  },

  // 检查管理员权限
  checkAdmin: function() {
    if (auth.isAdmin()) {
      this.setData({ isAdmin: true });
    } else {
      this.setData({ isAdmin: false });
    }
  },

  // 加载直播场次列表
  loadLiveSessions: async function() {
    this.setData({ isLoading: true });

    try {
      // 1. 先获取正在直播的场次
      const activeSession = await api.get('/live-sessions/active');
      console.log('activeSession:', activeSession);

      // 2. 获取已结束场次列表
      const endedSessions = await api.get('/live-sessions?page=0&size=100');
      console.log('endedSessions:', endedSessions);

      // 3. 处理数据 - 只有当 activeSession 有 id 时才认为有数据
      const hasActiveSession = activeSession && activeSession.id;
      if (hasActiveSession) {
        this.setData({ activeSession });
      }

      // 4. 按年月分组
      const grouped = this.groupByMonth(endedSessions || []);

      // 5. 判断是否有数据
      const hasData = hasActiveSession || (grouped && grouped.length > 0);
      console.log('hasData:', hasData, 'grouped.length:', grouped ? grouped.length : 0);

      this.setData({
        groupedSessions: grouped || [],
        hasData: hasData,
        isLoading: false
      });
    } catch (err) {
      console.error('加载直播场次失败:', err);
      this.setData({
        hasData: false,
        isLoading: false
      });
    }
  },

  // 按年月分组
  groupByMonth: function(sessions) {
    console.log('groupByMonth input:', sessions);
    console.log('isArray:', Array.isArray(sessions));
    console.log('length:', sessions ? sessions.length : 'null');
    const groups = {};

    sessions.forEach(session => {
      const date = new Date(session.createdAt || session.endedAt);
      const monthKey = `${date.getFullYear()}年${date.getMonth() + 1}月`;
      console.log('Processing session:', session.title, 'monthKey:', monthKey);

      if (!groups[monthKey]) {
        groups[monthKey] = [];
      }

      // 格式化日期显示
      const dateStr = `${date.getMonth() + 1}月${date.getDate()}日 ${this.padZero(date.getHours())}:${this.padZero(date.getMinutes())}`;

      groups[monthKey].push({
        ...session,
        date: dateStr
      });
    });

    // 转换为数组并按月份排序
    const result = Object.keys(groups).sort((a, b) => {
      const aDate = this.parseMonth(a);
      const bDate = this.parseMonth(b);
      return bDate - aDate; // 降序
    }).map(month => ({
      month,
      count: groups[month].length,
      sessions: groups[month]
    }));

    console.log('groupByMonth result:', JSON.stringify(result));
    return result;
  },

  parseMonth: function(monthStr) {
    // 匹配 "2026 年 4 月" 格式（不带空格）
    const match = monthStr.match(/(\d+) 年 (\d+) 月/);
    if (match) {
      return parseInt(match[1]) * 100 + parseInt(match[2]);
    }
    return 0;
  },

  padZero: function(num) {
    return num < 10 ? '0' + num : num;
  },

  // 跳转详情页
  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/liveRoomDetail/detail?id=${id}`
    });
  },

  // 创建直播
  createLiveSession: function() {
    this.setData({ showCreateModal: true, titleInput: '' });
  },

  // 隐藏创建弹窗
  hideCreateModal: function() {
    this.setData({ showCreateModal: false, titleInput: '' });
  },

  // 输入标题
  onTitleInput: function(e) {
    this.setData({ titleInput: e.detail.value });
  },

  // 确认创建直播
  confirmCreateSession: async function() {
    const { titleInput } = this.data;

    if (!titleInput || !titleInput.trim()) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '创建中...' });

    try {
      await api.post('/live-sessions', { title: titleInput.trim() });
      wx.hideLoading();
      this.hideCreateModal();
      wx.showToast({ title: '创建成功', icon: 'success' });
      this.loadLiveSessions();
    } catch (err) {
      wx.hideLoading();
      console.error('创建直播失败:', err);
      wx.showToast({ title: err.message || '创建失败', icon: 'none' });
    }
  }
});
