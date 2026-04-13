/**
 * TSPL 指令生成工具
 * 汉印 N31 打印机支持 TSPL 指令集
 * 用于将图片数据转换为打印机可识别的指令
 */

/**
 * 将 Base64 PNG 图片转换为 TSPL BITMAP 指令
 * @param base64Image Base64 编码的 PNG 图片（包含 data:image/png;base64, 前缀）
 * @param width 图片宽度（像素）
 * @param height 图片高度（像素）
 * @param x 打印起始 X 坐标（点）
 * @param y 打印起始 Y 坐标（点）
 * @returns TSPL 指令数组（Uint8Array）
 */
export function imageToTsplBitmap(base64Image: string, width: number, height: number, x: number = 0, y: number = 0): Uint8Array {
  // 移除 Base64 前缀
  const imageData = base64Image.replace('data:image/png;base64,', '');

  // 解码 Base64
  const binaryString = atob(imageData);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // 解析 PNG 数据，提取位图
  // PNG 格式：8 字节签名 + IHDR 块 + IDAT 块（图像数据）+ IEND 块
  // 我们需要将 PNG 转换为 1bpp 位图用于打印

  // 简化处理：将 PNG 转为黑白二值图像
  const imageDataObj = base64ToImageData(imageData);
  const bitmap = imageDataTo1bppBitmap(imageDataObj);

  // 生成 TSPL BITMAP 指令
  // BITMAP x,y,width,height,data
  const tsplCommands: number[] = [];

  // BITMAP 指令头
  const bitmapHeader = `BITMAP ${x},${y},${Math.ceil(width / 8)},${height},`;
  for (let i = 0; i < bitmapHeader.length; i++) {
    tsplCommands.push(bitmapHeader.charCodeAt(i));
  }

  // 添加位图数据（每行数据需要补齐到字节边界）
  const bytesPerLine = Math.ceil(width / 8);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < bytesPerLine; col++) {
      tsplCommands.push(bitmap[row * bytesPerLine + col]);
    }
  }

  // 添加换行
  tsplCommands.push(0x0D); // CR
  tsplCommands.push(0x0A); // LF

  return new Uint8Array(tsplCommands);
}

/**
 * 将 Base64 图片数据转换为 ImageData
 */
function base64ToImageData(base64: string): { width: number; height: number; data: Uint8ClampedArray } {
  // 在小程序环境中，需要使用 canvas 来解析图片
  // 这里提供一个简化的实现框架

  // 注意：微信小程序环境需要使用 wx.createCanvasContext
  // 这个函数在实际使用时需要根据小程序 API 调整

  // 临时实现：返回空数据，实际使用需要小程序 canvas 支持
  return {
    width: 0,
    height: 0,
    data: new Uint8ClampedArray()
  };
}

/**
 * 将 ImageData 转换为 1bpp 位图（黑白二值）
 */
function imageDataTo1bppBitmap(imageData: { width: number; height: number; data: Uint8ClampedArray }): Uint8Array {
  const { width, height, data } = imageData;
  const bytesPerLine = Math.ceil(width / 8);
  const bitmap = new Uint8Array(bytesPerLine * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = (y * width + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];

      // 转换为灰度
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // 二值化（阈值 128）
      const bit = gray < 128 ? 1 : 0;

      // 设置位图数据（每个字节 8 个像素）
      const byteIndex = y * bytesPerLine + Math.floor(x / 8);
      const bitPosition = 7 - (x % 8);

      if (bit) {
        bitmap[byteIndex] |= (1 << bitPosition);
      }
    }
  }

  return bitmap;
}

/**
 * 生成完整的 TSPL 打印指令序列
 * @param commands TSPL 指令列表
 * @returns 完整的打印指令
 */
export function buildTsplCommands(commands: string[]): Uint8Array {
  let result = '';
  for (const cmd of commands) {
    result += cmd + '\r\n';
  }

  const bytes: number[] = [];
  for (let i = 0; i < result.length; i++) {
    bytes.push(result.charCodeAt(i));
  }

  return new Uint8Array(bytes);
}

/**
 * 生成打印面单的完整 TSPL 指令
 * @param base64Image Base64 图片
 * @param width 图片宽度
 * @param height 图片高度
 * @param paperWidth 纸张宽度（mm）
 * @param paperHeight 纸张高度（mm）
 * @returns TSPL 指令
 */
export function generateWaybillTspl(
  base64Image: string,
  imageWidth: number,
  imageHeight: number,
  paperWidth: number = 78,
  paperHeight: number = 130
): Uint8Array {
  // TSPL 指令序列
  const commands: string[] = [];

  // 1. 初始化打印机
  commands.push('SIZE ' + paperWidth + ' mm,' + paperHeight + ' mm');
  commands.push('GAP ' + paperHeight + ' mm,0 mm');
  commands.push('REFERENCE 0,0');
  commands.push('DIRECTION 1'); // 打印方向
  commands.push('CLS'); // 清除缓冲区

  // 2. 打印图片（BITMAP 指令）
  // 注意：实际图片数据需要通过 imageToTsplBitmap 转换
  // 这里简化处理，实际使用需要完整的图片转换逻辑
  commands.push(`BITMAP 0,0,${Math.ceil(imageWidth / 8)},${imageHeight},`);
  // 图片数据会在实际发送时添加

  // 3. 打印命令
  commands.push('PRINT 1,1');

  return buildTsplCommands(commands);
}

/**
 * 蓝牙数据包分包发送
 * @param data 要发送的数据
 * @param maxSize 每个包的最大大小（蓝牙 BLE 限制，通常 20 字节）
 * @returns 分包后的数据数组
 */
export function splitDataForBle(data: Uint8Array, maxSize: number = 20): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += maxSize) {
    const chunk = data.slice(i, Math.min(i + maxSize, data.length));
    chunks.push(chunk);
  }
  return chunks;
}

export default {
  imageToTsplBitmap,
  buildTsplCommands,
  generateWaybillTspl,
  splitDataForBle
};
