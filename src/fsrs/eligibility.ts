// Which cards are eligible to be studied (and counted) right now.
//
// This is the single source of truth that keeps the scheduler and the progress
// bar in agreement when cards are suspended, buried, or held back by a per-deck
// new-card-per-day cap.
//
//  - Suspended/buried cards are excluded *entirely*: they drop out of the study
//    pool AND of the progress/objective denominator while excluded.
//  - The new-card cap only rations *today's* study pool (which new cards a session
//    will introduce). It deliberately does not change the dashboard denominator, so
//    the deck's exam-day trajectory stays honest while a session paces new material.

import { MS_PER_DAY } from './params';
import type { Card, Deck } from '../db/types';

/** Whether a card may be studied or counted at `now` (not suspended, not buried). */
export function isAvailable(card: Card, now: number = Date.now()): boolean {
  if (card.suspended) return false;
  if (card.buriedUntil != null && card.buriedUntil > now) return false;
  return true;
}

/** All cards that are available (not suspended/buried) at `now`. */
export function availableCards(cards: Card[], now: number = Date.now()): Card[] {
  return cards.filter((c) => isAvailable(c, now));
}

/** How many brand-new cards a card-set has already introduced in the last 24 hours.
 *  Uses a rolling window so a late-night session that crosses midnight does not
 *  double-spend the daily new-card budget.
 */
export function newCardsIntroducedRecently(cards: Card[], now: number = Date.now()): number {
  const cutoff = now - MS_PER_DAY;
  return cards.filter((c) => {
    if (c.history.length === 0) return false;
    const firstReview = c.history.reduce((min, h) => Math.min(min, h.timestamp), Infinity);
    return firstReview !== Infinity && firstReview > cutoff;
  }).length;
}

/**
 * The set of cards a study session may serve right now for a deck: available cards,
 * with brand-new (state 0) cards rationed by the deck's `newCardsPerDay` cap. An
 * undefined/zero cap means unlimited. New cards are admitted oldest-first so the
 * deck's authored order is respected.
 */
export function studyPool(cards: Card[], deck: Deck, now: number = Date.now()): Card[] {
  // Archived decks are withdrawn from all study, but their cards are retained and
  // still counted in progress/objective denominators (which use availableCards).
  if (deck.archived) return [];
  const available = availableCards(cards, now);
  const cap = Math.floor(deck.newCardsPerDay ?? 0);
  if (cap <= 0) return available; // unlimited

  const budget = Math.max(cap - newCardsIntroducedRecently(available, now), 0);
  const newAllowed = new Set(
    available
      .filter((c) => c.state === 0)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, budget)
      .map((c) => c.id),
  );
  return available.filter((c) => c.state !== 0 || newAllowed.has(c.id));
}
