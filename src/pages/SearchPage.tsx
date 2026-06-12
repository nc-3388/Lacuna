import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { m as motion } from 'motion/react';
import { useAllCards, useDecks } from '../state/useData';
import { plainPreview, searchCards, type CardFilter } from '../db/search';
import { cn } from '../components/ui/cn';
import { FlagIcon, SearchIcon, TagIcon, CardsIcon } from '../components/ui/icons';
import { useMotionSpeed, speedMultiplier } from '../state/motionSpeed';

/** The structured filters offered as quick chips, in display order. */
const FILTER_CHIPS: { value: CardFilter; label: string }[] = [
  { value: 'due', label: 'Due now' },
  { value: 'new', label: 'New' },
  { value: 'leech', label: 'Leeches' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'suspended', label: 'Suspended' },
];

/** Full-page search across every card in every deck. Shares the search core with the palette. */
export function SearchPage() {
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const decks = useDecks();
  const cards = useAllCards();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Set<CardFilter>>(new Set());

  const results = useMemo(
    () =>
      searchCards(query, cards ?? [], decks ?? [], {
        filters: [...filters],
      }),
    [query, cards, decks, filters],
  );

  function toggleFilter(value: CardFilter) {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  const trimmed = query.trim();
  const active = trimmed !== '' || filters.size > 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:px-10">
      <header className="relative mb-8 overflow-hidden rounded-2xl border border-line bg-surface p-6 md:p-8">
        <div className="absolute inset-0 bg-dot-grid opacity-40" aria-hidden="true" />
        <div className="relative">
          <p className="mb-1 text-sm uppercase tracking-[0.18em] text-ink-faint">Find</p>
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">Search</h1>
        </div>
      </header>

      <div className="mb-6 flex items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-3 shadow-sm transition-shadow focus-within:border-accent focus-within:shadow-md">
        <SearchIcon width={18} height={18} className="text-ink-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across every deck by content, deck name or tag…"
          className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-faint sm:block">
          Ctrl/Cmd+K
        </kbd>
      </div>

      {/* Smart-view filter chips: narrow the whole collection without a text query. */}
      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        {FILTER_CHIPS.map((chip, i) => {
          const on = filters.has(chip.value);
          return (
            <motion.button
              key={chip.value}
              type="button"
              onClick={() => toggleFilter(chip.value)}
              aria-pressed={on}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.14 * m, delay: i * 0.02 * m }}
              whileHover={{ y: -1, transition: { duration: 0.1 * m } }}
              whileTap={{ scale: 0.95 }}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                on
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-soft hover:border-line-strong',
              )}
            >
              {chip.label}
            </motion.button>
          );
        })}
        {filters.size > 0 && (
          <motion.button
            type="button"
            onClick={() => setFilters(new Set())}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.14 * m }}
            className="rounded-full px-2 py-1 text-xs text-ink-faint transition-colors hover:text-ink"
          >
            Clear
          </motion.button>
        )}
      </div>

      {!decks || !cards ? (
        <SearchSkeleton />
      ) : !active ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 * m }}
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/50 py-16 text-center"
        >
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent shadow-sm">
            <SearchIcon width={24} height={24} />
          </div>
          <h3 className="mb-2 font-display text-xl">Search across all cards</h3>
          <p className="max-w-sm text-sm text-ink-soft">
            Start typing to search the front, back, deck name and tags of every card, or pick a
            filter above to browse due, new, flagged, suspended or leech cards.
          </p>
        </motion.div>
      ) : results.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 * m }}
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/50 py-16 text-center"
        >
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent shadow-sm">
            <CardsIcon width={24} height={24} />
          </div>
          <h3 className="mb-2 font-display text-xl">No cards match</h3>
          <p className="max-w-sm text-sm text-ink-soft">
            No cards match{trimmed ? ` "${trimmed}"` : ' those filters'}.
            Try clearing your search or filters.
          </p>
        </motion.div>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-soft">
            {results.length} result{results.length === 1 ? '' : 's'}
          </p>
          <div className="grid gap-2">
            {results.map((hit) => (
              <motion.button
                key={hit.card.id}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16 * m }}
                onClick={() =>
                  navigate(`/deck/${hit.card.deckId}/cards/${hit.card.id}/edit`)
                }
                whileHover={{ y: -3, transition: { duration: 0.12 * m } }}
                className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 text-left shadow-sm transition-all duration-200 hover:border-line-strong hover:shadow-md hover:shadow-black/[0.04]"
              >
                <span className="text-sm text-ink">
                  {plainPreview(hit.card.front, 140) || '(empty front)'}
                </span>
                {hit.card.back.trim() && (
                  <span className="truncate text-sm text-ink-faint">
                    {plainPreview(hit.card.back, 140)}
                  </span>
                )}
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                  <span>{hit.deck.name}</span>
                  {hit.card.flagged && (
                    <FlagIcon width={12} height={12} className="text-accent" />
                  )}
                  {(hit.card.tags ?? []).length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <TagIcon width={12} height={12} />
                      {hit.card.tags!.join(', ')}
                    </span>
                  )}
                </span>
              </motion.button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4"
        >
          <div className="h-4 w-3/4 animate-pulse rounded bg-ink/10" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-ink/10" />
          <div className="mt-1 h-3 w-24 animate-pulse rounded bg-ink/10" />
        </div>
      ))}
    </div>
  );
}
