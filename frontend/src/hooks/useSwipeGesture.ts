import { useRef, useCallback } from "react";

export interface SwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  velocityThreshold?: number;
}

export function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
  threshold = 80,
  velocityThreshold = 0.3,
}: SwipeGestureOptions) {
  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const tracking = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    startTime.current = Date.now();
    tracking.current = true;
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!tracking.current) return;
      tracking.current = false;

      const deltaX = e.clientX - startX.current;
      const deltaY = e.clientY - startY.current;
      const elapsed = Date.now() - startTime.current;

      // Only trigger if horizontal movement is dominant
      if (Math.abs(deltaY) > Math.abs(deltaX) * 0.6) return;

      const velocity = Math.abs(deltaX) / Math.max(elapsed, 1);
      const meetsThreshold =
        Math.abs(deltaX) >= threshold || velocity >= velocityThreshold;

      if (!meetsThreshold) return;

      if (deltaX < 0 && onSwipeLeft) {
        onSwipeLeft();
      } else if (deltaX > 0 && onSwipeRight) {
        onSwipeRight();
      }
    },
    [onSwipeLeft, onSwipeRight, threshold, velocityThreshold],
  );

  const onPointerCancel = useCallback(() => {
    tracking.current = false;
  }, []);

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
  };
}
