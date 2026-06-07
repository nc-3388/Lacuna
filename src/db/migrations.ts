// Schema migrations for upgrading existing user data to the FSRS-6 model.
//
// Pre-FSRS-6 decks stored only the 17-parameter FSRS-4.5 weights implicitly (the
// app's params were a module constant, never persisted) and cards carried only
// {stability, difficulty, lastReviewed}. These pure helpers add the new fields
// without dropping any existing user data; they are exercised directly by the
// migration unit test and also run inside the Dexie upgrade hook (see schema.ts).

import { defaultFsrsParameters, FSRS_VERSION } from '../fsrs/params';
import type { Card, Deck } from './types';

/** A deck as stored before FSRS-6: the new fields may be absent. */
export type LegacyDeck = Omit<
  Deck,
  'fsrsVersion' | 'fsrsParameters' | 'examObjective'
> &
  Partial<Pick<Deck, 'fsrsVersion' | 'fsrsParameters' | 'examObjective'>>;

/** A card as stored before FSRS-6: the new memory fields may be absent. */
export type LegacyCard = Omit<
  Card,
  'reps' | 'lapses' | 'state' | 'due' | 'scheduledDays' | 'learningSteps'
> &
  Partial<
    Pick<
      Card,
      'reps' | 'lapses' | 'state' | 'due' | 'scheduledDays' | 'learningSteps'
    >
  >;

/**
 * Bring a deck record up to the FSRS-6 schema. Decks tagged below FSRS-6 (or
 * with no parameters at all) are re-tagged `fsrsVersion = 6` and reseeded with
 * the default FSRS-6 parameter set; everything else about the deck is preserved.
 */
export function migrateDeckRecord(deck: LegacyDeck): Deck {
  const needsReseed = (deck.fsrsVersion ?? 0) < FSRS_VERSION || !deck.fsrsParameters;
  return {
    ...deck,
    fsrsVersion: FSRS_VERSION,
    fsrsParameters: needsReseed ? defaultFsrsParameters() : deck.fsrsParameters!,
    examObjective: deck.examObjective ?? 'expectedMarks',
  };
}

/**
 * Bring a card record up to the FSRS-6 schema. The existing stability/difficulty
 * remain valid under FSRS-6; the new bookkeeping fields are derived from the
 * card's review history where possible.
 */
export function migrateCardRecord(card: LegacyCard): Card {
  const reps = card.reps ?? card.history.length;
  const lapses =
    card.lapses ?? card.history.filter((log) => log.grade === 1).length;
  // New cards are State.New (0); previously reviewed cards are treated as Review (2).
  const state = card.state ?? (card.lastReviewed === null ? 0 : 2);
  return {
    ...card,
    reps,
    lapses,
    state,
    // If a pre-FSRS-6 card has no due date, estimate it from stability rather than
    // defaulting to lastReviewed (which would make it immediately due).
    due:
      card.due ??
      (card.lastReviewed != null && card.stability != null
        ? card.lastReviewed + Math.round(card.stability * 86_400_000)
        : card.lastReviewed),
    scheduledDays: card.scheduledDays ?? 0,
    learningSteps: card.learningSteps ?? 0,
    // Fields added after FSRS-6; default so older records and imports stay valid.
    tags: card.tags ?? [],
    suspended: card.suspended ?? false,
    buriedUntil: card.buriedUntil ?? null,
  };
}
