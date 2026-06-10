import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

let toastIdCounter = 0;
import { AnimatePresence, m as motion } from 'motion/react';
import { cn } from './cn';
import { CheckIcon, CloseIcon, InfoIcon } from './icons';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';

type ToastTone = 'neutral' | 'positive' | 'negative';

interface ToastOptions {
  /** Label for an inline action button (e.g. "Undo"). */
  actionLabel?: string;
  /** Invoked when the action button is pressed; the toast then dismisses. */
  onAction?: () => void;
  /** Lifetime in milliseconds. Defaults to 3500ms, or 6000ms when an action is shown. */
  duration?: number;
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const MAX_TOASTS = 5;

  const notify = useCallback(
    (message: string, tone: ToastTone = 'neutral', options?: ToastOptions) => {
      const id = ++toastIdCounter;
      const duration = options?.duration ?? (options?.actionLabel ? 6000 : 3500);
      setToasts((prev) => {
        const next = [
          ...prev,
          {
            id,
            message,
            tone,
            actionLabel: options?.actionLabel,
            onAction: options?.onAction,
            duration,
          },
        ];
        // Prune the oldest toasts so the stack never grows without limit.
        if (next.length > MAX_TOASTS) {
          return next.slice(next.length - MAX_TOASTS);
        }
        return next;
      });
      // Dismissal is managed by ToastBar via requestAnimationFrame so it can be paused on hover.
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 will-change-transform">
        <AnimatePresence>
          {toasts.map((t) => (
            <ToastBar key={t.id} toast={t} onDismiss={() => dismiss(t.id)} motionMultiplier={m} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastBar({ toast, onDismiss, motionMultiplier }: { toast: ToastItem; onDismiss: () => void; motionMultiplier?: number }) {
  const m = motionMultiplier ?? 1;
  const [progress, setProgress] = useState(1);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const remainingRef = useRef<number>(toast.duration);
  const onDismissRef = useRef(onDismiss);

  // Keep the latest onDismiss without causing re-runs.
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const resume = useCallback(() => {
    startRef.current = performance.now();
    const duration = toast.duration;

    function tick(now: number) {
      const elapsed = now - startRef.current;
      const currentRemaining = Math.max(0, remainingRef.current - elapsed);
      setProgress(currentRemaining / duration);

      if (currentRemaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        onDismissRef.current();
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [toast.duration]);

  const pause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const elapsed = performance.now() - startRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
  }, []);

  useEffect(() => {
    resume();
    return () => cancelAnimationFrame(rafRef.current);
  }, [resume]);

  const toneClasses = {
    positive: 'border-positive/40 text-positive',
    negative: 'border-negative/40 text-negative',
    neutral: 'border-line-strong text-ink',
  } as const;

  const progressColour = {
    positive: 'bg-positive',
    negative: 'bg-negative',
    neutral: 'bg-accent',
  } as const;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.96 }}
      transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur bg-surface-raised/95 max-w-xs overflow-hidden',
        toneClasses[toast.tone],
      )}
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      {/* Dismiss timer progress bar */}
      <motion.div
        className={cn('absolute bottom-0 left-0 h-[2px] origin-left', progressColour[toast.tone])}
        style={{ width: `${progress * 100}%`, opacity: 0.6 }}
      />

      <span className="shrink-0">
        {toast.tone === 'positive' && <CheckIcon width={16} height={16} />}
        {toast.tone === 'negative' && <CloseIcon width={16} height={16} />}
        {toast.tone === 'neutral' && <InfoIcon width={16} height={16} />}
      </span>
      <span className="min-w-0 flex-1">{toast.message}</span>
      {toast.actionLabel && (
        <button
          type="button"
          onClick={() => {
            toast.onAction?.();
            onDismiss();
          }}
          className="shrink-0 font-medium text-accent underline underline-offset-2 transition-opacity hover:opacity-80 active:opacity-80"
        >
          {toast.actionLabel}
        </button>
      )}
    </motion.div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
