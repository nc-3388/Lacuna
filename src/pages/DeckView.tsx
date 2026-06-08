import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  useCards,
  useDeck,
  useDecks,
  useSessionHistory,
} from '../state/useData';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { ProgressBar } from '../components/ui/ProgressBar';
import { CardList } from '../components/cards/CardList';
import { DeckAnalytics } from '../components/analytics/DeckAnalytics';
import { archiveDeck, unarchiveDeck, updateDeck } from '../db/repository';
import {
  progressDescription,
  progressHeading,
  progressValue,
} from '../fsrs/objective';
import { examHasPassed, MAINTENANCE_HORIZON_DAYS } from '../fsrs/horizon';
import { examEveAvailable, EXAM_EVE_WINDOW_HOURS } from '../fsrs/cram';
import { availableCards } from '../fsrs/eligibility';
import { useToast } from '../components/ui/Toast';
import {
  formatDateTime,
  fromDateTimeLocalValue,
  relativeExam,
  toDateTimeLocalValue,
} from '../utils/datetime';
import { DateTimePicker } from '../components/ui/DateTimePicker';
import {
  CardsIcon,
  ChartIcon,
  ChevronLeftIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from '../components/ui/icons';
import { searchCards, type CardFilter } from '../db/search';
import { cn } from '../components/ui/cn';
import { useMotionSpeed, speedMultiplier } from '../state/motionSpeed';
import type { Card, Deck } from '../db/types';

type Tab = 'cards' | 'analytics';

export function DeckView() {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const deck = useDeck(deckId);
  const cards = useCards(deckId);
  const allDecks = useDecks();
  const history = useSessionHistory(deckId);
  const { notify } = useToast();

  const [tab, setTab] = useState<Tab>('cards');
  const [examBannerOpen, setExamBannerOpen] = useState(false);
  const [postExamDismissed, setPostExamDismissed] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sortMode, setSortMode] = useState<'due' | 'created' | 'stability' | 'alpha'>('due');
  const [filters, setFilters] = useState<Set<CardFilter>>(new Set());
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);

  // Distinct tags across the deck, for the filter row.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards ?? []) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort();
  }, [cards]);

  // Debounce search input so filtering/sorting doesn't run on every keystroke.
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 180);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // Deck-scoped shortcut: N starts a new card. Ignored while typing in a field so it
  // never hijacks the tag filter or the exam-date input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return;
      if (e.key.toLowerCase() === 'n' && deckId) {
        e.preventDefault();
        navigate(`/deck/${deckId}/cards/new`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deckId, navigate]);

  // Progress reflects the cards actually in play (suspended/buried are excluded).
  const progress = deck && cards ? progressValue(availableCards(cards), deck) : 0;

  // The active tag filter narrows both the visible list and the study session.
  const visibleTag = activeTag && allTags.includes(activeTag) ? activeTag : null;

  // Deck-scoped search: text + structured filters + sort.
  const searchedCards = useMemo(() => {
    if (!cards) return [];
    let pool = visibleTag
      ? cards.filter((c) => (c.tags ?? []).includes(visibleTag))
      : [...cards];

    // Apply text query and inline operators.
    const trimmed = debouncedQuery.trim();
    if (trimmed || filters.size > 0) {
      const hits = searchCards(trimmed, pool, deck ? [deck] : [], {
        filters: [...filters],
        parseQuery: true,
      });
      pool = hits.map((h) => h.card);
    }

    // Sort.
    switch (sortMode) {
      case 'due':
        pool.sort((a, b) => {
          const ad = a.due ?? Number.MAX_SAFE_INTEGER;
          const bd = b.due ?? Number.MAX_SAFE_INTEGER;
          return ad - bd;
        });
        break;
      case 'created':
        pool.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'stability':
        pool.sort((a, b) => (b.stability ?? 0) - (a.stability ?? 0));
        break;
      case 'alpha':
        pool.sort((a, b) => a.front.localeCompare(b.front));
        break;
    }
    return pool;
  }, [cards, deck, filters, debouncedQuery, sortMode, visibleTag]);

  if (deck === undefined || cards === undefined) {
    return <DeckViewSkeleton />;
  }
  if (deck === null) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
        className="p-10"
      >
        <p className="mb-4 text-ink-soft">This deck could not be found.</p>
        <Link to="/" className="text-accent underline">
          Back to dashboard
        </Link>
      </motion.div>
    );
  }

  const studyPath = `/deck/${deck.id}/learn${
    visibleTag ? `?tag=${encodeURIComponent(visibleTag)}` : ''
  }`;

  function startStudy() {
    if (!cards?.length) return;
    if (!deck?.examDatePromptDismissed) {
      setExamBannerOpen(true);
    } else {
      navigate(studyPath);
    }
  }

  function toggleFilter(value: CardFilter) {
    setFilters((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      {/* Breadcrumb */}
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-faint transition-colors hover:text-ink"
      >
        <ChevronLeftIcon width={16} height={16} />
        All decks
      </Link>

      {/* Header */}
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 text-sm uppercase tracking-[0.16em] text-ink-faint">
              Exam {relativeExam(deck.examDate)} · {formatDateTime(deck.examDate)}
            </div>
            <h1 className="font-display text-4xl tracking-tight md:text-5xl">
              {deck.name}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => navigate(`/deck/${deck.id}/settings`)}
              aria-label="Deck settings"
              title="Deck settings"
            >
              <SettingsIcon width={18} height={18} />
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={startStudy}
              disabled={cards.length === 0}
            >
              <PlayIcon width={18} height={18} />
              Study
            </Button>
          </div>
        </div>

        {/* Mastery summary */}
        <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-ink-soft">{progressHeading(deck)}</span>
            <span className="tabular font-medium text-ink">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <ProgressBar value={progress} />
          <p className="mt-3 text-xs text-ink-faint">{progressDescription(deck)}</p>
        </div>
      </header>

      {/* Passed-exam / archived state: surfaced before study can resume */}
      <AnimatePresence>
        {deck.archived ? (
          <PassedExamBanner key="archived" tone="archived" motionMultiplier={m}>
            <h2 className="mb-1 font-display text-xl">This deck is archived</h2>
            <p className="mb-4 text-sm text-ink-soft">
              It is kept in full but hidden from active study and from your totals on the
              dashboard. Restore it to bring it back into rotation.
            </p>
            <Button
              variant="primary"
              onClick={async () => {
                await unarchiveDeck(deck.id);
                notify('Deck restored to active study.', 'positive');
              }}
            >
              Restore to active study
            </Button>
          </PassedExamBanner>
        ) : examHasPassed(deck) && !postExamDismissed ? (
          <PassedExamBanner key="passed" tone="passed" motionMultiplier={m}>
            <h2 className="mb-1 font-display text-xl">This exam date has passed</h2>
            <p className="mb-4 text-sm text-ink-soft">
              Scheduling no longer has a deadline to aim at. Choose what to do next. If you
              keep revising, Lacuna maintains your target retention against a rolling{' '}
              {MAINTENANCE_HORIZON_DAYS}-day horizon instead of a fixed date.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => navigate(`/deck/${deck.id}/settings`)}>
                Set a new exam date
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  await archiveDeck(deck.id);
                  notify('Deck archived.', 'neutral');
                }}
              >
                Archive deck
              </Button>
              <Button variant="ghost" onClick={() => setPostExamDismissed(true)}>
                Keep revising
              </Button>
            </div>
          </PassedExamBanner>
        ) : null}
      </AnimatePresence>

      {/* Inline exam-date confirmation, shown the first time a deck is studied */}
      <AnimatePresence>
        {examBannerOpen && (
          <ExamDateBanner
            deck={deck}
            onProceed={() => navigate(studyPath)}
            onClose={() => setExamBannerOpen(false)}
            motionMultiplier={m}
          />
        )}
      </AnimatePresence>

      {/* Exam-eve cram: an explicit mode offered only inside the final window */}
      {!deck.archived && examEveAvailable(deck) && cards.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl">Exam-eve cram</h2>
            <p className="text-sm text-ink-soft">
              Your exam is within {EXAM_EVE_WINDOW_HOURS} hours. Cram mode puts your weakest
              cards first to get as many over the line as possible. It trades long-term
              retention for exam-day coverage, so use it only for the final push.
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            onClick={() => navigate(`${studyPath}${visibleTag ? '&' : '?'}mode=cram`)}
          >
            <PlayIcon width={18} height={18} />
            Start cram
          </Button>
        </div>
      )}

      {/* Tabs */}
      <motion.div layout transition={{ layout: { duration: 0.18 * m, ease: [0.16, 1, 0.3, 1] } }} className="mb-6 flex gap-1 border-b border-line">
        <TabButton active={tab === 'cards'} onClick={() => setTab('cards')} icon={<CardsIcon width={16} height={16} />} motionMultiplier={m}>
          Cards
        </TabButton>
        <TabButton
          active={tab === 'analytics'}
          onClick={() => setTab('analytics')}
          icon={<ChartIcon width={16} height={16} />}
          motionMultiplier={m}
        >
          Analytics
        </TabButton>
      </motion.div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
      >
        {tab === 'cards' ? (
          <>
            {/* Search bar + sort + filters */}
            <div className="mb-4 flex flex-col gap-3">
              <div className="flex items-center gap-3 rounded-xl border border-line-strong bg-surface px-4 py-2.5 focus-within:border-accent">
                <SearchIcon width={18} height={18} className="text-ink-faint" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search cards… (try tag:chemistry or is:leech)"
                  className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-xs text-ink-faint hover:text-ink"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-soft outline-none focus:border-accent"
                >
                  <option value="due">Sort by due date</option>
                  <option value="created">Sort by created</option>
                  <option value="stability">Sort by stability</option>
                  <option value="alpha">Sort A–Z</option>
                </select>
                <FilterChip
                  label="Due"
                  active={filters.has('due')}
                  onClick={() => toggleFilter('due')}
                />
                <FilterChip
                  label="New"
                  active={filters.has('new')}
                  onClick={() => toggleFilter('new')}
                />
                <FilterChip
                  label="Leeches"
                  active={filters.has('leech')}
                  onClick={() => toggleFilter('leech')}
                />
                <FilterChip
                  label="Flagged"
                  active={filters.has('flagged')}
                  onClick={() => toggleFilter('flagged')}
                />
                <FilterChip
                  label="Suspended"
                  active={filters.has('suspended')}
                  onClick={() => toggleFilter('suspended')}
                />
                {filters.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilters(new Set())}
                    className="text-xs text-ink-faint hover:text-ink"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {allTags.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    !visibleTag
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line text-ink-soft hover:border-line-strong',
                  )}
                >
                  All
                </button>
                {allTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setActiveTag(t)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      visibleTag === t
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line text-ink-soft hover:border-line-strong',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            {searchedCards.length === 0 ? (
              <EmptyCardState
                hasQuery={searchQuery.trim().length > 0 || filters.size > 0}
                onNewCard={() => navigate(`/deck/${deck.id}/cards/new`)}
                motionMultiplier={m}
              />
            ) : (
              <CardList
                cards={searchedCards}
                deck={deck}
                allDecks={allDecks ?? []}
                onNewCard={() => navigate(`/deck/${deck.id}/cards/new`)}
                onEditCard={(card: Card) =>
                  navigate(`/deck/${deck.id}/cards/${card.id}/edit`)
                }
              />
            )}
          </>
        ) : (
          <DeckAnalytics cards={cards} history={history ?? []} />
        )}
      </motion.div>
    </div>
  );
}

/** Shared shell for the passed-exam and archived notices. */
function PassedExamBanner({
  tone,
  children,
  motionMultiplier,
}: {
  tone: 'passed' | 'archived';
  children: React.ReactNode;
  motionMultiplier?: number;
}) {
  const m = motionMultiplier ?? 1;
  return (
    <motion.section
      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
      animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.16 * m, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div
        className={cn(
          'rounded-2xl border p-5',
          tone === 'passed'
            ? 'border-amber-500/40 bg-amber-500/5'
            : 'border-line-strong bg-surface',
        )}
      >
        {children}
      </div>
    </motion.section>
  );
}

/**
 * Inline replacement for the old exam-date modal. Slides in when the user first studies a
 * deck, letting them confirm the real exam date (or skip) before the Learn session opens.
 */
function ExamDateBanner({
  deck,
  onProceed,
  onClose,
  motionMultiplier,
}: {
  deck: Deck;
  onProceed: () => void;
  onClose: () => void;
  motionMultiplier?: number;
}) {
  const m = motionMultiplier ?? 1;
  const [value, setValue] = useState(() => toDateTimeLocalValue(deck.examDate));
  const [dontAsk, setDontAsk] = useState(false);

  async function handleSet() {
    const ms = fromDateTimeLocalValue(value);
    await updateDeck(deck.id, {
      examDate: Number.isNaN(ms) ? deck.examDate : ms,
      examDatePromptDismissed: true,
    });
    onClose();
    onProceed();
  }

  async function handleSkip() {
    if (dontAsk) {
      await updateDeck(deck.id, { examDatePromptDismissed: true });
    }
    onClose();
    onProceed();
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.2 * m, ease: [0.16, 1, 0.3, 1] }}
      className="mb-6"
    >
      <div className="rounded-2xl border border-accent/40 bg-accent-soft/40 p-5">
        <h2 className="mb-1 font-display text-xl">When is your exam?</h2>
        <p className="mb-4 text-sm text-ink-soft">
          Lacuna schedules every card to peak on your exam day. Set the real date and time
          so the queue and progress bar are accurate.
        </p>
        <div className="max-w-sm">
          <DateTimePicker
            value={fromDateTimeLocalValue(value) || deck.examDate}
            onChange={(ms) => setValue(toDateTimeLocalValue(ms))}
            label="Exam date and time"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={handleSet}>
            Set date and study
          </Button>
          <Button variant="ghost" onClick={handleSkip}>
            Not now
          </Button>
          <div className="ml-auto">
            <Toggle
              checked={dontAsk}
              onChange={setDontAsk}
              label="Don't ask again for this deck"
            />
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function DeckViewSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      <div className="mb-6 h-4 w-24 animate-pulse rounded bg-ink/10" />
      <div className="mb-8">
        <div className="mb-1 h-3 w-40 animate-pulse rounded bg-ink/10" />
        <div className="h-10 w-64 animate-pulse rounded bg-ink/10 md:w-80" />
      </div>
      <div className="mb-6 rounded-2xl border border-line bg-surface p-5">
        <div className="mb-2 flex justify-between">
          <div className="h-4 w-32 animate-pulse rounded bg-ink/10" />
          <div className="h-4 w-10 animate-pulse rounded bg-ink/10" />
        </div>
        <div className="h-2 w-full animate-pulse rounded-full bg-ink/10" />
        <div className="mt-3 h-3 w-48 animate-pulse rounded bg-ink/10" />
      </div>
      <div className="mb-6 flex gap-1 border-b border-line pb-2">
        <div className="h-8 w-20 animate-pulse rounded bg-ink/10" />
        <div className="h-8 w-24 animate-pulse rounded bg-ink/10" />
      </div>
      <div className="mb-4 flex flex-col gap-3">
        <div className="h-10 w-full animate-pulse rounded-xl bg-ink/10" />
        <div className="flex gap-2">
          <div className="h-7 w-24 animate-pulse rounded-lg bg-ink/10" />
          <div className="h-7 w-20 animate-pulse rounded-lg bg-ink/10" />
          <div className="h-7 w-24 animate-pulse rounded-lg bg-ink/10" />
        </div>
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3">
            <div className="h-4 w-4 animate-pulse rounded bg-ink/10" />
            <div className="h-4 flex-1 animate-pulse rounded bg-ink/10" />
            <div className="h-4 w-20 animate-pulse rounded bg-ink/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
  motionMultiplier,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  motionMultiplier?: number;
}) {
  const m = motionMultiplier ?? 1;
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-2 px-4 py-2.5 text-sm transition-colors',
        active ? 'text-accent' : 'text-ink-soft hover:text-ink',
      )}
    >
      {icon}
      {children}
      {active && (
        <motion.span
          layoutId="deck-tab"
          transition={{ duration: 0.25 * m, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"
        />
      )}
    </button>
  );
}

function EmptyCardState({
  hasQuery,
  onNewCard,
  motionMultiplier,
}: {
  hasQuery: boolean;
  onNewCard: () => void;
  motionMultiplier?: number;
}) {
  const m = motionMultiplier ?? 1;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 * m, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/50 py-16 text-center"
    >
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
        <CardsIcon width={22} height={22} />
      </div>
      <h3 className="mb-1 font-display text-xl">
        {hasQuery ? 'No cards match' : 'No cards yet'}
      </h3>
      <p className="mb-6 max-w-sm text-sm text-ink-soft">
        {hasQuery
          ? 'Try clearing your search or filters to see more cards.'
          : 'This deck is empty. Add your first card to start revising.'}
      </p>
      {!hasQuery && (
        <Button variant="primary" onClick={onNewCard}>
          <PlusIcon width={18} height={18} />
          New card
        </Button>
      )}
    </motion.div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      whileTap={{ scale: 0.92 }}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-all duration-150',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line text-ink-soft hover:border-line-strong',
      )}
    >
      {label}
    </motion.button>
  );
}
