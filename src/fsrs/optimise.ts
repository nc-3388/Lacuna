// FSRS parameter optimisation from a deck's own review history.
//
// Lacuna uses the official gradient-based trainer from the ts-fsrs authors
// (`@open-spaced-repetition/binding`, fsrs-rs via WASM in the browser worker).
// Review histories are converted to the binding's item format, fitted with
// `computeParameters()`, and validated against FSRS valid ranges before they can
// ever be applied. Log-loss evaluation for before/after summaries reuses ts-fsrs
// replay (see `evaluateParameters`).
//
// This runs off the main thread in a Web Worker (see src/workers/optimise.worker.ts)
// because training on long histories is CPU-heavy.

import type { FSRSBindingItem } from '@open-spaced-repetition/binding';
import {
  fsrs,
  generatorParameters,
  clipParameters,
  createEmptyCard,
  checkParameters,
  CLAMP_PARAMETERS,
  W17_W18_Ceiling,
  clamp,
  default_w,
  default_relearning_steps,
  type Card as TsCard,
  type Grade as TsGrade,
} from 'ts-fsrs';
import { DEFAULT_REQUEST_RETENTION, MS_PER_DAY } from './params';
import type { Card, Grade } from '../db/types';

/**
 * Minimum number of reviews before optimisation is worthwhile. Below this the fit
 * is dominated by noise, so the action is gated and the threshold is stated in the
 * UI copy. With fewer than 1,000 reviews a train/validation split leaves too little
 * data to judge out-of-sample performance reliably.
 */
export const MIN_OPTIMISE_REVIEWS = 1_000;

const EPS = 1e-6;
const NUM_RELEARNING_STEPS = default_relearning_steps.length;

/** A single card's grade sequence, the only thing the optimiser needs from a card. */
export interface ReviewSequence {
  timestamps: number[];
  grades: Grade[];
}

/** Plain review record for the binding trainer (rating 1–4, deltaT in days). */
export interface BindingReviewData {
  rating: number;
  deltaT: number;
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

/** Convert one card's review sequence to binding review records. First review deltaT is 0. */
export function sequenceToBindingReviews(seq: ReviewSequence): BindingReviewData[] {
  return seq.grades.map((grade, i) => ({
    rating: grade,
    deltaT:
      i === 0 ? 0 : (seq.timestamps[i] - seq.timestamps[i - 1]) / MS_PER_DAY,
  }));
}

/** Convert every card's history into binding review data (one array per card). */
export function cardsToBindingReviewData(cards: Card[]): BindingReviewData[][] {
  return reviewSequences(cards).map(sequenceToBindingReviews);
}

/** Total reviews across the given cards. */
export function countReviews(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + c.history.length, 0);
}

/** Per-weight min/max bounds used by `clipParameters` (FSRS valid ranges). */
export function fsrsWeightBounds(
  numRelearningSteps: number = NUM_RELEARNING_STEPS,
): Array<[number, number]> {
  let w17w18Ceiling = W17_W18_Ceiling;
  if (Math.max(0, numRelearningSteps) > 1) {
    const value =
      -(Math.log(default_w[11]) + Math.log(Math.pow(2, default_w[13]) - 1) + default_w[14] * 0.3) /
      numRelearningSteps;
    w17w18Ceiling = clamp(+value.toFixed(8), 0.01, 2);
  }
  return CLAMP_PARAMETERS(w17w18Ceiling, true).slice(0, 21) as Array<[number, number]>;
}

/**
 * Reject weight sets the trainer returns if they fall outside FSRS valid ranges.
 * Throws with a readable message when invalid.
 */
export function validateFittedWeights(w: number[]): void {
  if (w.length !== 21) {
    throw new Error(`Trainer returned ${w.length} weights; expected 21.`);
  }
  checkParameters(w);
  const bounds = fsrsWeightBounds();
  for (let i = 0; i < w.length; i += 1) {
    const [min, max] = bounds[i];
    if (w[i] < min || w[i] > max) {
      throw new Error(
        `Weight w${i} (${w[i]}) is outside the FSRS valid range [${min}, ${max}].`,
      );
    }
  }
}

/** Non-throwing variant for callers that need to report failure in UI copy. */
export function tryValidateFittedWeights(
  w: number[],
): { ok: true } | { ok: false; message: string } {
  try {
    validateFittedWeights(w);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Result of splitting review sequences chronologically into train and validation. */
export interface SplitResult {
  trainSequences: ReviewSequence[];
  validationSequences: ReviewSequence[];
  cutoffTimestamp: number;
}

/**
 * Split review sequences chronologically so validation always tests on reviews the
 * fit did not see. The cutoff is placed so roughly `trainFraction` of all reviews
 * fall into training and the remainder into validation.
 */
export function chronologicallySplitSequences(
  sequences: ReviewSequence[],
  trainFraction: number = 0.8,
): SplitResult {
  const allTimestamps: number[] = [];
  for (const seq of sequences) {
    allTimestamps.push(...seq.timestamps);
  }
  allTimestamps.sort((a, b) => a - b);

  const cutoffIndex = Math.max(0, Math.floor(allTimestamps.length * trainFraction) - 1);
  const cutoffTimestamp = allTimestamps[cutoffIndex] ?? Infinity;

  const trainSequences: ReviewSequence[] = [];
  const validationSequences: ReviewSequence[] = [];

  for (const seq of sequences) {
    const splitIndex = seq.timestamps.findIndex((t) => t > cutoffTimestamp);
    if (splitIndex === -1) {
      trainSequences.push(seq);
      validationSequences.push({ timestamps: [], grades: [] });
    } else if (splitIndex === 0) {
      trainSequences.push({ timestamps: [], grades: [] });
      validationSequences.push(seq);
    } else {
      trainSequences.push({
        timestamps: seq.timestamps.slice(0, splitIndex),
        grades: seq.grades.slice(0, splitIndex),
      });
      validationSequences.push({
        timestamps: seq.timestamps.slice(splitIndex),
        grades: seq.grades.slice(splitIndex),
      });
    }
  }

  return { trainSequences, validationSequences, cutoffTimestamp };
}

export interface EvaluateOptions {
  /** If provided, only score reviews whose timestamp is strictly greater than this value. */
  scoreAfterTimestamp?: number;
}

/**
 * Mean log loss of a weight set over the review sequences: replay each card and
 * compare the predicted retrievability before each (non-first) review against the
 * actual outcome. Lower is better. Returns the loss and the number of scored reviews.
 *
 * When `scoreAfterTimestamp` is given, only reviews after that timestamp are
 * scored; earlier reviews still update the simulated card state so the evaluation
 * is honest (the model has not seen the held-out reviews).
 */
export function evaluateParameters(
  sequences: ReviewSequence[],
  w: number[],
  requestRetention: number = DEFAULT_REQUEST_RETENTION,
  options?: EvaluateOptions,
): { logLoss: number; scored: number } {
  const engine = fsrs(
    generatorParameters({ w, request_retention: requestRetention, enable_fuzz: false }),
  );

  let loss = 0;
  let scored = 0;
  for (const seq of sequences) {
    let card: TsCard = createEmptyCard(new Date(seq.timestamps[0]));
    let hasPrior = false;
    for (let i = 0; i < seq.grades.length; i += 1) {
      const when = new Date(seq.timestamps[i]);
      if (
        hasPrior &&
        (options?.scoreAfterTimestamp === undefined || seq.timestamps[i] > options.scoreAfterTimestamp)
      ) {
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
  return { logLoss: scored > 0 ? loss / scored : NaN, scored };
}

export interface ComputeParametersOptions {
  enableShortTerm: boolean;
  numRelearningSteps: number;
  progress?: (current: number, total: number) => boolean | void | undefined;
}

/** Trainer entry point (injected so tests can use the native binding in Node). */
export type ComputeParametersFn = (
  trainSet: FSRSBindingItem[],
  options: ComputeParametersOptions,
) => Promise<number[]>;

export interface OptimiseOptions {
  requestRetention?: number;
  /** Weight set to score the "before" metric (defaults to FSRS-6 defaults). */
  initialW?: number[];
  onProgress?: (fraction: number) => void;
  computeParameters: ComputeParametersFn;
  createItem: (reviews: BindingReviewData[]) => FSRSBindingItem;
}

export interface OptimiseResult {
  w: number[];
  before: number;
  after: number;
  scored: number;
  /** True when the fitted weights beat the defaults on held-out validation data. */
  isOutOfSampleWin: boolean;
}

/**
 * Fit FSRS weights to the deck's review history via the official binding trainer.
 * Weights are clipped and validated before being returned.
 */
export async function optimiseParameters(
  cards: Card[],
  options: OptimiseOptions,
): Promise<OptimiseResult> {
  const allSequences = reviewSequences(cards);
  const requestRetention = options.requestRetention ?? DEFAULT_REQUEST_RETENTION;
  const initialW = clip(options.initialW ? [...options.initialW] : [...default_w]);

  // Split chronologically: train on earlier reviews, validate on later ones.
  const { trainSequences, cutoffTimestamp } = chronologicallySplitSequences(allSequences);

  const trainSet = trainSequences
    .filter((seq) => seq.grades.length > 0)
    .map((seq) => options.createItem(sequenceToBindingReviews(seq)));

  if (trainSet.length === 0) {
    throw new Error('Training set is empty after the chronological split.');
  }

  // Evaluate defaults and the eventual fit on the held-out portion only.
  const before = evaluateParameters(allSequences, initialW, requestRetention, {
    scoreAfterTimestamp: cutoffTimestamp,
  }).logLoss;

  const rawW = await options.computeParameters(trainSet, {
    enableShortTerm: true,
    numRelearningSteps: NUM_RELEARNING_STEPS,
    progress: (current, total) => {
      if (total > 0) options.onProgress?.(current / total);
    },
  });

  const validation = tryValidateFittedWeights(rawW);
  if (!validation.ok) {
    throw new Error(
      `Trainer returned weights outside FSRS valid ranges: ${validation.message}`,
    );
  }

  const w = clip([...rawW]);
  validateFittedWeights(w);

  const final = evaluateParameters(allSequences, w, requestRetention, {
    scoreAfterTimestamp: cutoffTimestamp,
  });

  const isOutOfSampleWin = final.scored > 0 && final.logLoss < before;

  return {
    w,
    before,
    after: final.logLoss,
    scored: final.scored,
    isOutOfSampleWin,
  };
}

/** Clip a weight set to the FSRS valid ranges (always returns a fresh 21-length array). */
export function clip(w: number[]): number[] {
  return clipParameters(w, NUM_RELEARNING_STEPS);
}
