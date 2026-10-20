export function createActionGate(interval = 350) {
  const previous = new Map();
  return (action, time = performance.now()) => {
    const last = previous.get(action);
    if (last !== undefined && time - last < interval) return false;
    previous.set(action, time);
    return true;
  };
}

export function installTouchGuards(root = document) {
  let previousTap;
  const onDoubleClick = event => {
    if (event.target.closest?.('button, .camera-toolbar, .direction-pad')) event.preventDefault();
  };
  const onTouchEnd = event => {
    if (event.changedTouches.length !== 1 || event.touches.length) { previousTap = null; return; }
    const button = event.target.closest?.('button');
    // Direction presses intentionally support fast consecutive positioning.
    if (!button || button.matches('[data-move]')) { previousTap = null; return; }
    const touch = event.changedTouches[0], now = performance.now();
    if (previousTap?.button === button && now - previousTap.time < 350 &&
      Math.hypot(touch.clientX - previousTap.x, touch.clientY - previousTap.y) < 24) event.preventDefault();
    previousTap = { button, time: now, x: touch.clientX, y: touch.clientY };
  };
  root.addEventListener('dblclick', onDoubleClick, { passive: false });
  root.addEventListener('touchend', onTouchEnd, { passive: false });
  return () => { root.removeEventListener('dblclick', onDoubleClick); root.removeEventListener('touchend', onTouchEnd); };
}
