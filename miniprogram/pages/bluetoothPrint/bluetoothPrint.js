// miniprogram/pages/bluetoothPrint/bluetoothPrint.js
const api = require('../../utils/api');
const { printer } = require('../../utils/bluetooth-printer');

Page({
  data: {
    shipmentId: null,
    shipmentIds: [],     // 批量打印时的多个发货单 ID
    currentShipmentIndex: 0,  // 当前打印的发货单索引
    mergeGroupId: null,
    isMerge: false,
    waybillImage: '',
    expressCode: '',
    expressNo: '',
    imageWidth: 0,
    imageHeight: 0,
    waybillType: '',  // 'electronic' 或 'custom'

    // 蓝牙相关
    connected: false,
    deviceName: '',
    deviceId: '',
    devices: [],
    pairedDeviceId: '',
    showDeviceModal: false,

    // 打印设置
    copyCount: 1,
    isPrinting: false,
    waybillImages: []  // 批量打印时的所有面单
  },

  onLoad: async function(options) {
    const shipmentId = options.shipmentId || null;
    const shipmentIds = options.shipmentIds ? options.shipmentIds.split(',') : [];
    const mergeGroupId = options.mergeGroupId || null;
    const isMerge = options.isMerge === 'true';

    this.setData({
      shipmentId,
      shipmentIds,
      mergeGroupId,
      isMerge
    });

    // 设置页面标题
    if (shipmentIds.length > 0) {
      wx.setNavigationBarTitle({
        title: `批量打印 (${shipmentIds.length}个)`
      });
    } else if (isMerge) {
      wx.setNavigationBarTitle({
        title: '合并打印面单'
      });
    } else {
      wx.setNavigationBarTitle({
        title: '蓝牙打印面单'
      });
    }

    // 加载面单图片
    await this.loadWaybillImage();

    // 检查已配对设备
    this.checkPairedDevice();
  },

  onUnload: function() {
    // 页面卸载时不断开蓝牙，保持连接状态
  },

  // 加载面单图片
  async loadWaybillImage() {
    wx.showLoading({ title: '加载面单...' });

    try {
      let res;

      // 批量打印模式：从多个 shipmentIds 中获取面单
      if (this.data.shipmentIds.length > 0) {
        const currentShipmentId = this.data.shipmentIds[this.data.currentShipmentIndex];
        res = await api.get(`/shipments/${currentShipmentId}/waybill-image`);
        this.setData({
          waybillImage: res.waybillImage,
          expressCode: res.expressCode,
          expressNo: res.expressNo,
          imageWidth: res.width,
          imageHeight: res.height,
          waybillType: res.waybillType || 'custom'
        });
      } else if (this.data.isMerge && this.data.mergeGroupId) {
        // 合并发货：获取所有面单
        res = await api.get(`/merge-groups/${this.data.mergeGroupId}/waybill-images`);
        if (res.waybills && res.waybills.length > 0) {
          // 使用第一个面单（后续可支持切换）
          const waybill = res.waybills[0];
          this.setData({
            waybillImage: waybill.waybillImage,
            expressCode: waybill.expressCode,
            expressNo: waybill.expressNo,
            imageWidth: waybill.width,
            imageHeight: waybill.height,
            waybillType: waybill.waybillType || 'custom'
          });
        }
      } else {
        // 单发货单
        res = await api.get(`/shipments/${this.data.shipmentId}/waybill-image`);
        this.setData({
          waybillImage: res.waybillImage,
          expressCode: res.expressCode,
          expressNo: res.expressNo,
          imageWidth: res.width,
          imageHeight: res.height,
          waybillType: res.waybillType || 'custom'
        });
      }
    } catch (err) {
      console.error('加载面单失败:', err);
      wx.showToast({ title: '加载面单失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 检查已配对设备
  checkPairedDevice: function() {
    const pairedDeviceId = printer.getPairedDevice();
    if (pairedDeviceId) {
      this.setData({ pairedDeviceId });
    }
  },

  // 处理连接：打开设备选择弹窗
  handleConnect: function() {
    this.setData({ showDeviceModal: true });
    // 自动开始搜索
    this.startDiscovery();
  },

  // 连接已配对设备
  async connectPairedDevice() {
    if (!this.data.pairedDeviceId) return;

    wx.showLoading({ title: '连接中...' });
    try {
      await printer.init();
      await printer.connect(this.data.pairedDeviceId);
      this.setData({
        connected: true,
        deviceId: this.data.pairedDeviceId,
        deviceName: '已配对设备',
        showDeviceModal: false
      });
      wx.hideLoading();
      wx.showToast({ title: '连接成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '连接失败：' + err.message, icon: 'none' });
    }
  },

  // 开始搜索设备
  async startDiscovery() {
    this.setData({ devices: [] });

    try {
      await printer.init();
      await printer.discoverDevices();

      // 延时获取设备列表
      setTimeout(async () => {
        const devices = await printer.getBluetoothDevices();
        this.setData({ devices });
      }, 3000);
    } catch (err) {
      console.error('搜索设备失败:', err);
      wx.showToast({ title: '搜索失败', icon: 'none' });
    }
  },

  // 选择设备
  async selectDevice(e) {
    const device = e.currentTarget.dataset.device;

    wx.showLoading({ title: '连接中...' });
    try {
      await printer.connect(device.deviceId);
      this.setData({
        connected: true,
        deviceId: device.deviceId,
        deviceName: device.name || '未知设备',
        showDeviceModal: false
      });
      wx.hideLoading();
      wx.showToast({ title: '连接成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '连接失败', icon: 'none' });
    }
  },

  // 关闭设备弹窗
  closeDeviceModal: function() {
    printer.stopDiscovery();
    this.setData({ showDeviceModal: false });
  },

  // 断开连接
  async handleDisconnect() {
    try {
      await printer.disconnect();
      this.setData({
        connected: false,
        deviceId: '',
        deviceName: ''
      });
      wx.showToast({ title: '已断开', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: '断开失败', icon: 'none' });
    }
  },

  // 增加份数
  increaseCopy: function() {
    const max = 5;
    if (this.data.copyCount < max) {
      this.setData({ copyCount: this.data.copyCount + 1 });
    }
  },

  // 减少份数
  decreaseCopy: function() {
    if (this.data.copyCount > 1) {
      this.setData({ copyCount: this.data.copyCount - 1 });
    }
  },

  // 执行打印
  async handlePrint() {
    if (!this.data.connected) {
      wx.showToast({ title: '请先连接打印机', icon: 'none' });
      return;
    }

    this.setData({ isPrinting: true });
    wx.showLoading({ title: '打印中...', mask: true });

    try {
      // 生成 TSPL 指令并发送
      await this.printWaybill();

      wx.hideLoading();
      wx.showToast({ title: '打印完成', icon: 'success' });

      // 批量打印模式：打印完一个后继续打印下一个
      if (this.data.shipmentIds.length > 0) {
        const nextIndex = this.data.currentShipmentIndex + 1;
        if (nextIndex < this.data.shipmentIds.length) {
          // 还有下一个，继续打印
          wx.showModal({
            title: '继续打印',
            content: `已打印 ${this.data.currentShipmentIndex + 1}/${this.data.shipmentIds.length}，是否继续打印下一个？`,
            confirmText: '继续',
            cancelText: '返回',
            success: (res) => {
              if (res.confirm) {
                this.loadNextShipment(nextIndex);
              } else {
                setTimeout(() => {
                  wx.navigateBack();
                }, 500);
              }
            }
          });
        } else {
          // 全部打印完成
          wx.showModal({
            title: '全部完成',
            content: `已完成 ${this.data.shipmentIds.length} 个面单的打印`,
            showCancel: false,
            success: () => {
              setTimeout(() => {
                wx.navigateBack();
              }, 500);
            }
          });
        }
      } else {
        // 单打印模式：直接返回
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      }
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '打印失败',
        content: err.message || '未知错误',
        showCancel: false
      });
    } finally {
      this.setData({ isPrinting: false });
    }
  },

  // 加载下一个发货单的面单
  async loadNextShipment(nextIndex) {
    this.setData({ currentShipmentIndex: nextIndex });
    await this.loadWaybillImage();
  },

  // 打印面单（核心方法）
  async printWaybill() {
    // 1. 解析 Base64 图片
    const base64Image = this.data.waybillImage;
    const width = this.data.imageWidth;
    const height = this.data.imageHeight;

    // 2. 生成 TSPL 指令
    // TSPL 指令序列
    const tsplCommands = [
      'SIZE 78 mm,130 mm',
      'GAP 130 mm,0 mm',
      'REFERENCE 0,0',
      'DIRECTION 1',
      'CLS',
      `BITMAP 0,0,${Math.ceil(width / 8)},${height},`
      // 图片数据会在下面添加
    ];

    // 3. 转换图片为位图数据
    const bitmapData = await this.convertImageToBitmap(base64Image, width, height);

    // 4. 构建完整指令
    let fullCommand = '';
    for (const cmd of tsplCommands) {
      fullCommand += cmd + '\r\n';
    }

    // 添加位图数据
    fullCommand += bitmapData;
    fullCommand += '\r\n';

    // 添加打印命令
    fullCommand += 'PRINT 1,1\r\n';

    // 5. 转换为 Uint8Array
    const encoder = new TextEncoder();
    const data = encoder.encode(fullCommand);

    // 6. 通过蓝牙发送
    await printer.write(data.buffer);
  },

  // 将 Base64 图片转换为位图数据（简化版）
  async convertImageToBitmap(base64Image, width, height) {
    // 创建 canvas 进行图片处理
    const canvas = wx.createOffscreenCanvas({
      type: '2d',
      width: width,
      height: height
    });

    const ctx = canvas.getContext('2d');

    // 加载图片
    const img = await this.loadImage(base64Image);
    ctx.drawImage(img, 0, 0, width, height);

    // 获取像素数据
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    // 转换为二值位图（黑白）
    const bytesPerLine = Math.ceil(width / 8);
    const bitmap = new Uint8Array(bytesPerLine * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;
        const r = pixels[pixelIndex];
        const g = pixels[pixelIndex + 1];
        const b = pixels[pixelIndex + 2];

        // 转换为灰度
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;

        // 二值化（阈值 128）
        const bit = gray < 128 ? 1 : 0;

        // 设置位图数据
        const byteIndex = y * bytesPerLine + Math.floor(x / 8);
        const bitPosition = 7 - (x % 8);

        if (bit) {
          bitmap[byteIndex] |= (1 << bitPosition);
        }
      }
    }

    // 转换为十六进制字符串（TSPL 格式）
    let hexString = '';
    for (let i = 0; i < bitmap.length; i++) {
      hexString += String.fromCharCode(bitmap[i]);
    }

    return hexString;
  },

  // 加载 Base64 图片到 Image 对象
  loadImage(base64Image) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = base64Image;
    });
  }
});
