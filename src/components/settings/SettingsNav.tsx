import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, useMotionValue, useSpring, type MotionValue } from 'motion/react';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';
import { cn } from '../ui/cn';

interface SettingsSection {
  id: string;
  label: string;
}

interface SettingsNavProps {
  sections: SettingsSection[];
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function getScrollParent(element: HTMLElement): HTMLElement {
  let parent = element.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflow + style.overflowY)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return document.documentElement;
}

function getOffsetTopRelativeTo(element: HTMLElement, ancestor: HTMLElement): number {
  let top = 0;
  let el: HTMLElement | null = element;
  while (el && el !== ancestor) {
    top += el.offsetTop;
    el = el.offsetParent as HTMLElement | null;
  }
  return top;
}

function smoothScrollTo(element: HTMLElement, duration: number) {
  const scrollParent = getScrollParent(element);
  const startTop = scrollParent.scrollTop;
  const targetTop = getOffsetTopRelativeTo(element, scrollParent) - 32;
  const distance = targetTop - startTop;
  const startTime = performance.now();

  function tick(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(progress);
    scrollParent.scrollTop = startTop + distance * eased;
    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

/** Compute a gravitational pull scale based on distance from the cursor.
 *  Items close to the cursor grow; items far away stay at base size. */
function computePullScale(
  mouseX: number,
  mouseY: number,
  rect: DOMRect,
  maxScale: number,
  radius: number,
): number {
  const itemCx = rect.left + rect.width / 2;
  const itemCy = rect.top + rect.height / 2;
  const dist = Math.hypot(mouseX - itemCx, mouseY - itemCy);
  if (dist >= radius) return 1;
  const t = dist / radius; // 0 at cursor, 1 at edge
  // Exponential falloff: the closest pill expands dramatically more than neighbours
  const eased = Math.exp(-3.5 * t);
  return 1 + (maxScale - 1) * eased;
}

export function SettingsNav({ sections }: SettingsNavProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const [expanded, setExpanded] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect reduced-motion preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Track which section is closest to the top of the viewport
  useEffect(() => {
    const firstEl = sections.length > 0 ? document.getElementById(sections[0].id) : null;
    if (!firstEl) return;
    const scrollParent = getScrollParent(firstEl);

    const onScroll = () => {
      let bestId: string | null = null;
      let bestDist = Infinity;
      sections.forEach(({ id }) => {
        const el = document.getElementById(id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(rect.top);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      });
      if (bestId) setActiveId(bestId);
    };

    scrollParent.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scrollParent.removeEventListener('scroll', onScroll);
  }, [sections]);

  const handleClick = useCallback(
    (id: string) => {
      const element = document.getElementById(id);
      if (element) {
        smoothScrollTo(element, 700 * m);
      }
      setMobileExpanded(false);
      setExpanded(false);
      setFocusedIndex(-1);
    },
    [m],
  );

  // Shared motion values for mouse position
  const mouseX = useMotionValue(-9999);
  const mouseY = useMotionValue(-9999);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    },
    [mouseX, mouseY],
  );

  const handleMouseEnter = useCallback(() => {
    setExpanded(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setExpanded(false);
    setFocusedIndex(-1);
    mouseX.set(-9999);
    mouseY.set(-9999);
  }, [mouseX, mouseY]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = focusedIndex >= 0 ? (focusedIndex + 1) % sections.length : 0;
        setFocusedIndex(next);
        setExpanded(true);
        const el = document.getElementById(
          `settings-nav-${sections[next].id}`,
        ) as HTMLButtonElement | null;
        el?.focus();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next =
          focusedIndex >= 0
            ? (focusedIndex - 1 + sections.length) % sections.length
            : sections.length - 1;
        setFocusedIndex(next);
        setExpanded(true);
        const el = document.getElementById(
          `settings-nav-${sections[next].id}`,
        ) as HTMLButtonElement | null;
        el?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (focusedIndex >= 0) {
          handleClick(sections[focusedIndex].id);
        }
      } else if (e.key === 'Escape') {
        setExpanded(false);
        setFocusedIndex(-1);
        containerRef.current?.blur();
      } else if (e.key === 'Tab' && !e.shiftKey && focusedIndex === -1) {
        // First tab into nav: focus first item and expand
        e.preventDefault();
        setFocusedIndex(0);
        setExpanded(true);
        const el = document.getElementById(
          `settings-nav-${sections[0].id}`,
        ) as HTMLButtonElement | null;
        el?.focus();
      }
    },
    [focusedIndex, sections, handleClick],
  );

  // Spring parameters adjusted by motion speed
  const springConfig = useMemo(() => {
    if (reducedMotion) {
      return { stiffness: 10000, damping: 100 };
    }
    return {
      stiffness: 380 / m,
      damping: 32 * m,
    };
  }, [reducedMotion, m]);

  return (
    <>
      {/* Desktop: anchored right, vertically centred */}
      <div
        ref={containerRef}
        className="fixed right-3 top-1/2 z-40 hidden -translate-y-1/2 md:block"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="navigation"
        aria-label="Settings sections"
      >
        <motion.div
          className="flex flex-col items-center gap-1.5 rounded-full border border-line bg-surface/90 p-2 shadow-lg backdrop-blur-md"
          animate={{
            width: expanded ? 160 : 32,
          }}
          transition={
            reducedMotion ? { duration: 0 } : { type: 'spring', ...springConfig }
          }
        >
          {sections.map((section, i) => (
            <NavItem
              key={section.id}
              section={section}
              isActive={activeId === section.id}
              isFocused={focusedIndex === i}
              expanded={expanded}
              mouseX={mouseX}
              mouseY={mouseY}
              reducedMotion={reducedMotion}
              springConfig={springConfig}
              m={m}
              onClick={() => handleClick(section.id)}
            />
          ))}
        </motion.div>
      </div>

      {/* Mobile: horizontal at top, touch-expandable */}
      <div
        className="fixed left-0 right-0 top-0 z-40 md:hidden"
        onClick={() => setMobileExpanded((p) => !p)}
        role="navigation"
        aria-label="Settings sections"
      >
        <motion.div
          className="flex items-center justify-center gap-2 border-b border-line bg-surface/90 px-4 py-2.5 shadow-md backdrop-blur-md"
          animate={{
            height: mobileExpanded ? 48 : 36,
          }}
          transition={
            reducedMotion ? { duration: 0 } : { type: 'spring', ...springConfig }
          }
        >
          {sections.map((section) => (
            <motion.button
              key={section.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClick(section.id);
              }}
              aria-current={activeId === section.id ? 'true' : undefined}
              className={cn(
                'relative flex items-center justify-center rounded-full outline-none transition-colors duration-200',
                activeId === section.id
                  ? 'bg-accent/60 text-accent'
                  : 'bg-accent/15 text-ink-soft',
                mobileExpanded && 'hover:bg-accent-soft hover:text-accent',
              )}
              animate={{
                width: mobileExpanded ? 'auto' : 22,
                height: mobileExpanded ? 32 : 22,
                paddingLeft: mobileExpanded ? 14 : 0,
                paddingRight: mobileExpanded ? 14 : 0,
              }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 380 / m, damping: 32 * m }
              }
            >
              <motion.span
                className="whitespace-nowrap text-xs font-medium"
                aria-hidden={!mobileExpanded}
                animate={{ opacity: mobileExpanded ? 1 : 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.12 * m }}
              >
                {section.label}
              </motion.span>
            </motion.button>
          ))}
        </motion.div>
      </div>
    </>
  );
}

function NavItem({
  section,
  isActive,
  isFocused,
  expanded,
  mouseX,
  mouseY,
  reducedMotion,
  springConfig,
  m,
  onClick,
}: {
  section: SettingsSection;
  isActive: boolean;
  isFocused: boolean;
  expanded: boolean;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  reducedMotion: boolean;
  springConfig: { stiffness: number; damping: number };
  m: number;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const scaleMotion = useMotionValue(1);
  // Use the exact same spring as the dimension animations so scale
  // never drifts out of sync with width / height.
  const smoothScale = useSpring(scaleMotion, {
    stiffness: springConfig.stiffness,
    damping: springConfig.damping,
  });

  useEffect(() => {
    function update() {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const x = mouseX.get();
      const y = mouseY.get();
      if (x === -9999 || y === -9999) {
        scaleMotion.set(1);
        return;
      }
      const s = computePullScale(x, y, rect, 1.5, 130);
      scaleMotion.set(s);
    }

    const unsubX = mouseX.on('change', update);
    const unsubY = mouseY.on('change', update);
    update();

    return () => {
      unsubX();
      unsubY();
    };
  }, [mouseX, mouseY, scaleMotion]);

  return (
    <motion.button
      ref={ref}
      id={`settings-nav-${section.id}`}
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex cursor-pointer items-center justify-center outline-none transition-colors duration-200',
        expanded
          ? 'h-8 w-full rounded-full px-3 text-xs font-medium'
          : 'h-2 w-2 rounded-full',
        isActive
          ? 'text-accent'
          : 'text-ink-soft hover:text-accent',
        isFocused && 'z-10',
      )}
      animate={{
        width: expanded ? '100%' : 8,
        height: expanded ? 32 : 8,
        borderRadius: 9999,
      }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { type: 'spring', ...springConfig }
      }
      aria-current={isActive ? 'true' : undefined}
      tabIndex={-1}
    >
      {/* Background pill – only this element gravitate-scales,
          keeping text crisp and the container bounds clean. */}
      <motion.div
        className={cn(
          'absolute inset-0 rounded-full transition-colors duration-200',
          isActive
            ? 'bg-accent/60'
            : 'bg-accent/15 group-hover:bg-accent-soft',
        )}
        style={{ scale: smoothScale }}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { type: 'spring', ...springConfig }
        }
      />
      <motion.span
        className="relative z-10 whitespace-nowrap"
        aria-hidden={!expanded}
        animate={{ opacity: expanded ? 1 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.14 * m }}
      >
        {section.label}
      </motion.span>
    </motion.button>
  );
}
