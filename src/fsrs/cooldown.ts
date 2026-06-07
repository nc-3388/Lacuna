// Queue cooldown slotting. When a card is failed (g = 1) it is given a cooldown so it
// is not immediately re-shown, preventing repetitive spamming of failed cards.
// Cooldowns live in memory for the duration of a Learn session only.

import { sortByObjective, type ObjectiveContext } from './objective';
import type { Card } from '../db/types';

/** Default maximum cooldown, scaled down for very small decks (size - 1, floored at 0). */
export const DEFAULT_COOLDOWN = 5;

export function maxCooldown(deckSize: number): number {
  if (deckSize >= 6) return DEFAULT_COOLDOWN;
  return Math.max(deckSize - 1, 0);
}

/** Per-session cooldown bookkeeping keyed by card id. */
export type CooldownMap = Map<string, number>;

/** Apply a cooldown to a just-failed card. */
export function applyCooldown(
  cooldowns: CooldownMap,
  cardId: string,
  deckSize: number,
): void {
  cooldowns.set(cardId, maxCooldown(deckSize));
}

/**
 * Select the next card to present from the Delta-R-sorted queue.
 *
 * Cards with an active cooldown (> 0) are skipped. After a card is reviewed, every
 * other card's cooldown is decremented by one (see decrementCooldowns). If every
 * remaining card is still on cooldown, the one closest to becoming eligible
 * (lowest remaining cooldown, then highest objective score) is served so the
 * session never stalls. Ordering always follows the deck's exam objective.
 */
export function selectNextCard(
  cards: Card[],
  oc: ObjectiveContext,
  cooldowns: CooldownMap,
  now: number = Date.now(),
): Card | null {
  if (cards.length === 0) return null;
  const scored = sortByObjective(cards, oc, now);

  const eligible = scored.find(({ card }) => (cooldowns.get(card.id) ?? 0) <= 0);
  if (eligible) return eligible.card;

  // All cards are on cooldown: serve the soonest-eligible, breaking ties by score.
  let best = scored[0];
  let bestCooldown = cooldowns.get(best.card.id) ?? 0;
  for (const entry of scored) {
    const cd = cooldowns.get(entry.card.id) ?? 0;
    if (cd < bestCooldown || (cd === bestCooldown && entry.score > best.score)) {
      best = entry;
      bestCooldown = cd;
    }
  }
  return best.card;
}

/**
 * Decrement every other card's cooldown by one after `reviewedCardId` is reviewed.
 * The reviewed card keeps whatever cooldown was just assigned to it (if any).
 *
 * Note: cooldowns are session-scoped, so this naturally applies across every deck
 * in a multi-deck session, matching SPEC §10.
 */
export function decrementCooldowns(cooldowns: CooldownMap, reviewedCardId: string): void {
  for (const [id, value] of cooldowns) {
    if (id === reviewedCardId) continue;
    const next = value - 1;
    if (next <= 0) cooldowns.delete(id);
    else cooldowns.set(id, next);
  }
}
