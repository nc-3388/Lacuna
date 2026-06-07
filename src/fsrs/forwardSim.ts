// Forward-simulation layer (our own code, layered on top of ts-fsrs).
//
// Lacuna does NOT use ts-fsrs for *scheduling*. ts-fsrs answers "when should this
// card next be due?"; we instead ask "what will retrievability be on the exam
// date, and how much does reviewing now improve it?". This module is pure: it
// touches neither IndexedDB nor React, so every function here is unit-testable.

import { Rating, type FSRS, type Grade as TsGrade } from 'ts-fsrs';
import { toTsCard, decayOf } from './fsrs';
import { MS_PER_DAY } from './params';
import type { Card, Deck, Grade } from '../db/types';

/**
 * Curve factor for the FSRS-6 power-law forgetting curve.
 *
 *   factor = 0.9^(1/decay) - 1
 *
 * With decay = -0.5 (the fixed FSRS-4.5 decay) this is exactly 19/81, so the
 * FSRS-6 curve reduces to the FSRS-4.5 curve.
 */
export function curveFactor(decay: number): number {
  return Math.pow(0.9, 1 / decay) - 1;
}

/**
 * FSRS-6 forgetting curve.
 *
 *   R(t, S) = (1 + factor * t / S)^decay,  factor = 0.9^(1/decay) - 1
 *
 * where `decay = -w20` (always negative) and `t`, `S` are in days. By
 * construction R = 0.90 exactly when t = S, for any decay.
 */
export function forgettingCurve(t: number, S: number, decay: number): number {
  if (!Number.isFinite(S) || S <= 0 || !Number.isFinite(t) || !Number.isFinite(decay)) return 0;
  const elapsed = Math.max(t, 0);
  return Math.pow(1 + curveFactor(decay) * (elapsed / S), decay);
}

/**
 * Context for the projection functions: an FSRS-6 engine (to compute post-review
 * stability) plus the deck's decay. `expectedGrade` is the grade we assume the
 * user will achieve when simulating a review.
 *
 * Default: Rating.Good. A future improvement could derive the expected grade from
 * the user's per-deck correct-rate; we keep Good as the documented default so the
 * forward simulation stays deterministic and dependency-free.
 */
export interface SimContext {
  fsrs: FSRS;
  decay: number;
  expectedGrade: Grade;
}

/** Build a forward-simulation context from a deck's persisted parameters. */
export function simContext(deck: Deck, engine: FSRS): SimContext {
  return {
    fsrs: engine,
    decay: decayOf(deck.fsrsParameters),
    expectedGrade: Rating.Good as Grade,
  };
}

/**
 * Predicted retrievability on the exam date with no further review: project the
 * card's current stability forward from its last review to the exam date.
 *
 * A never-reviewed card has no stability, so its predicted retrievability is 0
 * (documented; also avoids a divide-by-zero in the curve).
 */
export function rAtExam(
  card: Card,
  examDate: number,
  _now: number,
  decay: number,
): number {
  if (card.stability === null || card.lastReviewed === null) return 0;
  const days = Math.max(examDate - card.lastReviewed, 0) / MS_PER_DAY;
  return forgettingCurve(days, card.stability, decay);
}

/**
 * Predicted retrievability on the exam date if the card is reviewed now: use
 * ts-fsrs to obtain the post-review stability, then project that forward from now
 * to the exam date.
 *
 * On exam day (no time remaining) a review leaves the card at R = 1.0.
 */
export function rAtExamIfReviewedNow(
  card: Card,
  grade: Grade,
  examDate: number,
  now: number,
  ctx: SimContext,
): number {
  const daysRemaining = Math.max(examDate - now, 0) / MS_PER_DAY;
  const item = ctx.fsrs.next(toTsCard(card, now), new Date(now), grade as TsGrade);
  return forgettingCurve(daysRemaining, item.card.stability, ctx.decay);
}

/**
 * Delta-R: the gain in exam-day retrievability from reviewing the card now,
 * using the context's expected grade.
 *
 *   deltaR = rAtExamIfReviewedNow - rAtExam
 *
 * For a new card rAtExam = 0, so deltaR equals rAtExamIfReviewedNow. As a card's
 * current exam-day R approaches 1, deltaR collapses toward 0.
 */
export function deltaR(
  card: Card,
  examDate: number,
  now: number,
  ctx: SimContext,
  grade: Grade = ctx.expectedGrade,
): number {
  return (
    rAtExamIfReviewedNow(card, grade, examDate, now, ctx) -
    rAtExam(card, examDate, now, ctx.decay)
  );
}
