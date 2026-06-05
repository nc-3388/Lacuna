import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeParameters,
  FSRSBindingItem,
  FSRSBindingReview,
} from '@open-spaced-repetition/binding';
import { db } from '../db/schema';
import { createDeck, updateDeck } from '../db/repository';
import { makeEngine, applyReview } from './fsrs';
import { optimiseParameters } from './optimise';
import type { Card, Grade, ReviewLog } from '../db/types';
import { MS_PER_DAY } from './params';

function cardWithHistory(deckId: string, grades: Grade[]): Card {
  const start = Date.UTC(2026, 0, 1);
  const history: ReviewLog[] = grades.map((grade, i) => ({
    timestamp: start + i * 2 * MS_PER_DAY,
    grade,
    responseTimeSec: 2,
    distracted: false,
    stabilityBefore: i === 0 ? null : 1,
    stabilityAfter: 1,
    difficultyBefore: i === 0 ? null : 5,
    difficultyAfter: 5,
    retrievabilityAtReview: null,
  }));
  return {
    id: 'card-1',
    deckId,
    type: 'front_back',
    front: 'q',
    back: 'a',
    stability: 1,
    difficulty: 5,
    lastReviewed: history[history.length - 1]?.timestamp ?? null,
    reps: grades.length,
    lapses: 0,
    state: 2,
    due: null,
    scheduledDays: 0,
    learningSteps: 0,
    history,
    createdAt: start,
  };
}

describe('optimised weights persistence', () => {
  beforeEach(async () => {
    await Promise.all([
      db.decks.clear(),
      db.cards.clear(),
      db.sessionHistory.clear(),
      db.userPerformance.clear(),
    ]);
  });

  it('applied weights persist on the deck and feed the scheduler', async () => {
    const deck = await createDeck('Trainer deck');
    const card = cardWithHistory(deck.id, [3, 3, 4, 3, 2, 3, 4, 3]);

    const result = await optimiseParameters([card], {
      computeParameters,
      createItem: (reviews) =>
        new FSRSBindingItem(
          reviews.map((r) => new FSRSBindingReview(r.rating, r.deltaT)),
        ),
    });

    await updateDeck(deck.id, {
      fsrsParameters: { ...deck.fsrsParameters, w: result.w },
    });

    const loaded = (await db.decks.get(deck.id))!;
    expect(loaded.fsrsParameters.w).toEqual(result.w);
    expect(loaded.fsrsParameters.w).toHaveLength(21);

    const engine = makeEngine(loaded.fsrsParameters);
    const reviewed = applyReview(engine, card, 3, Date.now());
    expect(reviewed.memory.stability).toBeGreaterThan(0);
  });
});
