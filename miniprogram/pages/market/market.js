const db = wx.cloud.database();

Page({
  data: {
    wishes: []
  },

  onShow: function() {
    this.loadWishes();
  },

  // ====== 1. 下拉刷新 & 拉取列表 ======
  onPullDownRefresh: function() {
    this.loadWishes(() => {
      wx.stopPullDownRefresh(); // 数据加载完后自动收起下拉框
    });
  },

  loadWishes: function(callback) {
    wx.showLoading({ title: '加载中...' });
    // 按时间倒序拉取最新的许愿贴
    db.collection('wishes').orderBy('createTime', 'desc').get({
      success: res => {
        wx.hideLoading();
        this.setData({ wishes: res.data });
        if(callback) callback();
      },
      fail: err => {
        wx.hideLoading();
        console.error("加载失败", err);
        if(callback) callback();
      }
    });
  },

  // ====== 2. 终极转化引擎：点赞 + 订阅消息拦截 ======
  handleLike: function(e) {
    const index = e.currentTarget.dataset.index;
    let currentWishes = this.data.wishes;
    let wish = currentWishes[index];

    // 如果当前手机已经点过赞了，简单提示即可
    if (wish.isLiked) {
      wx.showToast({ title: '已经许过愿啦', icon: 'none' });
      return; 
    }

    let that = this;
    // 🚀 注入你的专属核武器：模板 ID
    const templateId = 'kg9ie8PfPyU4gmuMdCsC6ZQqvoiEGp5pY4_aZeO7Mv8'; 

    // 呼叫微信底层弹窗
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (res) => {
        console.log('订阅成功返回：', res); // 👈 加上这行盯死它
        if (res[templateId] === 'accept') {
          // 顾客同意了！太棒了！
          wx.showToast({ title: '到货将第一时间通知您', icon: 'none', duration: 2000 });
        } else {
          // 顾客拒绝了也没关系，不强求，保持高级感
          wx.showToast({ title: '许愿成功', icon: 'none' }); 
        }
      },
      fail: (err) => {
        console.error('订阅弹窗呼叫失败:', err);
        wx.showToast({ title: '许愿成功', icon: 'none' });
      },
      complete: () => {
        // 无论同意还是拒绝，视觉上的“进度条黑化”和数据库的“+1”都必须极速执行
        that.executeLikeAction(index, wish);
      }
    });
  },

  // 真正执行点赞视觉变化和数据库更新的后台动作
  executeLikeAction: function(index, wish) {
    let currentWishes = this.data.wishes;
    
    // 前端极速视觉反馈
    wish.likes = (wish.likes || 0) + 1;
    wish.isLiked = true; 
    this.setData({ wishes: currentWishes });

    // 偷偷在后台把点赞数 +1
    db.collection('wishes').doc(wish._id).update({
      data: { likes: db.command.inc(1) }
    });
  },

  // ====== 3. 极简发布（弹窗写字 + 直接选图上云） ======
  uploadWish: function() {
    let that = this;
    
    // 步骤一：弹出一个带输入框的原生小窗
    wx.showModal({
      title: '发布心愿单',
      editable: true,
      placeholderText: '例如：想要这件裙子，求上架！',
      success: (res) => {
        if (res.confirm && res.content) {
          let userText = res.content;

          // 步骤二：选相册图片
          wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            success: (mediaRes) => {
              let tempPath = mediaRes.tempFiles[0].tempFilePath;
              wx.showLoading({ title: '正在上传...', mask: true });

              // 步骤三：自动传到云开发存储
              let ext = tempPath.match(/\.([^.]+)$/) ? tempPath.match(/\.([^.]+)$/)[1] : 'png';
              wx.cloud.uploadFile({
                cloudPath: `wishes/wish_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`,
                filePath: tempPath,
                success: uploadRes => {
                  
                  // 步骤四：写进咱们刚刚建好的 wishes 数据库
                  db.collection('wishes').add({
                    data: {
                      image: uploadRes.fileID,
                      content: userText,
                      likes: 0,
                      linkedProductId: '', // 留空，等你进货了填！
                      createTime: db.serverDate()
                    },
                    success: () => {
                      wx.hideLoading();
                      wx.showToast({ title: '许愿成功', icon: 'success' });
                      that.loadWishes(); // 重新刷新列表，展示自己的帖子
                    }
                  });

                },
                fail: err => { wx.hideLoading(); wx.showToast({ title: '图片上传失败', icon: 'none' }); }
              });
            }
          });
        }
      }
    });
  },

  // ====== 4. 一键跳转购买 ======
  goToProduct: function(e) {
    let productId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${productId}`
    });
  }
})