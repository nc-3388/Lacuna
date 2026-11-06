import { m as motion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { speedMultiplier, useMotionSpeed } from '../../state/motionSpeed';
import { expandingActionSpring } from './motion';

/** Measures the incoming in-flow step; StepSwap keeps departing steps absolute. */
export function MeasuredHeight({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const [speed] = useMotionSpeed();
  const multiplier = speedMultiplier(speed);
  // Clip while the box trails the measured content height, so growing content is
  // revealed by the height animation instead of spilling out of the box. The
  // clip is re-applied alongside each new height target and released once the
  // box has settled on it; the release checks the rendered height because a
  // superseded animation still reports completion.
  const box = useRef<HTMLDivElement>(null);
  const heightValue = useRef<number | undefined>(undefined);
  const [height, setHeight] = useState<number>();
  const release = () => {
    if (multiplier === 0) return;
    const target = heightValue.current;
    const styled = box.current;
    const rendered = styled ? Number.parseFloat(getComputedStyle(styled).height) : NaN;
    if (target === undefined || !Number.isFinite(rendered) || Math.abs(rendered - target) < 1) {
      styled?.style.setProperty('overflow', 'visible');
    }
  };
  useLayoutEffect(() => {
    const observed = content.current;
    if (!observed) return;
    const styled = observed.parentElement;
    if (!styled) return;
    styled.style.setProperty('overflow', 'hidden');
    // Layout height, not the transformed bounding box: an ancestor mid-scale would shrink it.
    const measure = (next: number) => {
      const previous = heightValue.current;
      heightValue.current = next;
      setHeight(next);
      // Re-clip alongside a new grow target, before the taller content paints.
      if (previous !== undefined && next > previous) {
        styled.style.setProperty('overflow', 'hidden');
      }
    };
    measure(observed.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      measure(entries?.[0]?.borderBoxSize?.[0]?.blockSize ?? observed.offsetHeight);
    });
    observer.observe(observed);
    return () => observer.disconnect();
  }, [children]);
  return (
    <motion.div
      ref={box}
      initial={false}
      animate={{ height: multiplier > 0 ? (height ?? 'auto') : 'auto' }}
      transition={expandingActionSpring(multiplier)}
      // Reduced motion never starts an animation, so the completion handler owns
      // the only release: the layout effect above keeps that content clipped.
      onAnimationComplete={release}
      className="overflow-hidden"
    >
      <div ref={content} className="flow-root">
        {children}
      </div>
    </motion.div>
  );
}
