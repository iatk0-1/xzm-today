App({
  onLaunch: function () {
    // 小程序启动时，立刻连接你的专属云开发数据库
    wx.cloud.init({
      env: 'cloud1-1g5xiwto16479b78', 
      traceUser: true
    });
  }
})