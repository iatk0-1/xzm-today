// 与弹窗升降共用展开进度，保持当前图索引，不重建图片或视频。
function getGalleryLayout(width, progress, count, index, drag = 0) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const itemWidth = width * (2 + p) / 3;
  const current = Math.max(0, Math.min(Math.max(0, count - 1), index || 0));
  const max = Math.max(0, count * itemWidth - width);
  const base = Math.max(0, Math.min(max, current * itemWidth));
  const raw = base - drag;
  // 从实际停靠位置开始拖，首尾超出部分递减阻力，松手由组件平滑归位。
  const resistance = value => width * 0.18 * value / (width + value);
  const offset = count <= 1 ? (itemWidth - width) / 2
    : raw < 0 ? -resistance(-raw) : raw > max ? max + resistance(raw - max) : raw;
  return { galleryItemWidth: itemWidth, galleryHeight: itemWidth * 1.25, galleryOffset: offset, galleryTranslateX: -offset };
}
module.exports = { getGalleryLayout };
