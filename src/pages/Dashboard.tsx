import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useAllCards, useDecks, useDeckSummaries, useStudyStats } from '../state/useData';
import { StudySignals } from '../components/dashboard/StudySignals';
import { ReviewHeatmap } from '../components/dashboard/ReviewHeatmap';
import {
  createDeck,
  createDeckWithCards,
  deleteDecks,
  mergeDecks,
  restoreDecks,
  snapshotDecks,
  updateDeck,
} from '../db/repository';
import { DECK_COLOURS } from '../db/types';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useToast } from '../components/ui/Toast';
import { ImportPanel } from '../components/import/ImportPanel';
import { CheckIcon, FlaskIcon, MergeIcon, PlayIcon, PlusIcon, TrashIcon } from '../components/ui/icons';
import type { ParsedCard } from '../db/import';
import { relativeExam } from '../utils/datetime';
import { progressNoun } from '../fsrs/objective';
import { cn } from '../components/ui/cn';
import type { Deck } from '../db/types';

export function Dashboard() {
  const decks = useDecks();
  const summaries = useDeckSummaries();
  const stats = useStudyStats();
  const allCards = useAllCards();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState<'blank' | 'import'>('blank');
  const [newName, setNewName] = useState('');
  const [newColour, setNewColour] = useState<string | undefined>(undefined);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  const selectedDecks = useMemo(
    () => (decks ?? []).filter((d) => selected.has(d.id)),
    [decks, selected],
  );

  // Archived decks are retained but hidden from active study; show them apart.
  const activeDecks = useMemo(() => (decks ?? []).filter((d) => !d.archived), [decks]);
  const archivedDecks = useMemo(() => (decks ?? []).filter((d) => d.archived), [decks]);

  // Total cards a global session would serve today, across all decks.
  const totalEligible = useMemo(
    () => Object.values(summaries ?? {}).reduce((sum, s) => sum + s.eligible, 0),
    [summaries],
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setMerging(false);
    setMergeTarget(null);
  }

  function startCreating() {
    setNewName('');
    setCreateMode('blank');
    setCreating(true);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    const deck = await createDeck(newName, newColour);
    setNewName('');
    setNewColour(undefined);
    setCreating(false);
    notify('Deck created.', 'positive');
    navigate(`/deck/${deck.id}`);
  }

  async function handleImportNew(cards: ParsedCard[]) {
    const deck = await createDeckWithCards(newName, cards);
    await updateDeck(deck.id, { colour: newColour });
    setNewName('');
    setNewColour(undefined);
    setCreating(false);
    notify(`Deck created with ${cards.length} card${cards.length === 1 ? '' : 's'}.`, 'positive');
    navigate(`/deck/${deck.id}`);
  }

  async function handleDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const snapshot = await snapshotDecks(ids);
    await deleteDecks(ids);
    exitSelectMode();
    notify(`${ids.length} deck${ids.length === 1 ? '' : 's'} deleted.`, 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreDecks(snapshot);
      },
    });
  }

  function startMerge() {
    setMergeTarget(selectedDecks[0]?.id ?? null);
    setMerging(true);
  }

  async function handleMerge() {
    if (!mergeTarget) return;
    await mergeDecks([...selected], mergeTarget);
    exitSelectMode();
    notify('Decks merged.', 'positive');
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 md:px-10">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm uppercase tracking-[0.18em] text-ink-faint">
            Your revision
          </p>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">Decks</h1>
        </div>
        <div className="flex items-center gap-2">
          {decks && decks.length > 0 && (
            <Button
              variant={selectMode ? 'primary' : 'secondary'}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            >
              {selectMode ? 'Done' : 'Select'}
            </Button>
          )}
          <Button variant="primary" onClick={startCreating}>
            <PlusIcon width={18} height={18} />
            New deck
          </Button>
        </div>
      </header>

      {/* Motivation strip: streak, reviews today, seven-day time forecast */}
      {!selectMode && stats && decks && decks.length > 0 && <StudySignals stats={stats} />}

      {/* Global "study everything" entry point */}
      {!selectMode && decks && decks.length > 0 && totalEligible > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-accent/40 bg-accent-soft/40 p-5"
        >
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl">Study today</h2>
            <p className="text-sm text-ink-soft">
              {totalEligible} card{totalEligible === 1 ? '' : 's'} ready across all your
              decks, ordered by what moves you furthest before each exam.
            </p>
          </div>
          <Button variant="primary" size="lg" onClick={() => navigate('/learn')}>
            <PlayIcon width={18} height={18} />
            Study all decks
          </Button>
        </motion.div>
      )}

      {/* Inline new-deck composer */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-line-strong bg-surface p-5">
              {/* Blank vs Import mode */}
              <div className="mb-4 flex gap-2">
                {(['blank', 'import'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCreateMode(m)}
                    className={cn(
                      'flex-1 rounded-lg border px-4 py-2 text-sm transition-colors',
                      createMode === m
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line text-ink-soft hover:border-line-strong',
                    )}
                  >
                    {m === 'blank' ? 'Start blank' : 'Import cards'}
                  </button>
                ))}
              </div>

              <label className="block text-sm text-ink-soft">
                Deck name
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (createMode === 'blank' && e.key === 'Enter' && newName.trim())
                      handleCreate();
                    if (e.key === 'Escape') setCreating(false);
                  }}
                  placeholder="e.g. Organic Chemistry"
                  className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent"
                />
              </label>

              {/* Colour picker */}
              <div className="block text-sm text-ink-soft">
                <div className="mb-2">Deck colour</div>
                <div className="flex flex-wrap gap-2">
                  {DECK_COLOURS.map((c) => {
                    const active = newColour === c.hex;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        title={c.label}
                        onClick={() => setNewColour(active ? undefined : c.hex)}
                        aria-pressed={active}
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
              </div>

              {createMode === 'blank' ? (
                <>
                  <p className="mt-3 text-xs text-ink-faint">
                    The exam date defaults to seven days from now. You will be asked to set
                    the real date the first time you study this deck.
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                    <Button variant="primary" onClick={handleCreate} disabled={!newName.trim()}>
                      Create
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mt-4">
                  <ImportPanel
                    onImport={handleImportNew}
                    onCancel={() => setCreating(false)}
                    importLabel="Create & import"
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection action bar */}
      {selectMode && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 rounded-xl border border-line-strong bg-surface px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-soft">{selected.size} selected</span>
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={selected.size < 2}
                onClick={startMerge}
              >
                <MergeIcon width={16} height={16} />
                Merge
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={selected.size === 0}
                onClick={handleDelete}
              >
                <TrashIcon width={16} height={16} />
                Delete
              </Button>
            </div>
          </div>

          {/* Inline merge chooser */}
          <AnimatePresence>
            {merging && selected.size >= 2 && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="border-t border-line pt-3">
                  <p className="mb-3 text-sm text-ink-soft">
                    Choose which deck to keep. All cards from the other selected decks move
                    into it; the kept deck retains its name, exam date and performance
                    history.
                  </p>
                  <div className="flex flex-col gap-2">
                    {selectedDecks.map((deck) => (
                      <label
                        key={deck.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                          mergeTarget === deck.id
                            ? 'border-accent bg-accent-soft'
                            : 'border-line hover:border-line-strong',
                        )}
                      >
                        <input
                          type="radio"
                          name="merge-target"
                          checked={mergeTarget === deck.id}
                          onChange={() => setMergeTarget(deck.id)}
                          className="accent-accent"
                        />
                        <span className="text-sm">{deck.name}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setMerging(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleMerge}
                      disabled={!mergeTarget}
                    >
                      Merge into selected
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Deck grid */}
      {!decks ? (
        <DeckSkeleton />
      ) : decks.length === 0 ? (
        <EmptyState onCreate={startCreating} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeDecks.slice(0, 3).map((deck, i) => (
              <DeckCard
                key={deck.id}
                deck={deck}
                index={i}
                summary={summaries?.[deck.id]}
                selectMode={selectMode}
                selected={selected.has(deck.id)}
                onToggleSelected={() => toggleSelected(deck.id)}
              />
            ))}
            {activeDecks.length > 3 && (
              <button
                type="button"
                onClick={() => {
                  document.querySelector('aside nav')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="group flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/50 p-5 text-center transition-colors hover:border-line hover:bg-surface"
              >
                <span className="mb-1 text-3xl text-ink-faint transition-colors group-hover:text-ink">
                  +{activeDecks.length - 3}
                </span>
                <span className="text-sm text-ink-faint">more decks in sidebar</span>
              </button>
            )}
          </div>

          {archivedDecks.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-4 text-sm uppercase tracking-[0.18em] text-ink-faint">
                Archived
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {archivedDecks.map((deck, i) => (
                  <DeckCard
                    key={deck.id}
                    deck={deck}
                    index={i}
                    summary={summaries?.[deck.id]}
                    selectMode={selectMode}
                    selected={selected.has(deck.id)}
                    onToggleSelected={() => toggleSelected(deck.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Review activity heatmap, for anyone arriving from Anki */}
      {!selectMode && allCards && allCards.some((c) => c.history.length > 0) && (
        <div className="mt-10">
          <ReviewHeatmap cards={allCards} />
        </div>
      )}
    </div>
  );
}

function DeckCard({
  deck,
  summary,
  index,
  selectMode,
  selected,
  onToggleSelected,
}: {
  deck: Deck;
  summary: { count: number; mastery: number; unreviewed: number } | undefined;
  index: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const colourBar = deck.colour ? (
    <span
      className="absolute inset-x-0 top-0 h-1 rounded-t-2xl"
      style={{ backgroundColor: deck.colour }}
    />
  ) : null;

  const body = (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.3) }}
      className={cn(
        'group relative flex h-full flex-col rounded-2xl border bg-surface p-5 transition-all duration-200',
        selected
          ? 'border-accent ring-2 ring-accent/30'
          : 'border-line hover:border-line-strong hover:shadow-xl hover:shadow-black/[0.04]',
      )}
    >
      {colourBar}
      {selectMode && (
        <span
          className={cn(
            'absolute right-4 top-4 grid h-6 w-6 place-items-center rounded-full border transition-colors',
            selected ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong',
          )}
        >
          {selected && <CheckIcon width={14} height={14} />}
        </span>
      )}

      <div
        className={cn(
          'mb-1 text-xs uppercase tracking-[0.14em]',
          deck.archived
            ? 'text-ink-faint'
            : deck.examDate < Date.now()
              ? 'text-amber-600'
              : 'text-ink-faint',
        )}
      >
        {deck.archived
          ? 'Archived'
          : deck.examDate < Date.now()
            ? 'Exam date passed'
            : `Exam ${relativeExam(deck.examDate)}`}
      </div>
      <h3 className="mb-4 font-display text-2xl leading-tight tracking-tight">
        {deck.name}
      </h3>

      <div className="mt-auto">
        <div className="mb-2 flex items-center justify-between text-sm text-ink-soft">
          <span>{summary?.count ?? 0} cards</span>
          <span className="tabular">
            {Math.round((summary?.mastery ?? 0) * 100)}% {progressNoun(deck)}
          </span>
        </div>
        <ProgressBar value={summary?.mastery ?? 0} height={8} />
      </div>
    </motion.div>
  );

  // Keep the same wrapper element across modes so toggling select mode doesn't
  // remount the card (which would replay its entrance animation). In select
  // mode we intercept the navigation and toggle the selection instead.
  return (
    <Link
      to={`/deck/${deck.id}`}
      onClick={
        selectMode
          ? (e) => {
              e.preventDefault();
              onToggleSelected();
            }
          : undefined
      }
      aria-pressed={selectMode ? selected : undefined}
      className="text-left"
    >
      {body}
    </Link>
  );
}

function DeckSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: Math.min(i * 0.05, 0.25) }}
          className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5"
        >
          <div className="mb-1 h-3 w-20 animate-pulse rounded bg-ink/10" />
          <div className="mb-4 h-7 w-3/4 animate-pulse rounded bg-ink/10" />
          <div className="mt-auto">
            <div className="mb-2 flex justify-between">
              <div className="h-4 w-16 animate-pulse rounded bg-ink/10" />
              <div className="h-4 w-12 animate-pulse rounded bg-ink/10" />
            </div>
            <div className="h-2 w-full animate-pulse rounded-full bg-ink/10" />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/50 py-20 text-center"
    >
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <FlaskIcon width={28} height={28} />
      </div>
      <h2 className="mb-2 font-display text-2xl">No decks yet</h2>
      <p className="mb-6 max-w-sm text-ink-soft">
        Create your first deck to begin building a revision schedule tuned to your exam.
      </p>
      <Button variant="primary" onClick={onCreate}>
        <PlusIcon width={18} height={18} />
        Create a deck
      </Button>
    </motion.div>
  );
}
