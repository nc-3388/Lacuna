import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { db } from '../db/schema';
import type { Card, Deck, Grade, UserPerformance } from '../db/types';
import {
  buryCard,
  recordReview,
  setCardFlag,
  suspendCard,
  undoReview,
} from '../db/repository';
import type { ReviewUndo } from '../db/repository';
import { emptyPerformance, gradeFromResponse, updatePerformance } from '../fsrs/grading';
import {
  applyCooldown,
  decrementCooldowns,
} from '../fsrs/cooldown';
import type { CooldownMap } from '../fsrs/cooldown';
import { progressHeading, progressNoun } from '../fsrs/objective';
import {
  makeSessionContext,
  selectNext,
  sessionComplete,
  sessionProgress,
} from '../fsrs/session';
import type { SessionContext } from '../fsrs/session';
import { startOfDay } from '../utils/datetime';
import { MS_PER_DAY } from '../fsrs/params';
import { CardContent } from '../components/cards/CardContent';
import { CardEditOverlay } from '../components/cards/CardEditOverlay';
import { KeyHints } from '../components/ui/KeyHints';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Button } from '../components/ui/Button';
import { Sidebar } from '../components/layout/Sidebar';
import { SessionReport } from '../components/learn/SessionReport';
import { useDistraction } from '../components/learn/useDistraction';
import type { SessionEvent, SessionSummary } from '../components/learn/types';
import { useGradingMode } from '../state/gradingMode';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  CheckIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  FlagIcon,
  KeyboardIcon,
  MenuIcon,
  MoreIcon,
  PauseIcon,
  UndoIcon,
} from '../components/ui/icons';

type Phase = 'loading' | 'question' | 'answer' | 'finished';

/** What undoing the most recent answer needs to restore (DB + in-session state). */
interface AnswerSnapshot {
  undo: ReviewUndo;
  cooldowns: CooldownMap;
  progressBefore: number;
  eventsLen: number;
  deckId: string;
}

export function LearnMode() {
  const { deckId } = useParams<{ deckId: string }>();
  const [searchParams] = useSearchParams();
  const tagFilter = searchParams.get('tag');
  const cramMode = searchParams.get('mode') === 'cram';
  const navigate = useNavigate();
  const distraction = useDistraction();
  const [gradingMode] = useGradingMode();

  const isGlobal = !deckId;

  const [phase, setPhase] = useState<Phase>('loading');
  // The deck a single-deck session is studying (null for the global session).
  const [singleDeck, setSingleDeck] = useState<Deck | null>(null);
  const [current, setCurrent] = useState<Card | null>(null);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // When set, the in-session edit overlay is open for the current card. While it is
  // open the FSRS response timer is paused (see openEdit/resumeTimer) so time spent
  // fixing a card never counts towards the invisible grade.
  const [editing, setEditing] = useState(false);
  // Focus mode hides the surrounding chrome for distraction-free review.
  const [focusMode, setFocusMode] = useState(false);
  // The keyboard-shortcuts cheatsheet (opened with ?).
  const [hintsOpen, setHintsOpen] = useState(false);
  // Navigation drawer — closed by default to keep Learn mode distraction-free,
  // opened on demand for quick navigation away without leaving the session UI.
  const [navOpen, setNavOpen] = useState(false);
  // A brief, non-blocking flash of colour the instant a card is graded — the small
  // tactile reward that makes answering feel responsive. Cleared on a short timer and
  // never delays the next card.
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const feedbackTimer = useRef<number | null>(null);

  // Session-only mutable state held in refs so it never triggers re-renders mid-card
  // and so the stable callbacks below always read current values (no stale closures).
  const cooldowns = useRef<CooldownMap>(new Map());
  const perfRef = useRef<Map<string, UserPerformance>>(new Map());
  const decksRef = useRef<Map<string, Deck>>(new Map());
  const ctxRef = useRef<SessionContext | null>(null);
  const cardsRef = useRef<Card[]>([]);
  const timerStart = useRef(0);
  const responseTime = useRef(0);
  // Elapsed thinking time captured when the edit overlay opens during the question
  // phase, so the timer can be rebased (not reset) when the overlay closes.
  const pausedElapsed = useRef(0);
  const events = useRef<SessionEvent[]>([]);
  const progressBefore = useRef(0);
  const lastAnswer = useRef<AnswerSnapshot | null>(null);
  // Guards against a double key-press / click submitting the same card twice.
  const submitting = useRef(false);

  const exitTo = isGlobal ? '/' : `/deck/${deckId}`;
  const backOut = useCallback(() => navigate(exitTo), [navigate, exitTo]);

  const objectiveLabel = useCallback(() => {
    if (singleDeck) return progressHeading(singleDeck);
    return 'Predicted readiness across all decks';
  }, [singleDeck]);

  const finish = useCallback(
    (reachedGoal: boolean) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const total = distraction.sessionMs();
      const focus =
        total <= 0
          ? 1
          : Math.max(0, Math.min(1, (total - distraction.blurredMs()) / total));
      setSummary({
        events: events.current,
        masteryBefore: progressBefore.current,
        masteryAfter: sessionProgress(cardsRef.current, ctx),
        objectiveLabel: objectiveLabel(),
        focusFraction: focus,
        reachedGoal,
      });
      setCanUndo(false);
      lastAnswer.current = null;      setPhase('finished');
    }, [objectiveLabel, distraction],
  );

  /** Present the next eligible card, or finish if the goal has been reached. */
  const serveNext = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (sessionComplete(cardsRef.current, ctx)) {
      finish(true);
      return;
    }
    const next = selectNext(cardsRef.current, ctx, cooldowns.current);
    if (!next) {
      finish(true);
      return;
    }
    setCurrent(next);
    setPhase('question');
    setMenuOpen(false);
    timerStart.current = performance.now();
    distraction.beginCard();
  }, [finish, distraction]);

  // Stable ref so the initial-load effect never re-runs just because serveNext's
  // callback identity changed (which would reset phase and undo reveal/exit).
  const serveNextRef = useRef(serveNext);
  serveNextRef.current = serveNext;

  // Initial load: read a static snapshot of the deck(s) so the session is stable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let decks: Deck[];
      let cards: Card[];
      if (deckId) {
        const d = await db.decks.get(deckId);
        if (!d) {
          navigate(`/deck/${deckId}`);
          return;
        }
        decks = [d];
        cards = await db.cards.where('deckId').equals(deckId).toArray();
        if (tagFilter) cards = cards.filter((c) => (c.tags ?? []).includes(tagFilter));
      } else {
        decks = await db.decks.toArray();
        cards = await db.cards.toArray();
      }
      if (cancelled) return;

      const perfs = await Promise.all(decks.map((d) => db.userPerformance.get(d.id)));
      const perfMap = new Map<string, UserPerformance>();
      decks.forEach((d, i) => perfMap.set(d.id, perfs[i] ?? emptyPerformance(d.id)));
      perfRef.current = perfMap;
      decksRef.current = new Map(decks.map((d) => [d.id, d]));
      const ctx = makeSessionContext(decks, cramMode ? 'cram' : 'objective');
      ctxRef.current = ctx;
      cardsRef.current = cards;
      setSingleDeck((prev) => {
        const next = deckId ? decks[0] : null;
        if (prev?.id === next?.id) return prev;
        return next;
      });

      if (decks.length === 0 || cards.length === 0) {
        if (deckId) {
          navigate(`/deck/${deckId}`);
          return;
        }
        // Global session with nothing to study: show a gentle finished screen.
        progressBefore.current = sessionProgress(cards, ctx);
        setSummary({
          events: [],
          masteryBefore: progressBefore.current,
          masteryAfter: progressBefore.current,
          objectiveLabel: 'Predicted readiness across all decks',
          focusFraction: 1,
          reachedGoal: true,
        });
        setPhase('finished');
        return;
      }

      progressBefore.current = sessionProgress(cards, ctx);
      setProgress(progressBefore.current);

      if (sessionComplete(cards, ctx)) {
        setSummary({
          events: [],
          masteryBefore: progressBefore.current,
          masteryAfter: progressBefore.current,
          objectiveLabel: deckId ? progressHeading(decks[0]) : 'Predicted readiness across all decks',
          focusFraction: 1,
          reachedGoal: true,
        });
        setPhase('finished');
      } else {
        serveNextRef.current();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, tagFilter, cramMode, navigate]);

  const reveal = useCallback(() => {
    setPhase((p) => {
      if (p !== 'question') return p;
      responseTime.current = (performance.now() - timerStart.current) / 1000;
      return 'answer';
    });
  }, []);

  const answer = useCallback(
    async (input: boolean | Grade) => {
      if (phase !== 'answer' || !current || submitting.current) return;
      const ctx = ctxRef.current;
      const deck = decksRef.current.get(current.deckId);
      if (!ctx || !deck) return;
      submitting.current = true;
      try {
        const manualGrade: Grade | null = typeof input === 'number' ? input : null;
      const correct: boolean = typeof input === 'number' ? input > 1 : input;

      // Fire the feedback flash immediately, independent of the (async) DB write and
      // of the next card mounting, so the reward always lands on the keypress.
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
      setFeedback(correct ? 'correct' : 'wrong');
      feedbackTimer.current = window.setTimeout(() => setFeedback(null), 500);

      const t = responseTime.current;
      const distracted = distraction.wasDistracted();
      const perf = perfRef.current.get(deck.id);
      const grade: Grade = manualGrade ?? gradeFromResponse(correct, t, perf);

      // Snapshot pre-review state for single-step undo.
      const cooldownsSnapshot = new Map(cooldowns.current);
      const eventsLen = events.current.length;
      const progressSnapshot = sessionProgress(cardsRef.current, ctx);
      const perfBefore = perf ?? null;

      const { card: updated, sessionHistoryId } = await recordReview({
        card: current,
        deck,
        grade,
        responseTimeSec: t,
        distracted,
        correct,
      });

      if (correct && perf) {
        perfRef.current.set(deck.id, updatePerformance(perf, t));
      }

      const nextCards = cardsRef.current.map((c) => (c.id === updated.id ? updated : c));
      cardsRef.current = nextCards;

      // Cooldown bookkeeping: failed cards wait; every other card's cooldown decays.
      // Scale the cooldown to the card's own deck size.
      if (grade === 1) {
        const deckSize = nextCards.filter((c) => c.deckId === deck.id).length;
        applyCooldown(cooldowns.current, updated.id, deckSize);
      }
      decrementCooldowns(cooldowns.current, updated.id);

      events.current = [...events.current, { grade, correct, responseTimeSec: t, distracted }];

      lastAnswer.current = {
        undo: { cardBefore: current, perfBefore, sessionHistoryId },
        cooldowns: cooldownsSnapshot,
        progressBefore: progressSnapshot,
        eventsLen,
        deckId: deck.id,
      };
      setCanUndo(true);

      setProgress(sessionProgress(nextCards, ctx));
        if (sessionComplete(nextCards, ctx)) finish(true);
        else serveNext();
      } finally {
        submitting.current = false;
      }
    },
    [phase, current, distraction, finish, serveNext],
  );

  const undoLast = useCallback(async () => {
    const snap = lastAnswer.current;
    const ctx = ctxRef.current;
    if (!snap || !ctx) return;
    try {
      await undoReview(snap.undo);
      cardsRef.current = cardsRef.current.map((c) =>
        c.id === snap.undo.cardBefore.id ? snap.undo.cardBefore : c,
      );
      cooldowns.current = snap.cooldowns;
      if (snap.undo.perfBefore) perfRef.current.set(snap.deckId, snap.undo.perfBefore);
      events.current = events.current.slice(0, snap.eventsLen);
      lastAnswer.current = null;
      setCanUndo(false);
      setProgress(snap.progressBefore);
      setCurrent(snap.undo.cardBefore);
      setPhase('question');
      setMenuOpen(false);
      timerStart.current = performance.now();
      distraction.beginCard();
    } catch {
      // If undo fails, leave the session state as-is so the user can continue.
    }
  }, [distraction]);

  /** Drop the current card from the live pool after a suspend/bury, then move on. */
  const afterRemoval = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    setMenuOpen(false);
    setCanUndo(false);
    lastAnswer.current = null;
    setProgress(sessionProgress(cardsRef.current, ctx));
    serveNext();
  }, [serveNext]);

  const suspendCurrent = useCallback(async () => {
    if (!current) return;
    try {
      await suspendCard(current.id);
      cardsRef.current = cardsRef.current.map((c) =>
        c.id === current.id ? { ...c, suspended: true } : c,
      );
      afterRemoval();
    } catch {
      // If suspend fails, the card remains in the pool and the user can try again.
    }
  }, [current, afterRemoval]);

  const buryCurrent = useCallback(async () => {
    if (!current) return;
    try {
      const until = startOfDay(Date.now()) + MS_PER_DAY;
      await buryCard(current.id, until);
      cardsRef.current = cardsRef.current.map((c) =>
        c.id === current.id ? { ...c, buriedUntil: until } : c,
      );
      afterRemoval();
    } catch {
      // If bury fails, the card remains in the pool and the user can try again.
    }
  }, [current, afterRemoval]);

  /** Open the in-session editor, pausing the response timer while it is open. */
  const openEdit = useCallback(() => {
    if (!current) return;
    setMenuOpen(false);
    // Only the question phase has a running timer; the answer phase already
    // captured responseTime at reveal, so there is nothing to pause there.
    if (phase === 'question') {
      pausedElapsed.current = performance.now() - timerStart.current;
    }
    setEditing(true);
  }, [current, phase]);

  /** Rebase the timer so editing time is excluded, then leave the overlay. */
  const resumeAfterEdit = useCallback(() => {
    if (phase === 'question') {
      timerStart.current = performance.now() - pausedElapsed.current;
    }
  }, [phase]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    resumeAfterEdit();
  }, [resumeAfterEdit]);

  const handleEdited = useCallback(
    (updated: Card) => {
      cardsRef.current = cardsRef.current.map((c) => (c.id === updated.id ? updated : c));
      setCurrent(updated);
      setEditing(false);
      resumeAfterEdit();
    },
    [resumeAfterEdit],
  );

  /** Flag or unflag the current card without disturbing its review timer or place. */
  const toggleFlagCurrent = useCallback(async () => {
    if (!current) return;
    const next = !current.flagged;
    await setCardFlag(current.id, next);
    const updated = { ...current, flagged: next };
    cardsRef.current = cardsRef.current.map((c) => (c.id === current.id ? updated : c));
    setCurrent(updated);
    setMenuOpen(false);
  }, [current]);

  // Keyboard shortcuts:
  //   question - Space or ArrowUp reveals the answer.
  //   answer   - silent mode uses Y/N or ArrowRight/ArrowLeft; manual mode uses 1-4.
  //   any time - E edits the current card; U undoes the last answer (when available).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // The edit overlay owns the keyboard entirely while open, so typing into it
      // never reveals or grades the card underneath.
      if (editing) return;
      // The help overlay only listens for ? / Escape to close itself.
      if (hintsOpen) {
        if (e.key === '?' || e.key === 'Escape') {
          e.preventDefault();
          setHintsOpen(false);
        }
        return;
      }
      // While the nav drawer is open, only Escape (to close it) is meaningful;
      // card shortcuts stay inert so navigating doesn't grade the current card.
      if (navOpen) {
        if (e.key === 'Escape') setNavOpen(false);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setHintsOpen(true);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'f') {
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      if (k === 'e' && current && (phase === 'question' || phase === 'answer')) {
        e.preventDefault();
        openEdit();
        return;
      }
      if (k === 'u' && canUndo) {
        e.preventDefault();
        void undoLast();
        return;
      }
      if (phase === 'question' && (e.code === 'Space' || e.code === 'ArrowUp')) {
        e.preventDefault();
        reveal();
      } else      if (phase === 'answer') {
        if (gradingMode === 'manual') {
          if (k === '1') answer(1);
          else if (k === '2') answer(2);
          else if (k === '3') answer(3);
          else if (k === '4') answer(4);
        } else if (k === 'y' || k === 'j' || e.code === 'ArrowRight') answer(true);
        else if (k === 'n' || e.code === 'ArrowLeft') answer(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, reveal, answer, canUndo, undoLast, navOpen, editing, current, openEdit, hintsOpen, gradingMode]);

  // Clear any pending feedback timer if the session unmounts mid-flash.
  useEffect(
    () => () => {
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    },
    [],
  );

  if (phase === 'loading') {
    return (
      <div className="grid h-screen place-items-center text-ink-faint">
        <span className="animate-pulse font-display text-2xl">Preparing session…</span>
      </div>
    );
  }

  if (phase === 'finished' && summary) {
    return (
      <div className="min-h-screen">
        <SessionReport
          summary={summary}
          onReturn={backOut}
          onContinue={
            summary.reachedGoal
              ? undefined
              : () => {
                  const ctx = ctxRef.current;
                  if (!ctx) return;
                  events.current = [];
                  progressBefore.current = sessionProgress(cardsRef.current, ctx);
                  setSummary(null);
                  serveNext();
                }
          }
        />
      </div>
    );
  }

  const headerTitle = singleDeck ? singleDeck.name : 'Today · all decks';
  const noun = singleDeck ? progressNoun(singleDeck) : 'ready';

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      {/* Grading feedback: a soft glow rising from the foot of the screen — green for a
          correct answer, a muted red for a missed one. Purely decorative and never
          intercepts pointer or keyboard input. */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={
              'pointer-events-none fixed inset-x-0 bottom-0 z-30 h-56 ' +
              (feedback === 'correct'
                ? 'bg-gradient-to-t from-positive/25 to-transparent'
                : 'bg-gradient-to-t from-negative/20 to-transparent')
            }
          />
        )}
      </AnimatePresence>

      {/* In-session card editor: fixes a card without leaving the session (timer paused). */}
      <AnimatePresence>
        {editing && current && (
          <CardEditOverlay
            card={current}
            tagSuggestions={[
              ...new Set(
                cardsRef.current
                  .filter((c) => c.deckId === current.deckId)
                  .flatMap((c) => c.tags ?? []),
              ),
            ].sort()}
            onSaved={handleEdited}
            onCancel={cancelEdit}
          />
        )}
      </AnimatePresence>

      {/* Navigation drawer: hidden by default, slides in for quick navigation away. */}
      <NavSidebar open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Help overlay (opened with ?) */}
      <KeyHints open={hintsOpen} onClose={() => setHintsOpen(false)} />

      {/* Focus mode: a single quiet affordance to leave, keeping the card uncluttered. */}
      {focusMode && (
        <button
          type="button"
          onClick={() => setFocusMode(false)}
          title="Exit focus mode (F)"
          className="fixed right-4 top-4 z-20 rounded-lg px-3 py-1.5 text-xs text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink"
        >
          Exit focus (F)
        </button>
      )}

      {/* Top bar: progress + actions + exit */}
      {!focusMode && (
      <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            title="Open navigation"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <MenuIcon width={18} height={18} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center justify-between text-xs text-ink-faint">
              <span className="truncate font-medium uppercase tracking-[0.14em]">
                {headerTitle}
              </span>
              <span className="tabular">
                {Math.round(progress * 100)}% {noun}
              </span>
            </div>
            <ProgressBar value={progress} height={6} />
          </div>

          {/* Per-card action menu (edit / suspend / bury) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Card actions"
              title="Card actions"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <MoreIcon width={18} height={18} />
            </button>
            <AnimatePresence>
              {menuOpen && current && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.14 }}
                  className="absolute right-0 top-11 z-20 w-52 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl shadow-black/10"
                >
                  <MenuItem
                    icon={<EditIcon width={16} height={16} />}
                    label="Edit card"
                    onClick={openEdit}
                  />
                  <MenuItem
                    icon={<FlagIcon width={16} height={16} />}
                    label={current.flagged ? 'Remove flag' : 'Flag card'}
                    onClick={toggleFlagCurrent}
                  />
                  <MenuItem
                    icon={<ClockIcon width={16} height={16} />}
                    label="Bury until tomorrow"
                    onClick={buryCurrent}
                  />
                  <MenuItem
                    icon={<PauseIcon width={16} height={16} />}
                    label="Suspend card"
                    onClick={suspendCurrent}
                  />
                  <div className="border-t border-line" />
                  <MenuItem
                    icon={<KeyboardIcon width={16} height={16} />}
                    label="Keyboard shortcuts"
                    onClick={() => { setMenuOpen(false); setHintsOpen(true); }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Button variant="ghost" size="sm" onClick={() => finish(false)}>
            Exit
          </Button>
        </div>
      </header>
      )}

      {/* Card */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
        {current && <FlipCard card={current} revealed={phase === 'answer'} />}

        {/* Controls */}
        <div className="mt-8">
          <AnimatePresence mode="wait">
            {phase === 'question' ? (
              <motion.div
                key="show"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col items-center gap-2"
              >
                <Button variant="primary" size="lg" className="w-full max-w-sm" onClick={reveal}>
                  Show answer
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="grade"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col items-center gap-3"
              >
                {gradingMode === 'manual' ? (
                  <>
                    <div className="grid w-full max-w-2xl grid-cols-2 gap-3 md:grid-cols-4">
                      <Button variant="danger" size="lg" onClick={() => answer(1)}>
                        <CloseIcon width={18} height={18} />
                        Again
                      </Button>
                      <Button variant="secondary" size="lg" onClick={() => answer(2)}>
                        Hard
                      </Button>
                      <Button variant="secondary" size="lg" onClick={() => answer(3)}>
                        Good
                      </Button>
                      <Button variant="primary" size="lg" onClick={() => answer(4)}>
                        <CheckIcon width={18} height={18} />
                        Easy
                      </Button>
                    </div>

                  </>
                ) : (
                  <>
                <div className="flex w-full max-w-md gap-3">
                  <Button
                    variant="danger"
                    size="lg"
                    className="flex-1"
                    onClick={() => answer(false)}
                  >
                    <CloseIcon width={18} height={18} />
                    No
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    className="flex-1"
                    onClick={() => answer(true)}
                  >
                    <CheckIcon width={18} height={18} />
                    Yes
                  </Button>
                </div>

                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Undo affordance: appears only while the last answer can be reversed. */}
          <div className="mt-4 flex h-6 justify-center">
            <AnimatePresence>
              {canUndo && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  type="button"
                  onClick={undoLast}
                  title="Undo last answer"
                  className="inline-flex items-center gap-1.5 text-xs text-ink-faint transition-colors hover:text-ink"
                >
                  <UndoIcon width={14} height={14} />
                  Undo last answer
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}

function NavSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const trapRef = useFocusTrap(open);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={trapRef}
          role="dialog"
          aria-label="Navigation"
          aria-modal="true"
          className="fixed inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            className="absolute inset-y-0 left-0"
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            <Sidebar collapsed={false} onToggleCollapsed={onClose} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MenuItem({
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
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink"
    >
      <span className="shrink-0 text-ink-faint">{icon}</span>
      {label}
    </button>
  );
}

/**
 * A card that flips vertically to reveal its answer. The two faces are swapped via a
 * keyed transition (rather than absolute stacking) so the card's height always fits the
 * content, even when the answer is much longer than the question.
 */
function FlipCard({ card, revealed }: { card: Card; revealed: boolean }) {
  const isCloze = card.type === 'cloze';
  return (
    <div
      className="flex flex-1 items-center justify-center"
      style={{ perspective: '1600px' }}
    >
      <div className="w-full" style={{ transformStyle: 'preserve-3d' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={revealed ? 'back' : 'front'}
            initial={{ rotateX: -90, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            exit={{ rotateX: 90, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: 'center top' }}
            className={
              'rounded-3xl border bg-surface px-8 py-12 shadow-xl shadow-black/5 ' +
              (revealed ? 'border-accent/40' : 'border-line')
            }
          >
            <div
              className={
                'mb-4 text-center text-[11px] uppercase tracking-[0.2em] ' +
                (revealed ? 'text-accent' : 'text-ink-faint')
              }
            >
              {revealed ? 'Answer' : isCloze ? 'Fill the gap' : 'Question'}
            </div>
            <div className="mx-auto max-w-prose text-center text-lg">
              <CardContent card={card} side={revealed ? 'back' : 'front'} />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
