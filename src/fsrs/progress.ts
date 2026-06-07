// Deck-level retrievability metrics used by the progress bar and analytics.
// These read exam-day retrievability from the forward-simulation layer so they
// always agree with the scheduler (see src/fsrs/objective.ts).

import { rAtExam } from './forwardSim';
import { decayOf } from './fsrs';
import { schedulingHorizon } from './horizon';
import { MASTERY_R } from './params';
import type { Card, Deck } from '../db/types';

/** The deck's forgetting-curve decay exponent (= -w20). */
export function deckDecay(deck: Deck): number {
  return decayOf(deck.fsrsParameters);
}

/**
 * Predicted retrievability of a single card on the exam day, with no further
 * review. A never-reviewed card has no stability, so this is 0.
 */
export function predictedExamRetrievability(
  card: Card,
  deck: Deck,
  now: number = Date.now(),
): number {
  return rAtExam(card, schedulingHorizon(deck, now), now, deckDecay(deck));
}

/** Fraction (0..1) of cards predicted to be at or above the mastery threshold on exam day. */
export function masteryFraction(
  cards: Card[],
  deck: Deck,
  now: number = Date.now(),
): number {
  if (cards.length === 0) return 1;
  const decay = deckDecay(deck);
  const horizon = schedulingHorizon(deck, now);
  const mastered = cards.filter(
    (c) => rAtExam(c, horizon, now, decay) >= MASTERY_R,
  ).length;
  return mastered / cards.length;
}

/** Average predicted exam-day retrievability across a deck (0..1). */
export function averagePredictedRetrievability(
  cards: Card[],
  deck: Deck,
  now: number = Date.now(),
): number {
  if (cards.length === 0) return 1;
  const decay = deckDecay(deck);
  const horizon = schedulingHorizon(deck, now);
  const total = cards.reduce(
    (sum, c) => sum + rAtExam(c, horizon, now, decay),
    0,
  );
  return total / cards.length;
}
