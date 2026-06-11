import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, m as motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useDashboardData, useFolders } from '../state/useData';
import { useDashboardSort, type DashboardSort } from '../state/dashboardSort';
import { StudySignals } from '../components/dashboard/StudySignals';
import { ReviewHeatmap } from '../components/dashboard/ReviewHeatmap';
import {
  createDeck,
  createDeckWithCards,
  createFolder,
  deleteDecks,
  deleteFolder,
  mergeDecks,
  moveDecksToFolder,
  restoreDecks,
  snapshotDecks,
  updateDeck,
  updateFolder,
} from '../db/repository';
import { DECK_COLOURS } from '../db/types';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useToast } from '../components/ui/Toast';
import { FolderIcon } from '../components/ui/icons';
import { UnifiedImportPanel } from '../components/import/UnifiedImportPanel';
import { CheckIcon, ChevronDownIcon, FlaskIcon, MergeIcon, PlayIcon, PlusIcon, TrashIcon } from '../components/ui/icons';
import type { ParsedCard } from '../db/import';
import { relativeExam } from '../utils/datetime';
import { progressNoun } from '../fsrs/objective';
import { cn } from '../components/ui/cn';
import { useMotionSpeed, speedMultiplier } from '../state/motionSpeed';
import { useIsTouchMode } from '../state/inputMode';
import type { Deck } from '../db/types';

export function Dashboard() {
  const dashboardData = useDashboardData();
  const decks = dashboardData?.decks;
  const summaries = dashboardData?.summaries;
  const stats = dashboardData?.stats;
  const allCards = dashboardData?.allCards;
  const folders = useFolders();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [dashboardSort] = useDashboardSort();

  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState<'blank' | 'import'>('blank');
  const [newName, setNewName] = useState('');
  const [newColour, setNewColour] = useState<string | undefined>(undefined);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  // Folder management
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [moveIntoFolder, setMoveIntoFolder] = useState<string | null>(null);

  const allSelected = decks ? decks.length > 0 && decks.every((d) => selected.has(d.id)) : false;

  const selectedDecks = useMemo(
    () => (decks ?? []).filter((d) => selected.has(d.id)),
    [decks, selected],
  );

  // Archived decks are retained but hidden from active study; show them apart.
  const activeDecks = useMemo(() => {
    const list = (decks ?? []).filter((d) => !d.archived);
    return sortDecks(list, dashboardSort, summaries);
  }, [decks, dashboardSort, summaries]);
  const archivedDecks = useMemo(() => (decks ?? []).filter((d) => d.archived), [decks]);

  // Total cards a global session would serve today, across all decks.
  const totalEligible = useMemo(
    () => activeDecks.reduce((sum, d) => sum + (summaries?.[d.id]?.eligible ?? 0), 0),
    [activeDecks, summaries],
  );

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    const allIds = (decks ?? []).map((d) => d.id);
    setSelected((prev) => {
      if (allIds.length > 0 && allIds.every((id) => prev.has(id))) return new Set();
      return new Set(allIds);
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
    const ids = [...selected];
    const snapshot = await snapshotDecks(ids);
    await mergeDecks(ids, mergeTarget);
    exitSelectMode();
    notify('Decks merged.', 'positive', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreDecks(snapshot);
      },
    });
  }

  // Folder management handlers
  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      await createFolder(newFolderName);
      setNewFolderName('');
      setCreatingFolder(false);
      notify('Folder created.', 'positive');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create folder.', 'negative');
    }
  }

  async function handleRenameFolder(id: string) {
    if (!renameFolderName.trim()) return;
    try {
      await updateFolder(id, { name: renameFolderName.trim() });
      setRenamingFolder(null);
      setRenameFolderName('');
      notify('Folder renamed.', 'positive');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not rename folder.', 'negative');
    }
  }

  async function handleDeleteFolder(id: string) {
    try {
      await deleteFolder(id);
      notify('Folder deleted.', 'neutral');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete folder.', 'negative');
    }
  }

  async function handleMoveToFolder(folderId: string | null) {
    const ids = [...selected];
    if (ids.length === 0) return;
    await moveDecksToFolder(ids, folderId);
    setMoveIntoFolder(null);
    notify(`${ids.length} deck${ids.length === 1 ? '' : 's'} moved.`, 'positive');
  }

  function toggleFolderExpanded(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Group active decks by folder
  const { groupedDecks, ungroupedDecks } = useMemo(() => {
    const ungrouped: Deck[] = [];
    const grouped: Record<string, Deck[]> = {};
    for (const deck of activeDecks) {
      if (deck.folderId) {
        (grouped[deck.folderId] ??= []).push(deck);
      } else {
        ungrouped.push(deck);
      }
    }
    return { groupedDecks: grouped, ungroupedDecks: ungrouped };
  }, [activeDecks]);

  // Top-level folders (not nested under another folder)
  const topFolders = useMemo(
    () => (folders ?? []).filter((f) => !f.parentId),
    [folders],
  );

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
          <Button
            variant="secondary"
            onClick={() => {
              setCreatingFolder(true);
              setNewFolderName('');
            }}
          >
            <FolderIcon width={18} height={18} />
            New folder
          </Button>
          <Button variant="primary" onClick={startCreating}>
            <PlusIcon width={18} height={18} />
            New deck
          </Button>
        </div>
      </header>

      {/* Motivation strip: streak, reviews today, seven-day time forecast */}
      {!selectMode && stats && decks && decks.length > 0 && <StudySignals stats={stats} decks={decks} />}

      {/* Global "study everything" entry point */}
      {!selectMode && decks && decks.length > 0 && totalEligible > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 * m, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-accent/40 bg-accent-soft/40 p-5"
        >
          <div className="min-w-0 w-full flex-1 sm:w-auto">
            <h2 className="font-display text-xl">Study today</h2>
            <p className="text-sm leading-relaxed text-balance text-ink-soft">
              {totalEligible} card{totalEligible === 1 ? '' : 's'} ready across all your
              decks, ordered by what moves you furthest before each exam.
            </p>
          </div>
          <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={() => navigate('/learn')}>
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
            transition={{ duration: 0.2 * m, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-line-strong bg-surface p-5">
              {/* Blank vs Import mode */}
              <div className="mb-4 flex gap-2">
                {(['blank', 'import'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCreateMode(mode)}
                    className={cn(
                      'flex-1 rounded-lg border px-4 py-2 text-sm transition-colors',
                      createMode === mode
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line text-ink-soft hover:border-line-strong',
                    )}
                  >
                    {mode === 'blank' ? 'Start blank' : 'Import cards'}
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
                      void handleCreate();
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
                  <UnifiedImportPanel
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

      {/* Inline new-folder composer */}
      <AnimatePresence>
        {creatingFolder && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.2 * m, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-line-strong bg-surface p-5">
              <label className="block text-sm text-ink-soft">
                Folder name
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newFolderName.trim()) void handleCreateFolder();
                    if (e.key === 'Escape') setCreatingFolder(false);
                  }}
                  placeholder="e.g. Semester 1"
                  className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent"
                />
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCreatingFolder(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                  Create
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection action bar */}
      {selectMode && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 rounded-xl border border-line-strong bg-surface px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleAll}
            aria-pressed={allSelected}
            className="flex min-h-11 items-center gap-2 text-sm text-ink-soft transition-colors hover:text-ink active:text-ink"
          >
            <span
              className={cn(
                'grid h-6 w-6 place-items-center rounded-full border transition-colors',
                allSelected
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-line-strong',
              )}
            >
              {allSelected && (
                <CheckIcon width={14} height={14} />
              )}
            </span>
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
            <span className="text-sm text-ink-faint">{selected.size} selected</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => setMoveIntoFolder(moveIntoFolder ? null : 'choose')}
              >
                <FolderIcon width={16} height={16} />
                Move to folder
              </Button>
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

          {/* Inline move-to-folder chooser */}
          <AnimatePresence>
            {moveIntoFolder && selected.size > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.22 * m, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="border-t border-line pt-3">
                  <p className="mb-3 text-sm text-ink-soft">
                    Choose a folder to move the selected decks into.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => handleMoveToFolder(null)}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-line-strong"
                    >
                      <span className="text-sm">Top level (no folder)</span>
                    </button>
                    {topFolders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => handleMoveToFolder(folder.id)}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-line-strong"
                      >
                        <FolderIcon width={16} height={16} />
                        <span className="text-sm">{folder.name}</span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setMoveIntoFolder(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Inline merge chooser */}
          <AnimatePresence>
            {merging && selected.size >= 2 && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.22 * m, ease: [0.16, 1, 0.3, 1] }}
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

      {/* Deck grid — grouped by folder */}
      {!decks ? (
        <DeckSkeleton motionMultiplier={m} />
      ) : decks.length === 0 ? (
        <EmptyState onCreate={startCreating} motionMultiplier={m} />
      ) : (
        <LayoutGroup>
          {/* Ungrouped decks */}
          {ungroupedDecks.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ungroupedDecks.map((deck) => (
                <motion.div
                  key={deck.id}
                  layout
                  className="h-full"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.24 * m,
                    layout: { duration: 0.22 * m, ease: [0.16, 1, 0.3, 1] },
                  }}
                >
                  <DeckCard
                    deck={deck}
                    summary={summaries?.[deck.id]}
                    selectMode={selectMode}
                    selected={selected.has(deck.id)}
                    onToggleSelected={() => toggleSelected(deck.id)}
                    motionMultiplier={m}
                    folders={topFolders}
                    onMoveToFolder={(deckId, folderId) => {
                      void moveDecksToFolder([deckId], folderId);
                      notify(folderId ? 'Deck moved to folder.' : 'Deck moved to top level.', 'positive');
                    }}
                  />
                </motion.div>
              ))}
            </div>
          )}

          {/* Folders with grouped decks */}
          {topFolders.map((folder) => {
            const folderDecks = groupedDecks[folder.id] ?? [];
            if (folderDecks.length === 0 && !selectMode) return null;
            const expanded = expandedFolders.has(folder.id);
            return (
              <motion.section
                key={folder.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24 * m, ease: [0.16, 1, 0.3, 1] }}
                className={cn('mt-6', ungroupedDecks.length === 0 && 'mt-0')}
              >
                <div className="mb-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleFolderExpanded(folder.id)}
                    className="flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-ink-faint transition-colors hover:text-ink"
                  >
                    <motion.span
                      animate={{ rotate: expanded ? 0 : -90 }}
                      transition={{ duration: 0.15 * m }}
                    >
                      <ChevronDownIcon width={14} height={14} />
                    </motion.span>
                    {renamingFolder === folder.id ? (
                      <input
                        autoFocus
                        value={renameFolderName}
                        onChange={(e) => setRenameFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRenameFolder(folder.id);
                          if (e.key === 'Escape') {
                            setRenamingFolder(null);
                            setRenameFolderName('');
                          }
                        }}
                        onBlur={() => handleRenameFolder(folder.id)}
                        className="rounded border border-line-strong bg-surface px-2 py-1 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
                      />
                    ) : (
                      <span className="flex items-center gap-2">
                        <FolderIcon width={16} height={16} />
                        {folder.name}
                        <span className="text-[11px] normal-case tracking-normal text-ink-faint">
                          {folderDecks.length} deck{folderDecks.length === 1 ? '' : 's'}
                        </span>
                      </span>
                    )}
                  </button>
                  {!selectMode && renamingFolder !== folder.id && (
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingFolder(folder.id);
                          setRenameFolderName(folder.name);
                        }}
                        className="min-h-11 rounded px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10"
                        title="Rename folder"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFolder(folder.id)}
                        className="min-h-11 rounded px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-ink/5 hover:text-rose-600 active:bg-ink/10"
                        title="Delete folder"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 * m, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {folderDecks.map((deck) => (
                          <motion.div
                            key={deck.id}
                            layout
                            className="h-full"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              duration: 0.24 * m,
                              layout: { duration: 0.22 * m, ease: [0.16, 1, 0.3, 1] },
                            }}
                          >
                            <DeckCard
                              deck={deck}
                              summary={summaries?.[deck.id]}
                              selectMode={selectMode}
                              selected={selected.has(deck.id)}
                              onToggleSelected={() => toggleSelected(deck.id)}
                              motionMultiplier={m}
                              folders={topFolders}
                              onMoveToFolder={(deckId, folderId) => {
                                void moveDecksToFolder([deckId], folderId);
                                notify(folderId ? 'Deck moved to folder.' : 'Deck moved to top level.', 'positive');
                              }}
                            />
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            );
          })}

          {archivedDecks.length > 0 && (
            <motion.section
              key="archived"
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24 * m, delay: 0.1 * m, ease: [0.16, 1, 0.3, 1] }}
              className="mt-10"
            >
              <h2 className="mb-4 text-sm uppercase tracking-[0.18em] text-ink-faint">
                Archived
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {archivedDecks.map((deck) => (
                  <motion.div
                    key={deck.id}
                    layout
                    className="h-full"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.24 * m,
                      layout: { duration: 0.22 * m, ease: [0.16, 1, 0.3, 1] },
                    }}
                  >
                    <DeckCard
                      deck={deck}
                      summary={summaries?.[deck.id]}
                      selectMode={selectMode}
                      selected={selected.has(deck.id)}
                      onToggleSelected={() => toggleSelected(deck.id)}
                      motionMultiplier={m}
                      folders={topFolders}
                      onMoveToFolder={(deckId, folderId) => {
                        void moveDecksToFolder([deckId], folderId);
                        notify(folderId ? 'Deck moved to folder.' : 'Deck moved to top level.', 'positive');
                      }}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.section>
          )}
        </LayoutGroup>
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
  selectMode,
  selected,
  onToggleSelected,
  motionMultiplier,
  folders,
  onMoveToFolder,
}: {
  deck: Deck;
  summary: { count: number; mastery: number; unreviewed: number } | undefined;
  selectMode: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  motionMultiplier?: number;
  folders?: { id: string; name: string }[];
  onMoveToFolder?: (deckId: string, folderId: string | null) => void;
}) {
  const m = motionMultiplier ?? 1;
  const navigate = useNavigate();
  const isTouchMode = useIsTouchMode();
  const { notify } = useToast();
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const colourBar = deck.colour ? (
    <span
      className="absolute inset-x-0 top-0 h-1"
      style={{ backgroundColor: deck.colour }}
    />
  ) : null;

  // Touch swipe state for quick actions
  const cardRef = useRef<HTMLDivElement>(null);
  const dragX = useMotionValue(0);
  const springX = useSpring(dragX, { stiffness: 380, damping: 32 });
  const swipeState = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    isSwipe: false,
  });
  const SWIPE_THRESHOLD = 50;
  const MAX_DRAG = 100;

  // UseTransform must be called unconditionally at top level (rules of hooks).
  const rightSwipeOpacity = useTransform(springX, [0, MAX_DRAG], [0, 1]);
  const leftSwipeOpacity = useTransform(springX, [0, -MAX_DRAG], [0, 1]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!isTouchMode || selectMode) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [role="button"]')) return;
    swipeState.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      isSwipe: false,
    };
    cardRef.current?.setPointerCapture(e.pointerId);
    dragX.set(0);
  }, [isTouchMode, selectMode, dragX]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isTouchMode || !swipeState.current.dragging) return;
    const dx = e.clientX - swipeState.current.startX;
    const dy = e.clientY - swipeState.current.startY;

    if (!swipeState.current.isSwipe && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
      swipeState.current.isSwipe = true;
    }
    if (!swipeState.current.isSwipe) return;
    e.preventDefault();

    const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx));
    dragX.set(clamped);
  }, [isTouchMode, dragX]);

  const justSwiped = useRef(false);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isTouchMode || !swipeState.current.dragging) return;
    cardRef.current?.releasePointerCapture(e.pointerId);
    swipeState.current.dragging = false;
    const wasSwipe = swipeState.current.isSwipe;
    swipeState.current.isSwipe = false;

    const currentX = dragX.get();
    if (wasSwipe) {
      e.stopPropagation();
      justSwiped.current = true;
      if (currentX > SWIPE_THRESHOLD) {
        // Swipe right = study
        dragX.set(0);
        navigate(`/deck/${deck.id}/learn`);
      } else if (currentX < -SWIPE_THRESHOLD) {
        // Swipe left = archive
        dragX.set(0);
        if (!deck.archived) {
          void (async () => {
            await updateDeck(deck.id, { archived: true });
            notify('Deck archived.', 'neutral');
          })();
        }
      } else {
        dragX.set(0);
      }
    } else {
      dragX.set(0);
    }
  }, [isTouchMode, dragX, deck, navigate, notify]);

  const handlePointerCancel = useCallback(() => {
    swipeState.current.dragging = false;
    swipeState.current.isSwipe = false;
    dragX.set(0);
  }, [dragX]);

  function handleLinkClick(e: React.MouseEvent) {
    if (selectMode) {
      e.preventDefault();
      onToggleSelected();
      return;
    }
    if (justSwiped.current) {
      e.preventDefault();
      justSwiped.current = false;
    }
  }

  useEffect(() => {
    function onClickOutside(e: Event) {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenuOpen(false);
      }
    }
    if (folderMenuOpen) {
      document.addEventListener('mousedown', onClickOutside);
      document.addEventListener('touchstart', onClickOutside);
      return () => {
        document.removeEventListener('mousedown', onClickOutside);
        document.removeEventListener('touchstart', onClickOutside);
      };
    }
  }, [folderMenuOpen]);

  const body = (
    <motion.div
      ref={cardRef}
      style={{ x: isTouchMode ? springX : undefined, touchAction: 'pan-y' }}        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      whileHover={!isTouchMode ? { y: -4, transition: { duration: 0.12 * m } } : undefined}
      whileTap={!isTouchMode ? { scale: 0.98, transition: { duration: 0.08 * m } } : undefined}
      className={cn(
        'group relative flex h-full flex-col rounded-2xl border bg-surface p-5 transition-colors duration-200',
        folderMenuOpen ? 'overflow-visible' : 'overflow-hidden',
        selected
          ? 'border-accent ring-2 ring-accent/30'
          : 'border-line hover:border-line-strong hover:shadow-xl hover:shadow-black/[0.04]',
      )}
    >
      {colourBar}
      {selectMode && (      <span
        className={cn(
          'absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full border transition-colors p-1',
          selected
            ? 'border-accent bg-accent text-accent-fg'
            : 'border-line-strong',
        )}
      >
        {selected && <CheckIcon width={14} height={14} />}
      </span>
      )}

      {/* Folder dropdown — visible on hover (desktop) or always (touch) when not in select mode */}
      {!selectMode && folders && folders.length > 0 && (
        <div ref={folderMenuRef} className="absolute right-2 top-2 z-20">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setFolderMenuOpen((v) => !v);
            }}
            className={cn(
              'grid h-9 w-9 place-items-center rounded-full border transition-colors',
              folderMenuOpen
                ? 'border-accent bg-accent text-accent-fg'
                : cn(
                    'border-transparent bg-surface/80 text-ink-faint hover:border-line-strong hover:text-ink',
                    !isTouchMode && 'opacity-0 group-hover:opacity-100',
                  ),
            )}
            title={deck.folderId ? 'Change folder' : 'Move to folder'}
            aria-expanded={folderMenuOpen}
            aria-haspopup="menu"
          >
            <FolderIcon width={16} height={16} />
          </button>
          {folderMenuOpen && (
            <div role="menu" className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-line-strong bg-surface p-1 shadow-lg shadow-black/10">
              {deck.folderId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onMoveToFolder?.(deck.id, null);
                    setFolderMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
                >
                  <span className="h-1.5 w-1.5 rounded-full border border-line-strong" />
                  Top level (no folder)
                </button>
              )}
              {folders.map((folder) => {
                if (folder.id === deck.folderId) return null;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onMoveToFolder?.(deck.id, folder.id);
                      setFolderMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
                  >
                    <FolderIcon width={14} height={14} />
                    {folder.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Touch swipe hint overlays */}
      {isTouchMode && !selectMode && (
        <>
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-0 flex items-center rounded-r-2xl bg-accent/90 px-3 text-accent-fg"
            style={{ opacity: rightSwipeOpacity, width: 80 }}
          >
            <PlayIcon width={20} height={20} />
          </motion.div>
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-0 flex items-center rounded-l-2xl bg-ink/10 px-3 text-ink"
            style={{ opacity: leftSwipeOpacity, width: 80 }}
          >
            <span className="text-xs font-medium">Archive</span>
          </motion.div>
        </>
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
            : `Exam ${relativeExam(deck.examDate, Date.now(), deck.timeZone)}`}
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

  return (
    <Link
      to={`/deck/${deck.id}`}
      onClick={handleLinkClick}
      aria-pressed={selectMode ? selected : undefined}
      className="block h-full text-left"
    >
      {body}
    </Link>
  );
}

function DeckSkeleton({ motionMultiplier }: { motionMultiplier?: number }) {
  const m = motionMultiplier ?? 1;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 * m, delay: Math.min(i * 0.04, 0.2) * m }}
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

function sortDecks(
  decks: Deck[],
  sort: DashboardSort,
  summaries: Record<string, { count: number; mastery: number; unreviewed: number; eligible: number }> | undefined,
): Deck[] {
  const list = [...decks];
  switch (sort) {
    case 'recent':
      list.sort((a, b) => (b.lastInteractedAt ?? b.createdAt) - (a.lastInteractedAt ?? a.createdAt));
      break;
    case 'ready':
      list.sort((a, b) => (summaries?.[b.id]?.eligible ?? 0) - (summaries?.[a.id]?.eligible ?? 0));
      break;
    case 'mastery':
      list.sort((a, b) => (summaries?.[a.id]?.mastery ?? 0) - (summaries?.[b.id]?.mastery ?? 0));
      break;
    case 'exam':
      list.sort((a, b) => a.examDate - b.examDate);
      break;
    case 'name':
      list.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'created':
      list.sort((a, b) => b.createdAt - a.createdAt);
      break;
  }
  return list;
}

function EmptyState({ onCreate, motionMultiplier }: { onCreate: () => void; motionMultiplier?: number }) {
  const m = motionMultiplier ?? 1;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32 * m, ease: [0.16, 1, 0.3, 1] }}
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
