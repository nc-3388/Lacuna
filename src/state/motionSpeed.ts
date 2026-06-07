import { useEffect, useState } from 'react';

export type MotionSpeed = 'slow' | 'normal' | 'fast';

const KEY = 'lacuna.motionSpeed';

const MULTIPLIERS: Record<MotionSpeed, number> = {
  slow: 1.4,
  normal: 1.0,
  fast: 0.6,
};

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

  useEffect(() => {
    const onChange = () => setSpeed(readMotionSpeed());
    window.addEventListener('storage', onChange);
    window.addEventListener('lacuna:motion-speed', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('lacuna:motion-speed', onChange);
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
