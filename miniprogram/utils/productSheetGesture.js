const DIRECTION_THRESHOLD = 8;
const HORIZONTAL_RATIO = 1.5;

function resolveDirection(dx, dy, image) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_THRESHOLD) return '';
  if (image && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO) return 'horizontal';
  // 图片必须明确横滑才交给轮播，斜向滑动归入上下拖动。
  if (image || Math.abs(dy) >= Math.abs(dx)) return 'vertical';
  return 'ignore';
}

function moveSheet(start, dy, viewportHeight, documentHeight) {
  // 全屏正文还没到顶时，下拉只回滚正文。本次手势滚到顶后也不突然拖窗，
  // 要在顶部重新下拉，才交给弹窗，避免浏览内容时误关闭。
  if (start.origin === 'full' && start.top === 0 && start.offset > 0 && dy > 0) {
    return { top: 0, offset: Math.max(0, start.offset - dy) };
  }
  const rawTop = start.top + dy;
  const top = Math.max(0, Math.min(viewportHeight, rawTop));
  // 从半屏开始的手势只展开弹窗，超出的距离不转成正文滚动。
  if (start.origin === 'half') return { top, offset: start.offset };
  const overflow = Math.max(0, -rawTop);
  const maxOffset = Math.max(0, documentHeight - viewportHeight);
  return { top, offset: Math.min(maxOffset, start.offset + overflow) };
}

function settleSheet(top, origin, height) {
  const halfTop = height / 3;
  // 展开和关闭共用距离门槛，速度不绕过门槛，轻拖松手回原状态。
  const distance = Math.min(70, halfTop * 0.4);
  if (origin === 'full') return top >= distance ? 'closed' : 'full';
  if (top - halfTop >= distance) return 'closed';
  if (halfTop - top >= distance) return 'full';
  return 'half';
}

module.exports = { resolveDirection, moveSheet, settleSheet };
