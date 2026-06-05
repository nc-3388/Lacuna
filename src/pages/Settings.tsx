import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTheme } from '../state/ThemeContext';
import { ACCENTS, useAccent } from '../state/AccentContext';
import { FONT_SCALE_STEPS, useFontScale } from '../state/FontScaleContext';
import { useBackups } from '../state/useData';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { cn } from '../components/ui/cn';
import { useToast } from '../components/ui/Toast';
import {
  downloadBackup,
  importBackup,
  readBackupFile,
  type ImportMode,
} from '../db/portability';
import {
  loadPomodoroSettings,
  savePomodoroSettings,
  type PomodoroSettings,
} from '../hooks/usePomodoro';
import {
  exportCardsCsv,
  exportCardsTsv,
  exportCardsPlainText,
  downloadTextFile,
} from '../db/export';
import {
  backupFolderName,
  chooseBackupFolder,
  clearBackupFolder,
  deleteBackup,
  folderMirrorSupported,
  restoreBackup,
  takeAutoBackup,
} from '../db/backups';
import { DownloadIcon, MoonIcon, SunIcon, UploadIcon } from '../components/ui/icons';
import type { BackupFile } from '../db/types';
import { formatDate, formatDateTime } from '../utils/datetime';
import { useGradingMode } from '../state/gradingMode';
import { useAutoOptimiseDefault } from '../state/optimiseSetting';
import { MIN_OPTIMISE_REVIEWS } from '../fsrs/optimise';
import {
  requestPersistentStorage,
  checkPersistentStorage,
  type StoragePersistenceState,
} from '../db/persistence';

export function Settings() {
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const { scale, setScale } = useFontScale();
  const { notify } = useToast();
  const [gradingMode, setGradingMode] = useGradingMode();
  const [autoOptimise, setAutoOptimise] = useAutoOptimiseDefault();
  const [pomoSettings, setPomoSettings] = useState<PomodoroSettings>(loadPomodoroSettings);
  const backups = useBackups();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [persistence, setPersistence] = useState<StoragePersistenceState | null>(null);

  const [pending, setPending] = useState<BackupFile | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const mirrorSupported = folderMirrorSupported();

  useEffect(() => {
    void backupFolderName().then(setFolder);
    void checkPersistentStorage().then(setPersistence);
  }, []);

  async function handleBackupNow() {
    try {
      await takeAutoBackup();
      notify('Restore point saved.', 'positive');
    } catch {
      notify('Could not save a restore point.', 'negative');
    }
  }

  async function handleRestore(id: number) {
    try {
      await restoreBackup(id);
      setConfirmRestore(null);
      notify('Data restored from the selected point.', 'positive');
    } catch {
      notify('Restore failed.', 'negative');
    }
  }

  async function handleChooseFolder() {
    try {
      const name = await chooseBackupFolder();
      setFolder(name);
      if (name) notify('Backups will now mirror to that folder.', 'positive');
    } catch {
      // The user cancelling the picker is not an error worth reporting.
    }
  }

  async function handleStopMirror() {
    await clearBackupFolder();
    setFolder(null);
    notify('Folder mirroring stopped.', 'neutral');
  }

  async function handleRequestPersistence() {
    const state = await requestPersistentStorage();
    setPersistence(state);
    if (state.persisted) {
      notify('Storage is now persisted.', 'positive');
    } else if (!state.supported) {
      notify('This browser does not support persistent storage.', 'neutral');
    } else {
      notify('Persistent storage was denied.', 'negative');
    }
  }

  async function handleExport() {
    try {
      await downloadBackup();
      notify('Backup downloaded.', 'positive');
    } catch {
      notify('Could not create the backup.', 'negative');
    }
  }

  async function handleExportCsv() {
    try {
      const csv = await exportCardsCsv();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(csv, `lacuna-cards-${stamp}.csv`, 'text/csv');
      notify('CSV exported.', 'positive');
    } catch {
      notify('Could not export CSV.', 'negative');
    }
  }

  async function handleExportTsv() {
    try {
      const tsv = await exportCardsTsv();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(tsv, `lacuna-cards-${stamp}.tsv`, 'text/tab-separated-values');
      notify('TSV exported.', 'positive');
    } catch {
      notify('Could not export TSV.', 'negative');
    }
  }

  async function handleExportPlainText() {
    try {
      const text = await exportCardsPlainText();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(text, `lacuna-cards-${stamp}.txt`, 'text/plain');
      notify('Plain text exported.', 'positive');
    } catch {
      notify('Could not export plain text.', 'negative');
    }
  }

  async function handleFile(file: File) {
    try {
      const backup = await readBackupFile(file);
      setPending(backup);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Invalid file.', 'negative');
    }
  }

  async function runImport(mode: ImportMode) {
    if (!pending) return;
    try {
      await importBackup(pending, mode);
      notify(
        mode === 'replace' ? 'Data replaced from backup.' : 'Backup merged.',
        'positive',
      );
    } catch {
      notify('Import failed.', 'negative');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 md:px-10">
      <header className="mb-10">
        <p className="mb-1 text-sm uppercase tracking-[0.18em] text-ink-faint">
          Preferences
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">Settings</h1>
      </header>

      {/* Appearance */}
      <section className="mb-8 rounded-2xl border border-line bg-surface p-6">
        <h2 className="mb-1 font-display text-xl">Appearance</h2>
        <p className="mb-4 text-sm text-ink-soft">
          Lacuna defaults to a dark theme. Your choice is remembered on this device.
        </p>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm">
            {theme === 'dark' ? (
              <MoonIcon width={18} height={18} />
            ) : (
              <SunIcon width={18} height={18} />
            )}
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </span>
          <Toggle
            checked={theme === 'light'}
            onChange={(checked) => setTheme(checked ? 'light' : 'dark')}
            label="Light"
          />
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <div className="mb-1 text-sm">Accent colour</div>
          <p className="mb-3 text-sm text-ink-soft">
            Sets the highlight colour used across the app. Remembered on this device.
          </p>
          <div className="flex flex-wrap gap-3">
            {ACCENTS.map((option) => {
              const active = accent === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setAccent(option.key)}
                  aria-pressed={active}
                  title={option.label}
                  aria-label={option.label}
                  className={cn(
                    'h-9 w-9 rounded-full ring-2 ring-offset-2 ring-offset-surface transition-transform hover:scale-105',
                    active ? 'ring-ink' : 'ring-transparent',
                  )}
                  style={{ backgroundColor: option.swatch }}
                />
              );
            })}
          </div>
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm">Text size</span>
            <span className="tabular text-sm text-ink-faint">{Math.round(scale * 100)}%</span>
          </div>
          <p className="mb-3 text-sm text-ink-soft">
            Scales all text across the app. Remembered on this device.
          </p>
          <div className="flex gap-2">
            {FONT_SCALE_STEPS.map((step) => {
              const active = Math.round(scale * 100) === Math.round(step.value * 100);
              return (
                <button
                  key={step.label}
                  type="button"
                  onClick={() => setScale(step.value)}
                  aria-pressed={active}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-2 text-sm transition-colors',
                    active
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line text-ink-soft hover:border-line-strong',
                  )}
                >
                  <span style={{ fontSize: `${step.value}em` }}>A</span>
                  <span className="ml-1.5 align-middle text-xs">{step.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Study and scheduling */}
      <section className="mb-8 rounded-2xl border border-line bg-surface p-6">
        <h2 className="mb-1 font-display text-xl">Study &amp; scheduling</h2>
        <p className="mb-5 text-sm text-ink-soft">
          How grades are decided and how the FSRS schedule adapts to you.
        </p>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm">Manual four-point grading</div>
            <p className="mt-1 text-sm text-ink-soft">
              By default Lacuna grades silently from whether you were right and how long you
              took, so you only press Yes or No. Turn this on to grade each card yourself with
              the four FSRS buttons (Again, Hard, Good, Easy) and their keyboard shortcuts.
            </p>
          </div>
          <Toggle
            checked={gradingMode === 'manual'}
            onChange={(checked) => setGradingMode(checked ? 'manual' : 'silent')}
            label="Manual grading"
          />
        </div>

        <div className="mt-6 flex items-start justify-between gap-3 border-t border-line pt-5">
          <div className="min-w-0">
            <div className="text-sm">Optimise scheduling</div>
            <p className="mt-1 text-sm text-ink-soft">
              Fit each deck's FSRS weights to your own review history, which is where most of
              FSRS's efficiency comes from. On by default. Optimisation only runs once a deck
              has at least {MIN_OPTIMISE_REVIEWS} reviews, and new weights are never applied
              without your confirmation. You can override this per deck in its settings.
            </p>
          </div>
          <Toggle
            checked={autoOptimise}
            onChange={setAutoOptimise}
            label="Optimise scheduling"
          />
        </div>
      </section>

      {/* Pomodoro timer */}
      <section className="mb-8 rounded-2xl border border-line bg-surface p-6">
        <h2 className="mb-1 font-display text-xl">Pomodoro timer</h2>
        <p className="mb-5 text-sm text-ink-soft">
          A built-in focus timer for your study sessions. Customise the durations to match
          your own rhythm.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <DurationInput
            label="Focus"
            value={pomoSettings.workMinutes}
            onChange={(v) => {
              const next = { ...pomoSettings, workMinutes: v };
              setPomoSettings(next);
              savePomodoroSettings(next);
            }}
          />
          <DurationInput
            label="Short break"
            value={pomoSettings.shortBreakMinutes}
            onChange={(v) => {
              const next = { ...pomoSettings, shortBreakMinutes: v };
              setPomoSettings(next);
              savePomodoroSettings(next);
            }}
          />
          <DurationInput
            label="Long break"
            value={pomoSettings.longBreakMinutes}
            onChange={(v) => {
              const next = { ...pomoSettings, longBreakMinutes: v };
              setPomoSettings(next);
              savePomodoroSettings(next);
            }}
          />
        </div>
        <div className="mt-5 flex items-start justify-between gap-3 border-t border-line pt-5">
          <div className="min-w-0">
            <div className="text-sm">Auto-start breaks</div>
            <p className="mt-1 text-sm text-ink-soft">
              Automatically start the break timer when a focus session ends.
            </p>
          </div>
          <Toggle
            checked={pomoSettings.autoStartBreaks}
            onChange={(checked) => {
              const next = { ...pomoSettings, autoStartBreaks: checked };
              setPomoSettings(next);
              savePomodoroSettings(next);
            }}
            label="Auto-start breaks"
          />
        </div>
      </section>

      {/* Data portability */}
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="mb-1 font-display text-xl">Import &amp; export</h2>
        <p className="mb-5 text-sm text-ink-soft">
          All your data lives locally in this browser. Export it to a single JSON file
          for backup or transfer, and import to restore or merge.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={handleExport}>
            <DownloadIcon width={18} height={18} />
            Export all data (JSON)
          </Button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            <UploadIcon width={18} height={18} />
            Import from file
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button variant="ghost" size="sm" onClick={handleExportCsv}>
            Export CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExportTsv}>
            Export TSV
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExportPlainText}>
            Export plain text
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />
        </div>

        {/* Inline import-mode chooser, revealed once a backup file is read */}
        <AnimatePresence>
          {pending && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-line-strong bg-surface-raised p-5">
                <h3 className="mb-3 font-display text-lg">Import data</h3>
                <div className="text-sm text-ink-soft">
                  <p className="mb-3">
                    This backup contains{' '}
                    <strong className="text-ink">{pending.decks.length}</strong> decks and{' '}
                    <strong className="text-ink">{pending.cards.length}</strong> cards,
                    exported on {formatDate(pending.exportedAt)}.
                  </p>
                  <ul className="space-y-2">
                    <li>
                      <strong className="text-ink">Merge</strong> keeps your current data
                      and folds in the backup, with the most recently updated copy winning
                      any conflict.
                    </li>
                    <li>
                      <strong className="text-ink">Replace all</strong> deletes everything
                      currently stored and restores the backup exactly.
                    </li>
                  </ul>
                </div>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                  <Button variant="secondary" onClick={() => runImport('merge')}>
                    Merge
                  </Button>
                  <Button variant="primary" onClick={() => runImport('replace')}>
                    Replace all
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Automatic backups */}
      <section className="mt-8 rounded-2xl border border-line bg-surface p-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl">Automatic backups</h2>
          <Button variant="secondary" size="sm" onClick={handleBackupNow}>
            Back up now
          </Button>
        </div>
        <p className="mb-5 text-sm text-ink-soft">
          Lacuna keeps the ten most recent restore points on this device and saves one
          automatically when you open it (at most once a day). Restoring replaces all
          current data with that snapshot.
        </p>

        {/* Persistent storage */}
        {persistence && (
          <div
            className={cn(
              'mb-5 rounded-xl border p-4',
              persistence.persisted
                ? 'border-line bg-surface-raised/40'
                : 'border-negative bg-negative/5',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-ink">
                  {persistence.persisted
                    ? 'Storage is persisted'
                    : 'Storage is not persisted'}
                </div>
                <p className="text-xs text-ink-faint">
                  {persistence.supported ? (
                    <>
                      {persistence.persisted
                        ? 'The browser will not delete this data under storage pressure.'
                        : 'The browser may delete this data under storage pressure. Regular exports or folder mirroring are the safeguard.'}
                      {persistence.usage != null && persistence.quota != null && (
                        <>
                          {' '}
                          Using {Math.round(persistence.usage / 1024 / 1024)} MB of{' '}
                          {Math.round(persistence.quota / 1024 / 1024)} MB.
                        </>
                      )}
                    </>
                  ) : (
                    'This browser does not support persistent storage.'
                  )}
                </p>
              </div>
              {persistence.supported && !persistence.persisted && (
                <Button variant="secondary" size="sm" onClick={handleRequestPersistence}>
                  Request persistence
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Folder mirror */}
        {mirrorSupported ? (
          <div className="mb-5 rounded-xl border border-line bg-surface-raised/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-ink">Mirror to a folder</div>
                <p className="text-xs text-ink-faint">
                  {folder
                    ? `Backups are also written to “${folder}”. This survives clearing browser data.`
                    : 'Also write each backup to a folder on your computer, so it survives clearing browser data.'}
                </p>
              </div>
              {folder ? (
                <Button variant="ghost" size="sm" onClick={handleStopMirror}>
                  Stop mirroring
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={handleChooseFolder}>
                  Choose folder
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="mb-5 text-xs text-ink-faint">
            This browser cannot mirror backups to a folder; restore points are kept in the
            browser only. Use “Export all data” above for an off-device copy.
          </p>
        )}

        {/* Restore points */}
        {!backups || backups.length === 0 ? (
          <p className="text-sm text-ink-faint">No restore points yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {backups.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm text-ink">{formatDateTime(b.createdAt)}</div>
                  <div className="text-xs text-ink-faint">
                    {b.deckCount} deck{b.deckCount === 1 ? '' : 's'} · {b.cardCount} card
                    {b.cardCount === 1 ? '' : 's'}
                  </div>
                </div>
                {confirmRestore === b.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-soft">Replace all data?</span>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmRestore(null)}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => b.id != null && handleRestore(b.id)}
                    >
                      Restore
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => b.id != null && void deleteBackup(b.id)}
                    >
                      Delete
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmRestore(b.id ?? null)}
                    >
                      Restore
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DurationInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm text-ink-soft">
      {label}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={120}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(Math.max(1, Math.min(120, n)));
          }}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-ink outline-none transition-colors focus:border-accent"
        />
        <span className="shrink-0 text-xs text-ink-faint">min</span>
      </div>
    </label>
  );
}
