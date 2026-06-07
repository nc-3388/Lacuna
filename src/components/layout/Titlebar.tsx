import { useEffect, useState } from 'react';
import { FlaskIcon } from '../ui/icons';

declare global {
  interface Window {
    electronAPI?: {
      isElectron?: boolean;
      minimizeWindow?: () => void;
      maximizeWindow?: () => void;
      closeWindow?: () => void;
      isMaximized?: () => Promise<boolean>;
      onMaximizeChange?: (cb: (maximized: boolean) => void) => () => void;
    };
  }
}

export function Titlebar() {
  const [maximized, setMaximized] = useState(false);
  const api = window.electronAPI;

  useEffect(() => {
    if (!api) return;
    void api.isMaximized?.().then(setMaximized);
    const unsub = api.onMaximizeChange?.(setMaximized);
    return () => { unsub?.(); };
  }, [api]);

  if (!api?.isElectron) return null;

  return (
    <div
      className="select-none flex items-center h-8 px-3 gap-2 border-b border-line bg-surface/80 backdrop-blur"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <FlaskIcon width={14} height={14} className="text-accent" />
      <span className="text-xs font-medium text-ink-soft tracking-wide">Lacuna</span>

      <div className="ml-auto flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => api.minimizeWindow?.()}
          className="w-11 h-8 flex items-center justify-center text-ink-soft hover:bg-ink/5 transition-colors"
          aria-label="Minimise"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button
          onClick={() => api.maximizeWindow?.()}
          className="w-11 h-8 flex items-center justify-center text-ink-soft hover:bg-ink/5 transition-colors"
          aria-label={maximized ? 'Restore' : 'Maximise'}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="1.5" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <rect x="3.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="2" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          )}
        </button>
        <button
          onClick={() => api.closeWindow?.()}
          className="w-11 h-8 flex items-center justify-center text-ink-soft hover:bg-negative/15 hover:text-negative transition-colors"
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
