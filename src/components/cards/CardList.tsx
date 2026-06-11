import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AnimatePresence, m as motion, useMotionValue, useSpring } from 'motion/react';
import { CardContent } from './CardContent';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { hapticLight, hapticMedium } from '../../utils/haptic';
import { UnifiedImportPanel } from '../import/UnifiedImportPanel';
import { CardAnalytics } from './CardAnalytics';
import {
  addTagToCards,
  buryCards,
  createCards,
  deleteCards,
  moveCards,
  removeTagFromCards,
  rescheduleCards,
  restoreCards,
  setCardFlag,
  setCardsSuspended,
  snapshotCards,
  unsuspendCard,
} from '../../db/repository';
import { isLeech } from '../../fsrs/leech';
import {
  CheckIcon,
  EditIcon,
  FlagIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
  UploadIcon,
} from '../ui/icons';
import { cn } from '../ui/cn';
import { useMotionSpeed, speedMultiplier } from '../../state/motionSpeed';
import { useIsTouchMode } from '../../state/inputMode';
import { useVirtualList } from '../../hooks/useVirtualList';
import type { ParsedCard } from '../../db/import';
import { importApkgResult, type ApkgImportResult } from '../../db/apkgImport';
import type { Card, Deck } from '../../db/types';

interface CardListProps {
  cards: Card[];
  deck: Deck;
  allDecks: Deck[];
  onNewCard: () => void;
  onEditCard: (card: Card) => void;
}

export function CardList({ cards, deck, allDecks, onNewCard, onEditCard }: CardListProps) {
  const { notify } = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string>('');
  const [tagging, setTagging] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleMode, setRescheduleMode] = useState<'new' | 'dueNow'>('new');
  const [importing, setImporting] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  useEffect(() => {
    setExpandedCardId(null);
  }, [deck.id]);


  const otherDecks = useMemo(
    () => allDecks.filter((d) => d.id !== deck.id),
    [allDecks, deck.id],
  );

  // Existing tags across the deck, offered as suggestions in the bulk tag panel.
  const tagSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort();
  }, [cards]);

  function toggle(id: string) {
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
    setSelected((prev) => {
      if (cards.length > 0 && cards.every((c) => prev.has(c.id))) return new Set();
      return new Set(cards.map((c) => c.id));
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
    setMoving(false);
    setMoveTarget('');
    setTagging(false);
    setTagValue('');
    setRescheduling(false);
    setRescheduleMode('new');
  }

  /** Apply a reversible bulk change to the selected cards, with an Undo toast. */
  async function applyBulk(
    apply: (ids: string[]) => Promise<void>,
    message: string,
  ) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const snapshot = await snapshotCards(ids);
    await apply(ids);
    exitSelect();
    notify(message, 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreCards(snapshot);
      },
    });
  }

  function plural(n: number) {
    return n === 1 ? '' : 's';
  }

  async function handleSuspend(suspended: boolean) {
    const n = selected.size;
    await applyBulk(
      (ids) => setCardsSuspended(ids, suspended),
      `${n} card${plural(n)} ${suspended ? 'suspended' : 'resumed'}.`,
    );
  }

  async function handleAddTag() {
    const tag = tagValue.trim();
    if (!tag) return;
    const n = selected.size;
    await applyBulk((ids) => addTagToCards(ids, tag), `Tagged ${n} card${plural(n)} "${tag}".`);
  }

  async function handleRemoveTag() {
    const tag = tagValue.trim();
    if (!tag) return;
    const n = selected.size;
    await applyBulk(
      (ids) => removeTagFromCards(ids, tag),
      `Removed "${tag}" from ${n} card${plural(n)}.`,
    );
  }

  async function handleDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const snapshot = await snapshotCards(ids);
    await deleteCards(ids);
    exitSelect();
    notify(`${ids.length} card${ids.length === 1 ? '' : 's'} deleted.`, 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreCards(snapshot);
      },
    });
  }

  function startMove() {
    setTagging(false);
    setRescheduling(false);
    setMoveTarget(otherDecks[0]?.id ?? '');
    setMoving(true);
  }

  function startTag() {
    setMoving(false);
    setRescheduling(false);
    setTagging(true);
  }

  function startReschedule() {
    setMoving(false);
    setTagging(false);
    setRescheduling(true);
  }

  async function handleBury() {
    const n = selected.size;
    const until = new Date();
    until.setDate(until.getDate() + 1);
    until.setHours(0, 0, 0, 0);
    await applyBulk(
      (ids) => buryCards(ids, until.getTime()),
      `${n} card${plural(n)} buried until tomorrow.`,
    );
  }

  async function handleReschedule() {
    const n = selected.size;
    if (rescheduleMode === 'new') {
      await applyBulk(
        (ids) => rescheduleCards(ids, { reset: true }),
        `${n} card${plural(n)} reset to new.`,
      );
    } else {
      await applyBulk(
        (ids) => rescheduleCards(ids, { due: Date.now() }),
        `${n} card${plural(n)} made due now.`,
      );
    }
  }

  async function handleMove() {
    if (!moveTarget) return;
    const ids = [...selected];
    const snapshot = await snapshotCards(ids);
    await moveCards(ids, moveTarget);
    exitSelect();
    notify(`${ids.length} card${ids.length === 1 ? '' : 's'} moved.`, 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreCards(snapshot);
      },
    });
  }

  async function handleImport(cards: ParsedCard[]) {
    await createCards(deck.id, cards);
    setImporting(false);
    notify(`${cards.length} card${cards.length === 1 ? '' : 's'} imported.`, 'positive');
  }

  async function handleApkgImport(result: ApkgImportResult) {
    await importApkgResult(result, deck.id);
    setImporting(false);
    notify(`${result.cards.length} card${result.cards.length === 1 ? '' : 's'} imported from Anki.`, 'positive');
  }

  const handleResume = useCallback(async (card: Card) => {
    const snapshot = await snapshotCards([card.id]);
    await unsuspendCard(card.id);
    notify('Card resumed.', 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreCards(snapshot);
      },
    });
  }, [notify]);

  const handleToggleFlag = useCallback(async (card: Card) => {
    const snapshot = await snapshotCards([card.id]);
    await setCardFlag(card.id, !card.flagged);
    notify(card.flagged ? 'Flag removed.' : 'Card flagged.', 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreCards(snapshot);
      },
    });
  }, [notify]);

  // One-click delete from a card's hover actions, with the same snapshot/undo flow
  // as the bulk selection delete.
  const handleDeleteOne = useCallback(async (id: string) => {
    const snapshot = await snapshotCards([id]);
    await deleteCards([id]);
    notify('Card deleted.', 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreCards(snapshot);
      },
    });
  }, [notify]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-2xl">
          Cards <span className="text-ink-faint">({cards.length})</span>
        </h2>
        <div className="ml-auto flex gap-2">
          {cards.length > 0 && (
            <Button
              variant={selectMode ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                if (selectMode) {
                  exitSelect();
                } else {
                  setSelectMode(true);
                  setExpandedCardId(null);
                }
              }}
            >
              {selectMode ? 'Done' : 'Select'}
            </Button>
          )}
          {!selectMode && (
            <Button
              variant={importing ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setImporting((v) => !v)}
            >
              <UploadIcon width={16} height={16} />
              Import
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={onNewCard}>
            <PlusIcon width={16} height={16} />
            New card
          </Button>
        </div>
      </div>

      {/* Inline import panel */}
      <AnimatePresence>
        {importing && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.12 * m, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-line-strong bg-surface p-5">
              <h3 className="mb-4 font-display text-lg">Import cards into {deck.name}</h3>
              <UnifiedImportPanel
                deckId={deck.id}
                onImport={handleImport}
                onCancel={() => setImporting(false)}
                importLabel="Add cards"
                onApkgImport={handleApkgImport}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {selectMode && (
        <div className="mb-4 rounded-xl border border-line-strong bg-surface px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleAll}
              aria-pressed={cards.length > 0 && cards.every((c) => selected.has(c.id))}
              className="flex items-center gap-2 text-sm text-ink-soft transition-colors hover:text-ink"
            >
              <span
                className={cn(
                  'grid h-5 w-5 place-items-center rounded-full border transition-colors',
                  cards.length > 0 && cards.every((c) => selected.has(c.id))
                    ? 'border-accent bg-accent text-accent-fg'
                    : 'border-line-strong',
                )}
              >
                {cards.length > 0 && cards.every((c) => selected.has(c.id)) && (
                  <CheckIcon width={12} height={12} />
                )}
              </span>
              {cards.length > 0 && cards.every((c) => selected.has(c.id)) ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-sm text-ink-faint">{selected.size} selected</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={tagging ? 'primary' : 'secondary'}
                disabled={selected.size === 0}
                onClick={() => (tagging ? setTagging(false) : startTag())}
              >
                Tag…
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => handleSuspend(true)}
              >
                Suspend
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => handleSuspend(false)}
              >
                Resume
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={selected.size === 0}
                onClick={handleBury}
              >
                Bury
              </Button>
              <Button
                size="sm"
                variant={rescheduling ? 'primary' : 'secondary'}
                disabled={selected.size === 0}
                onClick={() => (rescheduling ? setRescheduling(false) : startReschedule())}
              >
                Reschedule…
              </Button>
              <Button
                size="sm"
                variant={moving ? 'primary' : 'secondary'}
                disabled={selected.size === 0 || otherDecks.length === 0}
                onClick={() => (moving ? setMoving(false) : startMove())}
              >
                Move to…
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={selected.size === 0}
                onClick={handleDelete}
              >
                Delete
              </Button>
            </div>
          </div>

          {/* Inline tag chooser */}
          <AnimatePresence>
            {tagging && selected.size > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.12 * m, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="border-t border-line pt-3">
                  <label className="block text-sm text-ink-soft">
                    Tag for {selected.size} card{plural(selected.size)}
                    <input
                      list="bulk-tag-suggestions"
                      value={tagValue}
                      onChange={(e) => setTagValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleAddTag();
                        }
                      }}
                      placeholder="Type a tag…"
                      className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent"
                    />
                    <datalist id="bulk-tag-suggestions">
                      {tagSuggestions.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </label>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setTagging(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleRemoveTag}
                      disabled={!tagValue.trim()}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleAddTag}
                      disabled={!tagValue.trim()}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Inline reschedule chooser */}
          <AnimatePresence>
            {rescheduling && selected.size > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.12 * m, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="border-t border-line pt-3">
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-sm text-ink-soft">
                      Reschedule {selected.size} card{plural(selected.size)}
                    </legend>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="radio"
                        name="reschedule-mode"
                        value="new"
                        checked={rescheduleMode === 'new'}
                        onChange={() => setRescheduleMode('new')}
                        className="accent-accent"
                      />
                      Reset to new (clear scheduling)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="radio"
                        name="reschedule-mode"
                        value="dueNow"
                        checked={rescheduleMode === 'dueNow'}
                        onChange={() => setRescheduleMode('dueNow')}
                        className="accent-accent"
                      />
                      Make due now
                    </label>
                  </fieldset>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setRescheduling(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="primary" onClick={handleReschedule}>
                      Reschedule
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Inline move chooser */}
          <AnimatePresence>
            {moving && selected.size > 0 && otherDecks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.12 * m, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="border-t border-line pt-3">
                  <label className="block text-sm text-ink-soft">
                    Move {selected.size} card{selected.size === 1 ? '' : 's'} to
                    <select
                      value={moveTarget}
                      onChange={(e) => setMoveTarget(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent"
                    >
                      {otherDecks.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setMoving(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleMove}
                      disabled={!moveTarget}
                    >
                      Move
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong py-16 text-center">
          <p className="mb-4 text-ink-soft">This deck has no cards yet.</p>
          <Button variant="primary" onClick={onNewCard}>
            <PlusIcon width={18} height={18} />
            Add your first card
          </Button>
        </div>
      ) : (
        <CardListBody
          cards={cards}
          deck={deck}
          selectMode={selectMode}
          selected={selected}
          expandedCardId={expandedCardId}
          onToggle={toggle}
          onToggleExpand={setExpandedCardId}
          onEditCard={onEditCard}
          onResume={handleResume}
          onDelete={handleDeleteOne}
          onToggleFlag={handleToggleFlag}
          motionMultiplier={m}
        />
      )}
    </div>
  );
}

const VIRTUAL_THRESHOLD = 50;

/** Renders the card list either as a simple grid (small decks) or a virtualised
 *  absolute-positioned list (large decks) to keep performance constant. */
function CardListBody({
  cards,
  deck,
  selectMode,
  selected,
  expandedCardId,
  onToggle,
  onToggleExpand,
  onEditCard,
  onResume,
  onDelete,
  onToggleFlag,
  motionMultiplier,
}: {
  cards: Card[];
  deck: Deck;
  selectMode: boolean;
  selected: Set<string>;
  expandedCardId: string | null;
  onToggle: (id: string) => void;
  onToggleExpand: React.Dispatch<React.SetStateAction<string | null>>;
  onEditCard: (card: Card) => void;
  onResume: (card: Card) => void;
  onDelete: (id: string) => void;
  onToggleFlag: (card: Card) => void;
  motionMultiplier: number;
}) {
  const enabled = cards.length > VIRTUAL_THRESHOLD;
  const { totalHeight, virtualItems, measureRef, containerRef } = useVirtualList({
    itemCount: cards.length,
    estimateSize: 100,
    gap: 12,
    overscan: 5,
    enabled,
  });

  // Track which cards have already mounted so we only animate once.
  const mountedRef = useRef<Set<string>>(new Set());
  const isFirstRender = useRef(true);
  useEffect(() => {
    isFirstRender.current = false;
    cards.forEach((c) => mountedRef.current.add(c.id));
  }, [cards]);

  if (!enabled) {
    return (
      <div className="grid gap-3">
        {cards.map((card, i) => (
          <CardRow
            key={card.id}
            card={card}
            deck={deck}
            index={i}
            selectMode={selectMode}
            selected={selected.has(card.id)}
            expanded={expandedCardId === card.id}
            onToggle={() => onToggle(card.id)}
            onToggleExpand={() =>
              onToggleExpand((prev) => (prev === card.id ? null : card.id))
            }
            onEdit={() => onEditCard(card)}
            onResume={() => onResume(card)}
            onDelete={() => onDelete(card.id)}
            onToggleFlag={onToggleFlag}
            motionMultiplier={motionMultiplier}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative" style={{ height: totalHeight }}>
      {virtualItems.map(({ index, start }) => {
        const card = cards[index];
        const hasMounted = mountedRef.current.has(card.id);
        if (!hasMounted) mountedRef.current.add(card.id);
        return (
          <div
            key={card.id}
            ref={measureRef(index)}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${start}px)` }}
          >
            <CardRow
              card={card}
              deck={deck}
              index={index}
              selectMode={selectMode}
              selected={selected.has(card.id)}
              expanded={expandedCardId === card.id}
              onToggle={() => onToggle(card.id)}
              onToggleExpand={() =>
                onToggleExpand((prev) => (prev === card.id ? null : card.id))
              }
              onEdit={() => onEditCard(card)}
              onResume={() => onResume(card)}
              onDelete={() => onDelete(card.id)}
              onToggleFlag={onToggleFlag}
              motionMultiplier={motionMultiplier}
              skipAnimation={hasMounted && !isFirstRender.current}
            />
          </div>
        );
      })}
    </div>
  );
}

function CardRow({
  card,
  deck,
  index,
  selectMode,
  selected,
  expanded,
  onToggle,
  onToggleExpand,
  onEdit,
  onResume,
  onDelete,
  onToggleFlag,
  motionMultiplier,
  skipAnimation,
}: {
  card: Card;
  deck: Deck;
  index: number;
  selectMode: boolean;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onResume: () => void;
  onDelete: () => void;
  onToggleFlag: (card: Card) => void;
  motionMultiplier?: number;
  skipAnimation?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const m = motionMultiplier ?? 1;
  const isTouchMode = useIsTouchMode();
  const showBack = hovered;

  // Lazy-render: only parse the back side when it is actually visible.
  const contentSide = useMemo(() => (showBack ? 'back' : 'front'), [showBack]);

  const reviewed = card.lastReviewed !== null;
  const tags = card.tags ?? [];
  const buried = card.buriedUntil !== null && card.buriedUntil !== undefined && card.buriedUntil > Date.now();
  const leech = isLeech(card);
  const flagged = card.flagged === true;

  // Swipe-to-reveal state — multi-directional in touch mode.
  const [trayOpen, setTrayOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragX = useMotionValue(0);
  useEffect(() => {
    if (selectMode || expanded) {
      setTrayOpen(false);
      dragX.set(0);
    }
  }, [selectMode, expanded, dragX]);
  const springX = useSpring(dragX, { stiffness: 420, damping: 30, mass: 0.8 });
  const swipeState = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    isSwipe: false,
    openBeforeDrag: false,
  });
  const trayWidth = 220;
  const swipeThreshold = 40;
  const MAX_DRAG = 120;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (selectMode || expanded) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [role="button"]')) return;
    e.stopPropagation();
    swipeState.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      isSwipe: false,
      openBeforeDrag: trayOpen,
    };
    cardRef.current?.setPointerCapture(e.pointerId);
  }, [selectMode, expanded, trayOpen]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!swipeState.current.dragging) return;
    const dx = e.clientX - swipeState.current.startX;
    const dy = e.clientY - swipeState.current.startY;

    if (!swipeState.current.isSwipe && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
      swipeState.current.isSwipe = true;
    }
    if (!swipeState.current.isSwipe) return;

    e.preventDefault();

    // If tray was already open, dragging right closes it; dragging left keeps it open.
    // If tray was closed, dragging left opens it; dragging right triggers quick flag.
    const base = swipeState.current.openBeforeDrag ? -trayWidth : 0;
    const clamped = Math.max(-trayWidth, Math.min(isTouchMode ? MAX_DRAG : 0, base + dx));
    dragX.set(clamped);
  }, [dragX, isTouchMode]);

  const justHandledTap = useRef(false);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!swipeState.current.dragging) return;
    cardRef.current?.releasePointerCapture(e.pointerId);
    swipeState.current.dragging = false;
    const wasSwipe = swipeState.current.isSwipe;
    swipeState.current.isSwipe = false;

    if (wasSwipe) {
      e.stopPropagation();
      justHandledTap.current = true;
      const currentX = dragX.get();
      // If open before drag, drag right to close; if closed, drag left to open.
      if (swipeState.current.openBeforeDrag) {
        // Tray was open — close if dragged right past threshold
        if (currentX > -trayWidth + swipeThreshold) {
          setTrayOpen(false);
          dragX.set(0);
        } else {
          setTrayOpen(true);
          dragX.set(-trayWidth);
        }
      } else {
        // Tray was closed
        if (currentX < -swipeThreshold) {
          // Drag left — open tray
          hapticLight();
          setTrayOpen(true);
          dragX.set(-trayWidth);
        } else if (isTouchMode && currentX > swipeThreshold) {
          // Drag right — quick flag (touch mode only)
          hapticLight();
          dragX.set(0);
          onToggleFlag(card);
        } else {
          setTrayOpen(false);
          dragX.set(0);
        }
      }
    } else {        // It was a tap — close the tray if it is open; suppress the subsequent click.
      if (trayOpen) {
        hapticLight();
        justHandledTap.current = true;
        setTrayOpen(false);
        dragX.set(0);
      }
    }
  }, [dragX, trayOpen, isTouchMode, onToggleFlag, card]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    cardRef.current?.releasePointerCapture(e.pointerId);
    swipeState.current.dragging = false;
    swipeState.current.isSwipe = false;
    dragX.set(trayOpen ? -trayWidth : 0);
  }, [dragX, trayOpen]);

  function handleClick() {
    if (justHandledTap.current) {
      justHandledTap.current = false;
      return;
    }
    if (selectMode) {
      onToggle();
    } else if (trayOpen) {
      setTrayOpen(false);
      dragX.set(0);
    } else {
      onToggleExpand();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selectMode) {
        onToggle();
      } else {
        onToggleExpand();
      }
    }
  }

  return (
    <div
      className={cn(
        'group relative rounded-xl border bg-surface transition-colors duration-200',
        selected
          ? 'border-accent ring-2 ring-accent/30'
          : 'border-line hover:border-line-strong',
      )}
    >
      {/* Action tray revealed behind the card on swipe-left */}
      <div
        className="absolute inset-y-0 right-0 z-0 flex items-center overflow-hidden rounded-r-xl"
        style={{ width: trayWidth }}
      >
        <div className="flex h-full w-full items-center">
          <button
            type="button"
            aria-pressed={flagged}
            onClick={(e) => { e.stopPropagation(); hapticLight(); onToggleFlag(card); }}
            className={cn(
              'flex h-full flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors',
              flagged
                ? 'bg-accent/10 text-accent hover:bg-accent/20'
                : 'bg-ink/[0.03] text-ink-soft hover:bg-ink/5',
            )}
          >
            <FlagIcon width={18} height={18} />
            {flagged ? 'Unflag' : 'Flag'}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); hapticLight(); onEdit(); }}
            className="flex h-full flex-1 flex-col items-center justify-center gap-1 bg-ink/[0.03] text-xs text-ink-soft transition-colors hover:bg-accent/10 hover:text-accent"
          >
            <EditIcon width={18} height={18} />
            Edit
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); hapticMedium(); onDelete(); }}
            className="flex h-full flex-1 flex-col items-center justify-center gap-1 bg-negative/10 text-xs text-negative transition-colors hover:bg-negative/20"
          >
            <TrashIcon width={18} height={18} />
            Delete
          </button>
        </div>
      </div>

      <motion.div
        ref={cardRef}
        style={{ x: springX, touchAction: 'pan-y' }}
        initial={skipAnimation ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: skipAnimation ? 0 : 0.16 * m, delay: Math.min(index * 0.03, 0.25) * m }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => !selectMode && setHovered(true)}
        onMouseLeave={() => !selectMode && setHovered(false)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        tabIndex={0}
        aria-expanded={expanded}
        className={cn(
          'relative z-10 cursor-pointer rounded-xl border bg-surface p-4',
          selected
            ? 'border-accent ring-2 ring-accent/30'
            : 'border-line hover:border-line-strong hover:shadow-md hover:shadow-black/[0.03] active:bg-ink/5',
        )}
      >
        <div className="flex items-start gap-4">
          {selectMode && (
            <span
              className={cn(
                'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors',
                selected ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong',
              )}
            >
              {selected && <CheckIcon width={12} height={12} />}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-faint">
                {card.type === 'cloze' ? 'Cloze' : 'Front / Back'}
              </span>
              {showBack && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                  Back
                </span>
              )}
              {reviewed ? (
                <span className="text-[11px] text-ink-faint tabular">
                  Stability {card.stability!.toFixed(1)}d
                </span>
              ) : (
                <span className="text-[11px] text-accent">New</span>
              )}
              {card.suspended && (
                <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] text-ink-faint">
                  Suspended
                </span>
              )}
              {!card.suspended && buried && (
                <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] text-ink-faint">
                  Buried
                </span>
              )}
              {leech && (
                <span
                  title={`Failed ${card.lapses} times — consider rewording or splitting this card.`}
                  className="rounded-full bg-negative/10 px-2 py-0.5 text-[11px] font-medium text-negative"
                >
                  Leech
                </span>
              )}
              {flagged && <FlagIcon width={13} height={13} className="text-accent" />}
            </div>
            <div className="relative max-h-24 overflow-hidden text-sm text-ink-soft [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={showBack ? 'back' : 'front'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 * m }}
                >
                  <CardContent card={card} side={contentSide} />
                </motion.div>
              </AnimatePresence>
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <TagIcon width={13} height={13} className="text-ink-faint" />
                {tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-soft"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {!selectMode && (
            <div className="flex shrink-0 items-center gap-1">
              {card.suspended && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onResume(); }}
                  title="Resume card"
                  className="min-h-11 rounded-lg px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-ink/5 hover:text-accent active:bg-ink/10"
                >
                  Resume
                </button>
              )}
              <motion.button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleFlag(card); }}
                title={flagged ? 'Remove flag' : 'Flag card'}
                aria-pressed={flagged}
                whileTap={{ scale: 0.85 }}
                whileHover={{ scale: 1.08 }}
                className={cn(
                  'min-h-11 rounded-lg p-2 transition-opacity hover:bg-ink/5 hover:text-accent focus-visible:opacity-100 touch-visible',
                  flagged
                    ? 'text-accent opacity-100'
                    : 'text-ink-faint opacity-0 group-hover:opacity-100',
                )}
              >
                <FlagIcon width={16} height={16} />
              </motion.button>
              <motion.button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                title="Edit card"
                whileTap={{ scale: 0.85 }}
                whileHover={{ scale: 1.08 }}
                className="min-h-11 rounded-lg p-2 text-ink-faint opacity-0 transition-opacity hover:bg-ink/5 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 touch-visible"
              >
                <EditIcon width={16} height={16} />
              </motion.button>
              <motion.button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title="Delete card"
                whileTap={{ scale: 0.85 }}
                whileHover={{ scale: 1.08 }}
                className="min-h-11 rounded-lg p-2 text-ink-faint opacity-0 transition-opacity hover:bg-negative/10 hover:text-negative focus-visible:opacity-100 group-hover:opacity-100 touch-visible"
              >
                <TrashIcon width={16} height={16} />
              </motion.button>
            </div>
          )}
        </div>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.18 * m, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-t border-line pt-4">
                <CardAnalytics card={card} deck={deck} motionMultiplier={m} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
