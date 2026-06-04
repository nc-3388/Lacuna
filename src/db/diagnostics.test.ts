import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import { createCard, createDeck, recordReview } from './repository';
import {
  buildDiagnostics,
  formatDiagnostics,
  gatherContentSample,
  gatherCounts,
} from './diagnostics';

describe('buildDiagnostics', () => {
  it('assembles a well-formed bundle with no card content by default', () => {
    const bundle = buildDiagnostics({
      location: 'the Learn session',
      error: { name: 'TypeError', message: 'boom', stack: 'at x\nat y' },
      componentStack: 'in LearnMode',
      counts: { decks: 2, cards: 30, reviews: 100, backups: 3 },
      userAgent: 'TestAgent/1.0',
      language: 'en-GB',
      platform: 'TestOS',
      now: 1000,
    });

    expect(bundle.app).toBe('lacuna');
    expect(bundle.location).toBe('the Learn session');
    expect(bundle.error).toEqual({ name: 'TypeError', message: 'boom', stack: 'at x\nat y' });
    expect(bundle.componentStack).toBe('in LearnMode');
    expect(bundle.data).toEqual({ decks: 2, cards: 30, reviews: 100, backups: 3 });
    expect(bundle.environment.userAgent).toBe('TestAgent/1.0');
    // No content unless explicitly opted in.
    expect(bundle.contentSample).toBeUndefined();
  });

  it('includes a content sample only when one is supplied', () => {
    const bundle = buildDiagnostics({
      location: 'this page',
      error: { message: 'oops' },
      counts: { decks: 1, cards: 1, reviews: 0, backups: 0 },
      contentSample: [{ front: 'Q', back: 'A' }],
    });
    expect(bundle.contentSample).toEqual([{ front: 'Q', back: 'A' }]);
    expect(bundle.error.name).toBe('Error'); // defaulted
  });

  it('formats a bundle as readable text', () => {
    const text = formatDiagnostics(
      buildDiagnostics({
        location: 'the application',
        error: { name: 'Error', message: 'kaput', stack: null },
        counts: { decks: 0, cards: 0, reviews: 0, backups: 0 },
        now: 0,
      }),
    );
    expect(text).toContain('Lacuna diagnostic bundle');
    expect(text).toContain('Error: Error: kaput');
    expect(text).toContain('0 decks, 0 cards, 0 reviews, 0 restore points');
  });
});

describe('gatherCounts', () => {
  beforeEach(async () => {
    await Promise.all([
      db.decks.clear(),
      db.cards.clear(),
      db.sessionHistory.clear(),
      db.userPerformance.clear(),
    ]);
  });

  it('reports real counts including total reviews', async () => {
    const deck = await createDeck('Deck');
    const card = await createCard(deck.id, 'front_back', 'q', 'a');
    await recordReview({
      card,
      deck,
      grade: 3,
      responseTimeSec: 2,
      distracted: false,
      correct: true,
    });

    const counts = await gatherCounts();
    expect(counts.decks).toBe(1);
    expect(counts.cards).toBe(1);
    expect(counts.reviews).toBe(1);

    const sample = await gatherContentSample(5);
    expect(sample).toEqual([{ front: 'q', back: 'a' }]);
  });
});
