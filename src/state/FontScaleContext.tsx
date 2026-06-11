import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

// A device-local base text-size control. The scale is applied as the root font-size, so
// every rem-based size in the app grows or shrinks together. Mirrors ThemeContext.

const STORAGE_KEY = 'lacuna-font-scale';
export const FONT_SCALE_USER_SET_KEY = 'lacuna-font-scale-user-set';

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.35;
export const FONT_SCALE_DEFAULT = 1;

/** Named steps offered in Settings. */
export const FONT_SCALE_STEPS = [
  { label: 'Small', value: 0.9 },
  { label: 'Default', value: 1 },
  { label: 'Large', value: 1.15 },
  { label: 'Larger', value: 1.3 },
] as const;

interface FontScaleValue {
  scale: number;
  setScale: (scale: number) => void;
}

const FontScaleContext = createContext<FontScaleValue | null>(null);

function clamp(value: number): number {
  if (!Number.isFinite(value)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
}

function readStored(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (stored) return clamp(stored);
  } catch {
    // Ignore storage access errors and fall back to the default.
  }
  return FONT_SCALE_DEFAULT;
}

export function FontScaleProvider({ children }: { children: ReactNode }) {
  const [scale, setScaleState] = useState<number>(readStored);

  useEffect(() => {
    document.documentElement.style.fontSize = `${scale * 100}%`;
    try {
      localStorage.setItem(STORAGE_KEY, String(scale));
    } catch {
      // Persistence is best-effort.
    }
  }, [scale]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'number') setScaleState(clamp(detail));
    };
    window.addEventListener('lacuna:font-scale', handler);
    return () => window.removeEventListener('lacuna:font-scale', handler);
  }, []);

  const setScale = useCallback((next: number) => {
    try {
      localStorage.setItem(FONT_SCALE_USER_SET_KEY, '1');
    } catch {
      // Persistence is best-effort.
    }
    setScaleState(clamp(next));
  }, []);

  return (
    <FontScaleContext.Provider value={{ scale, setScale }}>
      {children}
    </FontScaleContext.Provider>
  );
}

export function useFontScale(): FontScaleValue {
  const ctx = useContext(FontScaleContext);
  if (!ctx) throw new Error('useFontScale must be used within a FontScaleProvider');
  return ctx;
}
