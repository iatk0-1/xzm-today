/**
 * 蓝牙打印机工具模块
 * 支持汉印 N31 热敏打印机
 */

const API = require('./api');

// 蓝牙服务配置（汉印 N31）
const BLE_CONFIG = {
  // 蓝牙服务 UUID（汉印设备通常使用）
  serviceId: '000018F0-0000-1000-8000-00805F9B34FB',
  // 特征值 UUID（写入）
  writeCharacteristicId: '00002AF1-0000-1000-8000-00805F9B34FB',
  // 特征值 UUID（通知）
  notifyCharacteristicId: '00002AF0-0000-1000-8000-00805F9B34FB',
  // 最大包大小（BLE 限制）
  maxPacketSize: 20
};

// 本地缓存的已配对设备 key
const PAIRED_DEVICE_KEY = 'paired_printer_device';

/**
 * 蓝牙打印机管理类
 */
class BluetoothPrinter {
  constructor() {
    this.deviceId = null;
    this.connected = false;
    this.serviceId = BLE_CONFIG.serviceId;
    this.writeId = BLE_CONFIG.writeCharacteristicId;
    this.notifyId = BLE_CONFIG.notifyCharacteristicId;
  }

  /**
   * 初始化蓝牙适配器
   */
  async init() {
    return new Promise((resolve, reject) => {
      wx.openBluetoothAdapter({
        success: (res) => {
          console.log('蓝牙适配器初始化成功', res);
          resolve(res);
        },
        fail: (err) => {
          console.error('蓝牙适配器初始化失败', err);
          if (err.errCode === 10001) {
            // 蓝牙未开启
            wx.showModal({
              title: '提示',
              content: '蓝牙未开启，请打开手机蓝牙',
              showCancel: false
            });
          }
          reject(err);
        }
      });
    });
  }

  /**
   * 搜索附近的蓝牙设备
   */
  async discoverDevices() {
    return new Promise((resolve, reject) => {
      wx.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: false,
        success: (res) => {
          console.log('开始搜索蓝牙设备', res);
          // 监听新设备发现
          wx.onBluetoothDeviceFound((res) => {
            res.devices.forEach(device => {
              console.log('发现设备:', device.name, device.deviceId, device.RSSI);
            });
          });
          resolve(res);
        },
        fail: (err) => {
          console.error('搜索蓝牙设备失败', err);
          reject(err);
        }
      });

      // 搜索 10 秒后停止
      setTimeout(() => {
        this.stopDiscovery();
      }, 10000);
    });
  }

  /**
   * 停止搜索
   */
  stopDiscovery() {
    wx.stopBluetoothDevicesDiscovery({
      success: (res) => {
        console.log('停止搜索蓝牙设备', res);
      }
    });
  }

  /**
   * 获取已搜索到的设备列表
   */
  async getBluetoothDevices() {
    return new Promise((resolve, reject) => {
      wx.getBluetoothDevices({
        success: (res) => {
          // 过滤出打印机设备（名称包含 HPRT、Hanin、N31 等）
          const printers = res.devices.filter(device => {
            const name = device.name || '';
            return name.includes('HPRT') ||
                   name.includes('Hanin') ||
                   name.includes('N31') ||
                   name.includes('H');
          });
          console.log('找到的打印机设备:', printers);
          resolve(printers);
        },
        fail: (err) => {
          console.error('获取设备列表失败', err);
          reject(err);
        }
      });
    });
  }

  /**
   * 连接蓝牙设备
   */
  async connect(deviceId) {
    return new Promise((resolve, reject) => {
      wx.showLoading({ title: '连接中...' });

      wx.createBLEConnection({
        deviceId: deviceId,
        success: (res) => {
          console.log('连接成功', res);
          this.deviceId = deviceId;
          // 保存已配对设备
          this.savePairedDevice(deviceId);
          // 获取服务
          this.getDeviceServices(deviceId)
            .then(() => {
              wx.hideLoading();
              this.connected = true;
              resolve(res);
            })
            .catch(reject);
        },
        fail: (err) => {
          console.error('连接失败', err);
          wx.hideLoading();
          reject(err);
        }
      });

      // 超时处理
      setTimeout(() => {
        wx.hideLoading();
        reject(new Error('连接超时'));
      }, 15000);
    });
  }

  /**
   * 获取设备服务
   */
  async getDeviceServices(deviceId) {
    return new Promise((resolve, reject) => {
      wx.getBLEDeviceServices({
        deviceId: deviceId,
        success: (res) => {
          console.log('获取设备服务', res);
          // 查找打印服务
          const printService = res.services.find(s =>
            s.uuid.toLowerCase().includes('18f0') ||
            s.uuid.toLowerCase().includes('18f0')
          );

          if (printService) {
            this.serviceId = printService.uuid;
            console.log('找到打印服务:', this.serviceId);
            // 获取特征值
            this.getCharacteristics(deviceId, this.serviceId)
              .then(resolve)
              .catch(reject);
          } else {
            // 如果没有找到特定服务，使用第一个服务
            this.serviceId = res.services[0].uuid;
            console.log('使用默认服务:', this.serviceId);
            this.getCharacteristics(deviceId, this.serviceId)
              .then(resolve)
              .catch(reject);
          }
        },
        fail: (err) => {
          console.error('获取服务失败', err);
          reject(err);
        }
      });
    });
  }

  /**
   * 获取特征值
   */
  async getCharacteristics(deviceId, serviceId) {
    return new Promise((resolve, reject) => {
      wx.getBLEDeviceCharacteristics({
        deviceId: deviceId,
        serviceId: serviceId,
        success: (res) => {
          console.log('获取特征值', res);
          // 查找写入和通知特征值
          for (const characteristic of res.characteristics) {
            if (characteristic.properties.write || characteristic.properties.writeNoResponse) {
              this.writeId = characteristic.uuid;
            }
            if (characteristic.properties.notify) {
              this.notifyId = characteristic.uuid;
            }
          }
          console.log('写入特征值:', this.writeId);
          console.log('通知特征值:', this.notifyId);
          resolve(res);
        },
        fail: (err) => {
          console.error('获取特征值失败', err);
          reject(err);
        }
      });
    });
  }

  /**
   * 发送数据到打印机
   */
  async write(data) {
    if (!this.deviceId || !this.connected) {
      throw new Error('蓝牙未连接');
    }

    // 分包发送
    const chunks = this.splitData(data);

    for (let i = 0; i < chunks.length; i++) {
      await this.writeChunk(chunks[i]);
      // 小包之间延时，避免数据丢失
      if (i < chunks.length - 1) {
        await this.sleep(10);
      }
    }
  }

  /**
   * 写入单个数据包
   */
  async writeChunk(chunk) {
    return new Promise((resolve, reject) => {
      wx.writeBLECharacteristicValue({
        deviceId: this.deviceId,
        serviceId: this.serviceId,
        characteristicId: this.writeId,
        value: chunk,
        success: (res) => {
          console.log('写入成功', res);
          resolve(res);
        },
        fail: (err) => {
          console.error('写入失败', err);
          reject(err);
        }
      });
    });
  }

  /**
   * 分包数据
   */
  splitData(data) {
    const chunks = [];
    const maxSize = BLE_CONFIG.maxPacketSize;

    if (data instanceof ArrayBuffer) {
      const uint8Array = new Uint8Array(data);
      for (let i = 0; i < uint8Array.length; i += maxSize) {
        const chunk = uint8Array.slice(i, Math.min(i + maxSize, uint8Array.length));
        chunks.push(chunk.buffer);
      }
    } else if (data instanceof Uint8Array) {
      for (let i = 0; i < data.length; i += maxSize) {
        const chunk = data.slice(i, Math.min(i + maxSize, data.length));
        chunks.push(chunk.buffer);
      }
    }

    return chunks;
  }

  /**
   * 延时工具
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 断开蓝牙连接
   */
  async disconnect() {
    if (!this.deviceId) {
      return;
    }

    return new Promise((resolve, reject) => {
      wx.closeBLEConnection({
        deviceId: this.deviceId,
        success: (res) => {
          console.log('断开连接成功', res);
          this.deviceId = null;
          this.connected = false;
          resolve(res);
        },
        fail: (err) => {
          console.error('断开连接失败', err);
          reject(err);
        }
      });
    });
  }

  /**
   * 保存已配对设备
   */
  savePairedDevice(deviceId) {
    try {
      wx.setStorageSync(PAIRED_DEVICE_KEY, deviceId);
      console.log('保存已配对设备:', deviceId);
    } catch (e) {
      console.error('保存设备失败', e);
    }
  }

  /**
   * 获取已配对设备
   */
  getPairedDevice() {
    try {
      const deviceId = wx.getStorageSync(PAIRED_DEVICE_KEY);
      if (deviceId) {
        console.log('读取已配对设备:', deviceId);
      }
      return deviceId;
    } catch (e) {
      console.error('读取设备失败', e);
      return null;
    }
  }

  /**
   * 清除已配对设备
   */
  clearPairedDevice() {
    try {
      wx.removeStorageSync(PAIRED_DEVICE_KEY);
      console.log('清除已配对设备');
    } catch (e) {
      console.error('清除设备失败', e);
    }
  }

  /**
   * 尝试重连已配对设备
   */
  async reconnect() {
    const pairedDeviceId = this.getPairedDevice();
    if (!pairedDeviceId) {
      return false;
    }

    try {
      await this.init();
      await this.connect(pairedDeviceId);
      return true;
    } catch (err) {
      console.error('重连失败', err);
      return false;
    }
  }
}

// 导出单例
const printer = new BluetoothPrinter();

module.exports = {
  BluetoothPrinter,
  printer,
  BLE_CONFIG
};
