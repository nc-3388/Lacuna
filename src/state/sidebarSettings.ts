import { useEffect, useState } from 'react';

// Device-local sidebar preferences: whether to show due card counts, archived decks,
// and whether to use a compact layout.

const KEY = 'lacuna.sidebarSettings';

export interface SidebarSettings {
  showDueCounts: boolean;
  showArchived: boolean;
  compactMode: boolean;
}

const DEFAULTS: SidebarSettings = {
  showDueCounts: true,
  showArchived: true,
  compactMode: false,
};

function readStored(): SidebarSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SidebarSettings>;
      return {
        showDueCounts: parsed.showDueCounts ?? DEFAULTS.showDueCounts,
        showArchived: parsed.showArchived ?? DEFAULTS.showArchived,
        compactMode: parsed.compactMode ?? DEFAULTS.compactMode,
      };
    }
  } catch {
    // Ignore parse errors and fall back to defaults.
  }
  return { ...DEFAULTS };
}

export function writeSidebarSettings(settings: Partial<SidebarSettings>): void {
  const current = readStored();
  const next = { ...current, ...settings };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent('lacuna:sidebar-settings', { detail: next }),
  );
}

export function useSidebarSettings(): [
  SidebarSettings,
  (patch: Partial<SidebarSettings>) => void,
] {
  const [settings, setSettings] = useState<SidebarSettings>(() => readStored());

  useEffect(() => {
    const onChange = () => setSettings(readStored());
    window.addEventListener('storage', onChange);
    window.addEventListener('lacuna:sidebar-settings', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('lacuna:sidebar-settings', onChange);
    };
  }, []);

  return [
    settings,
    (patch) => {
      writeSidebarSettings(patch);
      setSettings(readStored());
    },
  ];
}
