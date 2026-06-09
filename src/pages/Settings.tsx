import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m as motion, useMotionValue, useSpring, LayoutGroup } from 'motion/react';
import { useMotionSpeed, speedMultiplier, type MotionSpeed } from '../state/motionSpeed';
import { useTheme, type Theme } from '../state/ThemeContext';
import { ACCENTS, useAccent } from '../state/AccentContext';
import { FONT_SCALE_STEPS, useFontScale } from '../state/FontScaleContext';
import { useBackups } from '../state/useData';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { cn } from '../components/ui/cn';
import { useToast } from '../components/ui/Toast';
import {
  importBackup,
  readBackupFile,
  type ImportMode,
} from '../db/portability';
import {
  loadPomodoroSettings,
  savePomodoroSettings,
  type PomodoroSettings,
} from '../hooks/usePomodoro';
import { UnifiedExportPanel } from '../components/import/UnifiedExportPanel';
import {
  backupFolderName,
  chooseBackupFolder,
  clearBackupFolder,
  deleteBackup,
  folderMirrorSupported,
  restoreBackup,
  takeAutoBackup,
} from '../db/backups';
import { MoonIcon, SunIcon, UploadIcon, DownloadIcon } from '../components/ui/icons';
import type { BackupFile } from '../db/types';
import { formatDate, formatDateTime } from '../utils/datetime';
import { useGradingMode } from '../state/gradingMode';
import { useAutoOptimiseDefault } from '../state/optimiseSetting';
import { useDashboardSort, type DashboardSort } from '../state/dashboardSort';
import { useSidebarSettings, DEFAULT_NAV_ITEMS } from '../state/sidebarSettings';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { MIN_OPTIMISE_REVIEWS } from '../fsrs/optimise';
import {
  requestPersistentStorage,
  checkPersistentStorage,
  type StoragePersistenceState,
} from '../db/persistence';
import {
  useShortcutBindings,
  ACTION_LABELS,
  formatBinding,
  type LearnAction,
} from '../state/shortcutBindings';

const SETTINGS_SECTIONS = [
  { id: 'settings-appearance', label: 'Appearance' },
  { id: 'settings-sidebar', label: 'Sidebar' },
  { id: 'settings-dashboard', label: 'Dashboard' },
  { id: 'settings-study', label: 'Study & scheduling' },
  { id: 'settings-shortcuts', label: 'Keyboard shortcuts' },
  { id: 'settings-pomodoro', label: 'Pomodoro timer' },
  { id: 'settings-install', label: 'Install' },
  { id: 'settings-export', label: 'Import & export' },
  { id: 'settings-backups', label: 'Automatic backups' },
];

export function Settings() {
  const [motionSpeed, setMotionSpeed] = useMotionSpeed();
  const motionMult = speedMultiplier(motionSpeed);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const { scale, setScale } = useFontScale();
  const { notify } = useToast();
  const [gradingMode, setGradingMode] = useGradingMode();
  const [autoOptimise, setAutoOptimise] = useAutoOptimiseDefault();
  const [dashboardSort, setDashboardSort] = useDashboardSort();
  const [pomoSettings, setPomoSettings] = useState<PomodoroSettings>(loadPomodoroSettings);
  const backups = useBackups();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [persistence, setPersistence] = useState<StoragePersistenceState | null>(null);
  const shortcutBindings = useShortcutBindings();
  const [sidebarSettings, setSidebarSettings] = useSidebarSettings();
  const [capturingAction, setCapturingAction] = useState<LearnAction | null>(null);
  const [activeSection, setActiveSection] = useState<string>(SETTINGS_SECTIONS[0].id);

  const [pending, setPending] = useState<BackupFile | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const mirrorSupported = folderMirrorSupported();

  useEffect(() => {
    void backupFolderName().then(setFolder);
    void checkPersistentStorage().then(setPersistence);
  }, []);

  // Track which settings section is currently visible using IntersectionObserver.
  useEffect(() => {
    const intersecting = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) intersecting.add(entry.target.id);
          else intersecting.delete(entry.target.id);
        });
        // Pick the topmost intersecting section (earliest in the list).
        const top = SETTINGS_SECTIONS.find((s) => intersecting.has(s.id));
        if (top) setActiveSection(top.id);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
    );
    SETTINGS_SECTIONS.forEach((section) => {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
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
    <div className="mx-auto flex max-w-6xl gap-8 px-6 pb-10 pt-12 md:px-10 md:py-10">
      <div className="min-w-0 flex-1 max-w-2xl">
        <header className="mb-10">
        <p className="mb-1 text-sm uppercase tracking-[0.18em] text-ink-faint">
          Preferences
        </p>
        <h1 className="font-display text-4xl tracking-tight md:text-5xl">Settings</h1>
      </header>

      {/* Appearance */}
      <section
        id="settings-appearance"
        className="mb-8 rounded-2xl border border-line bg-surface p-6"
      >
        <h2 className="mb-1 font-display text-xl">Appearance</h2>
        <p className="mb-4 text-sm text-ink-soft">
          Lacuna defaults to a dark theme. Your choice is remembered on this device.
        </p>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm">
            {resolvedTheme === 'dark' ? (
              <MoonIcon width={18} height={18} />
            ) : (
              <SunIcon width={18} height={18} />
            )}
            {theme === 'auto'
              ? `Auto (${resolvedTheme === 'dark' ? 'dark' : 'light'})`
              : resolvedTheme === 'dark'
                ? 'Dark mode'
                : 'Light mode'}
          </span>
          <div className="flex gap-1">
            {(['dark', 'light', 'auto'] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                  theme === t
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-ink-soft hover:border-line-strong',
                )}
              >
                {t === 'dark' && 'Dark'}
                {t === 'light' && 'Light'}
                {t === 'auto' && 'Auto'}
              </button>
            ))}
          </div>
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
                  className="relative h-9 w-9 rounded-full transition-transform duration-150 hover:scale-110 active:scale-[0.88]"
                  style={{ backgroundColor: option.swatch }}
                >
                  {active && (
                    <span className="absolute inset-[-4px] rounded-full ring-2 ring-ink ring-offset-2 ring-offset-surface" />
                  )}
                </button>
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

        <div className="mt-6 border-t border-line pt-5">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm">Animation speed</span>
            <span className="tabular text-sm text-ink-faint">
              {motionSpeed === 'slow' ? 'Slow' : motionSpeed === 'fast' ? 'Fast' : 'Normal'}
            </span>
          </div>
          <p className="mb-3 text-sm text-ink-soft">
            Adjust how quickly decorative animations play across the app.
            Does not affect functional timers or progress bars.
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-faint">Slow</span>
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={motionSpeed === 'slow' ? 0 : motionSpeed === 'normal' ? 1 : 2}
              onChange={(e) => {
                const val = Number(e.target.value);
                const next: MotionSpeed = val === 0 ? 'slow' : val === 2 ? 'fast' : 'normal';
                setMotionSpeed(next);
              }}
              className="flex-1 accent-accent"
              aria-label="Animation speed"
            />
            <span className="text-xs text-ink-faint">Fast</span>
          </div>
        </div>
      </section>

      {/* Sidebar */}
      <section
        id="settings-sidebar"
        className="mb-8 rounded-2xl border border-line bg-surface p-6"
      >
        <h2 className="mb-1 font-display text-xl">Sidebar</h2>
        <p className="mb-5 text-sm text-ink-soft">
          Control what information appears in the sidebar navigation and how compact it is.
        </p>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm">Show due card counts</div>
            <p className="mt-1 text-sm text-ink-soft">
              Display the number of cards ready for review next to each deck name in the
              sidebar, so you can see which decks need attention at a glance.
            </p>
          </div>
          <Toggle
            checked={sidebarSettings.showDueCounts}
            onChange={(checked) => setSidebarSettings({ showDueCounts: checked })}
          />
        </div>
        <div className="mt-6 flex items-start justify-between gap-3 border-t border-line pt-5">
          <div className="min-w-0">
            <div className="text-sm">Show archived decks</div>
            <p className="mt-1 text-sm text-ink-soft">
              Include archived decks in the sidebar deck list. Archived decks are hidden
              from the dashboard by default but can still be accessed via the sidebar.
            </p>
          </div>
          <Toggle
            checked={sidebarSettings.showArchived}
            onChange={(checked) => setSidebarSettings({ showArchived: checked })}
          />
        </div>
        <div className="mt-6 flex items-start justify-between gap-3 border-t border-line pt-5">
          <div className="min-w-0">
            <div className="text-sm">Compact mode</div>
            <p className="mt-1 text-sm text-ink-soft">
              Reduce padding and font sizes throughout the sidebar to fit more items on
              screen at once.
            </p>
          </div>
          <Toggle
            checked={sidebarSettings.compactMode}
            onChange={(checked) => setSidebarSettings({ compactMode: checked })}
          />
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <div className="mb-1 text-sm">Primary navigation</div>
          <p className="mb-4 text-sm text-ink-soft">
            Reorder or hide the main nav items in the sidebar. At least one item must remain visible.
          </p>
          <div className="flex flex-col gap-2">
            {(() => {
              const visibleCount = sidebarSettings.navItems.filter((n) => n.visible).length;
              return sidebarSettings.navItems.map((item, index) => {
                const canMoveUp = index > 0;
                const canMoveDown = index < sidebarSettings.navItems.length - 1;
                const canHide = item.visible ? visibleCount > 1 : true;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 transition-colors"
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={!canMoveUp}
                      onClick={() => {
                        const next = [...sidebarSettings.navItems];
                        const [removed] = next.splice(index, 1);
                        next.splice(index - 1, 0, removed);
                        setSidebarSettings({ navItems: next });
                      }}
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors focus-visible:ring-2 focus-visible:ring-accent',
                        canMoveUp ? 'hover:bg-ink/5 hover:text-ink' : 'opacity-30',
                      )}
                      aria-label={`Move ${item.label} up`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
                    </button>
                    <button
                      type="button"
                      disabled={!canMoveDown}
                      onClick={() => {
                        const next = [...sidebarSettings.navItems];
                        const [removed] = next.splice(index, 1);
                        next.splice(index + 1, 0, removed);
                        setSidebarSettings({ navItems: next });
                      }}
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors focus-visible:ring-2 focus-visible:ring-accent',
                        canMoveDown ? 'hover:bg-ink/5 hover:text-ink' : 'opacity-30',
                      )}
                      aria-label={`Move ${item.label} down`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                  </div>
                  <span className="flex-1 text-sm text-ink">{item.label}</span>                    <Toggle
                    checked={item.visible}
                    disabled={!canHide}
                    onChange={(checked) => {
                      const next = sidebarSettings.navItems.map((n) =>
                        n.id === item.id ? { ...n, visible: checked } : n,
                      );
                      setSidebarSettings({ navItems: next });
                    }}
                  />
                </div>
              );
              });
            })()}
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarSettings({ navItems: DEFAULT_NAV_ITEMS })}
            >
              Reset to defaults
            </Button>
          </div>
        </div>
      </section>

      {/* Dashboard */}
      <section
        id="settings-dashboard"
        className="mb-8 rounded-2xl border border-line bg-surface p-6"
      >
        <h2 className="mb-1 font-display text-xl">Dashboard</h2>
        <p className="mb-5 text-sm text-ink-soft">
          Choose how decks are ordered on the dashboard. The top three active decks are shown.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(
            [
              { key: 'recent', label: 'Recently studied' },
              { key: 'ready', label: 'Ready for review' },
              { key: 'mastery', label: 'Lowest mastery' },
              { key: 'exam', label: 'Soonest exam' },
              { key: 'name', label: 'Name A–Z' },
              { key: 'created', label: 'Created recently' },
            ] as { key: DashboardSort; label: string }[]
          ).map((option) => {
            const active = dashboardSort === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setDashboardSort(option.key)}
                aria-pressed={active}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                  active
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-ink-soft hover:border-line-strong',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Study and scheduling */}
      <section
        id="settings-study"
        className="mb-8 rounded-2xl border border-line bg-surface p-6"
      >
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
          />
        </div>
      </section>

      {/* Keyboard shortcuts */}
      <section
        id="settings-shortcuts"
        className="mb-8 rounded-2xl border border-line bg-surface p-6"
      >
        <h2 className="mb-1 font-display text-xl">Keyboard shortcuts</h2>
        <p className="mb-5 text-sm text-ink-soft">
          Customise the keys used while studying. Click any row then press the key you want
          to assign. Changes are remembered on this device.
        </p>
        <div className="flex flex-col gap-2">
          {(Object.keys(ACTION_LABELS) as LearnAction[]).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => setCapturingAction(action)}
              className={cn(
                'flex items-center justify-between rounded-lg border px-4 py-2.5 text-left transition-colors',
                capturingAction === action
                  ? 'border-accent bg-accent-soft'
                  : 'border-line hover:border-line-strong',
              )}
            >
              <span className="text-sm">{ACTION_LABELS[action]}</span>
              <kbd
                className={cn(
                  'rounded border px-2 py-0.5 text-xs',
                  capturingAction === action
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-line-strong bg-surface text-ink-faint',
                )}
              >
                {capturingAction === action
                  ? 'Press a key…'
                  : formatBinding(shortcutBindings.bindings[action])}
              </kbd>
            </button>
          ))}
        </div>
        {capturingAction && (
          <KeyCaptureOverlay
            action={capturingAction}
            onCapture={(key) => {
              shortcutBindings.setBinding(capturingAction, key);
              setCapturingAction(null);
              notify('Shortcut updated.', 'positive');
            }}
            onCancel={() => setCapturingAction(null)}
          />
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => {
            shortcutBindings.reset();
            notify('Shortcuts reset to defaults.', 'neutral');
          }}>
            Reset to defaults
          </Button>
        </div>
      </section>

      {/* Pomodoro timer */}
      <section
        id="settings-pomodoro"
        className="mb-8 rounded-2xl border border-line bg-surface p-6"
      >
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
          />
        </div>
      </section>

      {/* Install */}
      <section
        id="settings-install"
        className="mb-8 rounded-2xl border border-line bg-surface p-6"
      >
        <h2 className="mb-1 font-display text-xl">Install</h2>
        <p className="mb-5 text-sm text-ink-soft">
          Add Lacuna to your home screen for quick access and offline use.
        </p>
        <InstallPanel />
      </section>

      {/* Data portability */}
      <section
        id="settings-export"
        className="rounded-2xl border border-line bg-surface p-6"
      >
        <h2 className="mb-1 font-display text-xl">Import &amp; export</h2>
        <p className="mb-5 text-sm text-ink-soft">
          All your data lives locally in this browser. Export it in multiple formats
          for backup or transfer, and import to restore or merge.
        </p>

        {/* Unified export panel */}
        <div className="mb-6">
          <UnifiedExportPanel heading="Export your data" />
        </div>

        {/* Import section */}
        <div className="border-t border-line pt-5">
          <h3 className="mb-3 font-display text-lg">Import</h3>
          <p className="mb-4 text-sm text-ink-soft">
            Import a full backup file (JSON) to restore or merge your data.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon width={18} height={18} />
              Import from file
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
        </div>

        {/* Inline import-mode chooser, revealed once a backup file is read */}
        <AnimatePresence>
          {pending && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.16 * motionMult, ease: [0.16, 1, 0.3, 1] }}
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
      <section
        id="settings-backups"
        className="mt-8 rounded-2xl border border-line bg-surface p-6"
      >
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

      {/* Right-side section nav */}
      <aside className="hidden xl:block w-64 shrink-0">
        <div className="sticky top-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 * motionMult, ease: [0.16, 1, 0.3, 1] }}
            className="relative overflow-hidden rounded-2xl border border-line bg-surface p-3 shadow-xl shadow-black/5 backdrop-blur-sm"
          >
            {/* Ambient top glow that subtly pulses */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent"
              animate={{ opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
            {/* Soft radial ambient wash behind the card */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-2xl"
              style={{
                background:
                  'radial-gradient(circle at 50% 0%, hsl(var(--accent) / 0.06), transparent 55%)',
              }}
              animate={{ opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            />

            <div className="relative mb-3 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              On this page
            </div>
            <LayoutGroup>
              <nav className="relative flex flex-col gap-1">
                {SETTINGS_SECTIONS.map((section, index) => (
                  <NavItem
                    key={section.id}
                    section={section}
                    active={activeSection === section.id}
                    onClick={() => {
                      const el = document.getElementById(section.id);
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    index={index}
                    m={motionMult}
                  />
                ))}
              </nav>
            </LayoutGroup>
          </motion.div>
        </div>
      </aside>
    </div>
  );
}

function InstallPanel() {
  const { isInstallable, isInstalled, promptInstall } = useInstallPrompt();

  if (isInstalled) {
    return (
      <p className="text-sm text-ink-soft">
        Lacuna is installed on this device and can be used offline.
      </p>
    );
  }

  if (!isInstallable) {
    return (
      <p className="text-sm text-ink-soft">
        Your browser does not support installing web apps, or Lacuna is already installed.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-ink-soft">
        Install Lacuna as a standalone app for offline access and a native-like experience.
      </p>
      <Button variant="secondary" onClick={promptInstall}>
        <DownloadIcon width={18} height={18} />
        Install
      </Button>
    </div>
  );
}

function NavItem({
  section,
  active,
  onClick,
  index,
  m,
}: {
  section: (typeof SETTINGS_SECTIONS)[number];
  active: boolean;
  onClick: () => void;
  index: number;
  m: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 350, damping: 25 });
  const springY = useSpring(mouseY, { stiffness: 350, damping: 25 });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distX = (e.clientX - centerX) * 0.12;
    const distY = (e.clientY - centerY) * 0.12;
    mouseX.set(distX);
    mouseY.set(distY);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ x: springX, y: springY }}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        delay: 0.04 * index * m,
        duration: 0.35 * m,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      className={cn(
        'relative flex items-center rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150',
        active ? 'text-accent' : 'text-ink-soft hover:text-ink',
      )}
    >
      {active && (
        <motion.div
          layoutId="activePill"
          className="absolute inset-0 rounded-lg bg-accent/10"
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <motion.div
            layoutId="activeBar"
            className="absolute inset-y-0 left-0 w-1 rounded-r-full bg-accent"
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          />
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-lg bg-gradient-to-r from-accent/10 via-accent/5 to-transparent"
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>
      )}
      <span className="relative z-10 truncate font-medium">{section.label}</span>
    </motion.button>
  );
}

function KeyCaptureOverlay({
  action,
  onCapture,
  onCancel,
}: {
  action: LearnAction;
  onCapture: (key: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      // Ignore modifier-only keys and navigation keys that should not be bound.
      if (
        e.key === 'Shift' ||
        e.key === 'Control' ||
        e.key === 'Alt' ||
        e.key === 'Meta' ||
        e.key === 'Tab' ||
        e.key === 'CapsLock' ||
        e.key === 'Dead'
      ) {
        return;
      }
      if (e.key === ' ') {
        onCapture('Space');
        return;
      }
      onCapture(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [action, onCapture, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="rounded-2xl border border-line-strong bg-surface px-8 py-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 font-display text-lg">Set shortcut for {ACTION_LABELS[action]}</h3>
        <p className="text-sm text-ink-soft">Press the key you want to use. Press Escape or click outside this card to cancel.</p>
      </div>
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
