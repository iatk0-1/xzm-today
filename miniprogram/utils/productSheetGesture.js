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
  const overflow = Math.max(0, -rawTop);
  const maxOffset = Math.max(0, documentHeight - viewportHeight);
  return { top, offset: Math.min(maxOffset, start.offset + overflow) };
}

function settleSheet(top, origin, height, velocity) {
  const halfTop = height / 3;
  if (origin === 'full') {
    const closeDistance = Math.min(180, Math.max(100, height * 0.2));
    // 全屏下拉只回弹全屏或关闭，快速轻划也不能跳过距离门槛。
    return top >= closeDistance ? 'closed' : 'full';
  }
  if (top > halfTop + height * 0.16 || (velocity > 0.65 && top > halfTop + 30)) return 'closed';
  if (top < halfTop - Math.min(70, halfTop * 0.4) || (velocity < -0.5 && top < halfTop - 24)) return 'full';
  return 'half';
}

module.exports = { resolveDirection, moveSheet, settleSheet };
