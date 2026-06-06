// Regression tests for the v4 -> v5 schema change that splits heavy
// BackupFile payloads out of the `backups` store, and for the summary-only
// read path that powers the Settings restore-point list.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie, { type Table } from 'dexie';
import { db, CURRENT_SCHEMA_VERSION } from './schema';
import { deleteBackup, restoreBackup, takeAutoBackup } from './backups';
import { createDeck } from './repository';
import type { BackupFile, BackupSnapshot } from './types';
import { defaultFsrsParameters, FSRS_VERSION } from '../fsrs/params';

function makeLegacySnapshot(name: string): BackupSnapshot {
  const deck = {
    id: 'd-' + name,
    name,
    examDate: Date.now(),
    createdAt: Date.now(),
    fsrsVersion: FSRS_VERSION,
    fsrsParameters: defaultFsrsParameters(),
    examObjective: 'expectedMarks' as const,
  };
  const payload: BackupFile = {
    app: 'lacuna',
    version: 4,
    exportedAt: Date.now(),
    decks: [deck],
    cards: [],
    assets: [],
    sessionHistory: [],
    userPerformance: [],
  };
  return {
    createdAt: payload.exportedAt,
    deckCount: 1,
    cardCount: 0,
    payload,
  };
}

describe('backup payload split', () => {
  beforeEach(async () => {
    // Wipe everything between tests so prior runs do not pollute state.
    await db.delete();
    await db.open();
    await Dexie.delete('lacuna-v4-migration-test');
  });

  it('stores a summary on the backups table and the full payload in backupPayloads', async () => {
    await createDeck('Alpha');
    await takeAutoBackup();

    const summaries = await db.backups.toArray();
    const payloads = await db.backupPayloads.toArray();

    expect(summaries).toHaveLength(1);
    const summary = summaries[0];
    expect(summary.payload).toBeUndefined();
    expect(summary.payloadId).toBeTypeOf('number');
    expect(summary.deckCount).toBe(1);

    expect(payloads).toHaveLength(1);
    expect(payloads[0].id).toBe(summary.payloadId);
    expect(payloads[0].payload.decks[0].name).toBe('Alpha');
  });

  it('summary-only records are tiny compared to the inline payload they replaced', async () => {
    for (let i = 0; i < 5; i += 1) {
      await createDeck(`Deck ${i}`);
      await takeAutoBackup();
    }

    const summaries = await db.backups.toArray();
    const projected = summaries.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      tag: s.tag,
      deckCount: s.deckCount,
      cardCount: s.cardCount,
      payloadId: s.payloadId,
    }));
    const summaryBytes = projected.reduce((n, s) => n + JSON.stringify(s).length, 0);
    const payloadBytes = (await db.backupPayloads.toArray()).reduce(
      (n, p) => n + JSON.stringify(p.payload).length,
      0,
    );
    // The list query reads at most 1% of the payload bytes it used to.
    expect(summaryBytes).toBeLessThan(Math.max(payloadBytes / 100, 500));
  });

  it('restores a snapshot by resolving the payloadId back to the BackupFile', async () => {
    await createDeck('Restoreable');
    await takeAutoBackup();
    const [summary] = await db.backups.toArray();
    expect(summary?.payloadId).toBeTypeOf('number');

    const allDecks = await db.decks.toArray();
    await db.decks.clear();
    expect(await db.decks.toArray()).toEqual([]);

    await restoreBackup(summary!.id!);

    const restored = await db.decks.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe(allDecks[0].name);
  });

  it('deleteBackup also removes the payload row', async () => {
    await createDeck('Disposable');
    await takeAutoBackup();
    const [summary] = await db.backups.toArray();
    expect(await db.backupPayloads.count()).toBe(1);

    await deleteBackup(summary!.id!);

    expect(await db.backups.count()).toBe(0);
    expect(await db.backupPayloads.count()).toBe(0);
  });

  it('CURRENT_SCHEMA_VERSION is at least 5 so the migration is wired', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
  });

  it('moves v4 inline payloads into the new backupPayloads store on upgrade', async () => {
    // Close the production db singleton, then re-seed a v4-shaped `lacuna`
    // database with inline payloads. The next `db.open()` will run the full
    // upgrade chain v0 -> v5, which is the same code path a real user on v4
    // takes when their browser IndexedDB is at the previous schema.
    await db.close();
    await Dexie.delete('lacuna');
    const seed = new Dexie('lacuna');
    seed.version(4).stores({
      decks: 'id, createdAt, examDate',
      cards: 'id, deckId, type, lastReviewed',
      sessionHistory: '++id, deckId, timestamp',
      userPerformance: 'deckId',
      backups: '++id, createdAt',
      appState: 'key',
      assets: 'hash, createdAt',
    });
    type LegacySnapshot = BackupSnapshot & { payload: BackupFile };
    await (seed.table('backups') as unknown as Table<LegacySnapshot, number>).bulkAdd([
      makeLegacySnapshot('A') as LegacySnapshot,
      makeLegacySnapshot('B') as LegacySnapshot,
    ]);
    await seed.close();

    await db.open();

    const summaries = await db.backups.toArray();
    const payloads = await db.backupPayloads.toArray();
    expect(summaries).toHaveLength(2);
    for (const s of summaries) {
      expect(s.payload).toBeUndefined();
      expect(s.payloadId).toBeTypeOf('number');
    }
    expect(payloads).toHaveLength(2);
    expect(payloads.map((p) => p.payload.decks[0].name).sort()).toEqual(['A', 'B']);
  });
});

