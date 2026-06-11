// Leech detection. A "leech" is a card that has been failed so many times it is
// quietly eating study time and probably needs rewording or splitting. We surface
// them (a badge plus a search filter) and optionally auto-suspend or tag them.

import type { Card } from '../db/types';

/** Global default: total lapses at or above which a card is treated as a leech. */
export const DEFAULT_LEECH_LAPSE_THRESHOLD = 8;
/** @deprecated Use DEFAULT_LEECH_LAPSE_THRESHOLD instead. Kept for test compatibility. */
export const LEECH_LAPSE_THRESHOLD = DEFAULT_LEECH_LAPSE_THRESHOLD;

/** Whether a card has lapsed often enough to be flagged as a leech.
 *  Uses the per-deck threshold when available, otherwise the global default. */
export function isLeech(card: Card, threshold?: number): boolean {
  return card.lapses >= (threshold ?? DEFAULT_LEECH_LAPSE_THRESHOLD);
}
