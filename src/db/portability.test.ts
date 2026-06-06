import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import { computeMergeDiff, BACKUP_VERSION } from './portability';
import { createDeck, createCard } from './repository';
import type { BackupFile } from './types';

async function reset() {
  await Promise.all([
    db.decks.clear(),
    db.cards.clear(),
    db.sessionHistory.clear(),
    db.userPerformance.clear(),
    db.assets.clear(),
  ]);
}

function makeBackup(partial: Partial<BackupFile> = {}): BackupFile {
  return {
    app: 'lacuna',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    decks: [],
    cards: [],
    assets: [],
    sessionHistory: [],
    userPerformance: [],
    ...partial,
  };
}

describe('computeMergeDiff', () => {
  beforeEach(reset);

  it('counts everything as new when the database is empty', async () => {
    // DB was cleared by beforeEach; no records exist.
    const backup = makeBackup({
      decks: [
        {
          id: 'deck-1',
          name: 'Biology',
          examDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
          createdAt: Date.now(),
          fsrsVersion: 6,
          fsrsParameters: { w: new Array(21).fill(0), requestRetention: 0.9 },
          examObjective: 'expectedMarks',
        },
      ],
      cards: [
        {
          id: 'card-1',
          deckId: 'deck-1',
          type: 'front_back',
          front: 'Q1',
          back: 'A1',
          stability: null,
          difficulty: null,
          lastReviewed: null,
          reps: 0,
          lapses: 0,
          state: 0,
          due: null,
          scheduledDays: 0,
          learningSteps: 0,
          history: [],
          createdAt: Date.now(),
        },
      ],
      sessionHistory: [
        { timestamp: 1000, deckId: 'deck-1', averagePredictedRetrievability: 0.5 },
      ],
      userPerformance: [
        {
          deckId: 'deck-1',
          runningMeanResponseTime: 5,
          runningStdDevResponseTime: 1,
          m2: 1,
          totalCorrectReviews: 10,
        },
      ],
    });

    const diff = await computeMergeDiff(backup);

    expect(diff.decks).toEqual({ new: 1, updated: 0, unchanged: 0 });
    expect(diff.cards).toEqual({ new: 1, updated: 0, unchanged: 0 });
    expect(diff.sessionHistory).toEqual({ new: 1, duplicates: 0 });
    expect(diff.userPerformance).toEqual({ new: 1, updated: 0, unchanged: 0 });
  });

  it('counts existing records with newer backup values as updated', async () => {
    const deck = await createDeck('Biology');
    const card = await createCard(deck.id, 'front_back', 'Q1', 'A1');

    const backup = makeBackup({
      decks: [{ ...deck, examDate: deck.examDate + 1 }],
      cards: [{ ...card, lastReviewed: Date.now() }],
      sessionHistory: [
        { timestamp: 1000, deckId: deck.id, averagePredictedRetrievability: 0.5 },
      ],
      userPerformance: [
        {
          deckId: deck.id,
          runningMeanResponseTime: 5,
          runningStdDevResponseTime: 1,
          m2: 1,
          totalCorrectReviews: 10,
        },
      ],
    });

    const diff = await computeMergeDiff(backup);

    expect(diff.decks).toEqual({ new: 0, updated: 1, unchanged: 0 });
    expect(diff.cards).toEqual({ new: 0, updated: 1, unchanged: 0 });
    expect(diff.sessionHistory).toEqual({ new: 1, duplicates: 0 });
    expect(diff.userPerformance).toEqual({ new: 0, updated: 1, unchanged: 0 });
  });

  it('detects updated decks by examDate and unchanged by older examDate', async () => {
    const deck = await createDeck('Chemistry');
    const existingExamDate = deck.examDate;

    const backup = makeBackup({
      decks: [
        { ...deck, examDate: existingExamDate + 1 }, // newer → updated
        { ...deck, id: 'deck-new', examDate: existingExamDate + 2, createdAt: Date.now() }, // new
      ],
    });

    const diff = await computeMergeDiff(backup);
    expect(diff.decks).toEqual({ new: 1, updated: 1, unchanged: 0 });
  });

  it('marks a deck as unchanged when the backup has the older examDate', async () => {
    const deck = await createDeck('Physics');
    const existingExamDate = deck.examDate;

    const backup = makeBackup({
      decks: [{ ...deck, examDate: existingExamDate - 1 }],
    });

    const diff = await computeMergeDiff(backup);
    expect(diff.decks).toEqual({ new: 0, updated: 0, unchanged: 1 });
  });

  it('detects updated cards by lastReviewed and unchanged by older lastReviewed', async () => {
    const deck = await createDeck('Maths');
    const card = await createCard(deck.id, 'front_back', 'Q', 'A');

    const backup = makeBackup({
      decks: [{ ...deck }],
      cards: [
        { ...card, lastReviewed: Date.now() + 1000 }, // newer → updated
        { ...card, id: 'card-new', lastReviewed: null }, // new
      ],
    });

    const diff = await computeMergeDiff(backup);
    expect(diff.cards).toEqual({ new: 1, updated: 1, unchanged: 0 });
  });

  it('falls back to createdAt for cards when lastReviewed is null on both sides', async () => {
    const deck = await createDeck('History');
    const card = await createCard(deck.id, 'front_back', 'Q', 'A');
    // Ensure lastReviewed is null
    await db.cards.update(card.id, { lastReviewed: null });
    const updatedCard = (await db.cards.get(card.id))!;

    const backup = makeBackup({
      decks: [{ ...deck }],
      cards: [
        { ...updatedCard, createdAt: updatedCard.createdAt + 1 }, // newer createdAt → updated
        { ...updatedCard, id: 'card-older', createdAt: updatedCard.createdAt - 1 }, // older → unchanged
      ],
    });

    const diff = await computeMergeDiff(backup);
    expect(diff.cards).toEqual({ new: 1, updated: 1, unchanged: 1 });
  });

  it('counts session history duplicates by timestamp:deckId key', async () => {
    const deck = await createDeck('Geography');

    await db.sessionHistory.add({
      timestamp: 1000,
      deckId: deck.id,
      averagePredictedRetrievability: 0.5,
    });

    const backup = makeBackup({
      decks: [{ ...deck }],
      sessionHistory: [
        { timestamp: 1000, deckId: deck.id, averagePredictedRetrievability: 0.6 }, // duplicate
        { timestamp: 2000, deckId: deck.id, averagePredictedRetrievability: 0.7 }, // new
      ],
    });

    const diff = await computeMergeDiff(backup);
    expect(diff.sessionHistory).toEqual({ new: 1, duplicates: 1 });
  });

  it('detects updated performance by totalCorrectReviews', async () => {
    const deck = await createDeck('Literature');

    await db.userPerformance.add({
      deckId: deck.id,
      runningMeanResponseTime: 5,
      runningStdDevResponseTime: 1,
      m2: 1,
      totalCorrectReviews: 10,
    });

    const backup = makeBackup({
      decks: [{ ...deck }],
      userPerformance: [
        {
          deckId: deck.id,
          runningMeanResponseTime: 6,
          runningStdDevResponseTime: 1.5,
          m2: 2,
          totalCorrectReviews: 15, // more → updated
        },
        {
          deckId: 'perf-new',
          runningMeanResponseTime: 4,
          runningStdDevResponseTime: 0.5,
          m2: 0.5,
          totalCorrectReviews: 3, // new
        },
        {
          deckId: deck.id,
          runningMeanResponseTime: 6,
          runningStdDevResponseTime: 1.5,
          m2: 2,
          totalCorrectReviews: 5, // fewer → unchanged
        },
      ],
    });

    const diff = await computeMergeDiff(backup);
    expect(diff.userPerformance).toEqual({ new: 1, updated: 1, unchanged: 1 });
  });

  it('reports no change when the backup exactly matches existing data', async () => {
    const deck = await createDeck('Art');
    const card = await createCard(deck.id, 'front_back', 'Q', 'A');

    const backup = makeBackup({
      decks: [{ ...deck }],
      cards: [{ ...card }],
      sessionHistory: [],
      userPerformance: [],
    });

    const diff = await computeMergeDiff(backup);
    expect(diff.decks).toEqual({ new: 0, updated: 1, unchanged: 0 }); // equal examDate → incoming wins
    expect(diff.cards).toEqual({ new: 0, updated: 1, unchanged: 0 }); // equal lastReviewed → incoming wins
  });
});
