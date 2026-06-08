// Deck sharing: turn one or more decks' content into a single compact, copy-and-paste
// code, and rebuild decks from such a code. A share code carries only the *content*
// needed to recreate the cards (type, front, back, tags — images ride along inside the
// Markdown as base64 data URIs) plus light deck metadata (name, objective, the date it
// was created and the date due). It deliberately omits personal scheduling state and
// review history: sharing is about the material, not one learner's progress.
//
// Compression comes from three places, in order of impact:
//   1. Reverse pairs (a front/back card and its mirror) are stored once as a single
//      "reversible" entry and expanded back into two independent cards on import — the
//      same shape createCardWithReverse produces.
//   2. Compact single-letter JSON keys.
//   3. DEFLATE (via the native CompressionStream) before base64, when available.
//
// The resulting string is a short scheme tag (LAC1 = compressed, LAC0 = plain) followed
// by base64, so it is just letters, digits and the usual base64 punctuation.

import { z } from 'zod';
import { db } from './schema';
import { createDeckWithCards, updateDeck } from './repository';
import { clampRequestRetention } from '../fsrs/params';
import type { ParsedCard } from './import';
import type { Card } from './types';
import { stripAssetImages } from './assets';

/** Format version. Bump only on a breaking change to the payload shape. */
const SHARE_VERSION = 1;
const PREFIX_COMPRESSED = 'LAC1';
const PREFIX_PLAIN = 'LAC0';

// ---------------------------------------------------------------------------
// Zod runtime schema for share payloads
// ---------------------------------------------------------------------------

const ShareCardSchema = z.object({
  k: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  f: z.string(),
  b: z.string().optional(),
  g: z.array(z.string()).optional(),
  i: z.literal(1).optional(),
});

const ShareDeckSchema = z.object({
  n: z.string().min(1),
  o: z.union([z.literal(0), z.literal(1)]),
  c: z.number(),
  e: z.number(),
  r: z.number().optional(),
  p: z.number().optional(),
  l: z.string().optional(),
  cards: z.array(ShareCardSchema),
});

const SharePayloadSchema = z.object({
  v: z.literal(SHARE_VERSION),
  by: z.union([z.string(), z.null()]).optional(),
  at: z.number(),
  decks: z.array(ShareDeckSchema),
});

/** A single card in a share payload. `k` is the kind. */
interface ShareCard {
  /** 0 = front/back, 1 = cloze, 2 = reversible front/back pair (expands to two cards). */
  k: 0 | 1 | 2;
  /** Front (Markdown). For cloze this holds the whole `{{cN::…}}` source. */
  f: string;
  /** Back (Markdown). Absent for cloze. */
  b?: string;
  /** Tags, when any. */
  g?: string[];
  /** True when one or more images were replaced by a placeholder. */
  i?: 1;
}

/** A single deck in a share payload, with compact keys. */
interface ShareDeck {
  n: string; // name
  o: 0 | 1; // objective: 0 expectedMarks, 1 securedTopics
  c: number; // createdAt (date created)
  e: number; // examDate (date due)
  r?: number; // requestRetention
  p?: number; // newCardsPerDay
  l?: string; // colour
  cards: ShareCard[];
}

/** The decoded contents of a share code. */
export interface SharePayload {
  v: number;
  /** Creator, reserved for a future "shared by" field; currently always null. */
  by?: string | null;
  /** Exported-at epoch ms. */
  at: number;
  decks: ShareDeck[];
}

/** A human-friendly summary of a share code, for the import preview. */
export interface ShareSummary {
  deckCount: number;
  cardCount: number;
  exportedAt: number;
  deckNames: string[];
  omittedImages: boolean;
}

// ---------------------------------------------------------------------------
// Base64 and DEFLATE helpers (direct fallback when Worker is unavailable)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // chunk so very large images do not overflow the call stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipeThrough(
  bytes: Uint8Array,
  stream: TransformStream<BufferSource, Uint8Array>,
  maxBytes?: number,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes as BufferSource);
  void writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (maxBytes != null && total > maxBytes) {
      await reader.cancel();
      throw new Error('Share code is too large to decode safely.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

const canCompress = typeof CompressionStream !== 'undefined';
const canDecompress = typeof DecompressionStream !== 'undefined';

export async function encodeShareDirect(payload: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (canCompress) {
    const deflated = await pipeThrough(bytes, new CompressionStream('deflate-raw'));
    return PREFIX_COMPRESSED + bytesToBase64(deflated);
  }
  return PREFIX_PLAIN + bytesToBase64(bytes);
}

const MAX_SHARE_BYTES = 5 * 1024 * 1024;

export async function decodeShareDirect(code: string): Promise<SharePayload> {
  const trimmed = code.trim().replace(/\s+/g, '');
  let bytes: Uint8Array;
  if (trimmed.startsWith(PREFIX_COMPRESSED)) {
    if (!canDecompress) {
      throw new Error('This browser cannot read compressed share codes.');
    }
    const compressed = base64ToBytes(trimmed.slice(PREFIX_COMPRESSED.length));
    if (compressed.length > MAX_SHARE_BYTES) {
      throw new Error('Share code is too large to decode safely.');
    }
    bytes = await pipeThrough(
      compressed,
      new DecompressionStream('deflate-raw'),
      MAX_SHARE_BYTES,
    );
  } else if (trimmed.startsWith(PREFIX_PLAIN)) {
    bytes = base64ToBytes(trimmed.slice(PREFIX_PLAIN.length));
    if (bytes.length > MAX_SHARE_BYTES) {
      throw new Error('Share code is too large to decode safely.');
    }
  } else {
    throw new Error('That does not look like a Lacuna share code.');
  }

  if (bytes.length > MAX_SHARE_BYTES) {
    throw new Error('Share code is too large to decode safely.');
  }

  let payload: SharePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as SharePayload;
  } catch {
    throw new Error('The share code is corrupted and could not be read.');
  }
  const parse = SharePayloadSchema.safeParse(payload);
  if (!parse.success) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('Share payload validation failed:', parse.error.issues);
    }
    throw new Error('This share code is from an unsupported version of Lacuna.');
  }
  return parse.data;
}

// ---------------------------------------------------------------------------
// Worker offload for encode / decode
// ---------------------------------------------------------------------------

const canUseShareWorker = typeof Worker !== 'undefined';

let shareWorker: Worker | null = null;
let shareJobId = 0;

function getShareWorker(): Worker {
  if (!shareWorker) {
    shareWorker = new Worker(
      new URL('../workers/share.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return shareWorker;
}

function runShareWorker<T>(
  message:
    | { type: 'encode'; payload: SharePayload }
    | { type: 'decode'; code: string },
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++shareJobId;
    const w = getShareWorker();

    function cleanup() {
      w.removeEventListener('message', messageHandler);
      w.removeEventListener('error', errorHandler);
      w.removeEventListener('messageerror', messageErrorHandler);
    }

    const messageHandler = (event: MessageEvent) => {
      const data = event.data as {
        type: string;
        result?: T;
        error?: string;
        id?: number;
      };
      if (data.id !== id) return;
      cleanup();
      if (data.type === 'error') {
        reject(new Error(data.error ?? 'Share worker failed.'));
      } else {
        resolve(data.result as T);
      }
    };

    const errorHandler = (e: ErrorEvent) => {
      cleanup();
      // Clear the cached worker so the next call creates a fresh one.
      shareWorker = null;
      reject(new Error(`Share worker failed: ${e.message || 'unknown error'}`));
    };

    const messageErrorHandler = () => {
      cleanup();
      shareWorker = null;
      reject(new Error('Share worker received an invalid message.'));
    };

    w.addEventListener('message', messageHandler);
    w.addEventListener('error', errorHandler);
    w.addEventListener('messageerror', messageErrorHandler);
    w.postMessage({ ...message, id });
  });
}

async function encodeShare(payload: SharePayload): Promise<string> {
  if (canUseShareWorker) {
    try {
      return await runShareWorker<string>({ type: 'encode', payload });
    } catch {
      // Fall through to direct path if the worker fails.
    }
  }
  return encodeShareDirect(payload);
}

/** Decode a share code into its payload, throwing a readable error if it is invalid. */
export async function decodeShare(code: string): Promise<SharePayload> {
  if (canUseShareWorker) {
    try {
      return await runShareWorker<SharePayload>({ type: 'decode', code });
    } catch {
      // Fall through to direct path if the worker fails.
    }
  }
  return decodeShareDirect(code);
}

/** Count the cards a payload would create (reversible pairs count as two). */
export function summariseShare(payload: SharePayload): ShareSummary {
  let cardCount = 0;
  const deckNames: string[] = [];
  for (const deck of payload.decks) {
    deckNames.push(deck.n);
    for (const card of deck.cards) cardCount += card.k === 2 ? 2 : 1;
  }
  return {
    deckCount: payload.decks.length,
    cardCount,
    exportedAt: payload.at,
    deckNames,
    omittedImages: payload.decks.some((d) => d.cards.some((c) => c.i === 1)),
  };
}

// ---------------------------------------------------------------------------
// Packing (DB -> code)
// ---------------------------------------------------------------------------

/**
 * Pack a deck's cards, folding each front/back card that has an exact mirror into a
 * single reversible entry. Cloze cards pass through untouched.
 */
function packCards(cards: Card[]): ShareCard[] {
  const out: ShareCard[] = [];
  const consumed = new Set<string>();
  // Use a length-prefixed key so the separator can never collide with card content.
  // Format: length-of-front + \u0002 + front + \u0002 + back.  \u0002 is a control
  // character that cannot appear in normal Markdown.
  const key = (f: string, b: string) => `${f.length}${f}${b}`;

  // Index front/back cards by content so a card can find its mirror in one lookup.
  const byContent = new Map<string, Card[]>();
  for (const c of cards) {
    if (c.type !== 'front_back') continue;
    const k = key(c.front, c.back);
    const bucket = byContent.get(k);
    if (bucket) bucket.push(c);
    else byContent.set(k, [c]);
  }

  for (const c of cards) {
    if (consumed.has(c.id)) continue;
    const tags = c.tags && c.tags.length ? { g: c.tags } : {};
    const front = stripAssetImages(c.front);
    const back = stripAssetImages(c.back);
    const imageFlag = front.stripped || back.stripped ? { i: 1 as const } : {};

    if (c.type === 'cloze') {
      out.push({ k: 1, f: front.markdown, ...tags, ...imageFlag });
      consumed.add(c.id);
      continue;
    }

    const partner = (byContent.get(key(c.back, c.front)) ?? []).find(
      (p) => p.id !== c.id && !consumed.has(p.id),
    );
    if (partner) {
      out.push({ k: 2, f: front.markdown, b: back.markdown, ...tags, ...imageFlag });
      consumed.add(c.id);
      consumed.add(partner.id);
    } else {
      out.push({ k: 0, f: front.markdown, b: back.markdown, ...tags, ...imageFlag });
      consumed.add(c.id);
    }
  }
  return out;
}

/** Build a single share code for the given decks, in the order supplied. */
export async function buildShareCode(deckIds: string[]): Promise<string> {
  const found = await db.decks.where('id').anyOf(deckIds).toArray();
  const order = new Map(deckIds.map((id, i) => [id, i]));
  found.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const decks: ShareDeck[] = [];
  for (const deck of found) {
    const cards = await db.cards.where('deckId').equals(deck.id).sortBy('createdAt');
    decks.push({
      n: deck.name,
      o: deck.examObjective === 'securedTopics' ? 1 : 0,
      c: deck.createdAt,
      e: deck.examDate,
      r: deck.fsrsParameters.requestRetention,
      ...(deck.newCardsPerDay ? { p: deck.newCardsPerDay } : {}),
      ...(deck.colour ? { l: deck.colour } : {}),
      cards: packCards(cards),
    });
  }

  return encodeShare({ v: SHARE_VERSION, by: null, at: Date.now(), decks });
}

// ---------------------------------------------------------------------------
// Unpacking (code -> DB)
// ---------------------------------------------------------------------------

function unpackCard(sc: ShareCard): ParsedCard[] {
  const tags = sc.g && sc.g.length ? { tags: sc.g } : {};
  if (sc.k === 1) return [{ type: 'cloze', front: sc.f, back: '', ...tags }];
  if (sc.k === 2) {
    const back = sc.b ?? '';
    return [
      { type: 'front_back', front: sc.f, back, ...tags },
      { type: 'front_back', front: back, back: sc.f, ...tags },
    ];
  }
  return [{ type: 'front_back', front: sc.f, back: sc.b ?? '', ...tags }];
}

/**
 * Create fresh decks from a decoded payload. Imported decks always become new decks
 * (sharing never overwrites existing data); their content and the original date due
 * are preserved, while all FSRS/review state starts clean for the new owner.
 */
export async function importSharePayload(
  payload: SharePayload,
): Promise<{ decks: number; cards: number }> {
  let cardCount = 0;
  await db.transaction('rw', db.decks, db.cards, db.userPerformance, db.assets, async () => {
    for (const d of payload.decks) {
      const drafts = d.cards.flatMap(unpackCard);
      const deck = await createDeckWithCards(d.n || 'Shared deck', drafts);
      await updateDeck(deck.id, {
        examObjective: d.o === 1 ? 'securedTopics' : 'expectedMarks',
        examDate: typeof d.e === 'number' ? d.e : deck.examDate,
        ...(d.p && d.p > 0 ? { newCardsPerDay: d.p } : {}),
        ...(typeof d.r === 'number'
          ? {
              fsrsParameters: {
                ...deck.fsrsParameters,
                requestRetention: clampRequestRetention(d.r),
              },
            }
          : {}),
        ...(d.l ? { colour: d.l } : {}),
      });
      cardCount += drafts.length;
    }
  });
  return { decks: payload.decks.length, cards: cardCount };
}
