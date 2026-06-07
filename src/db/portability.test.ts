import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import { exportDatabase, importBackup, validateBackup, BACKUP_VERSION } from './portability';
import { createDeck, createCard } from './repository';

async function reset() {
  await Promise.all([
    db.decks.clear(),
    db.cards.clear(),
    db.sessionHistory.clear(),
    db.userPerformance.clear(),
    db.assets.clear(),
  ]);
}

describe('exportDatabase', () => {
  beforeEach(reset);

  it('exports a valid BackupFile with the current version', async () => {
    const deck = await createDeck('Biology');
    await createCard(deck.id, 'front_back', 'Q1', 'A1');

    const backup = await exportDatabase();

    expect(backup.app).toBe('lacuna');
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(validateBackup(backup)).toBe(true);
    expect(backup.decks).toHaveLength(1);
    expect(backup.decks[0].name).toBe('Biology');
    expect(backup.cards).toHaveLength(1);
    expect(backup.cards[0].front).toBe('Q1');
  });
});

describe('importBackup', () => {
  beforeEach(reset);

  it('replaces the database in replace mode', async () => {
    const deck = await createDeck('Old');
    await createCard(deck.id, 'front_back', 'Q1', 'A1');
    const backup = await exportDatabase();

    await createDeck('Extra');
    expect(await db.decks.count()).toBe(2);

    await importBackup(backup, 'replace');

    const decks = await db.decks.toArray();
    const cards = await db.cards.toArray();
    expect(decks).toHaveLength(1);
    expect(decks[0].name).toBe('Old');
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Q1');
  });

  it('merges decks by interaction time in merge mode', async () => {
    const deck = await createDeck('Biology');
    const backup = await exportDatabase();

    // Simulate local activity so lastInteractedAt is newer than the backup's.
    await db.decks.update(deck.id, {
      examDate: deck.examDate + 1000,
      lastInteractedAt: Date.now(),
    });
    await importBackup(backup, 'merge');

    const updated = await db.decks.get(deck.id);
    expect(updated!.examDate).toBe(deck.examDate + 1000); // local wins because more recently interacted
  });

  it('adds missing cards in merge mode', async () => {
    const deck = await createDeck('MergeDeck');
    const card = await createCard(deck.id, 'front_back', 'Q1', 'A1');
    const backup = await exportDatabase();

    await db.cards.delete(card.id);
    expect(await db.cards.count()).toBe(0);

    await importBackup(backup, 'merge');

    const cards = await db.cards.toArray();
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('Q1');
  });

  it('appends non-duplicate session history in merge mode', async () => {
    const deck = await createDeck('HistoryDeck');
    const backup = await exportDatabase();

    await db.sessionHistory.add({
      timestamp: 1000,
      deckId: deck.id,
      averagePredictedRetrievability: 0.5,
    });

    const backupWithHistory = {
      ...backup,
      sessionHistory: [
        { timestamp: 1000, deckId: deck.id, averagePredictedRetrievability: 0.6 },
        { timestamp: 2000, deckId: deck.id, averagePredictedRetrievability: 0.7 },
      ],
    };

    await importBackup(backupWithHistory, 'merge');

    const history = await db.sessionHistory.toArray();
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.timestamp).sort()).toEqual([1000, 2000]);
  });
});
