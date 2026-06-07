// Automatic local backups: timestamped restore points kept in IndexedDB, plus an
// optional File System Access folder mirror so backups can survive the browser's
// site data being cleared (the one failure IndexedDB restore points cannot).

import { db } from './schema';
import { exportDatabase, importBackup } from './portability';
import type { BackupFile, BackupSnapshot } from './types';
import { scheduleAssetGc } from './assets';

const MAX_RESTORE_POINTS = 10;
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
const FOLDER_KEY = 'backupFolderHandle';

// The File System Access types are not in every TS lib target; treat them loosely.
type DirHandle = {
  name: string;
  queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  getFileHandle: (name: string, o?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>;
  }>;
};

/** Whether this browser supports the File System Access folder mirror. */
export function folderMirrorSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

async function getFolderHandle(): Promise<DirHandle | null> {
  const entry = await db.appState.get(FOLDER_KEY);
  return (entry?.value as DirHandle | undefined) ?? null;
}

/** The name of the configured backup folder, or null if none is set. */
export async function backupFolderName(): Promise<string | null> {
  const handle = await getFolderHandle();
  return handle?.name ?? null;
}

/** Prompt the user to choose a folder for mirrored backups. Returns the folder name. */
export async function chooseBackupFolder(): Promise<string | null> {
  if (!folderMirrorSupported()) return null;
  const picker = (window as unknown as {
    showDirectoryPicker: (o: { mode: string }) => Promise<DirHandle>;
  }).showDirectoryPicker;
  const handle = await picker({ mode: 'readwrite' });
  await db.appState.put({ key: FOLDER_KEY, value: handle });
  return handle.name;
}

/** Stop mirroring backups to a folder. */
export async function clearBackupFolder(): Promise<void> {
  await db.appState.delete(FOLDER_KEY);
}

async function ensurePermission(handle: DirHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  if ((await handle.requestPermission?.(opts)) === 'granted') return true;
  return false;
}

/** Best-effort folder mirror for a backup payload. Exported so pre-migration snapshots can reuse it. */
export async function mirrorToFolder(payload: BackupFile): Promise<void> {
  const handle = await getFolderHandle();
  if (!handle) return;
  if (!(await ensurePermission(handle))) return;
  const stamp = new Date(payload.exportedAt).toISOString().slice(0, 19).replace(/:/g, '-');
  const fileHandle = await handle.getFileHandle(`lacuna-backup-${stamp}.json`, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

let lastBackupAt = 0;
const MIN_BACKUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

/** Reset the backup throttle so tests can call `takeAutoBackup` repeatedly. */
export function __resetBackupThrottleForTests(): void {
  lastBackupAt = 0;
}

/** Capture a full snapshot as a restore point, prune to the cap, and mirror if configured.
 *  Calls within the 5-minute throttle window are silently skipped so rapid mutations
 *  do not produce N backups per session. Pass `force: true` to bypass the throttle. */
export async function takeAutoBackup(force = false): Promise<void> {
  if (!force && Date.now() - lastBackupAt < MIN_BACKUP_INTERVAL) return;
  lastBackupAt = Date.now();

  const payload = await exportDatabase();
  const snapshot: BackupSnapshot = {
    createdAt: payload.exportedAt,
    deckCount: payload.decks.length,
    cardCount: payload.cards.length,
    payload,
  };
  await db.backups.add(snapshot);

  // Keep only the most recent restore points. Pre-migration snapshots are exempt:
  // they are the safety net for a botched upgrade and must not be pruned away.
  const all = await db.backups.orderBy('createdAt').toArray();
  const prunable = all.filter((s) => (s.tag ?? '') !== 'pre-migration');
  if (prunable.length > MAX_RESTORE_POINTS) {
    const excess = prunable.slice(0, prunable.length - MAX_RESTORE_POINTS);
    await db.backups.bulkDelete(excess.map((s) => s.id!));
  }

  // Best-effort folder mirror; never let it break the backup itself.
  await mirrorToFolder(payload).catch((e: unknown) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('Folder mirror failed:', e);
    }
  });
}

/** Take a backup only if the newest restore point is older than 24 hours. */
export async function autoBackupIfStale(): Promise<void> {
  const last = await db.backups.orderBy('createdAt').last();
  if (last && Date.now() - last.createdAt < STALE_MS) return;
  await takeAutoBackup();
  // Sweep orphaned assets once per day alongside the backup.
  scheduleAssetGc();
}

/** Replace the whole database from a stored restore point. */
export async function restoreBackup(id: number): Promise<void> {
  const snapshot = await db.backups.get(id);
  if (!snapshot) throw new Error('That restore point could not be found.');
  await importBackup(snapshot.payload, 'replace');
}

/** Remove a stored restore point. */
export async function deleteBackup(id: number): Promise<void> {
  await db.backups.delete(id);
}
