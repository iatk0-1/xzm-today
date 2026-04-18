const api = require('../../utils/api');
const auth = require('../../utils/auth');

// 默认头像（微信官方提供的默认头像）
const DEFAULT_AVATAR_URL = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

Page({
  data: {
    nickname: '',
    avatarUrl: DEFAULT_AVATAR_URL,
    saving: false
  },

  onLoad: function() {
    // 加载当前用户信息
    const userInfo = auth.getUserInfo();
    if (userInfo) {
      this.setData({
        nickname: userInfo.nickname || '',
        avatarUrl: userInfo.avatarUrl || DEFAULT_AVATAR_URL
      });
    }
  },

  onNicknameInput: function(e) {
    this.setData({
      nickname: e.detail.value
    });
  },

  // 用户选择头像（官方 open-type="chooseAvatar" 回调）
  onChooseAvatar: function(e) {
    const { avatarUrl } = e.detail;
    console.log('用户选择的头像临时路径:', avatarUrl);
    
    // 直接更新预览
    this.setData({
      avatarUrl: avatarUrl
    });
    
    // 上传头像到服务器
    this.uploadAvatar(avatarUrl);
  },

  // 上传头像
  uploadAvatar: async function(filePath) {
    wx.showLoading({ title: '上传中...' });

    try {
      const uploadRes = await api.uploadFile('/files/upload-avatar', filePath);

      if (uploadRes.url) {
        this.setData({
          avatarUrl: uploadRes.url
        });
        wx.hideLoading();
        wx.showToast({ title: '头像上传成功', icon: 'success' });
      } else {
        throw new Error('上传失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '上传失败', icon: 'none' });
      console.error('上传头像失败:', err);
    }
  },

  // 保存资料
  saveProfile: async function() {
    const { nickname, avatarUrl } = this.data;

    if (!nickname || !nickname.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    this.setData({ saving: true });

    try {
      await api.put('/users/me/profile', {
        nickname: nickname.trim(),
        avatarUrl: avatarUrl !== DEFAULT_AVATAR_URL ? avatarUrl : undefined
      });

      // 更新本地存储
      const userInfo = auth.getUserInfo();
      if (userInfo) {
        userInfo.nickname = nickname.trim();
        userInfo.avatarUrl = avatarUrl !== DEFAULT_AVATAR_URL ? avatarUrl : userInfo.avatarUrl;
        wx.setStorageSync('userInfo', userInfo);
      }

      this.setData({ saving: false });
      wx.showToast({ title: '保存成功', icon: 'success' });

      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 1000);
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
      console.error('保存失败:', err);
    }
  }
});
