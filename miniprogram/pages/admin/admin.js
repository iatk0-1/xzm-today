const db = wx.cloud.database()

// 拖拽网格配置：格子宽度 90 + 间距 15 = 105
const ITEM_SIZE = 105; 
const COLUMNS = 3;

Page({
  data: {
    videoUrl: '', // 🚀 新增：用来存视频的云端地址
    // 媒体池 (涵盖封面与轮播)
    mediaList: [], 
    dragIndex: -1, // 当前正在拖拽的图片索引
    dragAreaHeight: ITEM_SIZE, // 容器动态高度
    uploadBtnX: 0,
    uploadBtnY: 0,
    tempMoveX: 0,
    tempMoveY: 0,

    // 🚀 新增的文字详情字段
    shippingInfo: '付款后按排单顺序发货', // 给个默认值，省得每次敲
    description: '',
    fabricCare: '',
    sizeChartTip: '',
    warmTips: '',

    title: '',
    selectedTags: [],
    tagInput: '',
    historyTags: ['春装新款', '半身裙', '外套', '内搭'], 

    sizeOptions: [
      { name: '均码', selected: false }, { name: 'XS', selected: false }, 
      { name: 'S', selected: false }, { name: 'M', selected: false }, 
      { name: 'L', selected: false }, { name: 'XL', selected: false }, { name: 'XXL', selected: false }
    ],
    colors: [],
    colorInput: '',
    skuList: [],
    batchPrice: '',
    batchStock: '',

    lookbookImgs: [],
    detailImgs: [],

    manualRelated: [], 
    showRelatedModal: false,
    searchKeyword: '',
    allProducts: [], 
    filteredProducts: [] 
  },

  onLoad() {
    let history = wx.getStorageSync('historyTags');
    if(history) this.setData({ historyTags: history });
    this.refreshGrid();
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  // ================= 拖拽媒体池核心黑科技 =================
  // 根据数组计算每个格子的 x, y 坐标
  refreshGrid(list = this.data.mediaList) {
    let positionedList = list.map((item, index) => {
      // 只有不在拖拽状态的元素才重新分配坐标
      if (index !== this.data.dragIndex) {
        item.x = (index % COLUMNS) * ITEM_SIZE;
        item.y = Math.floor(index / COLUMNS) * ITEM_SIZE;
      }
      return item;
    });

    // 计算上传按钮的位置
    let btnIndex = list.length;
    let btnX = (btnIndex % COLUMNS) * ITEM_SIZE;
    let btnY = Math.floor(btnIndex / COLUMNS) * ITEM_SIZE;
    
    // 计算整个区域需要多高 (行数 * 格子高度)
    let rows = Math.ceil((btnIndex + 1) / COLUMNS);

    this.setData({
      mediaList: positionedList,
      uploadBtnX: btnX,
      uploadBtnY: btnY,
      dragAreaHeight: rows * ITEM_SIZE
    });
  },

  chooseMedia() {
    wx.chooseMedia({
      count: 9 - this.data.mediaList.length,
      mediaType: ['image'],
      success: (res) => {
        let newItems = res.tempFiles.map((file, i) => ({
          id: 'img_' + Date.now() + i,
          url: file.tempFilePath,
          x: 0, y: 0 // 初始占位，refreshGrid 会分配真实坐标
        }));
        let list = this.data.mediaList.concat(newItems);
        this.refreshGrid(list);
      }
    });
  },

  removeMedia(e) {
    const index = e.currentTarget.dataset.index;
    let list = this.data.mediaList;
    list.splice(index, 1);
    this.refreshGrid(list); // 删掉后，排在后面的自动往前补位，封面动态易主！
  },

  // 长按触发拖拽
  onDragStart(e) {
    wx.vibrateShort(); // 给手感
    this.setData({ dragIndex: e.currentTarget.dataset.index });
  },

  // 拖动过程中实时计算落点
  onDragMove(e) {
    if (this.data.dragIndex === -1) return;
    this.data.tempMoveX = e.detail.x;
    this.data.tempMoveY = e.detail.y;
  },

  // 松手，结算位置并重排数组
  onDragEnd() {
    if (this.data.dragIndex === -1) return;
    let dragIdx = this.data.dragIndex;
    let list = [...this.data.mediaList];
    
    // 根据最后停留的像素坐标，反推它在第几个坑位
    let dropCol = Math.round(this.data.tempMoveX / ITEM_SIZE);
    let dropRow = Math.round(this.data.tempMoveY / ITEM_SIZE);
    
    // 边界保护
    if (dropCol < 0) dropCol = 0;
    if (dropCol >= COLUMNS) dropCol = COLUMNS - 1;
    if (dropRow < 0) dropRow = 0;

    let targetIdx = dropRow * COLUMNS + dropCol;
    if (targetIdx >= list.length) targetIdx = list.length - 1;

    // 如果位置变了，就把数组里的元素抽出来，插到新位置
    if (targetIdx !== dragIdx) {
      let movingItem = list.splice(dragIdx, 1)[0];
      list.splice(targetIdx, 0, movingItem);
    }

    // 结束拖拽状态，并全局重新排布坐标
    this.setData({ dragIndex: -1 }, () => {
      this.refreshGrid(list);
    });
  },

  // ================= 视频上传核心功能 (带实时进度条版) =================
  uploadVideo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'], 
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      compressed: true, 
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        wx.showLoading({ title: '连接云端中...' });
        
        const cloudPath = `videos/${Date.now()}_${Math.floor(Math.random()*1000)}.mp4`;
        
        const uploadTask = wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempFilePath,
          success: uploadRes => {
            wx.hideLoading();
            wx.showToast({ title: '视频上传成功', icon: 'success' });
            this.setData({ videoUrl: uploadRes.fileID });
          },
          fail: err => {
            wx.hideLoading();
            // 🚀 强力报错：如果失败，用弹窗把错误原因死死拍在屏幕上！
            wx.showModal({ 
              title: '上传失败', 
              content: err.errMsg || JSON.stringify(err), 
              showCancel: false 
            });
            console.error('上传失败完整报错：', err);
          }
        });

        // 🚀 核心黑科技：监听真实进度，是死是活一目了然！
        uploadTask.onProgressUpdate((res) => {
          wx.showLoading({ title: `正在上传 ${res.progress}%` });
        });
      }
    });
  },

  removeVideo() {
    this.setData({ videoUrl: '' });
  },
  // ==================================================
  // ================= 选填图上传 (Lookbook / Detail) =================
  chooseExtraImage(e) {
    const type = e.currentTarget.dataset.type;
    let currentList = this.data[`${type}Imgs`];
    wx.chooseMedia({
      count: 9, mediaType: ['image'],
      success: (res) => {
        const newPaths = res.tempFiles.map(file => file.tempFilePath);
        this.setData({ [`${type}Imgs`]: currentList.concat(newPaths) });
      }
    })
  },
  removeExtraImage(e) {
    const { type, index } = e.currentTarget.dataset;
    let list = this.data[`${type}Imgs`];
    list.splice(index, 1);
    this.setData({ [`${type}Imgs`]: list });
  },

  // ================= 分类、尺码、颜色、SKU (保留原逻辑) =================
  addTag() {
    let val = this.data.tagInput.trim();
    if (val && !this.data.selectedTags.includes(val)) {
      this.setData({ selectedTags: [...this.data.selectedTags, val], tagInput: '' });
      let history = this.data.historyTags;
      if(!history.includes(val)){
        history.unshift(val); 
        if(history.length > 10) history.pop(); 
        this.setData({ historyTags: history });
        wx.setStorageSync('historyTags', history);
      }
    }
  },
  removeTag(e) {
    let tag = e.currentTarget.dataset.tag;
    this.setData({ selectedTags: this.data.selectedTags.filter(t => t !== tag) });
  },
  selectHistoryTag(e) {
    let tag = e.currentTarget.dataset.tag;
    if (!this.data.selectedTags.includes(tag)) {
      this.setData({ selectedTags: [...this.data.selectedTags, tag] });
    }
  },
  toggleSize(e) {
    const index = e.currentTarget.dataset.index;
    const key = `sizeOptions[${index}].selected`;
    this.setData({ [key]: !this.data.sizeOptions[index].selected }, () => { this.generateSkuMatrix(); });
  },
  addColor() {
    let val = this.data.colorInput.trim();
    if (val && !this.data.colors.includes(val)) {
      this.setData({ colors: [...this.data.colors, val], colorInput: '' }, () => { this.generateSkuMatrix(); });
    }
  },
  removeColor(e) {
    const index = e.currentTarget.dataset.index;
    let colors = this.data.colors;
    colors.splice(index, 1);
    this.setData({ colors }, () => { this.generateSkuMatrix(); });
  },
  generateSkuMatrix() {
    let activeSizes = this.data.sizeOptions.filter(s => s.selected).map(s => s.name);
    let activeColors = this.data.colors;
    if (activeSizes.length === 0 && activeColors.length === 0) {
      this.setData({ skuList: [] }); return;
    }
    let sizes = activeSizes.length > 0 ? activeSizes : ['默认尺码'];
    let colors = activeColors.length > 0 ? activeColors : ['默认颜色'];
    let newSkuList = [];
    let oldSkuList = this.data.skuList;
    colors.forEach(c => {
      sizes.forEach(s => {
        let existItem = oldSkuList.find(old => old.color === c && old.size === s);
        newSkuList.push({
          color: c, size: s,
          price: existItem ? existItem.price : '',
          stock: existItem ? existItem.stock : ''
        });
      });
    });
    this.setData({ skuList: newSkuList });
  },
  applyBatch() {
    const { batchPrice, batchStock, skuList } = this.data;
    if (!batchPrice && !batchStock) return wx.showToast({ title: '请输入值', icon: 'none' });
    let newList = skuList.map(item => ({
      ...item,
      price: batchPrice || item.price,
      stock: batchStock || item.stock
    }));
    this.setData({ skuList: newList });
  },
  onSkuInput(e) {
    const { index, field } = e.currentTarget.dataset;
    const key = `skuList[${index}].${field}`;
    this.setData({ [key]: e.detail.value });
  },

  // ================= 关联商品 (彻底修复版) =================
  openRelatedModal() {
    wx.showLoading({ title: '加载中...' });
    db.collection('products').field({ _id:true, title:true, image:true, displayPrice:true, price:true }).get({
      success: res => {
        wx.hideLoading();
        let selectedIds = this.data.manualRelated.map(item => item._id);
        
        // 🚀 核心修复：只保留有 title 和 image 的正常商品，过滤掉脏数据
        let validProducts = res.data.filter(p => p.title && p.image); 

        let products = validProducts.map(p => ({
          ...p,
          selected: selectedIds.includes(p._id)
        }));
        this.setData({ 
          allProducts: products, 
          filteredProducts: products, 
          showRelatedModal: true,
          searchKeyword: '' 
        });
      },
      fail: err => { wx.hideLoading(); wx.showToast({ title: '获取失败', icon: 'none' }); }
    });
  },
  closeRelatedModal() {
    this.setData({ showRelatedModal: false });
  },
  onSearchInput(e) {
    const keyword = e.detail.value.trim().toLowerCase();
    this.setData({ searchKeyword: keyword });
    if (!keyword) {
      this.setData({ filteredProducts: this.data.allProducts });
      return;
    }
    let filtered = this.data.allProducts.filter(p => p.title.toLowerCase().includes(keyword));
    this.setData({ filteredProducts: filtered });
  },
  // 完美修复：同步修改总数组和过滤数组，强制刷新页面
  toggleRelated(e) {
    let item = e.currentTarget.dataset.item;
    let all = this.data.allProducts;
    let filtered = this.data.filteredProducts;
    
    let indexInAll = all.findIndex(p => p._id === item._id);
    if (indexInAll > -1) {
      all[indexInAll].selected = !all[indexInAll].selected;
    }

    let indexInFiltered = filtered.findIndex(p => p._id === item._id);
    if (indexInFiltered > -1) {
      filtered[indexInFiltered].selected = all[indexInAll].selected;
    }

    this.setData({ allProducts: all, filteredProducts: filtered });
  },
  confirmRelated() {
    let selectedItems = this.data.allProducts.filter(p => p.selected);
    this.setData({ manualRelated: selectedItems, showRelatedModal: false });
  },
  removeRelated(e) {
    let id = e.currentTarget.dataset.id;
    let newList = this.data.manualRelated.filter(item => item._id !== id);
    this.setData({ manualRelated: newList });
  },

  // ================= 终极打包上架 (带全自动图片上云补丁版) =================
  submitProduct() {
    // 提取当前数据
    const { mediaList, title, selectedTags, skuList, lookbookImgs, detailImgs, manualRelated, videoUrl } = this.data;

    if (mediaList.length === 0 || !title || skuList.length === 0) {
      return wx.showToast({ title: '首图/名称/尺码颜色不能为空', icon: 'none' });
    }

    // 自动算价算法
    let prices = skuList.map(item => Number(item.price)).filter(p => !isNaN(p) && p > 0);
    if(prices.length === 0) return wx.showToast({ title: '请填写正确的SKU价格', icon: 'none' });
    let minPrice = Math.min(...prices);
    let maxPrice = Math.max(...prices);
    let finalDisplayPrice = (minPrice === maxPrice) ? String(minPrice) : `${minPrice} - ${maxPrice}`;

    wx.showLoading({ title: '扫描图片中...', mask: true });

    let that = this;
    let uploadTasks = []; // 建立一个上传队列

    // 1. 扫描主图和轮播图 (找出尚未上云的临时文件)
    mediaList.forEach((item, index) => {
      if (!item.url.startsWith('cloud://')) {
        uploadTasks.push({
          path: item.url,
          callback: (cloudId) => { that.data.mediaList[index].url = cloudId; } // 传完替换回云端永久ID
        });
      }
    });

    // 2. 扫描 Lookbook 详情长图
    lookbookImgs.forEach((url, index) => {
      if (!url.startsWith('cloud://')) {
        uploadTasks.push({
          path: url,
          callback: (cloudId) => { that.data.lookbookImgs[index] = cloudId; }
        });
      }
    });

    // 3. 扫描 Detail 细节图
    detailImgs.forEach((url, index) => {
      if (!url.startsWith('cloud://')) {
        uploadTasks.push({
          path: url,
          callback: (cloudId) => { that.data.detailImgs[index] = cloudId; }
        });
      }
    });

    // 🚀 核心黑科技：递归排队上传（完美避开任何机型报错，并且展示进度）
    let currentIndex = 0;
    function uploadNext() {
      // 检查队列，如果全传完了，就召唤最终的写入函数！
      if (currentIndex >= uploadTasks.length) {
        that.doSubmitToDatabase(finalDisplayPrice);
        return;
      }

      let task = uploadTasks[currentIndex];
      wx.showLoading({ title: `上传图片 ${currentIndex + 1}/${uploadTasks.length}`, mask: true });

      // 提取图片后缀名，上传到云开发存储的 images 文件夹中
      let ext = task.path.match(/\.([^.]+)$/) ? task.path.match(/\.([^.]+)$/)[1] : 'png';
      wx.cloud.uploadFile({
        cloudPath: `images/img_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`,
        filePath: task.path,
        success: res => {
          task.callback(res.fileID); // 把本地路径替换成永久云端 ID
          currentIndex++;
          uploadNext(); // 传完一张，触发下一张
        },
        fail: err => {
          wx.hideLoading();
          wx.showModal({ title: '图片上传失败', content: err.errMsg, showCancel: false });
        }
      });
    }

    // 启动自动上传流水线
    uploadNext();
  },

  // ================= 真正写入数据库的终极函数 =================
  doSubmitToDatabase(finalDisplayPrice) {
    wx.showLoading({ title: '正在写入数据...', mask: true });
    
    // 🚀 核心修改 1：把新加的 5 个文字字段提取出来
    const { mediaList, title, selectedTags, skuList, lookbookImgs, detailImgs, manualRelated, videoUrl, shippingInfo, description, fabricCare, sizeChartTip, warmTips } = this.data;

    let finalMainImage = mediaList[0].url;
    let finalBannerImgs = mediaList.slice(1).map(item => item.url);

    // 🚀 核心修改 2：把它们统统塞进要发给数据库的包裹里
    const productData = {
      image: finalMainImage,          
      bannerImgs: finalBannerImgs,    
      videoUrl: videoUrl,             
      title: title,
      tags: selectedTags,
      skuMatrix: skuList,
      displayPrice: finalDisplayPrice, 
      lookbookImgs: lookbookImgs,
      detailImgs: detailImgs,
      manualRelatedIds: manualRelated.map(item => item._id), 
      
      // 新增的文字字段写入数据库
      shippingInfo: shippingInfo,
      description: description,
      fabricCare: fabricCare,
      sizeChartTip: sizeChartTip,
      warmTips: warmTips,

      createTime: db.serverDate()
    };

    db.collection('products').add({
      data: productData,
      success: res => {
        wx.hideLoading();
        wx.showToast({ title: '完美上架！', icon: 'success' });
        setTimeout(() => { wx.navigateBack(); }, 1500);
      },
      fail: err => { wx.hideLoading(); console.error(err); }
    });
  }
})