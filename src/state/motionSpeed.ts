import { useEffect, useState } from 'react';

export type MotionSpeed = 'slow' | 'normal' | 'fast';

const KEY = 'lacuna.motionSpeed';

const MULTIPLIERS: Record<MotionSpeed, number> = {
  slow: 1.4,
  normal: 1.0,
  fast: 0.6,
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function readMotionSpeed(): MotionSpeed {
  const raw = localStorage.getItem(KEY) as MotionSpeed | null;
  return raw === 'slow' || raw === 'fast' ? raw : 'normal';
}

export function writeMotionSpeed(speed: MotionSpeed): void {
  localStorage.setItem(KEY, speed);
  window.dispatchEvent(
    new CustomEvent('lacuna:motion-speed', { detail: speed }),
  );
}

export function speedMultiplier(speed?: MotionSpeed): number {
  if (prefersReducedMotion()) return 0;
  return MULTIPLIERS[speed ?? readMotionSpeed()];
}

/** Read the current motion multiplier directly from localStorage (for class components / pre-provider). */
export function getMotionMultiplier(): number {
  try {
    return speedMultiplier();
  } catch {
    return 1;
  }
}

export function useMotionSpeed(): [
  MotionSpeed,
  (speed: MotionSpeed) => void,
] {
  const [speed, setSpeed] = useState<MotionSpeed>(() => readMotionSpeed());
  // Force re-render when the OS-level motion preference changes so that
  // components recompute their speedMultiplier() on the next render.
  const [, setMotionPref] = useState(false);

  useEffect(() => {
    const onChange = () => setSpeed(readMotionSpeed());
    window.addEventListener('storage', onChange);
    window.addEventListener('lacuna:motion-speed', onChange);

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPref = (e: MediaQueryListEvent) => setMotionPref(e.matches);
    mql.addEventListener('change', onPref);

    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('lacuna:motion-speed', onChange);
      mql.removeEventListener('change', onPref);
    };
  }, []);

  return [
    speed,
    (next) => {
      writeMotionSpeed(next);
      setSpeed(next);
    },
  ];
}
