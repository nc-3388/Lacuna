import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLongPress } from './useLongPress';

describe('useLongPress', () => {
  it('returns the expected event handlers', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));
    expect(result.current.onPointerDown).toBeDefined();
    expect(result.current.onPointerMove).toBeDefined();
    expect(result.current.onPointerUp).toBeDefined();
    expect(result.current.onPointerLeave).toBeDefined();
    expect(result.current.onPointerCancel).toBeDefined();
  });

  it('triggers onLongPress after the threshold', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, threshold: 300 }));
    const event = new PointerEvent('pointerdown', { clientX: 0, clientY: 0 });
    result.current.onPointerDown(event as unknown as React.PointerEvent);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onLongPress).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('cancels on pointer move beyond maxMovement', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, threshold: 300, maxMovement: 5 }));
    const downEvent = new PointerEvent('pointerdown', { clientX: 0, clientY: 0 });
    result.current.onPointerDown(downEvent as unknown as React.PointerEvent);
    const moveEvent = new PointerEvent('pointermove', { clientX: 10, clientY: 0 });
    result.current.onPointerMove(moveEvent as unknown as React.PointerEvent);
    vi.advanceTimersByTime(300);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('fires onClick if not long-pressed', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, onClick, threshold: 300 }));
    const downEvent = new PointerEvent('pointerdown', { clientX: 0, clientY: 0 });
    const upEvent = new PointerEvent('pointerup', { clientX: 0, clientY: 0 });
    result.current.onPointerDown(downEvent as unknown as React.PointerEvent);
    result.current.onPointerUp(upEvent as unknown as React.PointerEvent);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
