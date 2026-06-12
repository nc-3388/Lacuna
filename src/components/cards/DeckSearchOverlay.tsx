import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { m as motion } from 'motion/react';
import { updateCard } from '../../db/repository';
import { useToast } from '../ui/Toast';
import { cn } from '../ui/cn';
import {
  ChevronDownIcon,
  CloseIcon,
  ReplaceIcon,
} from '../ui/icons';
import type { Card } from '../../db/types';

interface Match {
  cardId: string;
  field: 'front' | 'back';
  index: number;
  text: string;
}

interface DeckSearchOverlayProps {
  cards: Card[];
  onClose: () => void;
  onQueryChange?: (query: string) => void;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function DeckSearchOverlay({ cards, onClose, onQueryChange }: DeckSearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [replacing, setReplacing] = useState(false);
  const { notify } = useToast();
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findInputRef.current?.focus();
  }, []);

  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);

  const matches = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const result: Match[] = [];
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(escapeRegex(trimmed), flags);

    for (const card of cards) {
      const frontMatches = [...card.front.matchAll(regex)];
      const backMatches = [...card.back.matchAll(regex)];
      for (const m of frontMatches) {
        result.push({
          cardId: card.id,
          field: 'front',
          index: m.index ?? 0,
          text: m[0],
        });
      }
      for (const m of backMatches) {
        result.push({
          cardId: card.id,
          field: 'back',
          index: m.index ?? 0,
          text: m[0],
        });
      }
    }
    return result;
  }, [cards, query, caseSensitive]);

  const currentMatch = matches[currentIndex] ?? null;

  useEffect(() => {
    setCurrentIndex(0);
  }, [query, caseSensitive]);

  const goToMatch = useCallback((delta: number) => {
    setCurrentIndex((prev) => {
      const next = prev + delta;
      if (next < 0) return matches.length - 1;
      if (next >= matches.length) return 0;
      return next;
    });
  }, [matches.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        goToMatch(-1);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        goToMatch(1);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goToMatch]);

  async function handleReplaceAll() {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || matches.length === 0) return;
    setReplacing(true);
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(escapeRegex(trimmedQuery), flags);
    const updated = new Map<string, { front: string; back: string }>();

    for (const card of cards) {
      const newFront = card.front.replace(regex, replacement);
      const newBack = card.back.replace(regex, replacement);
      if (newFront !== card.front || newBack !== card.back) {
        updated.set(card.id, { front: newFront, back: newBack });
      }
    }

    for (const [id, changes] of updated) {
      await updateCard(id, changes);
    }

    setReplacing(false);
    notify(
      `Replaced ${matches.length} occurrence${matches.length === 1 ? '' : 's'} in ${updated.size} card${updated.size === 1 ? '' : 's'}.`,
      'positive',
    );
    onClose();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.12 }}
      className="relative mb-4 overflow-hidden rounded-2xl border border-line-strong bg-surface p-4 shadow-sm shadow-black/[0.03]"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-3">
          {/* Find row */}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-line-strong px-3 py-2 focus-within:border-accent">
              <input
                ref={findInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find…"
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
              {matches.length > 0 && (
                <span className="text-xs text-ink-faint tabular">
                  {currentIndex + 1} / {matches.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => goToMatch(-1)}
              disabled={matches.length === 0}
              className="grid h-9 w-9 place-items-center rounded-lg border border-line-strong text-ink-soft transition-colors hover:bg-ink/5 disabled:opacity-40"
              title="Previous match (Shift+Enter)"
            >
              <ChevronDownIcon width={16} height={16} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => goToMatch(1)}
              disabled={matches.length === 0}
              className="grid h-9 w-9 place-items-center rounded-lg border border-line-strong text-ink-soft transition-colors hover:bg-ink/5 disabled:opacity-40"
              title="Next match (Enter)"
            >
              <ChevronDownIcon width={16} height={16} />
            </button>
          </div>

          {/* Replace row */}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-line-strong px-3 py-2 focus-within:border-accent">
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="Replace with…"
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleReplaceAll()}
              disabled={matches.length === 0 || replacing}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
                matches.length > 0 && !replacing
                  ? 'border-accent bg-accent-soft text-accent hover:bg-accent/20'
                  : 'border-line-strong text-ink-faint opacity-40',
              )}
              title="Replace all"
            >
              <ReplaceIcon width={15} height={15} />
              Replace all
            </button>
          </div>

          {/* Options + current match preview */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-line accent-accent"
              />
              Match case
            </label>
            {currentMatch && (
              <span className="text-xs text-ink-faint">
                Match in {currentMatch.field} of card{' '}
                {cards.find((c) => c.id === currentMatch.cardId)?.front.slice(0, 40) ?? '…'}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink"
          title="Close (Esc)"
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>
    </motion.div>
  );
}
