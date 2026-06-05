import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'details:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Traps keyboard focus inside a container element while it is mounted.
 * - On mount, focuses the first focusable child (or the element matching `autoFocusSelector`).
 * - Tab on the last focusable element cycles back to the first.
 * - Shift+Tab on the first focusable element cycles to the last.
 * - On unmount, focus is returned to the trigger element (the element that was focused
 *   when the trap activated), unless `returnFocus` is false.
 */
export function useFocusTrap(
  enabled: boolean,
  options: {
    /** If provided, the first element matching this selector receives initial focus. */
    autoFocusSelector?: string;
    /** Whether to return focus to the trigger element on unmount. Default true. */
    returnFocus?: boolean;
  } = {},
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    // Remember the element that opened the overlay so we can return focus later.
    triggerRef.current = document.activeElement as HTMLElement | null;

    // Auto-focus the first focusable element (or the one matching autoFocusSelector).
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const autoFocus = options.autoFocusSelector
      ? container.querySelector<HTMLElement>(options.autoFocusSelector)
      : null;
    (autoFocus ?? focusables[0])?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !container) return;

      const elements = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0);

      if (elements.length === 0) return;

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      if (options.returnFocus !== false) {
        triggerRef.current?.focus();
      }
    };
  }, [enabled, options.autoFocusSelector, options.returnFocus]);

  return containerRef;
}
