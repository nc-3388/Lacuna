import { useCallback, useEffect, useRef, useState, useMemo } from 'react';

interface VirtualItem {
  index: number;
  start: number;
  end: number;
  key: string;
}

interface UseVirtualListOptions {
  itemCount: number;
  estimateSize: number;
  gap?: number;
  overscan?: number;
  enabled?: boolean;
}

interface UseVirtualListResult {
  totalHeight: number;
  virtualItems: VirtualItem[];
  measureRef: (index: number) => (el: HTMLElement | null) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  scrollToIndex: (index: number) => void;
}

/**
 * A lightweight, dependency-free virtual list hook that tracks scroll position
 * and renders only visible items. Items are absolutely positioned with translateY
 * so expanding/collapsing cards automatically reflow the layout via ResizeObserver.
 */
export function useVirtualList({
  itemCount,
  estimateSize,
  gap = 0,
  overscan = 3,
  enabled = true,
}: UseVirtualListOptions): UseVirtualListResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemHeights = useRef<Record<number, number>>({});

  // Clear cached heights when the item count changes to avoid stale data.
  useEffect(() => {
    itemHeights.current = {};
  }, [itemCount]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [, setMeasureVersion] = useState(0);

  // Track scroll position via window scroll (page-flow virtualisation)
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    let raf: number | null = null;
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const rect = el.getBoundingClientRect();
        const offset = Math.max(0, -rect.top);
        setScrollOffset(offset);
        setContainerHeight(window.innerHeight);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [enabled]);

  // Measure individual item heights
  const measureRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (!el) return;
      const height = el.getBoundingClientRect().height;
      const prev = itemHeights.current[index];
      if (prev !== height) {
        itemHeights.current[index] = height;
        setMeasureVersion((v) => v + 1);
      }
    },
    [],
  );

  // Recalculate layout when measurements change
  const { totalHeight, virtualItems } = useMemo(() => {
    if (!enabled) {
      return {
        totalHeight: 0,
        virtualItems: Array.from({ length: itemCount }, (_, index) => ({
          index,
          start: 0,
          end: 0,
          key: String(index),
        })),
      };
    }

    const heights: number[] = [];
    const starts: number[] = [];
    let current = 0;
    for (let i = 0; i < itemCount; i++) {
      starts[i] = current;
      const h = itemHeights.current[i] ?? estimateSize;
      heights[i] = h;
      current += h + gap;
    }
    const total = Math.max(0, current - gap);

    // Find visible range
    const startOffset = scrollOffset;
    const endOffset = scrollOffset + containerHeight;

    let startIndex = 0;
    let endIndex = itemCount - 1;

    // Binary search for start
    let lo = 0;
    let hi = itemCount - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (starts[mid] + heights[mid] < startOffset) {
        lo = mid + 1;
      } else {
        startIndex = mid;
        hi = mid - 1;
      }
    }

    // Binary search for end
    lo = 0;
    hi = itemCount - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (starts[mid] > endOffset) {
        endIndex = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    startIndex = Math.max(0, startIndex - overscan);
    endIndex = Math.min(itemCount - 1, endIndex + overscan);

    const items: VirtualItem[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      items.push({
        index: i,
        start: starts[i],
        end: starts[i] + heights[i],
        key: String(i),
      });
    }

    return { totalHeight: total, virtualItems: items };
  }, [enabled, itemCount, estimateSize, gap, overscan, scrollOffset, containerHeight]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = containerRef.current;
      if (!el) return;
      let offset = 0;
      for (let i = 0; i < index; i++) {
        offset += (itemHeights.current[i] ?? estimateSize) + gap;
      }
      const containerTop = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: containerTop + offset, behavior: 'smooth' });
    },
    [estimateSize, gap],
  );

  return { totalHeight, virtualItems, measureRef, containerRef, scrollToIndex };
}
