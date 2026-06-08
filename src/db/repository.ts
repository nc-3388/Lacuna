// High-level data operations that combine the FSRS engine with persistence.
// Components call these rather than touching Dexie tables directly.

import { db, makeId } from './schema';
import type {
  Card,
  CardType,
  Deck,
  Grade,
  ReviewLog,
  SessionHistoryEntry,
  UserPerformance,
} from './types';
import { applyReview, makeEngine } from '../fsrs/fsrs';
import { defaultFsrsParameters, FSRS_VERSION } from '../fsrs/params';
import { emptyPerformance, updatePerformance } from '../fsrs/grading';
import { averagePredictedRetrievability } from '../fsrs/progress';
import { defaultExamDate } from '../utils/datetime';
import { scheduleAssetGc } from './assets';

/** Convert low-level IndexedDB errors into user-friendly messages. */
function friendlyDbError(err: unknown): Error {
  if (err instanceof DOMException && err.name === 'QuotaExceededError') {
    return new Error('Your browser storage is full. Free up space or export your data to a file.');
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export async function createDeck(name: string, colour?: string): Promise<Deck> {
  try {
    const createdAt = Date.now();
    const deck: Deck = {
      id: makeId(),
      name: name.trim() || 'Untitled deck',
      examDate: defaultExamDate(createdAt),
      createdAt,
      fsrsVersion: FSRS_VERSION,
      fsrsParameters: defaultFsrsParameters(),
      examObjective: 'expectedMarks',
      lastInteractedAt: createdAt,
      ...(colour ? { colour } : {}),
    };
    await db.decks.add(deck);
    await db.userPerformance.add(emptyPerformance(deck.id));
    return deck;
  } catch (err) {
    throw friendlyDbError(err);
  }
}

export async function updateDeck(id: string, changes: Partial<Deck>): Promise<void> {
  try {
    await db.decks.update(id, changes);
  } catch (err) {
    throw friendlyDbError(err);
  }
}

/** Archive a deck: keep all data but withdraw it from active study and progress totals. */
export async function archiveDeck(id: string): Promise<void> {
  await db.decks.update(id, { archived: true });
}

/** Return an archived deck to active study. */
export async function unarchiveDeck(id: string): Promise<void> {
  await db.decks.update(id, { archived: false });
}

/** Set a deck's exam date (used to resolve the passed-exam state with a fresh date). */
export async function setExamDate(id: string, examDate: number): Promise<void> {
  await db.decks.update(id, { examDate });
}

export async function deleteDeck(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.decks,
    db.cards,
    db.sessionHistory,
    db.userPerformance,
    async () => {
      await db.cards.where('deckId').equals(id).delete();
      await db.sessionHistory.where('deckId').equals(id).delete();
      await db.userPerformance.delete(id);
      await db.decks.delete(id);
    },
  );
  scheduleAssetGc();
}

export async function deleteDecks(ids: string[]): Promise<void> {
  await db.transaction(
    'rw',
    db.decks,
    db.cards,
    db.sessionHistory,
    db.userPerformance,
    async () => {
      for (const id of ids) {
        await db.cards.where('deckId').equals(id).delete();
        await db.sessionHistory.where('deckId').equals(id).delete();
        await db.userPerformance.delete(id);
        await db.decks.delete(id);
      }
    },
  );
  scheduleAssetGc();
}

/** A complete copy of one or more decks and everything that hangs off them. */
export interface DeckSnapshot {
  decks: Deck[];
  cards: Card[];
  sessionHistory: SessionHistoryEntry[];
  userPerformance: UserPerformance[];
}

/**
 * Capture decks plus their cards, session history and performance before deletion,
 * so the action can be offered with an "Undo". Call this *before* deleteDecks.
 */
export async function snapshotDecks(ids: string[]): Promise<DeckSnapshot> {
  const idSet = new Set(ids);
  const [decks, cards, sessionHistory, userPerformance] = await Promise.all([
    db.decks.where('id').anyOf(ids).toArray(),
    db.cards.where('deckId').anyOf(ids).toArray(),
    db.sessionHistory.where('deckId').anyOf(ids).toArray(),
    db.userPerformance.where('deckId').anyOf(ids).toArray(),
  ]);
  // Guard against any stray records the indexes might miss.
  return {
    decks: decks.filter((d) => idSet.has(d.id)),
    cards,
    sessionHistory,
    userPerformance,
  };
}

/** Re-insert a previously captured DeckSnapshot (the inverse of deleteDecks). */
export async function restoreDecks(snapshot: DeckSnapshot): Promise<void> {
  try {
    await db.transaction(
      'rw',
      db.decks,
      db.cards,
      db.sessionHistory,
      db.userPerformance,
      async () => {
        await Promise.all([
          db.decks.bulkPut(snapshot.decks),
          db.cards.bulkPut(snapshot.cards),
          db.userPerformance.bulkPut(snapshot.userPerformance),
          // Drop the old auto-increment ids so Dexie reassigns them cleanly.
          db.sessionHistory.bulkAdd(
            snapshot.sessionHistory.map(({ id: _id, ...rest }) => rest as SessionHistoryEntry),
          ),
        ]);
      },
    );
  } catch (err) {
    throw friendlyDbError(err);
  }
}

/**
 * Merge several decks into a chosen target. The target keeps its name, exam date and
 * performance profile; all other decks' cards are reassigned to it, their session history
 * is concatenated onto the target, and the emptied decks are removed.
 */
export async function mergeDecks(sourceIds: string[], targetId: string): Promise<void> {
  const others = sourceIds.filter((id) => id !== targetId);
  if (others.length === 0) return;
  const now = Date.now();
  await db.transaction(
    'rw',
    db.decks,
    db.cards,
    db.sessionHistory,
    db.userPerformance,
    async () => {
      for (const sourceId of others) {
        await db.cards.where('deckId').equals(sourceId).modify({ deckId: targetId });
        await db.sessionHistory
          .where('deckId')
          .equals(sourceId)
          .modify({ deckId: targetId });
        await db.userPerformance.delete(sourceId);
        await db.decks.delete(sourceId);
      }
      await db.decks.update(targetId, { lastInteractedAt: now });
    },
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export async function createCard(
  deckId: string,
  type: CardType,
  front: string,
  back: string,
  tags: string[] = [],
): Promise<Card> {
  try {
    const card: Card = {
      id: makeId(),
      deckId,
      type,
      front,
      back,
      stability: null,
      difficulty: null,
      lastReviewed: null,
      reps: 0,
      lapses: 0,
      state: 0,
      due: null,
      scheduledDays: 0,
      learningSteps: 0,
      history: [],
      createdAt: Date.now(),
      tags,
      suspended: false,
      buriedUntil: null,
    };
    await db.cards.add(card);
    return card;
  } catch (err) {
    throw friendlyDbError(err);
  }
}

/**
 * Bulk-create cards from import drafts (front/back/type only). Returns the created
 * cards. createdAt is offset per row so the deck keeps the imported order.
 */
export async function createCards(
  deckId: string,
  drafts: { type: CardType; front: string; back: string; tags?: string[] }[],
): Promise<Card[]> {
  try {
    const now = Date.now();
    const cards: Card[] = drafts.map((draft, i) => ({
      id: makeId(),
      deckId,
      type: draft.type,
      front: draft.front,
      back: draft.back,
      stability: null,
      difficulty: null,
      lastReviewed: null,
      reps: 0,
      lapses: 0,
      state: 0,
      due: null,
      scheduledDays: 0,
      learningSteps: 0,
      history: [],
      createdAt: now + i,
      tags: draft.tags ?? [],
      suspended: false,
      buriedUntil: null,
    }));
    await db.cards.bulkAdd(cards);
    return cards;
  } catch (err) {
    throw friendlyDbError(err);
  }
}

/**
 * Create a front/back card together with its reverse (back becomes the prompt). The two
 * are ordinary, fully independent cards with their own FSRS state — editing or scheduling
 * one never touches the other. Tags are shared at creation. Returns both cards.
 */
export async function createCardWithReverse(
  deckId: string,
  front: string,
  back: string,
  tags: string[] = [],
): Promise<{ card: Card; reverse: Card }> {
  const card = await createCard(deckId, 'front_back', front, back, tags);
  const reverse = await createCard(deckId, 'front_back', back, front, tags);
  return { card, reverse };
}

/** Create a deck and immediately populate it with imported cards, in one go. */
export async function createDeckWithCards(
  name: string,
  drafts: { type: CardType; front: string; back: string; tags?: string[] }[],
): Promise<Deck> {
  try {
    const deck = await createDeck(name);
    if (drafts.length > 0) await createCards(deck.id, drafts);
    return deck;
  } catch (err) {
    throw friendlyDbError(err);
  }
}

export async function updateCard(id: string, changes: Partial<Card>): Promise<void> {
  try {
    await db.cards.update(id, changes);
    if ('front' in changes || 'back' in changes) {
      scheduleAssetGc();
    }
  } catch (err) {
    throw friendlyDbError(err);
  }
}

export async function deleteCards(ids: string[]): Promise<void> {
  await db.cards.bulkDelete(ids);
  scheduleAssetGc();
}

/** Capture card rows before deletion so the action can be offered with an "Undo". */
export async function snapshotCards(ids: string[]): Promise<Card[]> {
  return db.cards.where('id').anyOf(ids).toArray();
}

/** Re-insert previously captured cards (the inverse of deleteCards). */
export async function restoreCards(cards: Card[]): Promise<void> {
  try {
    await db.cards.bulkPut(cards);
  } catch (err) {
    throw friendlyDbError(err);
  }
}

export async function moveCards(ids: string[], targetDeckId: string): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    await db.cards.where('id').anyOf(ids).modify({ deckId: targetDeckId });
  });
}

/** Withhold a card from all study and from progress/objective until un-suspended. */
export async function suspendCard(id: string): Promise<void> {
  await db.cards.update(id, { suspended: true });
}

/** Return a suspended card to normal scheduling. */
export async function unsuspendCard(id: string): Promise<void> {
  await db.cards.update(id, { suspended: false });
}

/** Suspend or un-suspend many cards at once (used by the card list's bulk actions). */
export async function setCardsSuspended(ids: string[], suspended: boolean): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    await db.cards.where('id').anyOf(ids).modify({ suspended });
  });
}

/** Add a tag to many cards at once, leaving cards that already have it untouched. */
export async function addTagToCards(ids: string[], tag: string): Promise<void> {
  const clean = tag.trim();
  if (!clean) return;
  await db.transaction('rw', db.cards, async () => {
    await db.cards.where('id').anyOf(ids).modify((card) => {
      const tags = card.tags ?? [];
      if (!tags.includes(clean)) card.tags = [...tags, clean];
    });
  });
}

/** Remove a tag from many cards at once. */
export async function removeTagFromCards(ids: string[], tag: string): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    await db.cards.where('id').anyOf(ids).modify((card) => {
      if (card.tags?.length) card.tags = card.tags.filter((t) => t !== tag);
    });
  });
}

/** Skip a card until the given instant (defaults to the caller-supplied next midnight). */
export async function buryCard(id: string, until: number): Promise<void> {
  await db.cards.update(id, { buriedUntil: until });
}

/** Set or clear a card's flag (a user marker for quick filtering and follow-up). */
export async function setCardFlag(id: string, flagged: boolean): Promise<void> {
  await db.cards.update(id, { flagged });
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export interface RecordReviewArgs {
  card: Card;
  deck: Deck;
  grade: Grade;
  responseTimeSec: number;
  distracted: boolean;
  /** Whether the answer was correct (grade > 1); drives per-deck calibration stats. */
  correct: boolean;
  now?: number;
  /** Pre-computed deck cards to avoid re-reading the database on every review. */
  deckCards?: Card[];
}

/** The result of recording a review: the updated card plus undo bookkeeping. */
export interface RecordReviewResult {
  card: Card;
  /** Id of the SessionHistory row written for this review, so it can be undone. */
  sessionHistoryId: number;
}

/**
 * Record a single review: apply the FSRS update to the card, append a review log,
 * update the deck's calibration profile (correct reviews only), and write a
 * SessionHistory snapshot of the deck's average predicted exam-day retrievability.
 * Returns the updated card (for immediate re-scoring) and the SessionHistory id
 * (so the review can be undone, see undoReview).
 */
export async function recordReview(args: RecordReviewArgs): Promise<RecordReviewResult> {
  try {
    const { card, deck, grade, responseTimeSec, distracted, correct } = args;
    const now = args.now ?? Date.now();

  // All FSRS-6 maths is delegated to ts-fsrs via the engine wrapper.
  const engine = makeEngine(deck.fsrsParameters);
  const { memory, retrievabilityAtReview } = applyReview(engine, card, grade, now);

  const log: ReviewLog = {
    timestamp: now,
    grade,
    responseTimeSec,
    distracted,
    stabilityBefore: card.stability,
    stabilityAfter: memory.stability,
    difficultyBefore: card.difficulty,
    difficultyAfter: memory.difficulty,
    retrievabilityAtReview,
  };

  const updatedCard: Card = {
    ...card,
    stability: memory.stability,
    difficulty: memory.difficulty,
    lastReviewed: memory.lastReviewed,
    due: memory.due,
    scheduledDays: memory.scheduledDays,
    learningSteps: memory.learningSteps,
    reps: memory.reps,
    lapses: memory.lapses,
    state: memory.state,
    history: [...card.history, log],
  };

  const sessionHistoryId = await db.transaction(
    'rw',
    db.cards,
    db.decks,
    db.sessionHistory,
    db.userPerformance,
    async () => {
      await db.cards.put(updatedCard);
      await db.decks.update(deck.id, { lastInteractedAt: now });

      if (correct) {
        const perf =
          (await db.userPerformance.get(deck.id)) ?? emptyPerformance(deck.id);
        await db.userPerformance.put(updatePerformance(perf, responseTimeSec));
      }

      // Read deck cards inside the transaction so concurrent reviews cannot
      // race the average predicted retrievability calculation.
      const allDeckCards = await db.cards.where('deckId').equals(deck.id).toArray();
      const deckCards = allDeckCards.map((c) =>
        c.id === updatedCard.id ? updatedCard : c,
      );
      const avgRetrievability = averagePredictedRetrievability(deckCards, deck);

      return db.sessionHistory.add({
        timestamp: now,
        deckId: deck.id,
        averagePredictedRetrievability: avgRetrievability,
      });
    },
  );

    return { card: updatedCard, sessionHistoryId };
  } catch (err) {
    throw friendlyDbError(err);
  }
}

/** Snapshot needed to reverse a single review (see undoReview). */
export interface ReviewUndo {
  /** The card exactly as it was before the review. */
  cardBefore: Card;
  /** The deck's calibration profile before the review (null if none existed). */
  perfBefore: UserPerformance | null;
  /** The SessionHistory row id written by the review. */
  sessionHistoryId: number;
  /** The deck that was reviewed (in case the card was moved since). */
  deckId: string;
}

/**
 * Reverse the most recent review: restore the card and the deck's calibration
 * profile wholesale (no Welford inverse maths) and delete the SessionHistory row
 * the review appended. Single-step, used by the in-session Undo affordance.
 */
export async function undoReview(undo: ReviewUndo): Promise<void> {
  try {
    await db.transaction(
      'rw',
      db.cards,
      db.sessionHistory,
      db.userPerformance,
      async () => {
        await db.cards.put(undo.cardBefore);
        if (undo.perfBefore) {
          await db.userPerformance.put(undo.perfBefore);
        } else {
          await db.userPerformance.delete(undo.deckId);
        }
        await db.sessionHistory.delete(undo.sessionHistoryId);
      },
    );
  } catch (err) {
    throw friendlyDbError(err);
  }
}
