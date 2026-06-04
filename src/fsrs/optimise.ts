// FSRS parameter optimisation from a deck's own review history.
//
// ts-fsrs ships the FSRS-6 maths but not a parameter trainer, so this is our own
// optimiser built on ts-fsrs primitives (no new dependency). The idea is the
// standard one: replay each card's grade sequence under a candidate weight set,
// predict the retrievability the model would have assigned just before each
// review, and score it against what actually happened (recalled or not) with log
// loss. Lower loss means better-calibrated predictions. We then hill-climb the 21
// weights to reduce that loss, clipping every candidate to the FSRS valid ranges.
//
// This runs off the main thread in a Web Worker (see src/workers/optimise.worker.ts)
// because replaying long histories many times is CPU-heavy.

import {
  fsrs,
  generatorParameters,
  clipParameters,
  createEmptyCard,
  default_w,
  default_relearning_steps,
  type Card as TsCard,
  type Grade as TsGrade,
} from 'ts-fsrs';
import { DEFAULT_REQUEST_RETENTION } from './params';
import type { Card, Grade } from '../db/types';

/**
 * Minimum number of reviews before optimisation is worthwhile. Below this the fit
 * is dominated by noise, so the action is gated and the threshold is stated in the
 * UI copy. FSRS's own guidance is that a few hundred reviews is the practical floor.
 */
export const MIN_OPTIMISE_REVIEWS = 400;

const EPS = 1e-6;
const NUM_RELEARNING_STEPS = default_relearning_steps.length;

/** A single card's grade sequence, the only thing the optimiser needs from a card. */
export interface ReviewSequence {
  timestamps: number[];
  grades: Grade[];
}

/** Extract the (timestamp, grade) sequences the optimiser replays. */
export function reviewSequences(cards: Card[]): ReviewSequence[] {
  return cards
    .map((card) => ({
      timestamps: card.history.map((h) => h.timestamp),
      grades: card.history.map((h) => h.grade),
    }))
    .filter((seq) => seq.grades.length > 0);
}

/** Total reviews across the given cards. */
export function countReviews(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + c.history.length, 0);
}

/**
 * Mean log loss of a weight set over the review sequences: replay each card and
 * compare the predicted retrievability before each (non-first) review against the
 * actual outcome. Lower is better. Returns the loss and the number of scored reviews.
 */
export function evaluateParameters(
  sequences: ReviewSequence[],
  w: number[],
  requestRetention: number = DEFAULT_REQUEST_RETENTION,
): { logLoss: number; scored: number } {
  const engine = fsrs(
    generatorParameters({ w, request_retention: requestRetention, enable_fuzz: false }),
  );

  let loss = 0;
  let scored = 0;
  for (const seq of sequences) {
    // Start from a fresh empty card at the first review instant and replay grades.
    let card: TsCard = createEmptyCard(new Date(seq.timestamps[0]));
    let hasPrior = false;
    for (let i = 0; i < seq.grades.length; i += 1) {
      const when = new Date(seq.timestamps[i]);
      if (hasPrior) {
        const r = engine.get_retrievability(card, when, false);
        const p = Math.min(1 - EPS, Math.max(EPS, r));
        const y = seq.grades[i] > 1 ? 1 : 0;
        loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
        scored += 1;
      }
      card = engine.next(card, when, seq.grades[i] as TsGrade).card;
      hasPrior = true;
    }
  }
  return { logLoss: scored > 0 ? loss / scored : Infinity, scored };
}

export interface OptimiseOptions {
  requestRetention?: number;
  /** Weight set to start the climb from (defaults to the FSRS-6 defaults). */
  initialW?: number[];
  /** Number of refinement passes over all 21 weights. */
  passes?: number;
  onProgress?: (fraction: number) => void;
}

export interface OptimiseResult {
  w: number[];
  before: number;
  after: number;
  scored: number;
}

/**
 * Hill-climb the 21 FSRS weights to reduce log loss over the review history.
 * Coordinate descent with multiplicative steps (so the very different scales of
 * w0..w20 are handled), every candidate clipped to the FSRS valid ranges.
 */
export function optimiseParameters(
  cards: Card[],
  options: OptimiseOptions = {},
): OptimiseResult {
  const sequences = reviewSequences(cards);
  const requestRetention = options.requestRetention ?? DEFAULT_REQUEST_RETENTION;
  const passes = options.passes ?? 6;

  let w = clip(options.initialW ? [...options.initialW] : [...default_w]);
  const before = evaluateParameters(sequences, w, requestRetention).logLoss;
  let best = before;

  let rate = 0.3;
  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < w.length; i += 1) {
      for (const dir of [1, -1]) {
        const candidate = [...w];
        const delta = (Math.abs(candidate[i]) || 0.1) * rate * dir;
        candidate[i] = candidate[i] + delta;
        const clipped = clip(candidate);
        const loss = evaluateParameters(sequences, clipped, requestRetention).logLoss;
        if (loss < best - 1e-9) {
          best = loss;
          w = clipped;
        }
      }
    }
    rate *= 0.6; // refine the step each pass
    options.onProgress?.((pass + 1) / passes);
  }

  const final = evaluateParameters(sequences, w, requestRetention);
  return { w, before, after: final.logLoss, scored: final.scored };
}

/** Clip a weight set to the FSRS valid ranges (always returns a fresh 21-length array). */
export function clip(w: number[]): number[] {
  return clipParameters(w, NUM_RELEARNING_STEPS);
}
