// The single source of truth for a deck's exam objective.
//
// The whole point of this module is that the scheduler's sort metric and the
// progress bar are *both* derived from `deck.examObjective`, so they can never
// disagree. Anything that ranks cards or reports progress must go through here.
//
//  - "expectedMarks" (default): maximise the sum of predicted exam-day
//    retrievability. Greedily, that means reviewing the card with the largest
//    Delta-R, so the scheduler sorts by Delta-R and the bar shows the *mean*
//    predicted R across the deck.
//  - "securedTopics": maximise how many cards are at or above 0.90 on exam day.
//    The scheduler prioritises cards a review would push across the 0.90 line,
//    cheapest (closest to the line) first; the bar shows the fraction of cards
//    already at or above 0.90.

import { makeEngine } from './fsrs';
import {
  deltaR,
  rAtExam,
  rAtExamIfReviewedNow,
  simContext,
  type SimContext,
} from './forwardSim';
import { averagePredictedRetrievability, masteryFraction } from './progress';
import { schedulingHorizon } from './horizon';
import { availableCards } from './eligibility';
import { MASTERY_R } from './params';
import type { Card, Deck, ExamObjective } from '../db/types';

/**
 * Below this Delta-R, a further review is deemed to add no meaningful marks, so
 * an "expectedMarks" session is considered complete.
 */
const EXPECTED_MARKS_EPSILON = 5e-3;

/** Pre-built scoring context for a deck (engine + decay + objective). */
export interface ObjectiveContext {
  objective: ExamObjective;
  deck: Deck;
  ctx: SimContext;
}

/** Build a scoring context once per session/render (one FSRS engine per deck). */
export function makeObjectiveContext(deck: Deck): ObjectiveContext {
  return {
    objective: deck.examObjective,
    deck,
    ctx: simContext(deck, makeEngine(deck.fsrsParameters)),
  };
}

/**
 * Progress-bar value (0..1) for the deck's objective. This is the *only* function
 * the UI should use for the bar, guaranteeing it matches the scheduler.
 */
export function progressValue(
  cards: Card[],
  deck: Deck,
  now: number = Date.now(),
): number {
  const available = availableCards(cards, now);
  return deck.examObjective === 'securedTopics'
    ? masteryFraction(available, deck, now)
    : averagePredictedRetrievability(available, deck, now);
}

/** A short noun for compact headers, e.g. "62% predicted score" / "62% secured". */
export function progressNoun(deck: Deck): string {
  return deck.examObjective === 'securedTopics' ? 'secured' : 'predicted score';
}

/** A heading for the deck/summary panels. */
export function progressHeading(deck: Deck): string {
  return deck.examObjective === 'securedTopics'
    ? 'Predicted mastery on exam day'
    : 'Predicted exam score';
}

/** A one-line description of exactly what the progress value measures. */
export function progressDescription(deck: Deck): string {
  return deck.examObjective === 'securedTopics'
    ? 'Proportion of cards predicted to be recalled with 90% or higher retrievability when your exam arrives.'
    : 'Mean predicted retrievability across the deck on your exam day.';
}

/**
 * Scheduler sort key for a card under the deck's objective. Higher = serve sooner.
 */
export function scoreCard(
  card: Card,
  oc: ObjectiveContext,
  now: number = Date.now(),
): number {
  const { deck, ctx } = oc;
  const horizon = schedulingHorizon(deck, now);

  if (oc.objective === 'expectedMarks') {
    // Greedy maximisation of Sigma R: serve the largest expected lift first.
    return deltaR(card, horizon, now, ctx);
  }

  // securedTopics: rank cards by whether reviewing now secures them (>= 0.90),
  // cheapest to secure first.
  const rNo = rAtExam(card, horizon, now, ctx.decay);
  if (rNo >= MASTERY_R) return -1; // already secured: nothing to gain, lowest priority
  const rYes = rAtExamIfReviewedNow(card, ctx.expectedGrade, horizon, now, ctx);
  if (rYes >= MASTERY_R) {
    // Securable now. A higher current rNo means it is closer to the line and so
    // cheaper to secure; rank those first. The +1 keeps every securable card
    // above every not-yet-securable one.
    return 1 + rNo;
  }
  // Cannot be secured by a single review yet: make the most progress available.
  return rYes;
}

export interface ScoredCard {
  card: Card;
  score: number;
}

/** Score and sort all cards in descending order under the deck's objective. */
export function sortByObjective(
  cards: Card[],
  oc: ObjectiveContext,
  now: number = Date.now(),
): ScoredCard[] {
  return cards
    .map((card) => ({ card, score: scoreCard(card, oc, now) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Whether the session goal for the deck's objective has been reached.
 *  - securedTopics: every card is at or above 0.90 on exam day.
 *  - expectedMarks: no card offers a meaningful further gain in Sigma R.
 */
export function isObjectiveComplete(
  cards: Card[],
  oc: ObjectiveContext,
  now: number = Date.now(),
): boolean {
  if (cards.length === 0) return true;
  if (oc.objective === 'securedTopics') {
    return masteryFraction(cards, oc.deck, now) >= 1;
  }
  const horizon = schedulingHorizon(oc.deck, now);
  const bestGain = cards.reduce(
    (best, card) => Math.max(best, deltaR(card, horizon, now, oc.ctx)),
    0,
  );
  return bestGain < EXPECTED_MARKS_EPSILON;
}
