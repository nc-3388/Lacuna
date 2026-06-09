import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, m as motion } from 'motion/react';
import { useCards, useDeck } from '../state/useData';
import { useMotionSpeed, speedMultiplier } from '../state/motionSpeed';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useToast } from '../components/ui/Toast';
import {
  deleteDecks,
  restoreDecks,
  snapshotDecks,
  updateDeck,
} from '../db/repository';
import { takeAutoBackup } from '../db/backups';
import {
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from '../utils/datetime';
import { DateTimePicker } from '../components/ui/DateTimePicker';
import {
  clampRequestRetention,
  defaultFsrsParameters,
  DEFAULT_REQUEST_RETENTION,
  MAX_REQUEST_RETENTION,
  MIN_REQUEST_RETENTION,
} from '../fsrs/params';
import { countReviews, MIN_OPTIMISE_REVIEWS } from '../fsrs/optimise';
import { useOptimiser } from '../state/useOptimiser';
import {
  optimiseEnabledForDeck,
  useAutoOptimiseDefault,
} from '../state/optimiseSetting';
import { ChevronLeftIcon } from '../components/ui/icons';
import { cn } from '../components/ui/cn';
import { DECK_COLOURS } from '../db/types';
import type { Card, Deck, ExamObjective } from '../db/types';

/** Named anchor points for the target-retention slider. */
const RETENTION_PRESETS = [
  { label: 'Relaxed', value: 0.85 },
  { label: 'Balanced', value: 0.9 },
  { label: 'Thorough', value: 0.95 },
] as const;

/**
 * Full-page deck settings, replacing the old modal. Lets the user rename a deck, set its
 * exam date and objective, and delete it. Deletion is immediate with an "Undo" toast
 * rather than a blocking confirmation dialog.
 */
export function DeckSettings() {
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const { notify } = useToast();

  const deck = useDeck(deckId);
  const cards = useCards(deckId);

  const [name, setName] = useState('');
  const [examValue, setExamValue] = useState('');
  const [objective, setObjective] = useState<ExamObjective>('expectedMarks');
  const [newPerDay, setNewPerDay] = useState('');
  const [retention, setRetention] = useState(DEFAULT_REQUEST_RETENTION);
  const [colour, setColour] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  // Re-arm the loaded latch whenever the deck changes so back/forward navigation
  // between different deck settings routes re-seeds the formotion.
  useEffect(() => {
    setLoaded(false);
  }, [deckId]);

  useEffect(() => {
    if (loaded || !deck) return;
    setName(deck.name);
    setExamValue(toDateTimeLocalValue(deck.examDate));
    setObjective(deck.examObjective);
    setNewPerDay(deck.newCardsPerDay ? String(deck.newCardsPerDay) : '');
    setRetention(clampRequestRetention(deck.fsrsParameters.requestRetention));
    setColour(deck.colour);
    setLoaded(true);
  }, [deck, loaded]);

  if (deck === undefined) {
    return <DeckSettingsSkeleton />;
  }
  if (deck === null) {
    return (
      <div className="p-10">
        <p className="mb-4 text-ink-soft">This deck could not be found.</p>
        <Link to="/" className="text-accent underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const deckPath = `/deck/${deck.id}`;

  async function handleSave() {
    if (!deck) return;
    const ms = fromDateTimeLocalValue(examValue);
    const parsedCap = Math.floor(Number(newPerDay));
    const newCardsPerDay =
      newPerDay.trim() === '' || !Number.isFinite(parsedCap) || parsedCap <= 0
        ? undefined
        : parsedCap;
    await updateDeck(deck.id, {
      name: name.trim() || deck.name,
      examDate: Number.isNaN(ms) ? deck.examDate : ms,
      examObjective: objective,
      newCardsPerDay,
      colour,
      fsrsParameters: {
        ...deck.fsrsParameters,
        requestRetention: clampRequestRetention(retention),
      },
    });
    notify('Deck updated.', 'positive');
    navigate(deckPath);
  }

  async function handleDelete() {
    if (!deck) return;
    const snapshot = await snapshotDecks([deck.id]);
    await deleteDecks([deck.id]);
    notify(`"${deck.name}" deleted.`, 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreDecks(snapshot);
      },
    });
    navigate('/');
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 md:px-10">
      <Link
        to={deckPath}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-faint transition-colors hover:text-ink"
      >
        <ChevronLeftIcon width={16} height={16} />
        Back to {deck.name}
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 * m }}
      >
        <header className="mb-8">
          <p className="mb-1 text-sm uppercase tracking-[0.18em] text-ink-faint">
            Deck
          </p>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">Settings</h1>
        </header>

        <div className="flex flex-col gap-6">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24 * m, delay: 0.05 * m, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl border border-line bg-surface p-6"
          >
            <div className="flex flex-col gap-4">
              <label className="block text-sm text-ink-soft">
                Deck name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent"
                />
              </label>

              {/* Colour picker */}
              <div className="block text-sm text-ink-soft">
                <div className="mb-2">Deck colour</div>
                <div className="flex flex-wrap gap-2">
                  {DECK_COLOURS.map((c) => {
                    const active = colour === c.hex;
                    return (                        <motion.button
                        key={c.key}
                        type="button"
                        title={c.label}
                        onClick={() => setColour(active ? undefined : c.hex)}
                        aria-pressed={active}
                        whileHover={{ scale: 1.15 }}
                        whileTap={{ scale: 0.9 }}
                        transition={{ duration: 0.12 * m }}
                        className={cn(
                          'h-8 w-8 rounded-full transition-all duration-150',
                          active
                            ? 'ring-2 ring-offset-2 ring-offset-surface ring-ink'
                            : 'hover:scale-110',
                        )}
                        style={{ backgroundColor: c.hex }}
                      />
                    );
                  })}
                </div>
                <span className="mt-1 block text-xs text-ink-faint">
                  Pick a colour to help identify this deck on the dashboard and in the sidebar.
                </span>
              </div>

              <DateTimePicker
                value={fromDateTimeLocalValue(examValue) || deck.examDate}
                onChange={(ms) => setExamValue(toDateTimeLocalValue(ms))}
                label="Exam date and time"
              />

              <div className="block text-sm text-ink-soft">
                <div className="mb-2">Exam objective</div>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs text-ink-faint">
                    {objective === 'securedTopics'
                      ? 'Secure as many topics as possible: prioritise cards a review would push to 90%+ on exam day. The progress bar shows the fraction of cards secured.'
                      : 'Maximise your expected marks: prioritise the largest expected lift to exam-day retrievability. The progress bar shows your mean predicted retrievability.'}
                  </p>
                  <Toggle
                    checked={objective === 'securedTopics'}
                    onChange={(checked) =>
                      setObjective(checked ? 'securedTopics' : 'expectedMarks')
                    }
                    label="Secure topics"
                  />
                </div>
              </div>

              <label className="block text-sm text-ink-soft">
                New cards per day
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={newPerDay}
                  onChange={(e) => setNewPerDay(e.target.value)}
                  placeholder="Unlimited"
                  className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent"
                />
                <span className="mt-1 block text-xs text-ink-faint">
                  Caps how many never-seen cards a study session introduces each day, so a
                  large deck does not overwhelm you. Leave blank for unlimited. Reviews of
                  cards you have already started are never capped.
                </span>
              </label>

              <div className="block text-sm text-ink-soft">
                <div className="flex items-baseline justify-between">
                  <span>Target retention</span>
                  <span className="tabular font-medium text-ink">
                    {Math.round(retention * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={MIN_REQUEST_RETENTION}
                  max={MAX_REQUEST_RETENTION}
                  step={0.01}
                  value={retention}
                  onChange={(e) => setRetention(Number(e.target.value))}
                  aria-label="Target retention"
                  className="mt-3 w-full accent-accent"
                />
                <div className="mt-2 flex gap-2">
                  {RETENTION_PRESETS.map((p) => {
                    const active = Math.round(retention * 100) === Math.round(p.value * 100);
                    return (
                      <motion.button
                        key={p.label}
                        type="button"
                        onClick={() => setRetention(p.value)}
                        aria-pressed={active}
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ duration: 0.1 * m }}
                        className={cn(
                          'flex-1 rounded-lg border px-3 py-2 text-xs transition-colors',
                          active
                            ? 'border-accent bg-accent-soft text-accent'
                            : 'border-line text-ink-soft hover:border-line-strong',
                        )}
                      >
                        <span className="block font-medium">{p.label}</span>
                        <span className="text-ink-faint">{Math.round(p.value * 100)}%</span>
                      </motion.button>
                    );
                  })}
                </div>
                <span className="mt-2 block text-xs text-ink-faint">
                  How well you want to remember each card. Higher means cards come back sooner
                  and more often (more reviews, fewer lapses); lower means a lighter workload
                  with more forgetting. {Math.round(retention * 100)}% is{' '}
                  {retention > DEFAULT_REQUEST_RETENTION
                    ? 'more thorough than the default.'
                    : retention < DEFAULT_REQUEST_RETENTION
                      ? 'lighter than the default.'
                      : 'the recommended default.'}
                </span>
              </div>
            </div>
          </motion.section>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24 * m, delay: 0.1 * m, ease: [0.16, 1, 0.3, 1] }}
          >
            <OptimisationPanel deck={deck} cards={cards ?? []} />
          </motion.div>

          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24 * m, delay: 0.15 * m, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl border border-negative/30 bg-negative/5 p-6"
          >
            <div className="mb-1 text-sm font-medium text-negative">Danger zone</div>
            <p className="mb-4 text-sm text-ink-soft">
              Deleting this deck removes all of its cards and history. You will have a
              moment to undo.
            </p>
            <Button variant="danger" size="sm" onClick={handleDelete}>
              Delete deck
            </Button>
          </motion.section>
        </div>
      </motion.div>

      {/* Sticky action bar (stays within the content column, clear of the sidebar) */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 * m, delay: 0.2 * m, ease: [0.16, 1, 0.3, 1] }}
        className="sticky bottom-0 z-30 -mx-6 mt-8 border-t border-line bg-paper/80 px-6 py-4 backdrop-blur-xl md:-mx-10 md:px-10"
      >
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={() => navigate(deckPath)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save changes
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Per-deck FSRS optimisation. Runs the optimiser in a Web Worker over the deck's
 * own review history, shows a before/after of the fit quality (log loss, lower is
 * better), and applies the new weights only on explicit confirmation, taking a
 * restore-point snapshot first. Gated on a minimum review count, and on the
 * per-deck/global "Optimise scheduling" setting.
 */
function DeckSettingsSkeleton() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8 md:px-10">
      <div className="mb-6 h-4 w-24 animate-pulse rounded bg-ink/10" />
      <div className="mb-8 space-y-3">
        <div className="h-3 w-20 animate-pulse rounded bg-ink/10" />
        <div className="h-10 w-48 animate-pulse rounded bg-ink/10" />
      </div>
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-6 space-y-4">
          <div className="h-4 w-full animate-pulse rounded bg-ink/10" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-ink/10" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-ink/10" />
          <div className="h-24 w-full animate-pulse rounded-lg bg-ink/10" />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 space-y-3">
          <div className="h-4 w-40 animate-pulse rounded bg-ink/10" />
          <div className="h-4 w-full animate-pulse rounded bg-ink/10" />
          <div className="h-8 w-32 animate-pulse rounded-lg bg-ink/10" />
        </div>
        <div className="rounded-2xl border border-negative/30 bg-negative/5 p-6 space-y-3">
          <div className="h-4 w-24 animate-pulse rounded bg-ink/10" />
          <div className="h-4 w-full animate-pulse rounded bg-ink/10" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-ink/10" />
        </div>
      </div>
    </div>
  );
}

function OptimisationPanel({ deck, cards }: { deck: Deck; cards: Card[] }) {
  const { notify } = useToast();
  const [globalDefault] = useAutoOptimiseDefault();
  const optimiser = useOptimiser();
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);

  // Cancel an in-flight optimisation if the user navigates to a different deck.
  useEffect(() => {
    return () => {
      optimiser.reset();
    };
  }, [deck?.id]);

  const reviews = countReviews(cards);
  const enabled = optimiseEnabledForDeck(deck.autoOptimise, globalDefault);
  const enoughData = reviews >= MIN_OPTIMISE_REVIEWS;

  async function applyWeights() {
    if (!optimiser.result || !optimiser.result.isOutOfSampleWin) return;
    // Restore point before touching scheduling weights (reuses the backup mechanism).
    try {
      await takeAutoBackup();
    } catch (e) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('Auto-backup before applying weights failed:', e);
      }
      notify('Could not create a restore point before applying weights.', 'negative');
      return;
    }
    await updateDeck(deck.id, {
      fsrsParameters: { ...deck.fsrsParameters, w: optimiser.result.w },
    });
    optimiser.reset();
    notify('Optimised weights applied.', 'positive');
  }

  async function resetToDefaults() {
    try {
      await takeAutoBackup();
    } catch (e) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('Auto-backup before resetting weights failed:', e);
      }
      notify('Could not create a restore point before resetting weights.', 'negative');
      return;
    }
    await updateDeck(deck.id, {
      fsrsParameters: {
        ...deck.fsrsParameters,
        w: defaultFsrsParameters().w,
      },
    });
    optimiser.reset();
    notify('Scheduling weights reset to defaults.', 'neutral');
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl">Scheduling optimisation</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Fit this deck's FSRS weights to its own review history. Optimisation runs off the
            main thread and is applied only when you confirm; a restore point is taken first.
          </p>
        </div>
        <Toggle
          checked={enabled}
          onChange={(checked) => void updateDeck(deck.id, { autoOptimise: checked })}
          label="Optimise this deck"
        />
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <AnimatePresence mode="wait">
          {!enoughData ? (
            <motion.p
              key="not-enough"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 * m }}
              className="text-sm text-ink-faint"
            >
              Optimisation needs at least {MIN_OPTIMISE_REVIEWS} reviews so that a
              held-out validation portion is large enough to judge the fit honestly.
              This deck has {reviews}. Keep revising and it will become available.
            </motion.p>
          ) : !enabled ? (
            <motion.p
              key="disabled"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 * m }}
              className="text-sm text-ink-faint"
            >
              Optimisation is turned off for this deck. Enable it above to fit the weights.
            </motion.p>
          ) : optimiser.status === 'running' ? (
            <motion.div
              key="running"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 * m }}
            >
              <p className="mb-2 text-sm text-ink-soft">
                Optimising over {reviews} reviews…
              </p>
              <ProgressBar value={optimiser.progress} />
            </motion.div>
          ) : optimiser.status === 'done' && optimiser.result ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 * m }}
            >
              <p className="mb-2 text-sm text-ink-soft">
                Held-out fit quality (log loss, lower is better):{' '}
                <span className="tabular text-ink">
                  {optimiser.result.before.toFixed(4)} → {optimiser.result.after.toFixed(4)}
                </span>{' '}
                over {optimiser.result.scored} scored reviews.
              </p>
              {optimiser.result.scored === 0 ? (
                <p className="mb-3 text-sm text-ink-faint">
                  Not enough recent reviews to validate out of sample. The default weights
                  are recommended.
                </p>
              ) : !optimiser.result.isOutOfSampleWin ? (
                <p className="mb-3 text-sm text-negative">
                  The fitted weights did not beat the defaults on unseen data. Keep the
                  default weights for now.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {optimiser.result.isOutOfSampleWin && optimiser.result.scored > 0 && (
                  <Button variant="primary" size="sm" onClick={applyWeights}>
                    Apply optimised weights
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => optimiser.reset()}>
                  Discard
                </Button>
              </div>
            </motion.div>
          ) : optimiser.status === 'error' ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 * m }}
            >
              <p className="mb-2 text-sm text-negative">
                Optimisation failed: {optimiser.error}
              </p>
              <Button variant="secondary" size="sm" onClick={() => optimiser.reset()}>
                Dismiss
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 * m }}
              className="flex flex-wrap gap-2"
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  optimiser.run(cards, deck.fsrsParameters.requestRetention)
                }
              >
                Optimise now
              </Button>
              <Button variant="ghost" size="sm" onClick={resetToDefaults}>
                Reset to defaults
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
