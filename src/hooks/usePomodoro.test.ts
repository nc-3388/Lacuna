import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePomodoro, loadPomodoroSettings, savePomodoroSettings, type PomodoroSettings } from './usePomodoro';

const STORAGE_KEY = 'lacuna-pomodoro-settings';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadPomodoroSettings', () => {
  it('returns defaults when nothing is stored', () => {
    const settings = loadPomodoroSettings();
    expect(settings.workMinutes).toBe(25);
    expect(settings.shortBreakMinutes).toBe(5);
    expect(settings.longBreakMinutes).toBe(15);
    expect(settings.autoStartBreaks).toBe(false);
  });

  it('returns clamped values for stored settings', () => {
    const stored: Partial<PomodoroSettings> = { workMinutes: 200, shortBreakMinutes: 0, longBreakMinutes: 70 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const settings = loadPomodoroSettings();
    expect(settings.workMinutes).toBe(120);
    expect(settings.shortBreakMinutes).toBe(1);
    expect(settings.longBreakMinutes).toBe(60);
  });

  it('returns defaults on invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const settings = loadPomodoroSettings();
    expect(settings.workMinutes).toBe(25);
  });
});

describe('savePomodoroSettings', () => {
  it('persists settings to localStorage', () => {
    savePomodoroSettings({ workMinutes: 30 });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.workMinutes).toBe(30);
  });
});

describe('usePomodoro', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => usePomodoro());
    expect(result.current.phase).toBe('idle');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.formattedTime).toBe('00:00');
  });

  it('starts focus phase and counts down', () => {
    const { result } = renderHook(() => usePomodoro());
    act(() => {
      result.current.startFocus();
    });
    expect(result.current.phase).toBe('focus');
    expect(result.current.isRunning).toBe(true);
    expect(result.current.formattedTime).toBe('25:00');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.formattedTime).toBe('24:59');
  });

  it('pauses and resumes', () => {
    const { result } = renderHook(() => usePomodoro());
    act(() => result.current.startFocus());
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.formattedTime).toBe('24:55');

    act(() => result.current.pause());
    expect(result.current.isRunning).toBe(false);

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.formattedTime).toBe('24:55');

    act(() => result.current.resume());
    expect(result.current.isRunning).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.formattedTime).toBe('24:54');
  });

  it('resets to idle', () => {
    const { result } = renderHook(() => usePomodoro());
    act(() => result.current.startFocus());
    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.formattedTime).toBe('00:00');
  });
});
