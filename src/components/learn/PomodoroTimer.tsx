import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePomodoro } from '../../hooks/usePomodoro';
import {
  ClockIcon,
  PlayIcon,
  PauseIcon,
  CloseIcon,
} from '../ui/icons';

const RADIUS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function phaseLabel(phase: string) {
  switch (phase) {
    case 'focus':
      return 'Focus';
    case 'shortBreak':
      return 'Short break';
    case 'longBreak':
      return 'Long break';
    default:
      return 'Pomodoro';
  }
}

function phaseColour(phase: string) {
  switch (phase) {
    case 'focus':
      return 'text-accent';
    case 'shortBreak':
      return 'text-positive';
    case 'longBreak':
      return 'text-ink';
    default:
      return 'text-ink-faint';
  }
}

function phaseStroke(phase: string) {
  switch (phase) {
    case 'focus':
      return 'stroke-accent';
    case 'shortBreak':
      return 'stroke-positive';
    case 'longBreak':
      return 'stroke-ink';
    default:
      return 'stroke-ink-faint';
  }
}

export function PomodoroTimer() {
  const pomodoro = usePomodoro();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popup on Escape or click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const {
    phase,
    isRunning,
    progress,
    formattedTime,
    sessionsCompleted,
    startFocus,
    pause,
    resume,
    reset,
  } = pomodoro;

  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);
  const active = phase !== 'idle';

  return (
    <div ref={containerRef} className="relative">
      {/* Compact timer button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={active ? `${phaseLabel(phase)} · ${formattedTime}` : 'Pomodoro timer'}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <svg width="36" height="36" viewBox="0 0 36 36" className="absolute inset-0">
          <circle
            cx="18"
            cy="18"
            r={RADIUS}
            fill="none"
            className="stroke-ink-faint"
            strokeWidth="2.5"
            opacity={0.15}
          />
          {active && (
            <motion.circle
              cx="18"
              cy="18"
              r={RADIUS}
              fill="none"
              className={phaseStroke(phase)}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              initial={{ strokeDashoffset: CIRCUMFERENCE }}
              animate={{ strokeDashoffset: strokeDashoffset }}
              transition={{ duration: 1, ease: 'linear' }}
              transform="rotate(-90 18 18)"
            />
          )}
        </svg>
        <span className="relative z-10">
          {active ? (
            <span className={`text-[10px] font-medium tabular ${phaseColour(phase)}`}>
              {formattedTime}
            </span>
          ) : (
            <ClockIcon width={16} height={16} />
          )}
        </span>
      </button>

      {/* Expanded controls */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl shadow-black/10"
          >
            <div className="px-4 py-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-faint">
                  {phaseLabel(phase)}
                </span>
                {sessionsCompleted > 0 && (
                  <span className="text-[10px] tabular text-ink-faint">
                    {sessionsCompleted} session{sessionsCompleted === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              {/* Large time display */}
              <div className="mb-3 text-center">
                <span
                  className={`font-display text-3xl tabular tracking-tight ${phaseColour(phase)}`}
                >
                  {formattedTime}
                </span>
              </div>

              {/* Progress bar */}
              {active && (
                <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-ink/5">
                  <motion.div
                    className={`h-full rounded-full ${phase === 'focus' ? 'bg-accent' : phase === 'shortBreak' ? 'bg-positive' : 'bg-ink'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress * 100}%` }}
                    transition={{ duration: 0.5, ease: 'linear' }}
                  />
                </div>
              )}

              {/* Controls */}
              <div className="flex justify-center gap-2">
                {!active && (
                  <button
                    type="button"
                    onClick={() => {
                      startFocus();
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
                  >
                    <PlayIcon width={14} height={14} />
                    Start
                  </button>
                )}
                {active && (
                  <>
                    {isRunning ? (
                      <button
                        type="button"
                        onClick={pause}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
                      >
                        <PauseIcon width={14} height={14} />
                        Pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={resume}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
                      >
                        <PlayIcon width={14} height={14} />
                        Resume
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={reset}
                      title="Reset"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink"
                    >
                      <CloseIcon width={12} height={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
