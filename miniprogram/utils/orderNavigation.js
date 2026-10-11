// 仅观察手势，不拦截触摸事件，保留 text 的原生选区和复制菜单。
const LONG_PRESS_MS = 350;
const MOVE_THRESHOLD = 10;

function duration(gesture, event) {
  const timestamp = event && event.timeStamp;
  const eventDuration = typeof timestamp === 'number' && typeof gesture.timestamp === 'number'
    ? timestamp - gesture.timestamp : 0;
  return Math.max(Date.now() - gesture.startedAt, eventDuration);
}

function onTouchStart(event) {
  const touches = event.touches || event.changedTouches || [];
  const point = touches[0] || {};
  this._orderNavigationGesture = {
    startedAt: Date.now(),
    timestamp: event.timeStamp,
    x: point.clientX,
    y: point.clientY,
    blocked: touches.length > 1,
    ended: false
  };
}

function onTouchMove(event) {
  const gesture = this._orderNavigationGesture;
  if (!gesture) return;
  const touches = event.touches || event.changedTouches || [];
  const point = touches[0] || {};
  const dx = point.clientX - gesture.x;
  const dy = point.clientY - gesture.y;
  if (touches.length > 1 || dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) {
    gesture.blocked = true;
  }
}

function onTouchEnd(event) {
  const gesture = this._orderNavigationGesture;
  if (!gesture) return;
  gesture.blocked = gesture.blocked || duration(gesture, event) >= LONG_PRESS_MS;
  gesture.ended = true;
}

function onTouchCancel() {
  const gesture = this._orderNavigationGesture;
  if (gesture) gesture.blocked = true;
}

function canNavigate(page, event) {
  const gesture = page._orderNavigationGesture;
  if (!gesture) return true;
  // 原生文字选择可能接管 touchend，此时仍按本次触摸时长拦住抬手后的 tap。
  if (!gesture.ended && duration(gesture, event) >= LONG_PRESS_MS) gesture.blocked = true;
  return !gesture.blocked;
}

module.exports = { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, canNavigate };
