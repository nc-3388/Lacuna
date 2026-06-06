import { AnimatePresence, motion } from 'motion/react';
import { SHORTCUT_GROUPS } from '../../state/shortcuts';
import { useShortcutBindings, formatBinding } from '../../state/shortcutBindings';
import { CloseIcon } from './icons';

/**
 * A keyboard-shortcuts cheatsheet, opened with "?" from anywhere. Its contents come from
 * the shared SHORTCUT_GROUPS registry so it always matches the real handlers.
 */
export function KeyHints({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bindings } = useShortcutBindings();

  // Build shortcut groups from live bindings so the cheatsheet never drifts.
  const liveGroups = SHORTCUT_GROUPS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.map((s) => {
      // Replace hardcoded keys with custom bindings for the Learn actions.
      const description = s.description.toLowerCase();
      if (description.includes('show the answer')) {
        return { ...s, keys: [formatBinding(bindings.reveal)] };
      }
      if (description.includes('mark correct') && !description.includes('manual')) {
        return { ...s, keys: [formatBinding(bindings.yes)] };
      }
      if (description.includes('mark incorrect')) {
        return { ...s, keys: [formatBinding(bindings.no)] };
      }
      if (description.includes('again')) {
        return { ...s, keys: [formatBinding(bindings.again)] };
      }
      if (description.includes('hard')) {
        return { ...s, keys: [formatBinding(bindings.hard)] };
      }
      if (description.includes('good')) {
        return { ...s, keys: [formatBinding(bindings.good)] };
      }
      if (description.includes('easy')) {
        return { ...s, keys: [formatBinding(bindings.easy)] };
      }
      if (description.includes('edit the current card')) {
        return { ...s, keys: [formatBinding(bindings.edit)] };
      }
      if (description.includes('toggle focus')) {
        return { ...s, keys: [formatBinding(bindings.focus)] };
      }
      if (description.includes('undo')) {
        return { ...s, keys: [formatBinding(bindings.undo)] };
      }
      return s;
    }),
  }));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === '?') {
              e.preventDefault();
              onClose();
            }
          }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-line-strong bg-paper shadow-2xl shadow-black/20"
          >
            <header className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="font-display text-xl">Keyboard shortcuts</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                title="Close (Esc)"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <CloseIcon width={18} height={18} />
              </button>
            </header>

            <div className="grid gap-6 px-6 py-6 sm:grid-cols-2">
              {liveGroups.map((group) => (
                <div key={group.title}>
                  <h3 className="mb-2 text-xs uppercase tracking-[0.14em] text-ink-faint">
                    {group.title}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {group.shortcuts.map((s) => (
                      <li
                        key={s.description}
                        className="flex items-center justify-between gap-3 text-sm text-ink-soft"
                      >
                        <span>{s.description}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {s.keys.map((k) => (
                            <kbd
                              key={k}
                              className="rounded border border-line-strong bg-surface px-1.5 py-0.5 text-[11px] text-ink-faint"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
