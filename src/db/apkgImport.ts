// APKG (Anki Package) import engine.
//
// Anki .apkg files are ZIP archives containing:
//   - collection.anki2  (SQLite database with notes, cards, revlog, models)
//   - media             (JSON file mapping numbered files to original filenames)
//   - numbered media files (e.g. "0", "1") referenced by the media JSON
//
// This engine uses fflate for ZIP extraction and sql.js for SQLite reading.
// It runs entirely in the browser and produces a structured payload that the
// repository layer can import into Lacuna's IndexedDB schema.

import { unzipSync, type Unzipped } from 'fflate';
import initSqlJs, { type Database } from 'sql.js';
import type { Card, CardType, Deck, ReviewLog } from './types';
import { makeId } from './schema';
import { sha256Blob } from './assets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApkgImportResult {
  deckName: string;
  cards: Card[];
  /** Images extracted from the APKG, keyed by original filename. */
  media: Map<string, Uint8Array>;
  /** How many Anki notes were skipped because their type is unsupported. */
  skippedNotes: number;
  /** How many Anki cards were skipped because their note was unsupported. */
  skippedCards: number;
}

export interface ApkgParseOptions {
  /** Target deck name (defaults to the first Anki deck name found). */
  deckName?: string;
  /** When true, import scheduling history (revlog). When false, start fresh. */
  importScheduling?: boolean;
}

// ---------------------------------------------------------------------------
// Anki SQLite schema helpers
// ---------------------------------------------------------------------------

interface AnkiNote {
  id: number;
  mid: number;
  flds: string;
  tags: string;
  sfld: string;
}

interface AnkiCard {
  id: number;
  nid: number;
  did: number;
  ord: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue: number;
  odid: number;
  flags: number;
}

interface AnkiRevlog {
  id: number;
  cid: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

interface AnkiModel {
  id: number;
  name: string;
  type: number; // 0 = standard, 1 = cloze
  tmpl: { name: string; qfmt: string; afmt: string }[];
  flds: { name: string }[];
}

interface AnkiDeck {
  id: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

/**
 * Parse an Anki .apkg file into a Lacuna import payload.
 *
 * @param file - The .apkg file from a file input.
 * @param options - Import options.
 * @returns The parsed result, or throws a user-friendly error.
 */
export async function parseApkg(
  file: File,
  options: ApkgParseOptions = {},
): Promise<ApkgImportResult> {
  const buffer = await file.arrayBuffer();
  const zip = unzipSync(new Uint8Array(buffer));

  // Read media mapping JSON.
  const mediaMap = readMediaMap(zip);

  // Load SQLite database.
  const db = await loadAnkiDatabase(zip);

  try {
    return extractFromDatabase(db, zip, mediaMap, options);
  } finally {
    db.close();
  }
}

/** Read the media JSON file from the ZIP. */
function readMediaMap(zip: Unzipped): Map<string, string> {
  const mediaJson = zip['media'];
  if (!mediaJson) return new Map();
  try {
    const parsed = JSON.parse(new TextDecoder().decode(mediaJson)) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

/** Load sql.js and open the collection.anki2 database. */
async function loadAnkiDatabase(zip: Unzipped): Promise<Database> {
  const dbBytes = zip['collection.anki2'];
  if (!dbBytes) {
    throw new Error('This file does not contain a valid Anki collection (collection.anki2 missing).');
  }

  const SQL = await initSqlJs({
    locateFile: (file) => {
      // sql.js WASM must be served from public/ or CDN.
      if (file.endsWith('.wasm')) {
        return '/sql-wasm.wasm';
      }
      return file;
    },
  });

  return new SQL.Database(dbBytes);
}

// ---------------------------------------------------------------------------
// Database extraction
// ---------------------------------------------------------------------------

function extractFromDatabase(
  db: Database,
  zip: Unzipped,
  mediaMap: Map<string, string>,
  options: ApkgParseOptions,
): ApkgImportResult {
  // Read models.
  const models = readModels(db);
  const modelMap = new Map(models.map((m) => [m.id, m]));

  // Read Anki decks.
  const ankiDecks = readDecks(db);
  const firstDeck = ankiDecks[0];
  const deckName = options.deckName ?? firstDeck?.name ?? 'Imported from Anki';

  // Read notes.
  const notes = readNotes(db);

  // Read cards.
  const cards = readCards(db);
  const cardByNid = groupBy(cards, (c) => c.nid);

  // Read revlog.
  const revlogs = options.importScheduling !== false ? readRevlog(db) : [];
  const revlogByCid = groupBy(revlogs, (r) => r.cid);

  // Build Lacuna cards.
  const lacunaCards: Card[] = [];
  let skippedNotes = 0;
  let skippedCards = 0;

  for (const note of notes) {
    const model = modelMap.get(note.mid);
    if (!model) {
      skippedNotes++;
      continue;
    }

    const mapping = mapModelToLacuna(model, note);
    if (!mapping) {
      skippedNotes++;
      continue;
    }

    const ankiCards = cardByNid.get(note.id) ?? [];
    if (ankiCards.length === 0) {
      skippedNotes++;
      continue;
    }

    for (const ankiCard of ankiCards) {
      const card = buildLacunaCard(
        ankiCard,
        mapping,
        revlogByCid.get(ankiCard.id) ?? [],
      );
      if (card) {
        lacunaCards.push(card);
      } else {
        skippedCards++;
      }
    }
  }

  // Extract media blobs.
  const media = new Map<string, Uint8Array>();
  for (const [key, filename] of mediaMap.entries()) {
    const bytes = zip[key];
    if (bytes) {
      media.set(filename, bytes);
    }
  }

  return {
    deckName,
    cards: lacunaCards,
    media,
    skippedNotes,
    skippedCards,
  };
}

// ---------------------------------------------------------------------------
// SQLite readers
// ---------------------------------------------------------------------------

function readModels(db: Database): AnkiModel[] {
  const stmt = db.prepare('SELECT id, name, type, flds, tmpl FROM notetypes');
  const models: AnkiModel[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: number;
      name: string;
      type: number;
      flds: string;
      tmpl: string;
    };
    try {
      models.push({
        id: row.id,
        name: row.name,
        type: row.type,
        flds: JSON.parse(row.flds) as { name: string }[],
        tmpl: JSON.parse(row.tmpl) as { name: string; qfmt: string; afmt: string }[],
      });
    } catch {
      // Skip malformed models.
    }
  }
  stmt.free();
  return models;
}

function readNotes(db: Database): AnkiNote[] {
  const stmt = db.prepare('SELECT id, mid, flds, tags, sfld FROM notes');
  const notes: AnkiNote[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: number;
      mid: number;
      flds: string;
      tags: string;
      sfld: string;
    };
    notes.push({
      id: row.id,
      mid: row.mid,
      flds: row.flds,
      tags: row.tags,
      sfld: row.sfld,
    });
  }
  stmt.free();
  return notes;
}

function readCards(db: Database): AnkiCard[] {
  const stmt = db.prepare(
    'SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags FROM cards',
  );
  const cards: AnkiCard[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, number>;
    cards.push({
      id: row.id,
      nid: row.nid,
      did: row.did,
      ord: row.ord,
      type: row.type,
      queue: row.queue,
      due: row.due,
      ivl: row.ivl,
      factor: row.factor,
      reps: row.reps,
      lapses: row.lapses,
      left: row.left,
      odue: row.odue,
      odid: row.odid,
      flags: row.flags,
    });
  }
  stmt.free();
  return cards;
}

function readRevlog(db: Database): AnkiRevlog[] {
  const stmt = db.prepare(
    'SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog',
  );
  const logs: AnkiRevlog[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, number>;
    logs.push({
      id: row.id,
      cid: row.cid,
      usn: row.usn,
      ease: row.ease,
      ivl: row.ivl,
      lastIvl: row.lastIvl,
      factor: row.factor,
      time: row.time,
      type: row.type,
    });
  }
  stmt.free();
  return logs;
}

function readDecks(db: Database): AnkiDeck[] {
  const stmt = db.prepare('SELECT id, name FROM decks');
  const decks: AnkiDeck[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: number; name: string };
    decks.push({ id: row.id, name: row.name });
  }
  stmt.free();
  return decks;
}

// ---------------------------------------------------------------------------
// Model mapping
// ---------------------------------------------------------------------------

interface NoteMapping {
  type: CardType;
  front: string;
  back: string;
  tags: string[];
}

function mapModelToLacuna(model: AnkiModel, note: AnkiNote): NoteMapping | null {
  const fields = note.flds.split('\x1f');

  if (model.type === 1) {
    // Cloze note type.
    const text = fields[0] ?? '';
    if (!text) return null;
    return {
      type: 'cloze',
      front: convertAnkiCloze(text),
      back: '',
      tags: parseAnkiTags(note.tags),
    };
  }

  if (model.type === 0) {
    // Standard note type. Use the first two fields as front/back.
    const front = fields[0] ?? '';
    const back = fields[1] ?? '';
    if (!front) return null;
    return {
      type: 'front_back',
      front: convertAnkiHtml(front),
      back: convertAnkiHtml(back),
      tags: parseAnkiTags(note.tags),
    };
  }

  // Unsupported model type.
  return null;
}

/** Convert Anki's {{c1::Text}} cloze syntax to Lacuna's {{c1::Text}} (same syntax). */
function convertAnkiCloze(text: string): string {
  // Anki and Lacuna use the same cloze syntax, but Anki may use HTML.
  return convertAnkiHtml(text);
}

/** Convert Anki HTML fields to Markdown-compatible text. */
function convertAnkiHtml(html: string): string {
  // Simple HTML-to-Markdown conversions.
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<div\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '')
    .replace(/<p\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '')
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<i>(.*?)<\/i>/gi, '_$1_')
    .replace(/<em>(.*?)<\/em>/gi, '_$1_')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre>(.*?)<\/pre>/gi, '```\n$1\n```')
    .replace(/<li\s*\/?>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<ul\s*\/?>/gi, '')
    .replace(/<\/ul>/gi, '')
    .replace(/<ol\s*\/?>/gi, '')
    .replace(/<\/ol>/gi, '')
    .replace(/<h1\s*\/?>(.*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2\s*\/?>(.*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3\s*\/?>(.*?)<\/h3>/gi, '### $1\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Parse Anki's space-separated tags (may have leading/trailing spaces). */
function parseAnkiTags(tagString: string): string[] {
  return tagString
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !t.startsWith('__'));
}

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------

function buildLacunaCard(
  ankiCard: AnkiCard,
  mapping: NoteMapping,
  revlogs: AnkiRevlog[],
): Card | null {
  const now = Date.now();

  // Convert Anki state to Lacuna FSRS state.
  const state: 0 | 1 | 2 | 3 = clampState(ankiCard.type);

  // Convert Anki due to epoch ms.
  // Anki due is: days since creation for reviews, or a Unix timestamp for learning.
  // For simplicity, we treat it as days for review cards and use today + days for new.
  const due = ankiCard.due > 1000000000
    ? ankiCard.due * 1000 // Unix timestamp
    : now + ankiCard.due * 86400_000; // Days offset

  // Convert review logs.
  const history: ReviewLog[] = revlogs
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      timestamp: r.id,
      grade: clampGrade(r.ease),
      responseTimeSec: Math.round(r.time / 1000),
      distracted: false,
      stabilityBefore: r.lastIvl > 0 ? r.lastIvl : null,
      stabilityAfter: r.ivl > 0 ? r.ivl : 1,
      difficultyBefore: null,
      difficultyAfter: r.factor / 1000,
      retrievabilityAtReview: null,
    }));

  // Estimate stability from interval (crude approximation for migration).
  const stability = ankiCard.ivl > 0 ? ankiCard.ivl : null;
  const difficulty = ankiCard.factor > 0 ? ankiCard.factor / 1000 : null;

  return {
    id: makeId(),
    deckId: '', // Filled in by the caller.
    type: mapping.type,
    front: mapping.front,
    back: mapping.back,
    stability,
    difficulty,
    lastReviewed: history.length > 0 ? history[history.length - 1].timestamp : null,
    reps: ankiCard.reps,
    lapses: ankiCard.lapses,
    state,
    due: state === 0 ? null : due,
    scheduledDays: ankiCard.ivl,
    learningSteps: ankiCard.left,
    history,
    createdAt: ankiCard.id,
    tags: mapping.tags,
    suspended: ankiCard.queue === -1,
    buriedUntil: null,
  };
}

function clampState(type: number): 0 | 1 | 2 | 3 {
  if (type === 0) return 0;
  if (type === 1) return 1;
  if (type === 2) return 2;
  if (type === 3) return 3;
  return 0;
}

function clampGrade(ease: number): 1 | 2 | 3 | 4 {
  if (ease === 1) return 1;
  if (ease === 2) return 2;
  if (ease === 3) return 3;
  if (ease === 4) return 4;
  return 3;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

function getImageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      resolve(null);
    };
    img.src = URL.createObjectURL(blob);
  });
}

function replaceMediaRefs(text: string, mediaMap: Map<string, string>): string {
  let result = text;
  // HTML img tags: <img src="filename.jpg">
  const imgRe = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
  result = result.replace(imgRe, (match, src) => {
    const hash = mediaMap.get(src);
    if (!hash) return match;
    return `![image](lacuna-asset://${hash})`;
  });
  // Markdown image syntax: ![alt](filename.jpg)
  const mdImgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  result = result.replace(mdImgRe, (match, alt, src) => {
    const hash = mediaMap.get(src);
    if (!hash) return match;
    return `![${alt}](lacuna-asset://${hash})`;
  });
  // Plain text references like filename.jpg (fallback for filenames embedded in text)
  for (const [filename, hash] of mediaMap.entries()) {
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const plainRe = new RegExp(escaped, 'g');
    result = result.replace(plainRe, `lacuna-asset://${hash}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Create a Lacuna deck from an APKG result and insert everything into the database.
 * This is a high-level helper that wires the engine output to the repository layer.
 */
export async function importApkgResult(
  result: ApkgImportResult,
  targetDeckId?: string,
): Promise<{ deck: Deck; cards: Card[] }> {
  const { createDeck, createCards } = await import('./repository');
  const { db } = await import('./schema');
  const { storeImageBlob } = await import('./assets');

  let deck: Deck;
  if (targetDeckId) {
    const existing = await db.decks.get(targetDeckId);
    if (!existing) throw new Error('Target deck not found.');
    deck = existing;
  } else {
    deck = await createDeck(result.deckName);
  }

  // Assign deckId to all cards.
  const cards = result.cards.map((c) => ({ ...c, deckId: deck.id }));

  // Create cards in bulk.
  const created = await createCards(
    deck.id,
    cards.map((c) => ({
      type: c.type,
      front: c.front,
      back: c.back,
      tags: c.tags,
    })),
  );

  // Update created cards with scheduling history.
  await db.transaction('rw', db.cards, async () => {
    for (let i = 0; i < created.length; i++) {
      const draft = cards[i];
      const card = created[i];
      await db.cards.update(card.id, {
        stability: draft.stability,
        difficulty: draft.difficulty,
        lastReviewed: draft.lastReviewed,
        reps: draft.reps,
        lapses: draft.lapses,
        state: draft.state,
        due: draft.due,
        scheduledDays: draft.scheduledDays,
        learningSteps: draft.learningSteps,
        history: draft.history,
        suspended: draft.suspended,
      });
    }
  });

  // Ingest media images and build a filename -> hash map.
  const mediaHashMap = new Map<string, string>();
  for (const [filename, bytes] of result.media.entries()) {
    const mime = guessMimeType(filename);
    if (mime.startsWith('image/')) {
      const blob = new Blob([new Uint8Array(bytes)], { type: mime });
      const hash = await sha256Blob(blob);
      mediaHashMap.set(filename, hash);
      const dims = await getImageDimensions(blob);
      await storeImageBlob(blob, mime, dims?.width ?? 0, dims?.height ?? 0);
    }
  }

  // Replace media references in card text with Lacuna asset references.
  if (mediaHashMap.size > 0) {
    await db.transaction('rw', db.cards, async () => {
      for (const card of created) {
        const newFront = replaceMediaRefs(card.front, mediaHashMap);
        const newBack = replaceMediaRefs(card.back, mediaHashMap);
        if (newFront !== card.front || newBack !== card.back) {
          await db.cards.update(card.id, { front: newFront, back: newBack });
        }
      }
    });
  }

  return { deck, cards: created };
}

function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
  };
  return map[ext] ?? 'application/octet-stream';
}
