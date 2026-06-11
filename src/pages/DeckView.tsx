import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, m as motion, useMotionValue, useSpring, useTransform } from 'motion/react';
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
import { DeckSearchOverlay } from '../components/cards/DeckSearchOverlay';
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
import { hapticMedium } from '../utils/haptic';
import {
  formatDateTime,
  fromDateTimeLocalValue,
  getLocalTimeZone,
  relativeExam,
  toDateTimeLocalValue,
} from '../utils/datetime';
import { DateTimePicker } from '../components/ui/DateTimePicker';
import {
  CardsIcon,
  ChartIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ClockIcon,
  FlameIcon,
  FlagIcon,
  InfoIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  CheckIcon,
} from '../components/ui/icons';
import { searchCards, type CardFilter } from '../db/search';
import { cn } from '../components/ui/cn';
import { useMotionSpeed, speedMultiplier } from '../state/motionSpeed';
import { useIsTouchMode } from '../state/inputMode';
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
  const [showFindOverlay, setShowFindOverlay] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [studyMenuOpen, setStudyMenuOpen] = useState(false);
  const studyMenuRef = useRef<HTMLDivElement>(null);
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const isTouchMode = useIsTouchMode();

  // Swipe-to-study gesture state
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeCommittedRef = useRef(false);

  // Page-wide rightward swipe overlay
  const swipeOverlayX = useMotionValue(0);
  const swipeOverlaySpring = useSpring(swipeOverlayX, { stiffness: 420, damping: 30 });
  const swipeOverlayOpacity = useTransform(swipeOverlaySpring, [0, 60, 120], [0, 0.5, 1]);
  const swipeOverlayScale = useTransform(swipeOverlaySpring, [0, 60, 120], [0.85, 1, 1.05]);

  // Mastery card gesture state
  const masteryRef = useRef<HTMLDivElement>(null);
  const masteryDragX = useMotionValue(0);
  const masteryDragY = useMotionValue(0);
  const masterySpringX = useSpring(masteryDragX, { stiffness: 400, damping: 30 });
  const masterySpringY = useSpring(masteryDragY, { stiffness: 400, damping: 30 });
  const masterySwipeRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    isSwipe: false,
    direction: null as 'right' | 'up' | 'down' | null,
  });
  const MASTERY_THRESHOLD = 50;

  const masteryRightOpacity = useTransform(masterySpringX, [0, MASTERY_THRESHOLD, MASTERY_THRESHOLD * 1.5], [0, 0.8, 1]);
  const masteryUpOpacity = useTransform(masterySpringY, [0, -MASTERY_THRESHOLD, -MASTERY_THRESHOLD * 1.5], [0, 0.8, 1]);
  const masteryDownOpacity = useTransform(masterySpringY, [0, MASTERY_THRESHOLD, MASTERY_THRESHOLD * 1.5], [0, 0.8, 1]);

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
      if (e.repeat || e.altKey) return;
      // Ctrl+F / Cmd+F opens the find-and-replace overlay.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowFindOverlay(true);
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
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

    // Apply find-and-replace query when overlay is open.
    const findTrimmed = findQuery.trim();
    if (showFindOverlay && findTrimmed) {
      const q = findTrimmed.toLowerCase();
      pool = pool.filter((c) =>
        c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q),
      );
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
  }, [cards, deck, filters, debouncedQuery, sortMode, visibleTag, showFindOverlay, findQuery]);

  const studyPath = deck
    ? `/deck/${deck.id}/learn${visibleTag ? `?tag=${encodeURIComponent(visibleTag)}` : ''}`
    : '';

  const handleRefresh = useCallback(() => {
    notify('Refreshed.', 'positive');
  }, [notify]);

  const startStudy = useCallback(() => {
    if (!cards?.length) return;
    if (!deck?.examDatePromptDismissed) {
      setExamBannerOpen(true);
    } else {
      navigate(studyPath);
    }
  }, [cards, deck, navigate, studyPath]);

  // Close the study menu when clicking outside.
  useEffect(() => {
    if (!studyMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (studyMenuRef.current && !studyMenuRef.current.contains(e.target as Node)) {
        setStudyMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [studyMenuOpen]);

  const handleMasteryPointerDown = useCallback((e: React.PointerEvent) => {
    if (!isTouchMode) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, [role="button"], textarea, [contenteditable]')) return;
    e.stopPropagation();
    masterySwipeRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      isSwipe: false,
      direction: null,
    };
    masteryRef.current?.setPointerCapture(e.pointerId);
  }, [isTouchMode]);

  const handleMasteryPointerMove = useCallback((e: React.PointerEvent) => {
    if (!masterySwipeRef.current.dragging) return;
    const dx = e.clientX - masterySwipeRef.current.startX;
    const dy = e.clientY - masterySwipeRef.current.startY;

    if (!masterySwipeRef.current.isSwipe && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      masterySwipeRef.current.isSwipe = true;
      if (Math.abs(dx) > Math.abs(dy)) {
        masterySwipeRef.current.direction = 'right';
      } else {
        masterySwipeRef.current.direction = dy > 0 ? 'down' : 'up';
      }
    }

    if (!masterySwipeRef.current.isSwipe) return;
    e.preventDefault();
    e.stopPropagation();

    if (masterySwipeRef.current.direction === 'right') {
      masteryDragX.set(Math.max(0, dx));
    } else if (masterySwipeRef.current.direction === 'up') {
      masteryDragY.set(Math.min(0, dy));
    } else if (masterySwipeRef.current.direction === 'down') {
      masteryDragY.set(Math.max(0, dy));
    }
  }, [masteryDragX, masteryDragY]);

  const handleMasteryPointerUp = useCallback((e: React.PointerEvent) => {
    if (!masterySwipeRef.current.dragging) return;
    e.stopPropagation();
    masteryRef.current?.releasePointerCapture(e.pointerId);
    masterySwipeRef.current.dragging = false;

    const wasSwipe = masterySwipeRef.current.isSwipe;
    const direction = masterySwipeRef.current.direction;
    masterySwipeRef.current.isSwipe = false;
    masterySwipeRef.current.direction = null;

    if (!wasSwipe) {
      masteryDragX.set(0);
      masteryDragY.set(0);
      return;
    }

    if (direction === 'right' && masteryDragX.get() > MASTERY_THRESHOLD) {
      hapticMedium();
      masteryDragX.set(0);
      startStudy();
    } else if (direction === 'up' && masteryDragY.get() < -MASTERY_THRESHOLD) {
      hapticMedium();
      masteryDragY.set(0);
      startStudy();
    } else if (direction === 'down' && masteryDragY.get() > MASTERY_THRESHOLD) {
      hapticMedium();
      masteryDragY.set(0);
      handleRefresh();
    } else {
      masteryDragX.set(0);
      masteryDragY.set(0);
    }
  }, [masteryDragX, masteryDragY, startStudy, handleRefresh]);

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

  // Swipe-to-study: rightward swipe on the main container starts a study session.
  const SWIPE_THRESHOLD = 80;
  const SWIPE_MAX_Y = 60;

  const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [contenteditable]';

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(INTERACTIVE_SELECTOR)) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: e.clientX, y: e.clientY };
    swipeCommittedRef.current = false;
    if (isTouchMode) {
      swipeOverlayX.set(0);
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!swipeStartRef.current || swipeCommittedRef.current) return;
    const dx = e.clientX - swipeStartRef.current.x;
    const dy = e.clientY - swipeStartRef.current.y;
    if (Math.abs(dy) > SWIPE_MAX_Y) {
      swipeStartRef.current = null;
      if (isTouchMode) swipeOverlayX.set(0);
      return;
    }
    if (isTouchMode && dx > 0) {
      swipeOverlayX.set(Math.min(dx, 160));
    }
    if (dx > SWIPE_THRESHOLD) {
      swipeCommittedRef.current = true;
      swipeStartRef.current = null;
      if (isTouchMode) swipeOverlayX.set(0);
      hapticMedium();
      startStudy();
    }
  }

  function handlePointerUp() {
    swipeStartRef.current = null;
    swipeCommittedRef.current = false;
    if (isTouchMode) swipeOverlayX.set(0);
  }

  return (
    <div
      className="relative mx-auto max-w-5xl px-6 py-8 md:px-10"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Rightward swipe overlay */}
      {isTouchMode && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-1/2 z-50 flex -translate-y-1/2 items-center gap-3 rounded-l-2xl bg-accent px-5 py-4 text-accent-fg shadow-xl"
          style={{ x: -swipeOverlaySpring, opacity: swipeOverlayOpacity, scale: swipeOverlayScale }}
        >
          <PlayIcon width={22} height={22} />
          <span className="text-sm font-medium">Study</span>
        </motion.div>
      )}

      {/* Breadcrumb */}
      <Link
        to="/"
        className="mb-6 inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-faint transition-colors hover:text-ink active:text-ink"
      >
        <ChevronLeftIcon width={16} height={16} />
        All decks
      </Link>

      {/* Header */}
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 text-sm uppercase tracking-[0.16em] text-ink-faint">
              Exam {relativeExam(deck.examDate, Date.now(), deck.timeZone)} · {formatDateTime(deck.examDate, deck.timeZone)}
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
            <div ref={studyMenuRef} className="relative flex items-center">
              <Button
                variant="primary"
                size="lg"
                onClick={startStudy}
                disabled={cards.length === 0}
                className="rounded-r-none"
              >
                <PlayIcon width={18} height={18} />
                Study
              </Button>
              <button
                type="button"
                onClick={() => setStudyMenuOpen((v) => !v)}
                aria-label="Study options"
                title="Study options"
                disabled={cards.length === 0}
                className="flex h-11 items-center justify-center rounded-r-lg border-l border-accent-fg/20 bg-accent px-2 text-accent-fg transition-colors hover:bg-accent/90 active:bg-accent/80 disabled:opacity-50"
              >
                <ChevronDownIcon width={16} height={16} />
              </button>
              <AnimatePresence>
                {studyMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.12 * m }}
                    className="absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl shadow-black/10"
                  >
                    <StudyMenuItem
                      icon={<PlayIcon width={16} height={16} />}
                      label="Study all cards"
                      onClick={() => { setStudyMenuOpen(false); startStudy(); }}
                    />
                    <StudyMenuItem
                      icon={<CheckIcon width={16} height={16} />}
                      label="Simple learn"
                      onClick={() => {
                        setStudyMenuOpen(false);
                        navigate(`${studyPath}${visibleTag ? '&' : '?'}mode=simple`);
                      }}
                    />
                    <StudyMenuItem
                      icon={<FlameIcon width={16} height={16} />}
                      label="Cram mode"
                      onClick={() => {
                        setStudyMenuOpen(false);
                        navigate(`${studyPath}${visibleTag ? '&' : '?'}mode=cram`);
                      }}
                    />
                    <StudyMenuItem
                      icon={<ClockIcon width={16} height={16} />}
                      label="Study due cards"
                      onClick={() => {
                        setStudyMenuOpen(false);
                        navigate(`/deck/${deck.id}/learn?${visibleTag ? `tag=${encodeURIComponent(visibleTag)}&` : ''}filter=due`);
                      }}
                    />
                    <StudyMenuItem
                      icon={<SparklesIcon width={16} height={16} />}
                      label="Study new cards"
                      onClick={() => {
                        setStudyMenuOpen(false);
                        navigate(`/deck/${deck.id}/learn?${visibleTag ? `tag=${encodeURIComponent(visibleTag)}&` : ''}filter=new`);
                      }}
                    />
                    <StudyMenuItem
                      icon={<InfoIcon width={16} height={16} />}
                      label="Study leech cards"
                      onClick={() => {
                        setStudyMenuOpen(false);
                        navigate(`/deck/${deck.id}/learn?${visibleTag ? `tag=${encodeURIComponent(visibleTag)}&` : ''}filter=leech`);
                      }}
                    />
                    <StudyMenuItem
                      icon={<FlagIcon width={16} height={16} />}
                      label="Study flagged cards"
                      onClick={() => {
                        setStudyMenuOpen(false);
                        navigate(`/deck/${deck.id}/learn?${visibleTag ? `tag=${encodeURIComponent(visibleTag)}&` : ''}filter=flagged`);
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Mastery summary */}
        <div
          ref={masteryRef}
          className="relative mt-6 rounded-2xl border border-line bg-surface p-5"
          style={{ touchAction: isTouchMode ? 'none' : 'pan-y' }}
          onPointerDown={handleMasteryPointerDown}
          onPointerMove={handleMasteryPointerMove}
          onPointerUp={handleMasteryPointerUp}
          onPointerCancel={handleMasteryPointerUp}
        >
          {isTouchMode && (
            <>
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 z-0 flex items-center rounded-r-2xl bg-accent/90 px-3 text-accent-fg"
                style={{ opacity: masteryRightOpacity, width: 80 }}
              >
                <PlayIcon width={20} height={20} />
              </motion.div>
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-0 flex items-center justify-center gap-2 rounded-t-2xl bg-accent/90 py-3 text-accent-fg"
                style={{ opacity: masteryUpOpacity }}
              >
                <PlayIcon width={18} height={18} />
                <span className="text-xs font-medium">Study</span>
              </motion.div>
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex items-center justify-center gap-2 rounded-b-2xl bg-ink/10 py-3 text-ink"
                style={{ opacity: masteryDownOpacity }}
              >
                <span className="text-xs font-medium">Refresh</span>
              </motion.div>
            </>
          )}
          <motion.div style={{ x: masterySpringX, y: masterySpringY }} className="relative z-10">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-ink-soft">{progressHeading(deck)}</span>
              <span className="tabular font-medium text-ink">
                {Math.round(progress * 100)}%
              </span>
            </div>
            <ProgressBar value={progress} />
            <p className="mt-3 text-xs text-ink-faint">{progressDescription(deck)}</p>
          </motion.div>
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
            {/* Find-and-replace overlay */}
            <AnimatePresence>
              {showFindOverlay && deck && cards && (
                <DeckSearchOverlay
                  cards={cards}
                  onClose={() => setShowFindOverlay(false)}
                  onQueryChange={setFindQuery}
                />
              )}
            </AnimatePresence>

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
  const [value, setValue] = useState(() => toDateTimeLocalValue(deck.examDate, deck.timeZone));
  const [dontAsk, setDontAsk] = useState(false);

  async function handleSet() {
    const ms = fromDateTimeLocalValue(value, deck.timeZone);
    await updateDeck(deck.id, {
      examDate: Number.isNaN(ms) ? deck.examDate : ms,
      timeZone: deck.timeZone ?? getLocalTimeZone(),
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
            value={fromDateTimeLocalValue(value, deck.timeZone) || deck.examDate}
            onChange={(ms) => setValue(toDateTimeLocalValue(ms, deck.timeZone))}
            timeZone={deck.timeZone}
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
        'relative flex min-h-11 items-center gap-2 px-4 py-2.5 text-sm transition-colors',
        active ? 'text-accent' : 'text-ink-soft hover:text-ink active:text-ink',
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

function StudyMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-h-11 items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10"
    >
      <span className="shrink-0 text-ink-faint">{icon}</span>
      {label}
    </button>
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
        'min-h-11 rounded-full border px-3 py-1 text-xs transition-all duration-150',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line text-ink-soft hover:border-line-strong active:bg-ink/5',
      )}
    >
      {label}
    </motion.button>
  );
}
