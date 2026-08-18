const db = wx.cloud.database();
const _ = db.command;

Page({
  data: {
    currentTab: 'unlinked', // unlinked(待寻觅) 或 linked(已关联)
    wishes: [],
    isLoading: true
  },

  onShow: function() {
    this.loadWishes();
  },

  switchTab: function(e) {
    this.setData({ currentTab: e.currentTarget.dataset.tab }, () => {
      this.loadWishes();
    });
  },

  // 1. 根据当前 Tab 拉取心愿
  loadWishes: function() {
    this.setData({ isLoading: true, wishes: [] });
    wx.showLoading({ title: '计算热度中...' });

    // 核心过滤：如果是 unlinked，找 productId 为 null 或不存在的；反之找存在且不为 null 的
    let condition = this.data.currentTab === 'unlinked' 
      ? _.or([_.eq(null), _.exists(false)]) 
      : _.and([_.neq(null), _.exists(true)]);

    db.collection('wishes')
      .where({ linkedProductId: condition })
      // 🚀 核心排序：按点赞数从高到低排！打造搞钱排行榜！
      .orderBy('likes', 'desc') 
      .get({
        success: res => {
          wx.hideLoading();
          let list = res.data.map(item => {
            const images = Array.isArray(item.images) && item.images.length > 0
              ? item.images
              : (item.image ? [item.image] : []);
            item.images = images;
            item.image = item.image || images[0] || '';
            item.title = item.title || item.content || '';
            if (item.createTime) {
              const date = new Date(item.createTime);
              item.createTimeStr = `${date.getMonth()+1}-${date.getDate()}`;
            }
            return item;
          });
          this.setData({ wishes: list, isLoading: false });
        },
        fail: err => {
          wx.hideLoading();
          console.error(err);
        }
      });
  },

  previewWishImages: function(e) {
    const index = Number(e.currentTarget.dataset.index);
    const wish = this.data.wishes[index];
    if (!wish) return;
    const images = wish.images && wish.images.length ? wish.images : (wish.image ? [wish.image] : []);
    if (images.length) {
      wx.previewImage({ current: images[0], urls: images });
    }
  },

  // 2. 🚀 神级交互：智能绑定商品
  bindProduct: function(e) {
    const wishId = e.currentTarget.dataset.id;

    wx.showLoading({ title: '拉取最新商品...' });
    
    // 自动去库里找你最近上架的 5 件衣服
    db.collection('products').where({ status: _.neq('offline') })
      .orderBy('createTime', 'desc').limit(5).get({
      success: res => {
        wx.hideLoading();
        const recentProducts = res.data;
        
        // 组装菜单选项：前几个是商品名，最后一个是手动输入
        let menuItems = recentProducts.map(p => `关联: ${p.title.substring(0, 10)}...`);
        menuItems.push('✍️ 手动输入商品 ID');

        wx.showActionSheet({
          itemList: menuItems,
          success: (actionRes) => {
            const tapIndex = actionRes.tapIndex;
            
            // 如果选了前几个自动拉取的商品
            if (tapIndex < recentProducts.length) {
              const selectedProductId = recentProducts[tapIndex]._id;
              this.executeBind(wishId, selectedProductId);
            } 
            // 如果选了最后一个“手动输入”
            else {
              wx.showModal({
                title: '手动绑定',
                content: '',
                editable: true,
                placeholderText: '请粘贴商品 ID',
                confirmColor: '#111111',
                success: (modalRes) => {
                  if (modalRes.confirm && modalRes.content) {
                    this.executeBind(wishId, modalRes.content.trim());
                  }
                }
              });
            }
          }
        });
      }
    });
  },

  // 执行写入数据库的绑定动作
  executeBind: function(wishId, productId) {
    wx.showLoading({ title: '施放魔法中...' });
    db.collection('wishes').doc(wishId).update({
      data: { linkedProductId: productId },
      success: () => {
        wx.hideLoading();
        wx.showToast({ title: '绑定成功！', icon: 'success' });
        this.loadWishes(); // 刷新，它会跑到“已上架”列表里
      }
    });
  },

  // 3. 解除绑定
  unbindProduct: function(e) {
    const wishId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '解除绑定',
      content: '解除后，市集里将恢复为点赞进度条，确定吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '解除中...' });
          db.collection('wishes').doc(wishId).update({
            data: { linkedProductId: null },
            success: () => {
              wx.hideLoading();
              wx.showToast({ title: '已解除', icon: 'success' });
              this.loadWishes();
            }
          });
        }
      }
    });
  },

  // 4. 删除乱发的心愿
  deleteWish: function(e) {
    const wishId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '这条心愿将被彻底清理',
      confirmColor: '#d32f2f',
      success: (res) => {
        if (res.confirm) {
          db.collection('wishes').doc(wishId).remove({
            success: () => {
              wx.showToast({ title: '已删除', icon: 'success' });
              this.loadWishes();
            }
          });
        }
      }
    });
  }
})
