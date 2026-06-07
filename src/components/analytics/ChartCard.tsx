import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';

/** A titled container giving every chart a consistent frame and empty state. */
export function ChartCard({
  title,
  description,
  empty,
  emptyMessage,
  children,
  delay = 0,
}: {
  title: string;
  description?: string;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  delay?: number;
}) {
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const d = delay ?? 0;
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 * m, delay: d * m, ease: [0.25, 0.1, 0.25, 1] }}
      className="rounded-2xl border border-line bg-surface p-5"
    >
      <header className="mb-4">
        <h3 className="font-display text-xl tracking-tight">{title}</h3>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </header>
      {empty ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.24 * m, delay: (d + 0.1) * m }}
          className="grid h-56 place-items-center text-sm text-ink-faint"
        >
          {emptyMessage ?? 'Not enough data yet.'}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.32 * m, delay: (d + 0.05) * m, ease: 'easeOut' }}
          className="h-56"
        >
          {children}
        </motion.div>
      )}
    </motion.section>
  );
}
