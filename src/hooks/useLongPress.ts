import { useCallback, useRef } from 'react';

interface LongPressOptions {
  /** Delay in milliseconds before the long press triggers. Default 600. */
  threshold?: number;
  /** Maximum movement in pixels before the long press is cancelled. Default 10. */
  maxMovement?: number;
  onLongPress: (e: PointerEvent | React.PointerEvent) => void;
  onClick?: (e: PointerEvent | React.PointerEvent) => void;
}

/**
 * Detects long press on touch/pointer devices.
 * Returns pointer event handlers to attach to the target element.
 */
export function useLongPress({ threshold = 600, maxMovement = 10, onLongPress, onClick }: LongPressOptions) {
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const triggeredRef = useRef(false);

  const start = useCallback(
    (e: React.PointerEvent) => {
      triggeredRef.current = false;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = window.setTimeout(() => {
        triggeredRef.current = true;
        onLongPress(e);
      }, threshold);
    },
    [threshold, onLongPress],
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current || timerRef.current === null) return;
      const dx = e.clientX - startPosRef.current.x;
      const dy = e.clientY - startPosRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > maxMovement) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        startPosRef.current = null;
      }
    },
    [maxMovement],
  );

  const end = useCallback(
    (e: React.PointerEvent) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      startPosRef.current = null;
      if (!triggeredRef.current && onClick) {
        onClick(e);
      }
      triggeredRef.current = false;
    },
    [onClick],
  );

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
    triggeredRef.current = false;
  }, []);

  return {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: end,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  };
}
