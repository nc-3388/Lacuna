import { useEffect, useState } from 'react';

// The global default for FSRS scheduling optimisation. On by default: fitting the
// weights to a user's own review history is where most of FSRS's efficiency comes
// from. A deck can override this to off (see Deck.autoOptimise); applying optimised
// weights always still requires explicit confirmation.

const KEY = 'lacuna.autoOptimise';

export function readAutoOptimiseDefault(): boolean {
  // Default on: only an explicit 'off' opts out.
  return localStorage.getItem(KEY) !== 'off';
}

export function writeAutoOptimiseDefault(enabled: boolean): void {
  localStorage.setItem(KEY, enabled ? 'on' : 'off');
  window.dispatchEvent(new CustomEvent('lacuna:auto-optimise', { detail: enabled }));
}

export function useAutoOptimiseDefault(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readAutoOptimiseDefault());

  useEffect(() => {
    const onChange = () => setEnabled(readAutoOptimiseDefault());
    window.addEventListener('storage', onChange);
    window.addEventListener('lacuna:auto-optimise', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('lacuna:auto-optimise', onChange);
    };
  }, []);

  return [
    enabled,
    (next) => {
      writeAutoOptimiseDefault(next);
      setEnabled(next);
    },
  ];
}

/** Whether optimisation is enabled for a deck: the deck override wins, else the global default. */
export function optimiseEnabledForDeck(
  deckOverride: boolean | undefined,
  globalDefault: boolean,
): boolean {
  return deckOverride ?? globalDefault;
}
