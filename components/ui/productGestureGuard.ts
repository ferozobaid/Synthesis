export interface HorizontalScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  deltaX: number;
}

export function isDominantHorizontalGesture(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) >= 2 && Math.abs(deltaX) >= Math.abs(deltaY) * 0.75;
}

export function canConsumeHorizontalDelta({
  scrollLeft,
  scrollWidth,
  clientWidth,
  deltaX,
}: HorizontalScrollMetrics): boolean {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  if (maxScrollLeft <= 1) return false;
  if (deltaX < 0) return scrollLeft > 1;
  if (deltaX > 0) return scrollLeft < maxScrollLeft - 1;
  return false;
}

export function elementCanConsumeHorizontalDelta(
  target: EventTarget | null,
  root: HTMLElement,
  deltaX: number,
): boolean {
  let element = target instanceof Element ? target : null;
  while (element && root.contains(element)) {
    if (element instanceof HTMLElement) {
      const overflowX = window.getComputedStyle(element).overflowX;
      if (
        (overflowX === "auto" || overflowX === "scroll") &&
        canConsumeHorizontalDelta({
          scrollLeft: element.scrollLeft,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          deltaX,
        })
      ) {
        return true;
      }
    }
    if (element === root) break;
    element = element.parentElement;
  }
  return false;
}
