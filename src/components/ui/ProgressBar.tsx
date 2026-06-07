import { motion } from 'motion/react';
import { cn } from './cn';

interface ProgressBarProps {
  /** Completion fraction, 0..1. */
  value: number;
  className?: string;
  showLabel?: boolean;
  height?: number;
  /** Accessible name for screen readers. */
  label?: string;
}

export function ProgressBar({
  value,
  className,
  showLabel = false,
  height = 10,
  label = 'Progress',
}: ProgressBarProps) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        className="relative flex-1 overflow-hidden rounded-full bg-ink/10"
        style={{ height }}
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-accent"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        >
          {/* A slow sheen travels along filled bars, giving the accent a sense of depth
              and quiet life. Hidden at 0% so an empty bar stays perfectly flat. */}
          {pct > 0 && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/30 to-transparent"
              initial={{ x: '-120%' }}
              animate={{ x: '420%' }}
              transition={{
                duration: 2.0,
                ease: 'easeInOut',
                repeat: Infinity,
                repeatDelay: 2.6,
              }}
            />
          )}
        </motion.div>
      </div>
      {showLabel && (
        <span className="tabular text-sm font-medium text-ink-soft w-12 text-right">
          {pct}%
        </span>
      )}
    </div>
  );
}
