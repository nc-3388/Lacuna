import { useCallback, useEffect, useRef, useState } from 'react';

export type PomodoroPhase = 'idle' | 'focus' | 'shortBreak' | 'longBreak';

export interface PomodoroSettings {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  autoStartBreaks: boolean;
}

const DEFAULT_SETTINGS: PomodoroSettings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  autoStartBreaks: false,
};

const STORAGE_KEY = 'lacuna-pomodoro-settings';

export function loadPomodoroSettings(): PomodoroSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PomodoroSettings>;
      return {
        workMinutes: Math.max(1, Math.min(120, Number(parsed.workMinutes) ?? DEFAULT_SETTINGS.workMinutes)),
        shortBreakMinutes: Math.max(1, Math.min(60, Number(parsed.shortBreakMinutes) ?? DEFAULT_SETTINGS.shortBreakMinutes)),
        longBreakMinutes: Math.max(1, Math.min(60, Number(parsed.longBreakMinutes) ?? DEFAULT_SETTINGS.longBreakMinutes)),
        autoStartBreaks: typeof parsed.autoStartBreaks === 'boolean' ? parsed.autoStartBreaks : DEFAULT_SETTINGS.autoStartBreaks,
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

function phaseDuration(p: PomodoroPhase, s: PomodoroSettings): number {
  switch (p) {
    case 'focus':
      return s.workMinutes * 60;
    case 'shortBreak':
      return s.shortBreakMinutes * 60;
    case 'longBreak':
      return s.longBreakMinutes * 60;
    default:
      return 0;
  }
}

export function savePomodoroSettings(settings: Partial<PomodoroSettings>): void {
  try {
    const current = loadPomodoroSettings();
    const next = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function usePomodoro() {
  const [settings, setSettings] = useState<PomodoroSettings>(loadPomodoroSettings);
  const [phase, setPhase] = useState<PomodoroPhase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const secondsLeftRef = useRef(secondsLeft);

  const durationForPhase = useCallback(
    (p: PomodoroPhase) => {
      return phaseDuration(p, settings);
    },
    [settings],
  );

  useEffect(() => {
    secondsLeftRef.current = secondsLeft;
  }, [secondsLeft]);

  // Sync settings when they change in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSettings(loadPomodoroSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const clearTick = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Tick down every second while running.
  useEffect(() => {
    if (!isRunning || secondsLeftRef.current <= 0) {
      clearTick();
      return;
    }
    intervalRef.current = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearTick();
  }, [isRunning, clearTick]);

  // Handle completion when timer hits zero.
  useEffect(() => {
    if (secondsLeft !== 0 || !isRunning) return;
    clearTick();
    setIsRunning(false);

    if (phase === 'focus') {
      const nextSessions = sessionsCompleted + 1;
      setSessionsCompleted(nextSessions);
      const nextPhase = nextSessions % 4 === 0 ? 'longBreak' : 'shortBreak';
      setPhase(nextPhase);
      const nextDuration = durationForPhase(nextPhase);
      setSecondsLeft(nextDuration);
      if (settings.autoStartBreaks) {
        setIsRunning(true);
      }
    } else {
      setPhase('idle');
      setSecondsLeft(0);
    }
  }, [secondsLeft, isRunning, phase, sessionsCompleted, settings.autoStartBreaks, durationForPhase, clearTick]);

  const startFocus = useCallback(() => {
    clearTick();
    const fresh = loadPomodoroSettings();
    setSettings(fresh);
    setPhase('focus');
    setSecondsLeft(phaseDuration('focus', fresh));
    setIsRunning(true);
  }, [clearTick]);

  const pause = useCallback(() => {
    clearTick();
    setIsRunning(false);
  }, [clearTick]);

  const resume = useCallback(() => {
    if (phase === 'idle') return;
    if (secondsLeft === 0) {
      // Phase completed while paused; restart the same phase.
      setSecondsLeft(phaseDuration(phase, settings));
    }
    setIsRunning(true);
  }, [secondsLeft, phase, settings]);

  const reset = useCallback(() => {
    clearTick();
    setPhase('idle');
    setSecondsLeft(0);
    setIsRunning(false);
  }, [clearTick]);

  const progress =
    phase === 'idle' || secondsLeft === 0
      ? 0
      : 1 - secondsLeft / durationForPhase(phase);

  const formattedTime =
    `${Math.floor(secondsLeft / 60).toString().padStart(2, '0')}:${(secondsLeft % 60).toString().padStart(2, '0')}`;

  return {
    phase,
    secondsLeft,
    sessionsCompleted,
    isRunning,
    progress,
    formattedTime,
    startFocus,
    pause,
    resume,
    reset,
    settings,
  };
}
