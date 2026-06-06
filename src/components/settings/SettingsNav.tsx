import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
    parent = element.parentElement;
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

export function SettingsNav({ sections }: SettingsNavProps) {
  const [hovered, setHovered] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [motionSpeed] = useMotionSpeed();
  const multiplier = speedMultiplier(motionSpeed);
  const baseDuration = 700;

  const centerIndex = (sections.length - 1) / 2;
  const maxAngle = 12;
  const angleStep = sections.length > 1 ? maxAngle / Math.floor(sections.length / 2) : 0;

  const handleClick = useCallback(
    (id: string) => {
      const element = document.getElementById(id);
      if (element) {
        smoothScrollTo(element, baseDuration * multiplier);
      }
    },
    [multiplier],
  );

  // Track which section is closest to the top of the viewport.
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

  return (
    <div
      className="fixed right-5 top-1/2 z-30 hidden -translate-y-1/2 xl:block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.div
        animate={{
          width: hovered ? 168 : 32,
          paddingTop: hovered ? 14 : 10,
          paddingBottom: hovered ? 14 : 10,
        }}
        transition={{ duration: 0.24 * multiplier, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-3 overflow-visible rounded-2xl border border-line bg-surface/90 shadow-lg backdrop-blur-md"
      >
        {sections.map((section, i) => {
          const distance = i - centerIndex;
          const angle = distance * angleStep;
          const isActive = activeId === section.id;

          return (
            <motion.button
              key={section.id}
              type="button"
              aria-label={section.label}
              onClick={() => handleClick(section.id)}
              animate={{
                width: hovered ? 144 : 8,
                height: hovered ? 26 : 8,
                rotate: hovered ? angle : 0,
                borderRadius: hovered ? 7 : 4,
              }}
              transition={{
                duration: 0.2 * multiplier,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={cn(
                'relative shrink-0 cursor-pointer overflow-hidden border-0 outline-none transition-colors duration-200',
                hovered
                  ? isActive
                    ? 'bg-accent shadow-sm'
                    : 'bg-accent-soft shadow-sm'
                  : isActive
                    ? 'bg-accent'
                    : 'bg-ink/20',
              )}
            >
              <AnimatePresence>
                {hovered && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.14 * multiplier, delay: 0.02 }}
                    className={cn(
                      'pointer-events-none block whitespace-nowrap text-center text-[11px] font-medium leading-[26px]',
                      isActive ? 'text-accent-fg' : 'text-accent',
                    )}
                  >
                    {section.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}
