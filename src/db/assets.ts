import { db } from './schema';
import type { BackupAsset, ImageAsset } from './types';

export const ASSET_PROTOCOL = 'lacuna-asset://';
const DATA_IMAGE_RE = /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/gi;
const ASSET_RE = /lacuna-asset:\/\/([a-f0-9]{64})/gi;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Build a Blob from raw bytes. We hand the Blob constructor a fresh ArrayBuffer
 * slice rather than the Uint8Array view directly: the DOM lib types now bind
 * typed arrays to a generic backing buffer (which may be a SharedArrayBuffer),
 * and a plain ArrayBuffer is unambiguously a BlobPart.
 */
function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer], { type: mimeType });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return hex(new Uint8Array(digest));
}

export function assetUrl(hash: string): string {
  return `${ASSET_PROTOCOL}${hash}`;
}

export function referencedAssetHashes(markdown: string): string[] {
  const hashes = new Set<string>();
  for (const match of markdown.matchAll(ASSET_RE)) hashes.add(match[1].toLowerCase());
  return [...hashes];
}

export function referencedAssetHashesInCards(cards: { front: string; back: string }[]): string[] {
  const hashes = new Set<string>();
  for (const card of cards) {
    referencedAssetHashes(`${card.front}\n${card.back}`).forEach((hash) => hashes.add(hash));
  }
  return [...hashes];
}

export function stripAssetImages(markdown: string): { markdown: string; stripped: boolean } {
  let stripped = false;
  const next = markdown.replace(/!\[([^\]]*)\]\(lacuna-asset:\/\/[a-f0-9]{64}\)/gi, (_m, alt) => {
    stripped = true;
    return `[Image omitted from share code: ${alt || 'image'}]`;
  });
  return { markdown: next, stripped };
}

export async function storeImageBlob(
  blob: Blob,
  mimeType: string,
  width: number,
  height: number,
): Promise<ImageAsset> {
  const hash = await sha256Blob(blob);
  const asset: ImageAsset = {
    hash,
    blob,
    mimeType,
    width,
    height,
    createdAt: Date.now(),
  };
  await db.assets.put(asset);
  return asset;
}

async function assetFromDataUri(uri: string, mimeType: string): Promise<ImageAsset> {
  const base64 = uri.slice(uri.indexOf(',') + 1);
  const bytes = base64ToBytes(base64);
  const blob = bytesToBlob(bytes, mimeType);
  const hash = await sha256Blob(blob);
  return { hash, blob, mimeType, width: 0, height: 0, createdAt: Date.now() };
}

export async function extractMarkdownAssets(
  markdown: string,
  putAsset: (asset: ImageAsset) => Promise<unknown>,
): Promise<string> {
  const replacements: { from: string; to: string }[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(DATA_IMAGE_RE)) {
    const from = match[0];
    if (seen.has(from)) continue;
    seen.add(from);
    const asset = await assetFromDataUri(from, match[1]);
    await putAsset(asset);
    replacements.push({ from, to: assetUrl(asset.hash) });
  }

  return replacements.reduce((text, r) => text.replaceAll(r.from, r.to), markdown);
}

export async function resolveAssetMarkdown(markdown: string): Promise<{
  markdown: string;
  objectUrls: string[];
}> {
  const replacements: { from: string; to: string }[] = [];
  const objectUrls: string[] = [];
  for (const hash of referencedAssetHashes(markdown)) {
    const asset = await db.assets.get(hash);
    if (!asset) continue;
    const url = URL.createObjectURL(asset.blob);
    objectUrls.push(url);
    replacements.push({ from: assetUrl(hash), to: url });
  }
  return {
    markdown: replacements.reduce((text, r) => text.replaceAll(r.from, r.to), markdown),
    objectUrls,
  };
}

export async function assetsForBackup(hashes: string[]): Promise<BackupAsset[]> {
  if (hashes.length === 0) return [];
  const assets = await db.assets.where('hash').anyOf(hashes).toArray();
  return Promise.all(
    assets.map(async (asset) => ({
      hash: asset.hash,
      data: bytesToBase64(new Uint8Array(await asset.blob.arrayBuffer())),
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
    })),
  );
}

export function backupAssetToImageAsset(asset: BackupAsset): ImageAsset {
  return {
    hash: asset.hash,
    blob: bytesToBlob(base64ToBytes(asset.data), asset.mimeType),
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Asset garbage collection
// ---------------------------------------------------------------------------

let gcTimeout: ReturnType<typeof setTimeout> | null = null;
let gcRunning = false;

/**
 * Scan every card's Markdown and remove assets whose hash is not referenced anywhere.
 * Safe to call at any time: it only deletes truly unreferenced rows.
 */
export async function collectOrphanedAssets(): Promise<number> {
  if (gcRunning) return 0;
  gcRunning = true;
  try {
    const cards = await db.cards.toArray();
    const referenced = new Set<string>();
    for (const card of cards) {
      referencedAssetHashes(`${card.front}\n${card.back}`).forEach((h) => referenced.add(h));
    }
    const allHashes = await db.assets.toCollection().primaryKeys();
    const orphans = allHashes.filter((h) => !referenced.has(h));
    if (orphans.length > 0) {
      await db.assets.bulkDelete(orphans);
    }
    return orphans.length;
  } finally {
    gcRunning = false;
  }
}

/**
 * Schedule a deferred asset sweep. Multiple rapid calls collapse into one so the
 * sweep runs only after a quiet period (e.g. after a bulk edit or import finishes).
 * Never runs during an active Learn session.
 */
export function scheduleAssetGc(delayMs = 3000): void {
  if (gcTimeout) clearTimeout(gcTimeout);
  gcTimeout = setTimeout(() => {
    void collectOrphanedAssets();
  }, delayMs);
}
