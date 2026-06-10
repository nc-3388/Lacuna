import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

function createFocusableContainer() {
  const container = document.createElement('div');
  container.innerHTML = `
    <button>First</button>
    <input />
    <button>Last</button>
  `;
  document.body.appendChild(container);
  return container;
}

describe('useFocusTrap', () => {
  it('returns a ref', () => {
    const { result } = renderHook(() => useFocusTrap(true));
    expect(result.current).toBeDefined();
    expect(result.current.current).toBeNull();
  });

  it('does not run when disabled', () => {
    const container = createFocusableContainer();
    const { result } = renderHook(() => useFocusTrap(false));
    const ref = result.current as unknown as { current: HTMLDivElement | null };
    ref.current = container as unknown as HTMLDivElement;
    const firstBtn = container.querySelector('button');
    firstBtn?.focus();
    expect(document.activeElement).toBe(firstBtn);
    document.body.removeChild(container);
  });

  it('returns a ref that can be attached to a container', () => {
    const container = createFocusableContainer();
    const { result } = renderHook(() => useFocusTrap(true));
    const ref = result.current as unknown as { current: HTMLDivElement | null };
    ref.current = container as unknown as HTMLDivElement;
    expect(ref.current).toBe(container);
    document.body.removeChild(container);
  });
});
