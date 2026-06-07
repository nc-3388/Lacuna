// Regression tests for automatic local backups and restore points.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import {
  deleteBackup,
  restoreBackup,
  takeAutoBackup,
  autoBackupIfStale,
  __resetBackupThrottleForTests,
} from './backups';
import { createDeck } from './repository';

describe('backups', () => {
  beforeEach(async () => {
    // Wipe everything between tests so prior runs do not pollute state.
    await db.delete();
    await db.open();
    __resetBackupThrottleForTests();
  });

  it('takeAutoBackup stores a snapshot in the backups table', async () => {
    await createDeck('Alpha');
    await takeAutoBackup();

    const snapshots = await db.backups.toArray();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].deckCount).toBe(1);
    expect(snapshots[0].payload).toBeDefined();
    expect(snapshots[0].payload.decks[0].name).toBe('Alpha');
  });

  it('restoreBackup replaces the database from a stored snapshot', async () => {
    await createDeck('Restoreable');
    await takeAutoBackup();
    const [snapshot] = await db.backups.toArray();

    await db.decks.clear();
    expect(await db.decks.toArray()).toEqual([]);

    await restoreBackup(snapshot.id!);

    const restored = await db.decks.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe('Restoreable');
  });

  it('deleteBackup removes a stored restore point', async () => {
    await createDeck('Disposable');
    await takeAutoBackup();
    const [snapshot] = await db.backups.toArray();
    expect(await db.backups.count()).toBe(1);

    await deleteBackup(snapshot.id!);

    expect(await db.backups.count()).toBe(0);
  });

  it('autoBackupIfStale skips backup when a recent restore point exists', async () => {
    await createDeck('Fresh');
    await takeAutoBackup();
    const countBefore = await db.backups.count();

    await autoBackupIfStale();

    expect(await db.backups.count()).toBe(countBefore);
  });
});
