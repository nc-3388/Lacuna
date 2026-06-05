// Pre-migration snapshots live in their own IndexedDB so a failed schema upgrade
// on the main database never rolls the snapshot back with it.

import Dexie, { type Table } from 'dexie';
import type { BackupFile } from './types';

interface PreMigrationSnapshot {
  id?: number;
  targetVersion: number;
  createdAt: number;
  payload: BackupFile;
}

class PreMigrationDb extends Dexie {
  snapshots!: Table<PreMigrationSnapshot, number>;

  constructor() {
    super('lacuna-pre-migration');
    this.version(1).stores({
      snapshots: '++id, targetVersion',
    });
  }
}

const preMigrationDb = new PreMigrationDb();

export async function savePreMigrationSnapshot(
  targetVersion: number,
  payload: BackupFile,
): Promise<void> {
  await preMigrationDb.snapshots.add({ targetVersion, createdAt: Date.now(), payload });
  // Also mirror to the configured folder so the snapshot survives browser data clearing.
  // Fire-and-forget so the snapshot is committed immediately; the mirror is best-effort.
  const { mirrorToFolder } = await import('./backups');
  void mirrorToFolder(payload).catch(() => {});
}

export async function getPreMigrationSnapshot(
  targetVersion: number,
): Promise<PreMigrationSnapshot | undefined> {
  return preMigrationDb.snapshots.where({ targetVersion }).last();
}

export async function deletePreMigrationSnapshot(id: number): Promise<void> {
  await preMigrationDb.snapshots.delete(id);
}

export async function listPreMigrationSnapshots(): Promise<PreMigrationSnapshot[]> {
  return preMigrationDb.snapshots.orderBy('createdAt').reverse().toArray();
}
