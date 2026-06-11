// FSRS-6 engine wrapper.
//
// Every memory-state update (initial S/D, post-success and post-lapse stability,
// difficulty update and the short-term support exposed by the installed ts-fsrs
// package) is delegated to `ts-fsrs`. This module only translates between Lacuna's
// persisted Card shape and ts-fsrs's Card, and exposes a couple of small, pure
// helpers. There is deliberately no hand-rolled FSRS maths here.
//
// Known limitation: FSRS is still a long-term scheduling model. It does not fully
// model same-evening cramming behaviour, so repeated reviews under exam pressure can
// look more certain than they really are.

import {
  fsrs,
  createEmptyCard,
  type State,
  type FSRS,
  type Card as TsCard,
  type Grade as TsGrade,
  type Steps,
} from 'ts-fsrs';
import type { Card, FsrsCardState, FsrsParameters, Grade } from '../db/types';
import { MS_PER_DAY } from './params';

export type { FSRS } from 'ts-fsrs';

/** Build an FSRS-6 scheduler from a deck's persisted parameter set. */
export function makeEngine(params: FsrsParameters): FSRS {
  return fsrs({
    w: params.w,
    request_retention: params.requestRetention,
    enable_short_term: true,
    enable_fuzz: params.enable_fuzz,
    maximum_interval: params.maximum_interval,
    learning_steps: params.learning_steps as Steps,
    relearning_steps: params.relearning_steps as Steps,
  });
}

/** Decay exponent for the deck's forgetting curve: decay = -w20 (always negative). */
export function decayOf(params: FsrsParameters): number {
  return -params.w[20];
}

/**
 * Translate a Lacuna Card into a ts-fsrs Card for a review taking place at `now`
 * (epoch ms). A never-reviewed card becomes a fresh empty card so ts-fsrs applies
 * the correct initial-stability/difficulty path.
 */
export function toTsCard(card: Card, now: number): TsCard {
  if (card.lastReviewed === null) {
    return createEmptyCard(new Date(now));
  }
  // A card that was reviewed before FSRS-6 but has missing memory fields should
  // be back-filled with sensible defaults rather than treated as brand-new.
  const stability = card.stability ?? 0.1;
  const difficulty = card.difficulty ?? 5.0;
  return {
    due: new Date(card.due ?? card.lastReviewed),
    stability,
    difficulty,
    elapsed_days: Math.max(0, Math.floor((now - card.lastReviewed) / MS_PER_DAY)),
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as State,
    last_review: new Date(card.lastReviewed),
  };
}

/** The memory-state fields produced by a review, mapped back to Lacuna's shape. */
export interface MemoryUpdate {
  stability: number;
  difficulty: number;
  lastReviewed: number;
  due: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: FsrsCardState;
}

/** Map a ts-fsrs Card back to Lacuna's persisted memory fields. */
export function fromTsCard(ts: TsCard, now: number): MemoryUpdate {
  return {
    stability: ts.stability,
    difficulty: ts.difficulty,
    lastReviewed: ts.last_review ? ts.last_review.getTime() : now,
    due: ts.due.getTime(),
    scheduledDays: ts.scheduled_days,
    learningSteps: ts.learning_steps,
    reps: ts.reps,
    lapses: ts.lapses,
    state: ts.state as FsrsCardState,
  };
}

export interface ReviewResult {
  memory: MemoryUpdate;
  /** Retrievability at the instant of review; null on a first review. */
  retrievabilityAtReview: number | null;
}

/**
 * Apply a grade to a card and return the new memory state plus the retrievability
 * at review time. All of the actual FSRS-6 maths happens inside `engine.next`.
 */
export function applyReview(
  engine: FSRS,
  card: Card,
  grade: Grade,
  now: number,
): ReviewResult {
  const before = toTsCard(card, now);
  const retrievabilityAtReview =
    card.lastReviewed === null || card.state === 0 ? null : engine.get_retrievability(before, now, false);
  const item = engine.next(before, new Date(now), grade as TsGrade);
  return { memory: fromTsCard(item.card, now), retrievabilityAtReview };
}
