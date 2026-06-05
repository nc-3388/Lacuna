import { useEffect, useMemo, useState } from 'react';
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
import {
  CardsIcon,
  ChartIcon,
  ChevronLeftIcon,
  PlayIcon,
  SettingsIcon,
} from '../components/ui/icons';
import { cn } from '../components/ui/cn';
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

  // Distinct tags across the deck, for the filter row.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of cards ?? []) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort();
  }, [cards]);

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

  if (deck === undefined || cards === undefined) {
    return <div className="p-10 text-ink-faint">Loading…</div>;
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

  // Progress reflects the cards actually in play (suspended/buried are excluded).
  const progress = progressValue(availableCards(cards), deck);

  // The active tag filter narrows both the visible list and the study session.
  const visibleTag = activeTag && allTags.includes(activeTag) ? activeTag : null;
  const visibleCards = visibleTag
    ? cards.filter((c) => (c.tags ?? []).includes(visibleTag))
    : cards;
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
          <PassedExamBanner key="archived" tone="archived">
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
          <PassedExamBanner key="passed" tone="passed">
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
      <div className="mb-6 flex gap-1 border-b border-line">
        <TabButton active={tab === 'cards'} onClick={() => setTab('cards')} icon={<CardsIcon width={16} height={16} />}>
          Cards
        </TabButton>
        <TabButton
          active={tab === 'analytics'}
          onClick={() => setTab('analytics')}
          icon={<ChartIcon width={16} height={16} />}
        >
          Analytics
        </TabButton>
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {tab === 'cards' ? (
          <>
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
            <CardList
              cards={visibleCards}
              deck={deck}
              allDecks={allDecks ?? []}
              onNewCard={() => navigate(`/deck/${deck.id}/cards/new`)}
              onEditCard={(card: Card) =>
                navigate(`/deck/${deck.id}/cards/${card.id}/edit`)
              }
            />
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
}: {
  tone: 'passed' | 'archived';
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
      animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
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
}: {
  deck: Deck;
  onProceed: () => void;
  onClose: () => void;
}) {
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
      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
      animate={{ opacity: 1, height: 'auto', marginBottom: 24 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className="rounded-2xl border border-accent/40 bg-accent-soft/40 p-5">
        <h2 className="mb-1 font-display text-xl">When is your exam?</h2>
        <p className="mb-4 text-sm text-ink-soft">
          Lacuna schedules every card to peak on your exam day. Set the real date and time
          so the queue and progress bar are accurate.
        </p>
        <label className="block max-w-sm text-sm text-ink-soft">
          Exam date and time
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-accent"
          />
        </label>
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

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
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
          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"
        />
      )}
    </button>
  );
}
