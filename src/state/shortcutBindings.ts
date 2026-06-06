import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'lacuna-shortcut-bindings';

export type LearnAction =
  | 'reveal'
  | 'yes'
  | 'no'
  | 'again'
  | 'hard'
  | 'good'
  | 'easy'
  | 'edit'
  | 'undo'
  | 'focus'
  | 'help';

export interface ShortcutBindings {
  reveal: string;
  yes: string;
  no: string;
  again: string;
  hard: string;
  good: string;
  easy: string;
  edit: string;
  undo: string;
  focus: string;
  help: string;
}

export const DEFAULT_BINDINGS: ShortcutBindings = {
  reveal: 'Space',
  yes: 'y',
  no: 'n',
  again: '1',
  hard: '2',
  good: '3',
  easy: '4',
  edit: 'e',
  undo: 'u',
  focus: 'f',
  help: '?',
};

export const ACTION_LABELS: Record<LearnAction, string> = {
  reveal: 'Show answer',
  yes: 'Mark correct (silent mode)',
  no: 'Mark incorrect (silent mode)',
  again: 'Again (manual mode)',
  hard: 'Hard (manual mode)',
  good: 'Good (manual mode)',
  easy: 'Easy (manual mode)',
  edit: 'Edit the current card',
  undo: 'Undo the last answer',
  focus: 'Toggle focus mode',
  help: 'Show keyboard shortcuts',
};

function readStoredBindings(): Partial<ShortcutBindings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ShortcutBindings>;
      return parsed;
    }
  } catch {
    // Invalid stored JSON; fall back to defaults.
  }
  return {};
}

function saveStoredBindings(bindings: ShortcutBindings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Persistence is best-effort.
  }
}

export function loadBindings(): ShortcutBindings {
  const stored = readStoredBindings();
  return { ...DEFAULT_BINDINGS, ...stored };
}

export function saveBindings(bindings: ShortcutBindings) {
  saveStoredBindings(bindings);
}

export function resetBindings() {
  saveStoredBindings(DEFAULT_BINDINGS);
  return { ...DEFAULT_BINDINGS };
}

/**
 * Check whether a keyboard event matches a stored binding.
 * Letter bindings are case-insensitive. Named keys (Space, ArrowUp, etc.)
 * match on `e.code` for Space and `e.key` for everything else.
 */
export function keyMatches(e: KeyboardEvent, binding: string): boolean {
  if (binding === 'Space') return e.code === 'Space';
  if (binding.startsWith('Arrow')) return e.key === binding;
  if (binding.length === 1 && /[a-z]/i.test(binding)) {
    return e.key.toLowerCase() === binding.toLowerCase();
  }
  return e.key === binding;
}

/** A human-readable label for a binding string. */
export function formatBinding(binding: string): string {
  if (binding === ' ') return 'Space';
  if (binding === 'ArrowUp') return 'Up';
  if (binding === 'ArrowDown') return 'Arrow down';
  if (binding === 'ArrowLeft') return 'Left';
  if (binding === 'ArrowRight') return 'Right';
  return binding;
}

/** React hook that keeps bindings in state and persists changes to localStorage. */
export function useShortcutBindings() {
  const [bindings, setBindingsState] = useState<ShortcutBindings>(loadBindings);

  useEffect(() => {
    saveBindings(bindings);
  }, [bindings]);

  const setBinding = useCallback((action: LearnAction, key: string) => {
    setBindingsState((prev) => ({ ...prev, [action]: key }));
  }, []);

  const reset = useCallback(() => {
    setBindingsState({ ...DEFAULT_BINDINGS });
  }, []);

  return { bindings, setBinding, reset };
}
