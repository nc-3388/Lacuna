// Plain, offline card search. A pure function over already-loaded cards and decks
// so it needs no index server and is trivially testable. Matching is a
// case- and diacritic-insensitive substring over the card front/back, the deck
// name, and the card's tags.

import type { Card, Deck } from './types';
import { isLeech } from '../fsrs/leech';

export interface SearchResult {
  card: Card;
  deck: Deck;
}

/** Structured, content-independent filters that turn search into deck management. */
export type CardFilter = 'due' | 'new' | 'leech' | 'flagged' | 'suspended';

export interface SearchOptions {
  /** All listed filters must match (logical AND). */
  filters?: CardFilter[];
  /** Reference time for the "due" filter; defaults to now. */
  now?: number;
  /** When true, the query string itself is parsed for inline operators (tag:, deck:, is:). */
  parseQuery?: boolean;
}

export interface ParsedQuery {
  text: string;
  tags: string[];
  decks: string[];
  filters: CardFilter[];
}

/**
 * Extract inline search operators from a query string.
 * Supported operators:
 *   tag:foo       -> cards tagged "foo"
 *   deck:bar      -> cards in deck named "bar" (global search)
 *   is:due|new|leech|flagged|suspended -> structured filter
 * The remaining text is treated as a plain substring query.
 */
export function parseAdvancedQuery(query: string): ParsedQuery {
  const tags: string[] = [];
  const decks: string[] = [];
  const filters: CardFilter[] = [];
  const textParts: string[] = [];

  // Split on spaces, but keep quoted strings together.
  const tokens = query.match(/[^\s"']+|"[^"]*"|'[^']*'/g) ?? [];
  for (const token of tokens) {
    const clean = token.replace(/^["']|["']$/g, '').trim();
    if (!clean) continue;

    const tagMatch = clean.match(/^tag:(.+)$/i);
    if (tagMatch) {
      tags.push(normalise(tagMatch[1]!));
      continue;
    }

    const deckMatch = clean.match(/^deck:(.+)$/i);
    if (deckMatch) {
      decks.push(normalise(deckMatch[1]!));
      continue;
    }

    const isMatch = clean.match(/^is:(.+)$/i);
    if (isMatch) {
      const filter = isMatch[1]!.toLowerCase();
      if (
        filter === 'due' ||
        filter === 'new' ||
        filter === 'leech' ||
        filter === 'flagged' ||
        filter === 'suspended'
      ) {
        filters.push(filter as CardFilter);
      }
      continue;
    }

    textParts.push(clean);
  }

  return { text: textParts.join(' '), tags, decks, filters };
}

/** Whether a single card satisfies one structured filter. */
function matchesFilter(card: Card, filter: CardFilter, now: number): boolean {
  switch (filter) {
    case 'due':
      return card.due !== null && card.due <= now;
    case 'new':
      return card.lastReviewed === null;
    case 'leech':
      return isLeech(card);
    case 'flagged':
      return card.flagged === true;
    case 'suspended':
      return card.suspended === true;
  }
}

/** Lower-case and strip accents so "résumé" matches "resume". */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Find cards matching `query`. Results are ranked so that matches in the card's
 * front rank above matches found only in the back/deck/tags, and earlier matches
 * rank above later ones.
 */
export function searchCards(
  query: string,
  cards: Card[],
  decks: Deck[],
  options: SearchOptions = {},
): SearchResult[] {
  const now = options.now ?? Date.now();
  const parsed = options.parseQuery ? parseAdvancedQuery(query) : null;
  const filters = [...(options.filters ?? []), ...(parsed?.filters ?? [])];
  const q = normalise(parsed ? parsed.text : query.trim());
  // Nothing to do without either a text query or an active filter.
  if (!q && filters.length === 0 && !parsed?.tags.length && !parsed?.decks.length) return [];

  const deckById = new Map(decks.map((d) => [d.id, d]));
  const ranked: { card: Card; deck: Deck; score: number }[] = [];

  for (const card of cards) {
    const deck = deckById.get(card.deckId);
    if (!deck) continue;

    // Every active filter must match (AND), narrowing the set before text ranking.
    if (filters.length && !filters.every((f) => matchesFilter(card, f, now))) continue;

    // Inline tag operators (AND between multiple tag: tokens).
    if (parsed?.tags.length) {
      const cardTags = (card.tags ?? []).map(normalise);
      if (!parsed.tags.every((t) => cardTags.includes(t))) continue;
    }

    // Inline deck operator.
    if (parsed?.decks.length) {
      if (!parsed.decks.some((d) => normalise(deck.name).includes(d))) continue;
    }

    let score = 0;
    if (q) {
      const haystack = normalise(
        [card.front, card.back, deck.name, ...(card.tags ?? [])].join('  '),
      );
      const idx = haystack.indexOf(q);
      if (idx === -1) continue;

      const frontIdx = normalise(card.front).indexOf(q);
      // Front matches always rank above non-front matches, regardless of how
      // far into the front text they appear. Ties are broken by earliest
      // overall match position (idx).
      score = frontIdx === -1 ? Number.MAX_SAFE_INTEGER / 2 + idx : frontIdx;
    }
    ranked.push({ card, deck, score });
  }

  // With a query, rank by match quality; filter-only results keep their input order.
  ranked.sort((a, b) => a.score - b.score);
  return ranked.map(({ card, deck }) => ({ card, deck }));
}

/** A short, plain-text preview of a card's markdown for result lists. */
export function plainPreview(md: string, max = 120): string {
  const text = md
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1') // cloze -> the answer text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/[#*_`>~$]/g, '') // markdown punctuation
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
