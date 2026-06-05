import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CardContent } from './CardContent';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { ImportPanel } from '../import/ImportPanel';
import {
  addTagToCards,
  createCards,
  deleteCards,
  moveCards,
  removeTagFromCards,
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
import type { ParsedCard } from '../../db/import';
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
  const [importing, setImporting] = useState(false);

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
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
    setMoving(false);
    setMoveTarget('');
    setTagging(false);
    setTagValue('');
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
    setMoveTarget(otherDecks[0]?.id ?? '');
    setMoving(true);
  }

  function startTag() {
    setMoving(false);
    setTagging(true);
  }

  async function handleMove() {
    if (!moveTarget) return;
    const ids = [...selected];
    await moveCards(ids, moveTarget);
    exitSelect();
    notify(`${ids.length} card${ids.length === 1 ? '' : 's'} moved.`, 'positive');
  }

  async function handleImport(cards: ParsedCard[]) {
    await createCards(deck.id, cards);
    setImporting(false);
    notify(`${cards.length} card${cards.length === 1 ? '' : 's'} imported.`, 'positive');
  }

  async function handleResume(card: Card) {
    const snapshot = await snapshotCards([card.id]);
    await unsuspendCard(card.id);
    notify('Card resumed.', 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreCards(snapshot);
      },
    });
  }

  async function handleToggleFlag(card: Card) {
    const snapshot = await snapshotCards([card.id]);
    await setCardFlag(card.id, !card.flagged);
    notify(card.flagged ? 'Flag removed.' : 'Card flagged.', 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreCards(snapshot);
      },
    });
  }

  // One-click delete from a card's hover actions, with the same snapshot/undo flow
  // as the bulk selection delete.
  async function handleDeleteOne(id: string) {
    const snapshot = await snapshotCards([id]);
    await deleteCards([id]);
    notify('Card deleted.', 'neutral', {
      actionLabel: 'Undo',
      onAction: () => {
        void restoreCards(snapshot);
      },
    });
  }

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
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
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
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-line-strong bg-surface p-5">
              <h3 className="mb-4 font-display text-lg">Import cards into {deck.name}</h3>
              <ImportPanel
                onImport={handleImport}
                onCancel={() => setImporting(false)}
                importLabel="Add cards"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {selectMode && (
        <div className="mb-4 rounded-xl border border-line-strong bg-surface px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-soft">{selected.size} selected</span>
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
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
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

          {/* Inline move chooser */}
          <AnimatePresence>
            {moving && selected.size > 0 && otherDecks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
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
        <div className="grid gap-3">
          {cards.map((card, i) => (
            <CardRow
              key={card.id}
              card={card}
              index={i}
              selectMode={selectMode}
              selected={selected.has(card.id)}
              onToggle={() => toggle(card.id)}
              onEdit={() => onEditCard(card)}
              onResume={() => handleResume(card)}
              onDelete={() => handleDeleteOne(card.id)}
              onToggleFlag={() => handleToggleFlag(card)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CardRow({
  card,
  index,
  selectMode,
  selected,
  onToggle,
  onEdit,
  onResume,
  onDelete,
  onToggleFlag,
}: {
  card: Card;
  index: number;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onResume: () => void;
  onDelete: () => void;
  onToggleFlag: () => void;
}) {
  const reviewed = card.lastReviewed !== null;
  const tags = card.tags ?? [];
  const buried = card.buriedUntil != null && card.buriedUntil > Date.now();
  const leech = isLeech(card);
  const flagged = card.flagged === true;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.25) }}
      onClick={selectMode ? onToggle : undefined}
      className={cn(
        'group relative flex items-start gap-4 rounded-xl border bg-surface p-4 transition-colors',
        selectMode && 'cursor-pointer',
        selected
          ? 'border-accent ring-2 ring-accent/30'
          : 'border-line hover:border-line-strong',
      )}
    >
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
        <div className="max-h-24 overflow-hidden text-sm text-ink-soft [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
          <CardContent card={card} side="front" />
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
              onClick={onResume}
              title="Resume card"
              className="rounded-lg px-2 py-1 text-xs text-ink-faint transition-colors hover:bg-ink/5 hover:text-accent"
            >
              Resume
            </button>
          )}
          <motion.button
            type="button"
            onClick={onToggleFlag}
            title={flagged ? 'Remove flag' : 'Flag card'}
            aria-pressed={flagged}
            whileTap={{ scale: 0.88 }}
            className={cn(
              'rounded-lg p-2 transition-opacity hover:bg-ink/5 hover:text-accent focus-visible:opacity-100',
              flagged
                ? 'text-accent opacity-100'
                : 'text-ink-faint opacity-0 group-hover:opacity-100',
            )}
          >
            <FlagIcon width={16} height={16} />
          </motion.button>
          <motion.button
            type="button"
            onClick={onEdit}
            title="Edit card"
            whileTap={{ scale: 0.88 }}
            className="rounded-lg p-2 text-ink-faint opacity-0 transition-opacity hover:bg-ink/5 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
          >
            <EditIcon width={16} height={16} />
          </motion.button>
          <motion.button
            type="button"
            onClick={onDelete}
            title="Delete card"
            whileTap={{ scale: 0.88 }}
            className="rounded-lg p-2 text-ink-faint opacity-0 transition-opacity hover:bg-negative/10 hover:text-negative focus-visible:opacity-100 group-hover:opacity-100"
          >
            <TrashIcon width={16} height={16} />
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}
