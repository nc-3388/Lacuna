import Dexie, { type Table } from 'dexie';
import type {
  Deck,
  Card,
  SessionHistoryEntry,
  UserPerformance,
  BackupFile,
  AppStateEntry,
  ImageAsset,
  BackupSnapshot,
} from './types';
import {
  migrateCardRecord,
  migrateDeckRecord,
  type LegacyCard,
  type LegacyDeck,
} from './migrations';
import { savePreMigrationSnapshot } from './preMigrationSnapshots';
import { bytesToBase64 } from './assets';

/**
 * Lacuna's IndexedDB database. A single Dexie instance owns every store.
 * Indexes are declared in version().stores(); only indexed fields are listed there,
 * other properties are stored implicitly on the record.
 */
export class LacunaDatabase extends Dexie {
  decks!: Table<Deck, string>;
  cards!: Table<Card, string>;
  sessionHistory!: Table<SessionHistoryEntry, number>;
  userPerformance!: Table<UserPerformance, string>;
  backups!: Table<BackupSnapshot, number>;
  appState!: Table<AppStateEntry, string>;
  assets!: Table<ImageAsset, string>;

  constructor() {
    super('lacuna');
    this.version(1).stores({
      decks: 'id, createdAt, examDate',
      cards: 'id, deckId, type, lastReviewed',
      sessionHistory: '++id, deckId, timestamp',
      userPerformance: 'deckId',
    });

    // Version 2: migrate the FSRS-4.5 (17-parameter) model to FSRS-6. The indexes
    // are unchanged; the upgrade only enriches existing records with the new
    // FSRS-6 fields. No user data is dropped.
    this.version(2)
      .stores({
        decks: 'id, createdAt, examDate',
        cards: 'id, deckId, type, lastReviewed',
        sessionHistory: '++id, deckId, timestamp',
        userPerformance: 'deckId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('decks')
          .toCollection()
          .modify((deck) => {
            Object.assign(deck, migrateDeckRecord(deck as LegacyDeck));
          });
        await tx
          .table('cards')
          .toCollection()
          .modify((card) => {
            Object.assign(card, migrateCardRecord(card as LegacyCard));
          });
      });

    // Version 3: add the automatic-backup restore-point store and a small key/value
    // store (for the optional File System Access folder handle), and backfill the
    // card fields introduced alongside tags/suspend/bury so existing data is clean.
    // Booleans are not valid IndexedDB keys, so `suspended` is filtered in memory,
    // not indexed.
    this.version(3)
      .stores({
        decks: 'id, createdAt, examDate',
        cards: 'id, deckId, type, lastReviewed',
        sessionHistory: '++id, deckId, timestamp',
        userPerformance: 'deckId',
        backups: '++id, createdAt',
        appState: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('cards')
          .toCollection()
          .modify((card) => {
            Object.assign(card, migrateCardRecord(card as LegacyCard));
          });
      });

    // Version 4: move embedded card images into a Blob asset table. Markdown keeps
    // only lacuna-asset://hash references, which keeps reactive card reads small.
    this.version(4)
      .stores({
        decks: 'id, createdAt, examDate',
        cards: 'id, deckId, type, lastReviewed',
        sessionHistory: '++id, deckId, timestamp',
        userPerformance: 'deckId',
        backups: '++id, createdAt',
        appState: 'key',
        assets: 'hash, createdAt',
      })
      .upgrade(async (tx) => {
        const { extractMarkdownAssets } = await import('./assets');
        // Read, transform (async, extracting images into the asset store), then write
        // back explicitly. We avoid an async `.modify()` callback because mutating the
        // record after an await is not reliably persisted by Dexie.
        const cards = await tx.table('cards').toArray();
        for (const card of cards) {
          const front = await extractMarkdownAssets(card.front ?? '', (asset) =>
            tx.table('assets').put(asset),
          );
          const back = await extractMarkdownAssets(card.back ?? '', (asset) =>
            tx.table('assets').put(asset),
          );
          const migrated = { ...card, front, back };
          Object.assign(migrated, migrateCardRecord(migrated as LegacyCard));
          await tx.table('cards').put(migrated);
        }
      });
  }
}

export const CURRENT_SCHEMA_VERSION = 4;

export const db = new LacunaDatabase();

async function getCurrentDbVersion(name: string): Promise<number> {
  if ('databases' in indexedDB) {
    try {
      const dbs = await indexedDB.databases();
      const db = dbs.find((d) => d.name === name);
      return db?.version ?? 0;
    } catch {
      // Fall through to raw open fallback.
    }
  }
  // Fallback for browsers that do not expose indexedDB.databases().
  // We deliberately do not open the database here: doing so would create it at
  // version 1 if it does not exist, which would then trigger a useless pre-migration
  // snapshot and an unnecessary upgrade path (v1 -> v4). In browsers without
  // databases(), we simply skip the snapshot — the upgrade itself is still safe.
  return 0;
}

export async function readAllDataFromVersion(name: string): Promise<BackupFile> {
  const raw = await new Promise<{
    version: number;
    data: Record<string, unknown[]>;
  }>((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => {
      const idb = req.result;
      const stores = Array.from(idb.objectStoreNames);
      const result: Record<string, unknown[]> = {};

      if (stores.length === 0) {
        idb.close();
        resolve({ version: idb.version, data: result });
        return;
      }

      const tx = idb.transaction(stores, 'readonly');
      let pending = stores.length;
      let failed = false;

      for (const storeName of stores) {
        const storeReq = tx.objectStore(storeName).getAll();
        storeReq.onsuccess = (e) => {
          if (failed) return;
          result[storeName] = (e.target as IDBRequest).result;
          pending--;
          if (pending === 0) {
            idb.close();
            resolve({ version: idb.version, data: result });
          }
        };
        storeReq.onerror = () => {
          if (failed) return;
          failed = true;
          idb.close();
          reject(storeReq.error);
        };
      }

      tx.onerror = () => {
        if (failed) return;
        failed = true;
        idb.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another connection'));
  });

  const assetsRaw = (raw.data['assets'] ?? []) as ImageAsset[];
  const assets = await Promise.all(
    assetsRaw.map(async (a) => {
      const buf = new Uint8Array(await a.blob.arrayBuffer());
      return {
        hash: a.hash,
        data: bytesToBase64(buf),
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        createdAt: a.createdAt,
      };
    }),
  );

  return {
    app: 'lacuna',
    version: Math.floor(raw.version / 10),
    exportedAt: Date.now(),
    decks: (raw.data['decks'] ?? []) as Deck[],
    cards: (raw.data['cards'] ?? []) as Card[],
    assets,
    sessionHistory: (raw.data['sessionHistory'] ?? []) as SessionHistoryEntry[],
    userPerformance: (raw.data['userPerformance'] ?? []) as UserPerformance[],
  };
}

let preMigrationSnapshotTaken = false;

/**
 * Detect a pending schema upgrade and, if one is pending, capture a full
 * pre-migration snapshot in a separate committed transaction before the
 * destructive migration runs. The snapshot is written to the dedicated
 * `lacuna-pre-migration` database so it survives even if the main upgrade
 * aborts and rolls back.
 */
export async function ensurePreMigrationSnapshot(): Promise<void> {
  if (preMigrationSnapshotTaken) return;
  preMigrationSnapshotTaken = true;

  const targetVersion = CURRENT_SCHEMA_VERSION;
  const currentVersion = Math.floor((await getCurrentDbVersion('lacuna')) / 10);

  if (currentVersion > 0 && currentVersion < targetVersion) {
    const payload = await readAllDataFromVersion('lacuna');
    await savePreMigrationSnapshot(targetVersion, payload);
  }
}

/** Generate a stable, collision-resistant identifier without external dependencies. */
export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
