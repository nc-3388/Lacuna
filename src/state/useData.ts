// Reactive data hooks backed by Dexie's live queries. Components re-render
// automatically when the underlying IndexedDB records change.

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import type {
  BackupSnapshot,
  Card,
  Deck,
  SessionHistoryEntry,
  UserPerformance,
} from '../db/types';
import { progressValue } from '../fsrs/objective';
import { availableCards, studyPool } from '../fsrs/eligibility';
import { computeStudyStats, type StudyStats } from '../fsrs/stats';

export function useDecks(): Deck[] | undefined {
  return useLiveQuery(() => db.decks.orderBy('createdAt').toArray(), []);
}

export function useDeck(deckId: string | undefined): Deck | undefined {
  return useLiveQuery(
    () => (deckId ? db.decks.get(deckId) : undefined),
    [deckId],
  );
}

export function useCard(cardId: string | undefined): Card | undefined {
  return useLiveQuery(
    () => (cardId ? db.cards.get(cardId) : undefined),
    [cardId],
  );
}

export function useCards(deckId: string | undefined): Card[] | undefined {
  return useLiveQuery(
    () => (deckId ? db.cards.where('deckId').equals(deckId).toArray() : []),
    [deckId],
  );
}

/** Every card across all decks, for global search. */
export function useAllCards(): Card[] | undefined {
  return useLiveQuery(() => db.cards.toArray(), []);
}

/** Automatic-backup restore points, newest first. */
export function useBackups(): BackupSnapshot[] | undefined {
  return useLiveQuery(() => db.backups.orderBy('createdAt').reverse().toArray(), []);
}

export function useDeckPerformance(
  deckId: string | undefined,
): UserPerformance | undefined {
  return useLiveQuery(
    () => (deckId ? db.userPerformance.get(deckId) : undefined),
    [deckId],
  );
}

export function useSessionHistory(
  deckId: string | undefined,
): SessionHistoryEntry[] | undefined {
  return useLiveQuery(
    () =>
      deckId
        ? db.sessionHistory.where('deckId').equals(deckId).sortBy('timestamp')
        : [],
    [deckId],
  );
}

/** All session-history entries across every deck, sorted by timestamp. */
export function useAllSessionHistory(): SessionHistoryEntry[] | undefined {
  return useLiveQuery(() => db.sessionHistory.orderBy('timestamp').toArray(), []);
}

/**
 * Dashboard study signals (streak, reviews today, seven-day time forecast), recomputed
 * reactively from review history, card due dates and per-deck response-time calibration.
 */
export function useStudyStats(): StudyStats | undefined {
  return useLiveQuery(async () => {
    const [cards, perf] = await Promise.all([
      db.cards.toArray(),
      db.userPerformance.toArray(),
    ]);
    // Only trust a deck's mean once it has at least one correct review to learn from.
    const deckSeconds = new Map<string, number>();
    for (const p of perf) {
      if (p.totalCorrectReviews > 0 && p.runningMeanResponseTime > 0) {
        deckSeconds.set(p.deckId, p.runningMeanResponseTime);
      }
    }
    return computeStudyStats(cards, deckSeconds);
  }, []);
}

export interface DeckSummary {
  count: number;
  /** Objective-aware progress (0..1): mean predicted R, or fraction secured. */
  mastery: number;
  /** Number of cards that have never been reviewed. */
  unreviewed: number;
  /** Cards a session would serve today (available, new-card cap applied). */
  eligible: number;
}

/**
 * Per-deck summary statistics for the dashboard: card count, mastery fraction and
 * how many cards remain unreviewed. Recomputed reactively as cards or decks change.
 */
export function useDeckSummaries(): Record<string, DeckSummary> | undefined {
  return useLiveQuery(async () => {
    const [decks, cards] = await Promise.all([
      db.decks.toArray(),
      db.cards.toArray(),
    ]);
    return computeDeckSummaries(decks, cards);
  }, []);
}

/** Pure computation behind useDeckSummaries so it can be reused by combined hooks. */
export function computeDeckSummaries(
  decks: Deck[],
  cards: Card[],
): Record<string, DeckSummary> {
  const deckById = new Map(decks.map((d) => [d.id, d]));
  const byDeck: Record<string, Card[]> = {};
  for (const card of cards) (byDeck[card.deckId] ??= []).push(card);

  const summaries: Record<string, DeckSummary> = {};
  for (const deck of decks) {
    const deckCards = byDeck[deck.id] ?? [];
    // Suspended/buried cards are excluded entirely from the objective denominator.
    const available = availableCards(deckCards);
    summaries[deck.id] = {
      count: deckCards.length,
      mastery: progressValue(available, deck),
      unreviewed: available.filter((c) => c.lastReviewed === null).length,
      eligible: studyPool(deckCards, deck).length,
    };
  }
  // Skip orphaned card sets whose deck was removed mid-transaction.
  for (const [deckId, deckCards] of Object.entries(byDeck)) {
    if (!deckById.has(deckId)) continue;
    summaries[deckId] ??= {
      count: deckCards.length,
      mastery: 0,
      unreviewed: deckCards.length,
      eligible: 0,
    };
  }
  return summaries;
}

/**
 * Single aggregated live query for the Dashboard. Returns decks, all cards,
 * per-deck summaries and global study stats in one reactive read so a shared
 * transaction (e.g. a review that touches cards + performance) triggers only one
 * re-render instead of four.
 */
export function useDashboardData():
  | {
      decks: Deck[];
      allCards: Card[];
      summaries: Record<string, DeckSummary>;
      stats: StudyStats;
    }
  | undefined {
  return useLiveQuery(async () => {
    const [decks, cards, perf] = await Promise.all([
      db.decks.toArray(),
      db.cards.toArray(),
      db.userPerformance.toArray(),
    ]);
    const summaries = computeDeckSummaries(decks, cards);
    const deckSeconds = new Map<string, number>();
    for (const p of perf) {
      if (p.totalCorrectReviews > 0 && p.runningMeanResponseTime > 0) {
        deckSeconds.set(p.deckId, p.runningMeanResponseTime);
      }
    }
    const stats = computeStudyStats(cards, deckSeconds);
    return { decks, allCards: cards, summaries, stats };
  }, []);
}
