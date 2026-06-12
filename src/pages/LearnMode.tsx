import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, m as motion, useMotionValue, useSpring } from 'motion/react';
import { hapticLight, hapticMedium } from '../utils/haptic';
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
import { ProgressBar, type ProgressVariant } from '../components/ui/ProgressBar';
import { Button } from '../components/ui/Button';
import { Sidebar } from '../components/layout/Sidebar';
import { SessionReport } from '../components/learn/SessionReport';
import { useDistraction } from '../components/learn/useDistraction';
import type { SessionEvent, SessionSummary } from '../components/learn/types';
import { useGradingMode } from '../state/gradingMode';
import { useStudyMode } from '../state/studyMode';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useShortcutBindings, keyMatches } from '../state/shortcutBindings';
import { useMotionSpeed, speedMultiplier, type MotionSpeed } from '../state/motionSpeed';
import { useIsTouchMode } from '../state/inputMode';
import {
  CheckIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  FlagIcon,
  HelpIcon,
  KeyboardIcon,
  MenuIcon,
  MoreIcon,
  PauseIcon,
} from '../components/ui/icons';
import { PomodoroTimer } from '../components/learn/PomodoroTimer';
import { useToast } from '../components/ui/Toast';
import { matchesFilter, type CardFilter } from '../db/search';
import { cn } from '../components/ui/cn';

type Phase = 'loading' | 'question' | 'answer' | 'finished';

/** The distinct visual identity of the current learn session. */
type LearnModeType = 'fsrs' | 'simple' | 'cram' | 'filtered' | 'filtered-due' | 'filtered-new' | 'filtered-leech' | 'filtered-flagged' | 'filtered-suspended';

const FILTER_LABELS: Record<string, string> = {
  due: 'due cards',
  new: 'new cards',
  leech: 'leeches',
  flagged: 'flagged cards',
  suspended: 'suspended cards',
};

/** What undoing the most recent answer needs to restore (DB + in-session state). */
interface AnswerSnapshot {
  undo: ReviewUndo;
  cooldowns: CooldownMap;
  progressBefore: number;
  eventsLen: number;
  deckId: string;
  deckReviews: number;
}

export function LearnMode() {
  const { deckId } = useParams<{ deckId: string }>();
  const [searchParams] = useSearchParams();
  const tagFilter = searchParams.get('tag');
  const cramMode = searchParams.get('mode') === 'cram';
  const simpleModeParam = searchParams.get('mode') === 'simple';
  const filterParams = useMemo(
    () => searchParams.getAll('filter') as CardFilter[],
    [searchParams],
  );
  const navigate = useNavigate();
  const distraction = useDistraction();
  const [gradingMode] = useGradingMode();
  const { bindings } = useShortcutBindings();
  const [motionSpeed] = useMotionSpeed();
  const m = speedMultiplier(motionSpeed);
  const isTouchMode = useIsTouchMode();
  const { notify } = useToast();
  const [studyMode] = useStudyMode();
  const isSimpleMode = studyMode === 'simple' || simpleModeParam;

  const mode: LearnModeType = useMemo(() => {
    if (isSimpleMode) return 'simple';
    if (cramMode) return 'cram';
    if (filterParams.length > 0) {
      if (filterParams.length === 1) {
        const f = filterParams[0];
        if (f === 'due') return 'filtered-due';
        if (f === 'new') return 'filtered-new';
        if (f === 'leech') return 'filtered-leech';
        if (f === 'flagged') return 'filtered-flagged';
        if (f === 'suspended') return 'filtered-suspended';
      }
      return 'filtered';
    }
    return 'fsrs';
  }, [isSimpleMode, cramMode, filterParams]);

  const isGlobal = !deckId;

  const [phase, setPhase] = useState<Phase>('loading');
  // The deck a single-deck session is studying (null for the global session).
  const [singleDeck, setSingleDeck] = useState<Deck | null>(null);
  const [current, setCurrent] = useState<Card | null>(null);
  const [progress, setProgress] = useState(0);
  // Cache sessionProgress so repeated calls while the card pool is unchanged don't recompute.
  const progressCacheRef = useRef<{ dirty: boolean; value: number }>({ dirty: true, value: 0 });
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
  const [feedback, setFeedback] = useState<'left' | 'right' | null>(null);
  const [feedbackSource, setFeedbackSource] = useState<'touch' | 'keyboard' | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  // Simple mode: queue of cards that are still unlearned (wrong or unseen).
  const simpleQueue = useRef<Card[]>([]);
  const simpleMastered = useRef<Set<string>>(new Set());
  const simpleWrong = useRef<Set<string>>(new Set());
  // Typed answer for typing cards.
  const [typedAnswer, setTypedAnswer] = useState('');
  const typingInputRef = useRef<HTMLInputElement>(null);

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
  // Per-deck review counters for the daily workload cap.
  const reviewsByDeck = useRef<Map<string, number>>(new Map());
  // When the user clicks "Continue anyway" after hitting a daily limit.
  const [limitOverride, setLimitOverride] = useState(false);
  // When the user clicks "Continue anyway" after hitting a session time limit.
  const [timeLimitOverride, setTimeLimitOverride] = useState(false);
  // Session wall-clock start time, used to enforce the per-deck session time limit.
  const sessionStartMs = useRef(0);
  // Cache sessionProgress so repeated calls while the card pool is unchanged don't recompute.
  // Stable refs for values that async callbacks must read fresh (avoid stale closures).
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const currentRef = useRef<Card | null>(current);
  currentRef.current = current;
  // Guards against state updates on an unmounted component after async work.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);  const exitTo = isGlobal ? '/' : `/deck/${deckId}`;
  const backOut = useCallback(() => navigate(exitTo), [navigate, exitTo]);

  const objectiveLabel = useCallback(() => {
    if (singleDeck) return progressHeading(singleDeck);
    return 'Predicted readiness across all decks';
  }, [singleDeck]);

  /** Compute sessionProgress with a lightweight dirty-check cache. */
  const cachedSessionProgress = useCallback((cards: Card[], ctx: SessionContext): number => {
    if (!progressCacheRef.current.dirty) {
      return progressCacheRef.current.value;
    }
    const value = sessionProgress(cards, ctx);
    progressCacheRef.current = { dirty: false, value };
    return value;
  }, []);    const finish = useCallback(
    (reachedGoal: boolean, limitReached = false, timeLimitReached = false) => {
      if (!mountedRef.current) return;
      const ctx = ctxRef.current;
      const total = distraction.sessionMs();
      const focus =
        total <= 0
          ? 1
          : Math.max(0, Math.min(1, (total - distraction.blurredMs()) / total));
      const masteryAfter = ctx
        ? cachedSessionProgress(cardsRef.current, ctx)
        : progressBefore.current;
      setSummary({
        events: events.current,
        masteryBefore: progressBefore.current,
        masteryAfter,
        objectiveLabel: objectiveLabel(),
        focusFraction: focus,
        reachedGoal,
        limitReached,
        timeLimitReached,
        simpleMode: isSimpleMode,
        mode,
      });
      setCanUndo(false);
      lastAnswer.current = null;
      if (!mountedRef.current) return;
      setPhase('finished');
    },
    [objectiveLabel, distraction, cachedSessionProgress, isSimpleMode, mode],
  );

  /** Present the next eligible card, or finish if the goal has been reached. */
  const serveNext = useCallback(() => {
    if (!mountedRef.current) return;

    if (isSimpleMode) {
      const remaining = simpleQueue.current.filter((c) => !simpleMastered.current.has(c.id));
      if (remaining.length === 0) {
        finish(true);
        return;
      }
      const next = remaining[0];
      if (!mountedRef.current) return;
      setCurrent(next);
      if (!mountedRef.current) return;
      setPhase('question');
      setMenuOpen(false);
      setTypedAnswer('');
      timerStart.current = performance.now();
      distraction.beginCard();
      distraction.setAnswerVisible(false);
      return;
    }

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
    if (!mountedRef.current) return;
    setCurrent(next);
    if (!mountedRef.current) return;
    setPhase('question');
    setMenuOpen(false);
    setTypedAnswer('');
    timerStart.current = performance.now();
    distraction.beginCard();
    distraction.setAnswerVisible(false);
    // Invalidate progress cache when moving to a new card.
    progressCacheRef.current.dirty = true;
  }, [finish, distraction, isSimpleMode]);

  // Stable ref so the initial-load effect never re-runs just because serveNext's
  // callback identity changed (which would reset phase and undo reveal/exit).
  const serveNextRef = useRef(serveNext);
  serveNextRef.current = serveNext;

  // Initial load: read a static snapshot of the deck(s) so the session is stable.
  useEffect(() => {
    let cancelled = false;
    // Reset all session refs so navigating deck -> deck does not leave stale state.
    cooldowns.current = new Map();
    events.current = [];
    lastAnswer.current = null;
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = null;
    setFeedback(null);
    setFeedbackSource(null);
    submitting.current = false;
    progressBefore.current = 0;
    perfRef.current = new Map();
    decksRef.current = new Map();
    ctxRef.current = null;
    cardsRef.current = [];
    setCanUndo(false);
    setSummary(null);
    setEditing(false);
    setMenuOpen(false);
    setHintsOpen(false);
    setNavOpen(false);
    setFocusMode(false);
    setLimitOverride(false);
    setTimeLimitOverride(false);
    sessionStartMs.current = 0;
    setPhase('loading');
    void (async () => {
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
        const now = Date.now();
        if (filterParams.length > 0) {
          cards = cards.filter((c) => filterParams.every((f) => matchesFilter(c, f, now)));
        }
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
      reviewsByDeck.current = new Map();
      setLimitOverride(false);
      setSingleDeck((prev) => {
        const next = deckId ? decks[0] : null;
        if (prev?.id === next?.id) return prev;
        return next;
      });

      if (decks.length === 0 || cards.length === 0) {
        if (cancelled) return;
        // Show an empty-state screen instead of navigating away so the user
        // understands what happened and can choose what to do next.
        progressBefore.current = sessionProgress(cards, ctx);
        const isFiltered = filterParams.length > 0 || tagFilter !== null;
        const filterParts = [
          ...(tagFilter ? [`tag "${tagFilter}"`] : []),
          ...(filterParams.length > 0
            ? filterParams.map((f) => FILTER_LABELS[f] ?? f)
            : []),
        ];
        const filterLabel = filterParts.join(' or ');
        setSummary({
          events: [],
          masteryBefore: progressBefore.current,
          masteryAfter: progressBefore.current,
          objectiveLabel: isFiltered
            ? `No cards matching ${filterLabel} to study`
            : deckId
              ? progressHeading(decks[0])
              : 'Predicted readiness across all decks',
          focusFraction: 1,
          reachedGoal: false,
          limitReached: false,
          mode,
        });
        setPhase('finished');
        return;
      }

      progressBefore.current = sessionProgress(cards, ctx);
      setProgress(progressBefore.current);

      if (isSimpleMode) {
        simpleQueue.current = [...cards];
        simpleMastered.current = new Set();
        simpleWrong.current = new Set();
        setProgress(0);
      } else {
        setProgress(progressBefore.current);
      }

      if (!isSimpleMode && sessionComplete(cards, ctx)) {
        setSummary({
          events: [],
          masteryBefore: progressBefore.current,
          masteryAfter: progressBefore.current,
          objectiveLabel: deckId ? progressHeading(decks[0]) : 'Predicted readiness across all decks',
          focusFraction: 1,
          reachedGoal: true,
          limitReached: false,
          timeLimitReached: false,
          mode,
        });
        setPhase('finished');
      } else {
        sessionStartMs.current = Date.now();
        serveNextRef.current();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, tagFilter, cramMode, filterParams, navigate, isSimpleMode, mode]);

  const reveal = useCallback(() => {
    setPhase((p) => {
      if (p !== 'question') return p;
      responseTime.current = (performance.now() - timerStart.current) / 1000;
      return 'answer';
    });
    distraction.setAnswerVisible(true);
  }, [distraction]);

  const hide = useCallback(() => {
    setPhase((p) => {
      if (p !== 'answer') return p;
      return 'question';
    });
    distraction.setAnswerVisible(false);
  }, [distraction]);

  const answer = useCallback(
    async (input: boolean | Grade, source: 'touch' | 'keyboard' = 'keyboard') => {
      if (submitting.current) return;
      submitting.current = true;
      const phaseNow = phaseRef.current;
      const cardNow = currentRef.current;
      if (phaseNow !== 'answer' || !cardNow) {
        submitting.current = false;
        return;
      }

      try {
        const correct: boolean = typeof input === 'number' ? input > 1 : input;

        if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
        setFeedbackSource(source);
        setFeedback(correct ? 'right' : 'left');
        feedbackTimer.current = window.setTimeout(() => { setFeedback(null); setFeedbackSource(null); }, Math.round(400 * m));

        const t = responseTime.current;
        const distracted = distraction.wasDistracted();

        if (isSimpleMode) {
          const grade: Grade = correct ? 3 : 1;
          events.current = [...events.current, { grade, correct, responseTimeSec: t, distracted }];

          if (correct) {
            simpleMastered.current.add(cardNow.id);
            simpleWrong.current.delete(cardNow.id);
          } else {
            simpleWrong.current.add(cardNow.id);
            // Re-queue the card at the end so it comes back later.
            simpleQueue.current = [...simpleQueue.current.filter((c) => c.id !== cardNow.id), cardNow];
          }

          const remaining = simpleQueue.current.filter((c) => !simpleMastered.current.has(c.id)).length;
          const mastered = simpleMastered.current.size;
          const total = mastered + remaining;
          setProgress(total > 0 ? mastered / total : 1);

          if (remaining === 0) {
            finish(true);
          } else {
            serveNext();
          }
          return;
        }

        const ctx = ctxRef.current;
        const deck = decksRef.current.get(cardNow.deckId);
        if (!ctx || !deck) {
          submitting.current = false;
          return;
        }

        const manualGrade: Grade | null = typeof input === 'number' ? input : null;
        const perf = perfRef.current.get(deck.id);
        const grade: Grade = manualGrade ?? gradeFromResponse(correct, t, perf);

        const cooldownsSnapshot = new Map(cooldowns.current);
        const eventsLen = events.current.length;
        const progressSnapshot = cachedSessionProgress(cardsRef.current, ctx);
        const perfBefore = perf ?? null;

        const { card: updated, sessionHistoryId } = await recordReview({
          card: cardNow,
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

        if (grade === 1) {
          const deckSize = nextCards.filter((c) => c.deckId === deck.id).length;
          applyCooldown(cooldowns.current, updated.id, deckSize);
        }
        decrementCooldowns(cooldowns.current, updated.id);

        events.current = [...events.current, { grade, correct, responseTimeSec: t, distracted }];

        const deckReviews = (reviewsByDeck.current.get(deck.id) ?? 0) + 1;
        reviewsByDeck.current.set(deck.id, deckReviews);

        lastAnswer.current = {
          undo: { cardBefore: cardNow, perfBefore, sessionHistoryId, deckId: deck.id },
          cooldowns: cooldownsSnapshot,
          progressBefore: progressSnapshot,
          eventsLen,
          deckId: deck.id,
          deckReviews,
        };
        setCanUndo(true);

        progressCacheRef.current.dirty = true;
        setProgress(cachedSessionProgress(nextCards, ctx));

        const limit = deck.maxReviewsPerDay;
        if (!limitOverride && limit && limit > 0 && deckReviews >= limit) {
          finish(false, true);
          return;
        }

        const goal = deck.dailyReviewGoal;
        if (!limitOverride && goal && goal > 0 && deckReviews >= goal) {
          finish(true);
          return;
        }

        const timeLimit = deck.sessionTimeLimitMinutes;
        if (!timeLimitOverride && timeLimit && timeLimit > 0 && sessionStartMs.current > 0) {
          const elapsedMinutes = (Date.now() - sessionStartMs.current) / 60000;
          if (elapsedMinutes >= timeLimit) {
            finish(false, false, true);
            return;
          }
        }

        if (sessionComplete(nextCards, ctx)) finish(true);
        else serveNext();
      } finally {
        submitting.current = false;
      }
    },
    [distraction, finish, serveNext, cachedSessionProgress, limitOverride, timeLimitOverride, m, isSimpleMode],
  );

  const undoLast = useCallback(async () => {
    const snap = lastAnswer.current;
    const ctx = ctxRef.current;
    if (!snap || !ctx) return;
    try {
      await undoReview(snap.undo);
      if (!mountedRef.current) return;
      cardsRef.current = cardsRef.current.map((c) =>
        c.id === snap.undo.cardBefore.id ? snap.undo.cardBefore : c,
      );
      cooldowns.current = snap.cooldowns;
      if (snap.undo.perfBefore) perfRef.current.set(snap.deckId, snap.undo.perfBefore);
      events.current = events.current.slice(0, snap.eventsLen);
      // Decrement the per-deck review counter on undo.
      const prevReviews = snap.deckReviews - 1;
      if (prevReviews > 0) reviewsByDeck.current.set(snap.deckId, prevReviews);
      else reviewsByDeck.current.delete(snap.deckId);
      lastAnswer.current = null;
      setCanUndo(false);
      progressCacheRef.current.dirty = true;
      setProgress(snap.progressBefore);
      setCurrent(snap.undo.cardBefore);
      setPhase('question');
      setMenuOpen(false);
      timerStart.current = performance.now();
      distraction.beginCard();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not undo the last answer.', 'negative');
    }
  }, [distraction, notify]);

  /** Drop the current card from the live pool after a suspend/bury, then move on. */
  const afterRemoval = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (!mountedRef.current) return;
    setMenuOpen(false);
    setCanUndo(false);
    lastAnswer.current = null;
    progressCacheRef.current.dirty = true;
    setProgress(cachedSessionProgress(cardsRef.current, ctx));
    serveNext();
  }, [serveNext, cachedSessionProgress]);

  const suspendCurrent = useCallback(async () => {
    if (!current) return;
    try {
      await suspendCard(current.id);
      cardsRef.current = cardsRef.current.map((c) =>
        c.id === current.id ? { ...c, suspended: true } : c,
      );
      if (isSimpleMode) {
        simpleQueue.current = simpleQueue.current.filter((c) => c.id !== current.id);
      }
      afterRemoval();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not suspend the card.', 'negative');
    }
  }, [current, afterRemoval, notify, isSimpleMode]);

  const buryCurrent = useCallback(async () => {
    if (!current) return;
    try {
      const until = startOfDay(Date.now()) + MS_PER_DAY;
      await buryCard(current.id, until);
      cardsRef.current = cardsRef.current.map((c) =>
        c.id === current.id ? { ...c, buriedUntil: until } : c,
      );
      if (isSimpleMode) {
        simpleQueue.current = simpleQueue.current.filter((c) => c.id !== current.id);
      }
      afterRemoval();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not bury the card.', 'negative');
    }
  }, [current, afterRemoval, notify, isSimpleMode]);

  /** Open the in-session editor, pausing the response timer while it is open. */
  const openEdit = useCallback(() => {
    if (!current) return;
    // Guard against the card having been removed from the session pool
    // (deleted / suspended by another tab) since the last render.
    if (!cardsRef.current.some((c) => c.id === current.id)) return;
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
    try {
      const next = !current.flagged;
      await setCardFlag(current.id, next);
      const updated = { ...current, flagged: next };
      cardsRef.current = cardsRef.current.map((c) => (c.id === current.id ? updated : c));
      setCurrent(updated);
      setMenuOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update the card flag.', 'negative');
    }
  }, [current, notify]);

  // Keyboard shortcuts:
  //   question - Space or ArrowUp reveals the answer.
  //   answer   - silent mode uses Y/N or ArrowRight/ArrowLeft; manual mode uses 1-4.
  //   any time - E edits the current card; U undoes the last answer (when available).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // While the user is typing into any input, textarea, or content-editable
      // element, card shortcuts stay inert so keystrokes don't accidentally grade.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        // Allow Enter in the typing input to submit the answer.
        if (target.tagName === 'INPUT' && e.key === 'Enter' && currentRef.current?.type === 'typing') {
          e.preventDefault();
          reveal();
          return;
        }
        return;
      }
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
      if (keyMatches(e, bindings.focus)) {
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      if (keyMatches(e, bindings.edit) && current && (phase === 'question' || phase === 'answer')) {
        e.preventDefault();
        openEdit();
        return;
      }
      if (keyMatches(e, bindings.undo) && canUndo) {
        e.preventDefault();
        void undoLast();
        return;
      }
      if (phase === 'question' && (keyMatches(e, bindings.reveal) || e.code === 'ArrowUp')) {
        e.preventDefault();
        reveal();
      } else if (phase === 'answer') {
        if (e.code === 'ArrowDown') {
          e.preventDefault();
          hide();
          return;
        }
        if (gradingMode === 'manual') {
          if (keyMatches(e, bindings.again)) { e.preventDefault(); void answer(1); }
          else if (keyMatches(e, bindings.hard)) { e.preventDefault(); void answer(2); }
          else if (keyMatches(e, bindings.good)) { e.preventDefault(); void answer(3); }
          else if (keyMatches(e, bindings.easy)) { e.preventDefault(); void answer(4); }
        } else if (keyMatches(e, bindings.yes) || e.code === 'ArrowRight') {
          e.preventDefault();
          void answer(true);
        } else if (keyMatches(e, bindings.no) || e.code === 'ArrowLeft') {
          e.preventDefault();
          void answer(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, reveal, hide, answer, canUndo, undoLast, navOpen, editing, current, openEdit, hintsOpen, gradingMode, bindings, m]);

  // Clear any pending feedback timer if the session unmounts mid-flash.
  useEffect(
    () => () => {
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    },
    [],
  );

  // Warn before closing the tab while a session is in progress.
  useEffect(() => {
    if (phase !== 'question' && phase !== 'answer') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase]);

  if (phase === 'loading') {
    return <LearnSkeleton mode={mode} />;
  }

  const noun = singleDeck ? progressNoun(singleDeck) : 'ready';

  const isTypingCard = current?.type === 'typing';

  return (
    <div className="min-h-screen bg-paper">
      <AnimatePresence mode="wait">
        {phase === 'finished' && summary ? (
          <motion.div
            key="finished"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.32 * m, ease: [0.16, 1, 0.3, 1] }}
            className="min-h-screen"
          >
            <SessionReport
              summary={summary}
              onReturn={backOut}
              onContinue={
                summary.reachedGoal && !summary.limitReached && !summary.timeLimitReached && !summary.simpleMode
                  ? undefined                    : summary.simpleMode
                    ? () => {
                        // Restart simple mode: reset all simple state and begin again.
                        simpleMastered.current = new Set();
                        simpleWrong.current = new Set();
                        simpleQueue.current = cardsRef.current.filter(
                          (c) => !c.suspended && !(c.buriedUntil && c.buriedUntil > Date.now()),
                        );
                        events.current = [];
                        progressBefore.current = 0;
                        sessionStartMs.current = Date.now();
                        setSummary(null);
                        setProgress(0);
                        serveNext();
                      }
                    : () => {
                        const ctx = ctxRef.current;
                        if (!ctx) return;
                        events.current = [];
                        progressBefore.current = cachedSessionProgress(cardsRef.current, ctx);
                        setSummary(null);
                        setLimitOverride(true);
                        setTimeLimitOverride(true);
                        serveNext();
                      }
              }
            />
          </motion.div>
        ) : (
          <motion.div
            key="study"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.32 * m, ease: [0.16, 1, 0.3, 1] }}
            className="flex min-h-screen flex-col"
          >
      {/* Grading feedback: a directional glow that sweeps in from the side the user
          swiped — left for No, right for Yes — plus a radial ring that pulses outward.
          Purely decorative and never intercepts input. */}
      <AnimatePresence>
        {feedback && (
          <>
            {feedbackSource === 'touch' ? (
              <motion.div
                key={`${feedback}-glow`}
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 * m }}
                className={
                  'pointer-events-none fixed inset-y-0 z-30 w-56 ' +
                  (feedback === 'right'
                    ? 'right-0 bg-gradient-to-l from-positive/25 to-transparent'
                    : 'left-0 bg-gradient-to-r from-negative/20 to-transparent')
                }
              />
            ) : (
              <motion.div
                key={`${feedback}-glow`}
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 * m }}
                className={
                  'pointer-events-none fixed inset-x-0 bottom-0 z-30 h-40 ' +
                  (feedback === 'right'
                    ? 'bg-gradient-to-t from-positive/25 to-transparent'
                    : 'bg-gradient-to-t from-negative/20 to-transparent')
                }
              />
            )}
            <motion.div
              key={`${feedback}-ring`}
              aria-hidden
              className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
              initial={{ opacity: 0.6 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 * m, ease: 'easeOut' }}
            >
              <motion.div
                initial={{ scale: 0.6, opacity: 0.5 }}
                animate={{ scale: 2.5, opacity: 0 }}
                transition={{ duration: 0.55 * m, ease: [0.16, 1, 0.3, 1] }}
                className={
                  'h-96 w-96 rounded-full ' +
                  (feedback === 'right'
                    ? 'bg-positive/15 ring-4 ring-positive/20'
                    : 'bg-negative/10 ring-4 ring-negative/15')
                }
              />
            </motion.div>
          </>
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
          className="fixed right-4 top-4 z-20 min-h-11 rounded-lg px-3 py-1.5 text-xs text-ink-faint transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10"
        >
          Exit focus (F)
        </button>
      )}

      {/* Top bar: mode-aware header, progress, and actions */}
      {!focusMode && (
        <LearnHeader
          mode={mode}
          singleDeck={singleDeck}
          progress={progress}
          noun={noun}
          filterParams={filterParams}
          tagFilter={tagFilter}
          onOpenNav={() => setNavOpen(true)}
          onExit={() => finish(false)}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          current={current}
          isTouchMode={isTouchMode}
          onEdit={openEdit}
          onToggleFlag={toggleFlagCurrent}
          onBury={buryCurrent}
          onSuspend={suspendCurrent}
          onShowShortcuts={() => { setMenuOpen(false); setHintsOpen(true); }}
          m={m}
          simpleWrong={simpleWrong.current.size}
          simpleRemaining={simpleQueue.current.filter((c) => !simpleMastered.current.has(c.id)).length}
          simpleMastered={simpleMastered.current.size}
          isSimpleMode={isSimpleMode}
          phase={phase}
          
        />
      )}      {/* Card — mode-aware border accent */}
      <main className={`mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8 ${isTouchMode ? 'pb-40' : ''}`}>
        {current && (
          <FlipCard
            card={current}
            revealed={phase === 'answer'}
            motionSpeed={motionSpeed}
            phase={phase}
            isTouchMode={isTouchMode}
            menuOpen={menuOpen}
            editing={editing}
            navOpen={navOpen}
            hintsOpen={hintsOpen}
            onReveal={reveal}
            onHide={hide}
            onAnswer={answer}
            typedAnswer={typedAnswer}
            mode={mode}
          />
        )}

        {/* Typing input for typing cards in question phase */}
        {isTypingCard && phase === 'question' && (
          <div className="mx-auto mt-6 w-full max-w-md">
            <input
              ref={typingInputRef}
              type="text"
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  reveal();
                }
              }}
              placeholder="Type your answer…"
              className="w-full rounded-lg border border-line-strong bg-surface px-4 py-3 text-ink outline-none transition-colors focus:border-accent"
              autoFocus
            />
            <div className="mt-3 flex justify-center">
              <Button variant="primary" size="lg" className="w-full" onClick={reveal}>
                Check answer
              </Button>
            </div>
          </div>
        )}

        {/* Controls */}
        {isTouchMode ? (
          <TouchBottomSheet
            phase={phase}
            gradingMode={gradingMode}
            onReveal={reveal}
            onHide={hide}
            onAnswer={answer}
            m={m}
            isTypingCard={isTypingCard}
          />
        ) : (
          <div className="mt-8">
            <AnimatePresence mode="wait">
              {phase === 'question' ? (
                <motion.div
                  key="show"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 * m, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center gap-2"
                >
                  {!isTypingCard && (
                    <Button variant="primary" size="lg" className="w-full max-w-sm" onClick={reveal}>
                      Show answer
                    </Button>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="grade"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 * m, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center gap-3"
                >
                  {gradingMode === 'manual' ? (
                    <motion.div
                      className="grid w-full max-w-2xl grid-cols-2 gap-3 md:grid-cols-4"
                      initial="hidden"
                      animate="visible"
                      variants={{
                        hidden: {},
                        visible: { transition: { staggerChildren: 0.04 } },
                      }}
                    >
                      <motion.div variants={buttonReveal(m)}>
                        <Button variant="danger" size="lg" className="w-full" onClick={() => void answer(1, 'keyboard')}>
                          <CloseIcon width={18} height={18} />
                          Again
                        </Button>
                      </motion.div>
                      <motion.div variants={buttonReveal(m)}>
                        <Button variant="secondary" size="lg" className="w-full" onClick={() => void answer(2, 'keyboard')}>
                          Hard
                        </Button>
                      </motion.div>
                      <motion.div variants={buttonReveal(m)}>
                        <Button variant="secondary" size="lg" className="w-full" onClick={() => void answer(3, 'keyboard')}>
                          Good
                        </Button>
                      </motion.div>
                      <motion.div variants={buttonReveal(m)}>
                        <Button variant="primary" size="lg" className="w-full" onClick={() => void answer(4, 'keyboard')}>
                          <CheckIcon width={18} height={18} />
                          Easy
                        </Button>
                      </motion.div>
                    </motion.div>
                  ) : (
                    <motion.div
                      className="flex w-full max-w-md gap-3"
                      initial="hidden"
                      animate="visible"
                      variants={{
                        hidden: {},
                        visible: { transition: { staggerChildren: 0.05 } },
                      }}
                    >
                      <motion.div variants={buttonReveal(m)} className="flex-1">
                        <Button variant="danger" size="lg" className="w-full" onClick={() => void answer(false, 'keyboard')}>
                          <CloseIcon width={18} height={18} />
                          No
                        </Button>
                      </motion.div>
                      <motion.div variants={buttonReveal(m)} className="flex-1">
                        <Button variant="primary" size="lg" className="w-full" onClick={() => void answer(true, 'keyboard')}>
                          <CheckIcon width={18} height={18} />
                          Yes
                        </Button>
                      </motion.div>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Mode-aware helpers and components ─── */

function modeBorderClass(mode: LearnModeType, revealed: boolean): string {
  if (!revealed) return 'border-line shadow-xl shadow-black/5';
  switch (mode) {
    case 'cram': return 'border-amber-500/40 shadow-2xl shadow-amber-500/10';
    case 'simple': return 'border-positive/40 shadow-2xl shadow-positive/10';
    case 'filtered-leech': return 'border-negative/40 shadow-2xl shadow-negative/10';
    case 'filtered-flagged': return 'border-amber-500/40 shadow-2xl shadow-amber-500/10';
    case 'filtered': return 'border-accent/40 shadow-2xl shadow-accent/10';
    default: return 'border-accent/40 shadow-2xl shadow-accent/10';
  }
}

function modeProgressVariant(mode: LearnModeType): ProgressVariant {
  switch (mode) {
    case 'cram': return 'amber';
    case 'simple': return 'simple';
    case 'filtered-leech': return 'negative';
    case 'filtered-flagged': return 'amber';
    case 'filtered-suspended': return 'negative';
    case 'filtered': return 'accent';
    default: return 'accent';
  }
}

function computeHeaderInfo({
  singleDeck,
  mode,
  filterParams,
  tagFilter,
}: {
  singleDeck: Deck | null;
  mode: LearnModeType;
  filterParams: CardFilter[];
  tagFilter: string | null;
}) {
  const deckName = singleDeck ? singleDeck.name : 'Today · all decks';
  const tagPart = tagFilter ? `tag "${tagFilter}"` : '';

  const filterLabels = filterParams.map((f) => FILTER_LABELS[f] ?? f);
  const filterPart = filterLabels.join(', ');

  switch (mode) {
    case 'simple':
      return {
        title: singleDeck ? `${deckName} · Simple learn` : 'Simple learn · all decks',
        subtitle: 'Loop until every card is correct',
      };
    case 'cram':
      return {
        title: singleDeck ? `${deckName} · Cram mode` : 'Cram mode · all decks',
        subtitle: 'Weakest cards first',
      };
    case 'filtered-due':
      return {
        title: `${deckName} · ${filterPart}`,
        subtitle: tagPart || 'Only cards that are due today',
      };
    case 'filtered-new':
      return {
        title: `${deckName} · ${filterPart}`,
        subtitle: tagPart || 'Only cards you have not seen yet',
      };
    case 'filtered-leech':
      return {
        title: `${deckName} · ${filterPart}`,
        subtitle: tagPart || 'Only leech cards',
      };
    case 'filtered-flagged':
      return {
        title: `${deckName} · ${filterPart}`,
        subtitle: tagPart || 'Only flagged cards',
      };
    case 'filtered-suspended':
      return {
        title: `${deckName} · ${filterPart}`,
        subtitle: tagPart || 'Only suspended cards',
      };
    case 'filtered':
      return {
        title: `${deckName} · ${filterPart}`,
        subtitle: tagPart || 'Filtered cards',
      };
    default:
      return {
        title: deckName,
        subtitle: tagPart || '',
      };
  }
}

function LearnHeader({
  mode,
  singleDeck,
  progress,
  noun,
  filterParams,
  tagFilter,
  onOpenNav,
  onExit,
  menuOpen,
  setMenuOpen,
  current,
  isTouchMode,
  onEdit,
  onToggleFlag,
  onBury,
  onSuspend,
  onShowShortcuts,
  m,
  simpleWrong,
  simpleRemaining,
  simpleMastered,
  isSimpleMode,
  phase,
}: {
  mode: LearnModeType;
  singleDeck: Deck | null;
  progress: number;
  noun: string;
  filterParams: CardFilter[];
  tagFilter: string | null;
  onOpenNav: () => void;
  onExit: () => void;
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  current: Card | null;
  isTouchMode: boolean;
  onEdit: () => void;
  onToggleFlag: () => void;
  onBury: () => void;
  onSuspend: () => void;
  onShowShortcuts: () => void;
  m: number;
  simpleWrong: number;
  simpleRemaining: number;
  simpleMastered: number;
  isSimpleMode: boolean;
  phase: Phase;
}) {
  const info = computeHeaderInfo({ singleDeck, mode, filterParams, tagFilter });
  const progressVariant = modeProgressVariant(mode);

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-10 border-b bg-paper/85 backdrop-blur',
          mode === 'cram' && 'border-amber-500/30',
          mode === 'simple' && 'border-positive/30',
          mode === 'filtered-leech' && 'border-negative/30',
          mode === 'filtered-flagged' && 'border-amber-500/30',
          !['cram', 'simple', 'filtered-leech', 'filtered-flagged'].includes(mode) && 'border-line',
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
          <button
            type="button"
            onClick={onOpenNav}
            aria-label="Open navigation"
            title="Open navigation"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10"
          >
            <MenuIcon width={18} height={18} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-col items-start gap-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-0">
              <span className={cn('font-medium uppercase tracking-[0.14em] sm:truncate', mode === 'cram' && 'text-amber-600', mode === 'simple' && 'text-positive', mode === 'filtered-leech' && 'text-negative', mode === 'filtered-flagged' && 'text-amber-600', 'text-ink-faint')}>
                {info.title}
              </span>
              <span className="whitespace-nowrap tabular text-sm font-medium text-ink">
                {mode === 'simple'
                  ? `${Math.round((simpleMastered / Math.max(1, simpleMastered + simpleRemaining)) * 100)}%`
                  : `${Math.round(progress * 100)}% ${noun}`}
              </span>
            </div>
            <ProgressBar value={progress} height={8} variant={progressVariant} showLabel />
            {info.subtitle && (
              <div className="mt-1.5 text-[10px] text-ink-faint">{info.subtitle}</div>
            )}
          </div>

          <PomodoroTimer />

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Card actions"
              title="Card actions"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10"
            >
              <MoreIcon width={18} height={18} />
            </button>
            <AnimatePresence>
              {menuOpen && current && (
                isTouchMode ? (
                  <TouchMenuSheet
                    current={current}
                    onEdit={onEdit}
                    onToggleFlag={onToggleFlag}
                    onBury={onBury}
                    onSuspend={onSuspend}
                    onShowShortcuts={onShowShortcuts}
                    onClose={() => setMenuOpen(false)}
                    m={m}
                  />
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ duration: 0.12 * m }}
                    className="absolute right-0 top-11 z-20 w-52 overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl shadow-black/10"
                  >
                    <MenuItem icon={<EditIcon width={16} height={16} />} label="Edit card" onClick={onEdit} />
                    <MenuItem icon={<FlagIcon width={16} height={16} />} label={current.flagged ? 'Remove flag' : 'Flag card'} onClick={onToggleFlag} />
                    <MenuItem icon={<ClockIcon width={16} height={16} />} label="Bury until tomorrow" onClick={onBury} />
                    <MenuItem icon={<PauseIcon width={16} height={16} />} label="Suspend card" onClick={onSuspend} />
                    <div className="border-t border-line" />
                    <MenuItem icon={<KeyboardIcon width={16} height={16} />} label="Keyboard shortcuts" onClick={onShowShortcuts} />
                  </motion.div>
                )
              )}
            </AnimatePresence>
          </div>

          <Button variant="ghost" size="sm" onClick={onExit}>
            Exit
          </Button>
        </div>
      </header>

      {/* Simple mode: visual progress chips below the header */}
      {isSimpleMode && phase !== 'finished' && (
        <SimpleModeStats
          wrong={simpleWrong}
          remaining={simpleRemaining}
          mastered={simpleMastered}
          m={m}
        />
      )}
    </>
  );
}

export function LearnSkeleton({ mode }: { mode?: LearnModeType }) {
  const borderClass = mode === 'cram' ? 'border-amber-500/30' : mode === 'simple' ? 'border-positive/30' : 'border-line';
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className={cn('sticky top-0 z-10 border-b bg-paper/85 backdrop-blur', borderClass)}>
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
          <div className="h-11 w-11 animate-pulse rounded-lg bg-ink/10" />
          <div className="min-w-0 flex-1">
            <div className="mb-1 h-3 w-32 animate-pulse rounded bg-ink/10" />
            <div className="h-1.5 w-full animate-pulse rounded-full bg-ink/10" />
          </div>
          <div className="h-11 w-11 animate-pulse rounded-lg bg-ink/10" />
          <div className="h-9 w-16 animate-pulse rounded-lg bg-ink/10" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-8">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full rounded-3xl border border-line bg-surface px-8 py-12">
            <div className="mx-auto mb-4 h-3 w-20 animate-pulse rounded bg-ink/10" />
            <div className="mx-auto h-6 w-3/4 animate-pulse rounded bg-ink/10" />
          </div>
        </div>
        <div className="mt-8 flex flex-col items-center gap-2">
          <div className="h-12 w-full max-w-sm animate-pulse rounded-lg bg-ink/10" />
        </div>
      </main>
    </div>
  );
}

function buttonReveal(m: number) {
  return {
    hidden: { opacity: 0, y: 12, scale: 0.96 },
    visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18 * m, ease: [0.16, 1, 0.3, 1] } },
  };
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
      className="flex w-full min-h-11 items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10"
    >
      <span className="shrink-0 text-ink-faint">{icon}</span>
      {label}
    </button>
  );
}

function TouchMenuSheet({
  current,
  onEdit,
  onToggleFlag,
  onBury,
  onSuspend,
  onShowShortcuts,
  onClose,
  m,
}: {
  current: Card;
  onEdit: () => void;
  onToggleFlag: () => void;
  onBury: () => void;
  onSuspend: () => void;
  onShowShortcuts: () => void;
  onClose: () => void;
  m: number;
}) {
  const trapRef = useFocusTrap(true);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragY = useMotionValue(0);
  const springY = useSpring(dragY, { stiffness: 400, damping: 30 });
  const dragStartY = useRef(0);
  const dragStartTime = useRef(0);
  const isDragging = useRef(false);

  const handleDragHandleDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartTime.current = performance.now();
    sheetRef.current?.setPointerCapture(e.pointerId);
  }, []);

  const handleDragHandleMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dy = e.clientY - dragStartY.current;
    if (dy > 0) dragY.set(dy);
  }, [dragY]);

  const handleDragHandleUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    sheetRef.current?.releasePointerCapture(e.pointerId);
    const dy = dragY.get();
    const elapsed = performance.now() - dragStartTime.current;
    // Flick or drag past threshold closes the sheet.
    if (dy > 80 || (dy > 20 && elapsed < 200)) {
      dragY.set(0);
      onClose();
    } else {
      dragY.set(0);
    }
  }, [dragY, onClose]);

  return (
    <motion.div
      ref={trapRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 * m }}
      className="fixed inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-label="Card actions"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <motion.div
        ref={sheetRef}
        style={{ y: springY }}
        initial={{ y: 120, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 120, opacity: 0 }}
        transition={{ duration: 0.28 * m, ease: [0.16, 1, 0.3, 1] }}
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl border-t border-line-strong bg-surface px-6 py-6 shadow-2xl shadow-black/20"
        onClick={(e) => e.stopPropagation()}            onPointerMove={handleDragHandleMove}
            onPointerUp={handleDragHandleUp}
            onPointerCancel={handleDragHandleUp}
          >
            {/* Drag handle — wide touch target, springy drag-to-close. */}
            <div className="mb-5 flex justify-center">
              <div
                className="flex h-8 w-20 cursor-grab items-center justify-center active:cursor-grabbing"
                onPointerDown={handleDragHandleDown}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    hapticLight();
                    onClose();
                  }
                }}
                role="button"
                aria-label="Drag to close"
                tabIndex={0}
              >
                <div className="h-1.5 w-12 rounded-full bg-ink/15 transition-colors active:bg-ink/25" />
              </div>
            </div>
        <div className="mx-auto flex max-w-3xl flex-col gap-1">
          <TouchMenuButton
            icon={<EditIcon width={22} height={22} />}
            label="Edit card"
            onClick={() => { hapticLight(); onEdit(); }}
          />
          <TouchMenuButton
            icon={<FlagIcon width={22} height={22} />}
            label={current.flagged ? 'Remove flag' : 'Flag card'}
            onClick={() => { hapticLight(); onToggleFlag(); }}
          />
          <TouchMenuButton
            icon={<ClockIcon width={22} height={22} />}
            label="Bury until tomorrow"
            onClick={() => { hapticLight(); onBury(); }}
          />
          <TouchMenuButton
            icon={<PauseIcon width={22} height={22} />}
            label="Suspend card"
            onClick={() => { hapticLight(); onSuspend(); }}
          />
          <div className="my-2 border-t border-line" />
          <TouchMenuButton
            icon={<KeyboardIcon width={22} height={22} />}
            label="Keyboard shortcuts"
            onClick={() => { hapticLight(); onShowShortcuts(); }}
          />
          <button
            type="button"
            onClick={() => { hapticLight(); onClose(); }}
            className="mt-2 flex h-14 w-full items-center justify-center rounded-xl bg-ink/5 text-sm font-medium text-ink-soft transition-colors active:bg-ink/10"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TouchMenuButton({
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
      className="flex h-14 w-full items-center gap-4 rounded-xl px-4 text-left text-base text-ink transition-colors hover:bg-ink/5 active:bg-ink/10"
    >
      <span className="shrink-0 text-ink-faint">{icon}</span>
      {label}
    </button>
  );
}

/** Beautiful visual stat chips for simple mode — replaces the plain text stats. */
function SimpleModeStats({
  wrong,
  remaining,
  mastered,
  m,
}: {
  wrong: number;
  remaining: number;
  mastered: number;
  m: number;
}) {
  const total = mastered + remaining;
  const pct = total > 0 ? mastered / total : 0;
  const r = 18;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - pct);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 * m, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto mt-3 flex w-full max-w-3xl items-center gap-3 px-6"
    >
      {/* Circular progress ring */}
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
        <svg width="44" height="44" viewBox="0 0 44 44" className="absolute inset-0">
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            className="stroke-ink/10"
            strokeWidth="3"
          />
          <motion.circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            className="stroke-positive"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: dashOffset }}
            transition={{ duration: 0.6 * m, ease: [0.16, 1, 0.3, 1] }}
            transform="rotate(-90 22 22)"
          />
        </svg>
        <span className="text-[10px] font-medium tabular text-positive">
          {Math.round(pct * 100)}%
        </span>
      </div>

      {/* Stat chips */}
      <div className="flex flex-1 items-center gap-2">
        <StatChip
          icon={<CloseIcon width={14} height={14} />}
          value={wrong}
          label="wrong"
          colour="negative"
        />
        <StatChip
          icon={<ClockIcon width={14} height={14} />}
          value={remaining}
          label="remaining"
          colour="amber"
        />
        <StatChip
          icon={<CheckIcon width={14} height={14} />}
          value={mastered}
          label="correct"
          colour="positive"
        />
      </div>
    </motion.div>
  );
}

function StatChip({
  icon,
  value,
  label,
  colour,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  colour: 'negative' | 'amber' | 'positive';
}) {
  const colourMap = {
    negative: 'bg-negative/10 text-negative border-negative/20',
    amber: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    positive: 'bg-positive/10 text-positive border-positive/20',
  };
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        colourMap[colour],
      )}
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span className="tabular font-semibold">{value}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}

function TouchBottomSheet({
  phase,
  gradingMode,
  onReveal,
  onHide,
  onAnswer,
  m,
  isTypingCard,
}: {
  phase: Phase;
  gradingMode: 'silent' | 'manual';
  onReveal: () => void;
  onHide: () => void;
  onAnswer: (input: boolean | Grade, source?: 'touch' | 'keyboard') => void;
  m: number;
  isTypingCard?: boolean;
}) {
  return (
    <AnimatePresence mode="wait">
      {phase === 'question' ? (
        <motion.div
          key="touch-show"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.22 * m, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-0 left-0 right-0 z-20 rounded-t-3xl border-t border-line-strong bg-surface px-6 py-6 shadow-2xl shadow-black/15"
        >
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-3">
            {isTypingCard ? (
              <p className="text-sm text-ink-faint">Type your answer above, then tap Check</p>
            ) : (
              <p className="text-sm text-ink-faint">Tap the card to reveal</p>
            )}
            {!isTypingCard && (
              <Button variant="primary" size="lg" className="w-full" onClick={() => { hapticLight(); onReveal(); }}>
                Show answer
              </Button>
            )}
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="touch-grade"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.22 * m, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-0 left-0 right-0 z-20 rounded-t-3xl border-t border-line-strong bg-surface px-6 py-6 shadow-2xl shadow-black/15"
        >
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-3">
            {gradingMode === 'manual' ? (
              <div className="grid w-full grid-cols-2 gap-3">
                <Button variant="danger" size="lg" className="h-14 w-full" onClick={() => { hapticMedium(); void onAnswer(1, 'touch'); }}>
                  <CloseIcon width={20} height={20} />
                  Again
                </Button>
                <Button variant="secondary" size="lg" className="h-14 w-full" onClick={() => { hapticLight(); void onAnswer(2, 'touch'); }}>
                  Hard
                </Button>
                <Button variant="secondary" size="lg" className="h-14 w-full" onClick={() => { hapticLight(); void onAnswer(3, 'touch'); }}>
                  Good
                </Button>
                <Button variant="primary" size="lg" className="h-14 w-full" onClick={() => { hapticMedium(); void onAnswer(4, 'touch'); }}>
                  <CheckIcon width={20} height={20} />
                  Easy
                </Button>
              </div>
            ) : (
              <div className="flex w-full gap-3">
                <Button variant="danger" size="lg" className="h-14 flex-1" onClick={() => { hapticMedium(); void onAnswer(false, 'touch'); }}>
                  <CloseIcon width={20} height={20} />
                  No
                </Button>
                <Button variant="primary" size="lg" className="h-14 flex-1" onClick={() => { hapticMedium(); void onAnswer(true, 'touch'); }}>
                  <CheckIcon width={20} height={20} />
                  Yes
                </Button>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={onHide}>
              Hide answer
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A card that flips vertically to reveal its answer, and responds to touch and mouse
 * gestures: tap to flip, swipe left for No, swipe right for Yes. The swipe interaction
 * is springy — the card follows the finger, a directional glow hints at the outcome,
 * and releasing past the threshold commits the answer with a satisfying snap.
 */
function FlipCard({
  card,
  revealed,
  motionSpeed,
  phase,
  isTouchMode,
  menuOpen,
  editing,
  navOpen,
  hintsOpen,
  onReveal,
  onHide,
  onAnswer,
  typedAnswer,
  mode,
}: {
  card: Card;
  revealed: boolean;
  motionSpeed: MotionSpeed;
  phase: Phase;
  isTouchMode: boolean;
  menuOpen: boolean;
  editing: boolean;
  navOpen: boolean;
  hintsOpen: boolean;
  onReveal: () => void;
  onHide: () => void;
  onAnswer: (input: boolean | Grade, source?: 'touch' | 'keyboard') => void;
  typedAnswer?: string;
  mode: LearnModeType;
}) {
  const m = speedMultiplier(motionSpeed);
  const isCloze = card.type === 'cloze';
  const isTyping = card.type === 'typing';
  const [swipe, setSwipe] = useState({ x: 0, hint: null as 'left' | 'right' | null });
  const [hasSwiped, setHasSwiped] = useState(() => {
    try {
      return localStorage.getItem('lacuna.learnHints') === '1';
    } catch {
      return false;
    }
  });
  const swipeRef = useRef({ x: 0, startX: 0, startY: 0, dragging: false, isSwipe: false });
  const selectionLenRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const swipeThreshold = 60;
  const maxDrag = 180;

  // Spring-physics x position for the snap-back so the card feels tactile.
  const swipeXMotion = useMotionValue(0);
  const swipeXSpring = useSpring(swipeXMotion, { stiffness: 480, damping: 32, mass: 0.9 });

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (swipeRef.current.dragging) return;
    // Ignore swipes when any overlay is open.
    if (menuOpen || editing || navOpen || hintsOpen) return;
    swipeRef.current = {
      x: 0,
      startX: e.clientX,
      startY: e.clientY,
      dragging: true,
      isSwipe: false,
    };
    selectionLenRef.current = window.getSelection()?.toString().length ?? 0;
    containerRef.current?.setPointerCapture?.(e.pointerId);
    setSwipe({ x: 0, hint: null });
  }, [menuOpen, editing, navOpen, hintsOpen]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!swipeRef.current.dragging) return;
    const dx = e.clientX - swipeRef.current.startX;
    const dy = e.clientY - swipeRef.current.startY;
    // Decide whether this is a horizontal swipe or a vertical scroll.
    // Swipe-to-grade is only enabled during the answer phase, matching keyboard shortcuts.
    if (!swipeRef.current.isSwipe && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      if (phase === 'answer') {
        swipeRef.current.isSwipe = true;
      }
    }
    if (!swipeRef.current.isSwipe) return;
    // Clamp the visual drag so the card never flies off-screen.
    const clamped = Math.max(-maxDrag, Math.min(maxDrag, dx));
    swipeRef.current.x = clamped;
    swipeXMotion.set(clamped);
    const hint: 'left' | 'right' | null = clamped < -swipeThreshold / 2 ? 'left' : clamped > swipeThreshold / 2 ? 'right' : null;
    setSwipe({ x: clamped, hint });
  }, [phase, swipeXMotion]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!swipeRef.current.dragging) return;
    containerRef.current?.releasePointerCapture?.(e.pointerId);
    swipeRef.current.dragging = false;
    const dx = swipeRef.current.x;
    const wasSwipe = swipeRef.current.isSwipe;
    swipeRef.current.isSwipe = false;
    if (wasSwipe) {
      if (dx < -swipeThreshold) {
        // Swipe left = No
        if (phase === 'answer') {
          hapticMedium();
          setHasSwiped(true);
          try { localStorage.setItem('lacuna.learnHints', '1'); } catch { /* ignore */ }
          swipeXMotion.set(0);
          setSwipe({ x: 0, hint: null });
          void onAnswer(false, 'touch');
        } else {
          // Snap back if not in answer phase.
          swipeXMotion.set(0);
          setSwipe({ x: 0, hint: null });
        }
      } else if (dx > swipeThreshold) {
        // Swipe right = Yes
        if (phase === 'answer') {
          hapticMedium();
          setHasSwiped(true);
          try { localStorage.setItem('lacuna.learnHints', '1'); } catch { /* ignore */ }
          swipeXMotion.set(0);
          setSwipe({ x: 0, hint: null });
          void onAnswer(true, 'touch');
        } else {
          swipeXMotion.set(0);
          setSwipe({ x: 0, hint: null });
        }
      } else {
        // Not far enough — spring back.
        swipeXMotion.set(0);
        setSwipe({ x: 0, hint: null });
      }
    } else {
      // It was a tap/click — flip the card unless the user selected text.
      const selection = window.getSelection();
      const selectionNow = selection?.toString().length ?? 0;
      const selectionGrew = selectionNow > selectionLenRef.current;
      const isInsideCard = selection && containerRef.current ? containerRef.current.contains(selection.anchorNode) : false;
      setSwipe({ x: 0, hint: null });
      if (!selectionGrew || !isInsideCard) {
        if (phase === 'question') onReveal();
        else if (phase === 'answer') onHide();
      }
    }
  }, [phase, onReveal, onHide, onAnswer, swipeXMotion]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    containerRef.current?.releasePointerCapture?.(e.pointerId);
    swipeRef.current.dragging = false;
    swipeRef.current.isSwipe = false;
    swipeXMotion.set(0);
    setSwipe({ x: 0, hint: null });
  }, [swipeXMotion]);

  // Safety net: clear any lingering swipe state when the card flips back to question.
  useEffect(() => {
    if (phase === 'question') {
      swipeXMotion.set(0);
      setSwipe({ x: 0, hint: null });
    }
  }, [phase, swipeXMotion]);

  return (
    <div
      className="flex flex-1 items-center justify-center"
      style={{ perspective: '1600px' }}
    >
      <div
        ref={containerRef}
        role="button"
        aria-label={revealed ? 'Hide answer' : 'Show answer'}
        className="relative w-full cursor-pointer"
        style={{ transformStyle: 'preserve-3d', touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {/* Swipe hint glow — appears during a drag to whisper the outcome.
            Positioned behind the card so the border stays crisp. */}
        <AnimatePresence>
          {swipe.hint && (
            <motion.div
              aria-hidden
              key={swipe.hint}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x: swipe.x }}
              exit={{ opacity: 0 }}
              transition={{ opacity: { duration: 0.12 * m }, x: { duration: 0 } }}
              className={
                'pointer-events-none absolute inset-y-0 z-0 w-56 rounded-3xl ' +
                (swipe.hint === 'right'
                  ? '-right-56 bg-gradient-to-r from-positive/20 to-transparent'
                  : '-left-56 bg-gradient-to-l from-negative/15 to-transparent')
              }
            />
          )}
        </AnimatePresence>

        {/* Touch swipe indicators — persistent hints that show the available gestures. */}
        {isTouchMode && phase === 'answer' && !hasSwiped && !swipe.hint && !menuOpen && !editing && !navOpen && !hintsOpen && (
          <>
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 z-20 flex items-center"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 0.5, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.6, duration: 0.35 * m, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex flex-col items-center gap-1 rounded-r-lg bg-negative/10 px-2 py-3">
                <CloseIcon width={16} height={16} className="text-negative" />
                <span className="text-[10px] text-negative">Swipe left</span>
              </div>
            </motion.div>
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 0.5, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.6, duration: 0.35 * m, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex flex-col items-center gap-1 rounded-l-lg bg-positive/10 px-2 py-3">
                <CheckIcon width={16} height={16} className="text-positive" />
                <span className="text-[10px] text-positive">Swipe right</span>
              </div>
            </motion.div>
          </>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={revealed ? 'back' : 'front'}
            initial={{ rotateX: -92, opacity: 0, scale: 0.97, x: swipe.x }}
            animate={{ rotateX: 0, opacity: 1, scale: 1 }}
            exit={{ rotateX: 92, opacity: 0, scale: 0.97, x: swipe.x }}
            transition={{
              x: { type: 'spring', stiffness: 480, damping: 32, mass: 0.9 },
              rotateX: { duration: 0.32 * m, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.32 * m, ease: [0.16, 1, 0.3, 1] },
              scale: { duration: 0.32 * m, ease: [0.16, 1, 0.3, 1] },
            }}
            style={{ transformOrigin: 'center center', x: swipeXSpring }}
            className={cn(
              'relative z-10 rounded-3xl border bg-surface px-8 py-14 md:px-12 md:py-16',
              modeBorderClass(mode, revealed),
            )}
          >
            {/* Mode-aware label pill */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 * m, delay: 0.1 * m, ease: [0.16, 1, 0.3, 1] }}
              className="mb-6 flex justify-center"
            >
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]',
                  revealed
                    ? isTyping
                      ? 'bg-accent/10 text-accent'
                      : 'bg-positive/10 text-positive'
                    : isCloze
                      ? 'bg-accent/10 text-accent'
                      : isTyping
                        ? 'bg-accent/10 text-accent'
                        : 'bg-ink/5 text-ink-soft',
                )}
              >
                {revealed ? (
                  isTyping ? (
                    <>
                      <CheckIcon width={12} height={12} />
                      Your answer
                    </>
                  ) : (
                    <>
                      <CheckIcon width={12} height={12} />
                      Answer
                    </>
                  )
                ) : isCloze ? (
                  <>
                    <EditIcon width={12} height={12} />
                    Fill the gap
                  </>
                ) : isTyping ? (
                  <>
                    <KeyboardIcon width={12} height={12} />
                    Type the answer
                  </>
                ) : (
                  <>
                    <HelpIcon width={12} height={12} />
                    Question
                  </>
                )}
              </span>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24 * m, delay: 0.14 * m, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto max-w-prose text-center text-xl leading-relaxed md:text-2xl"
            >
              <CardContent card={card} side={revealed ? 'back' : 'front'} />
            </motion.div>
            {/* For typing cards in answer phase, show the typed answer and correct answer */}
            {isTyping && revealed && typedAnswer !== undefined && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 * m, delay: 0.2 * m, ease: [0.16, 1, 0.3, 1] }}
                className="mx-auto mt-6 max-w-prose border-t border-line pt-6 text-center"
              >
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-ink-faint">
                  Your answer
                </div>
                <div className="mb-4 text-lg text-ink">
                  {typedAnswer.trim() || <span className="italic text-ink-faint">(empty)</span>}
                </div>
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-accent">
                  Correct answer
                </div>
                <div className="text-lg text-accent">
                  <CardContent card={card} side="back" />
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
